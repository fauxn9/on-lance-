//! Le seul endroit de l'application qui parle au client Riot.
//!
//! CE QU'ON FAIT, ET CE QU'ON NE FAIT PAS
//!
//! On lit le lockfile que le client ecrit lui-meme, et on interroge son serveur
//! HTTP local. Rien d'autre : aucune injection, aucun hook dans le processus du
//! jeu, aucun fichier du jeu touche, aucune requete aux serveurs de Riot. C'est
//! la contrainte de conception de la brique 9, et elle n'est pas negociable.
//!
//! Ces routes ne sont pas documentees par Riot et peuvent disparaitre a
//! n'importe quelle mise a jour. L'application doit donc traiter leur absence
//! comme un cas NORMAL — pas comme une panne.

use base64::Engine;
use presence_core::lockfile::{self, Lockfile};
use serde_json::Value;
use std::path::PathBuf;
use std::time::Duration;

#[derive(Debug, thiserror::Error)]
pub enum ErreurRiot {
    #[error("le client Riot n'est pas lancé")]
    ClientAbsent,
    #[error("lockfile illisible : {0}")]
    Lockfile(String),
    #[error("appel local en échec : {0}")]
    Appel(String),
    #[error("réponse inattendue du client (HTTP {0})")]
    Statut(u16),
}

/// Chemin par defaut du lockfile sous Windows.
///
/// On passe par LOCALAPPDATA plutot que de reconstruire le chemin depuis le
/// nom d'utilisateur : un profil peut etre ailleurs que dans C:\Users.
pub fn chemin_lockfile() -> PathBuf {
    let base = std::env::var("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            std::env::var("HOME")
                .map(|h| PathBuf::from(h).join("AppData").join("Local"))
                .unwrap_or_default()
        });
    base.join("Riot Games")
        .join("Riot Client")
        .join("Config")
        .join("lockfile")
}

pub struct ClientRiot {
    lock: Lockfile,
    http: reqwest::Client,
}

impl ClientRiot {
    /// Relit le lockfile et fabrique un client.
    ///
    /// A refaire a chaque tentative, jamais a garder en cache : un client Riot
    /// redemarre change de port ET de mot de passe. Un cache donnerait des
    /// erreurs de connexion incomprehensibles apres un simple redemarrage.
    pub fn detecter(chemin: &std::path::Path) -> Result<Self, ErreurRiot> {
        let brut = std::fs::read_to_string(chemin).map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                ErreurRiot::ClientAbsent
            } else {
                ErreurRiot::Lockfile(e.to_string())
            }
        })?;
        let lock = lockfile::parser(&brut).map_err(|e| ErreurRiot::Lockfile(format!("{e:?}")))?;
        Ok(Self::depuis_lockfile(lock))
    }

    /// Construit le client a partir d'un lockfile deja analyse (utile en test).
    ///
    /// `danger_accept_invalid_certs` merite une explication : le serveur local
    /// du client Riot presente un certificat auto-signe, et aucune autorite au
    /// monde ne peut signer un certificat pour 127.0.0.1. La verification est
    /// donc levee — mais UNIQUEMENT sur ce client-ci, qui ne sert qu'a joindre
    /// la boucle locale. Le client qui parle au serveur d'On lance ? est un
    /// autre objet, avec la verification intacte.
    pub fn depuis_lockfile(lock: Lockfile) -> Self {
        let http = reqwest::Client::builder()
            .danger_accept_invalid_certs(true)
            .timeout(Duration::from_secs(5))
            .build()
            .expect("client HTTP local");
        Self { lock, http }
    }

    async fn appel(&self, chemin: &str) -> Result<Value, ErreurRiot> {
        let url = format!("{}{}", self.lock.base_url(), chemin);
        let rep = self
            .http
            .get(&url)
            .header("Authorization", self.lock.autorisation())
            .send()
            .await
            .map_err(|e| ErreurRiot::Appel(e.to_string()))?;

        let statut = rep.status();
        if !statut.is_success() {
            return Err(ErreurRiot::Statut(statut.as_u16()));
        }
        rep.json::<Value>()
            .await
            .map_err(|e| ErreurRiot::Appel(e.to_string()))
    }

    /// Le puuid du compte connecte sur CETTE machine.
    ///
    /// Personne ne peut le fabriquer sans etre reellement connecte avec ce
    /// compte : c'est la preuve de propriete qui manquait depuis la brique 4.
    pub async fn puuid(&self) -> Result<String, ErreurRiot> {
        let v = self.appel("/entitlements/v1/token").await?;
        v.get("subject")
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| ErreurRiot::Appel("pas de `subject` dans la réponse".into()))
    }

    /// La charge utile de presence du JEU pour ce puuid, deja decodee.
    ///
    /// `Ok(None)` veut dire « Valorant n'est pas lance » — ce n'est pas une
    /// erreur, c'est l'etat le plus courant de la journee.
    pub async fn presence(&self, puuid: &str) -> Result<Option<Value>, ErreurRiot> {
        let v = self.appel("/chat/v4/presences").await?;
        let Some(liste) = v.get("presences").and_then(Value::as_array) else {
            return Ok(None);
        };
        Ok(presence_du_jeu(liste, puuid))
    }
}

/// Retrouve la presence du jeu parmi celles du compte, et la decode.
///
/// Un meme compte a PLUSIEURS presences, une par produit. Celle de
/// `riot_client` ne contient aucun etat de partie : la premiere version de la
/// sonde prenait la premiere venue, donc celle du client, et concluait a tort
/// que tout allait bien.
pub fn presence_du_jeu(presences: &[Value], puuid: &str) -> Option<Value> {
    presences
        .iter()
        .find(|p| {
            p.get("puuid").and_then(Value::as_str) == Some(puuid)
                && p.get("product").and_then(Value::as_str) == Some("valorant")
        })
        .and_then(decoder_presence)
}

/// Le detail utile d'une presence est du JSON encode en base64 dans `private`.
pub fn decoder_presence(p: &Value) -> Option<Value> {
    let brut = p.get("private")?.as_str()?;
    let octets = base64::engine::general_purpose::STANDARD.decode(brut).ok()?;
    serde_json::from_slice(&octets).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn encode(v: Value) -> String {
        base64::engine::general_purpose::STANDARD.encode(v.to_string())
    }

    #[test]
    fn ignore_la_presence_du_client_et_prend_celle_du_jeu() {
        // L'erreur de la v1 de la sonde, en un test.
        let moi = "274cbb77";
        let presences = vec![
            json!({ "puuid": moi, "product": "riot_client", "private": encode(json!({"x": 1})) }),
            json!({ "puuid": moi, "product": "valorant",
                    "private": encode(json!({"matchPresenceData": {"sessionLoopState": "INGAME"}})) }),
        ];
        let p = presence_du_jeu(&presences, moi).unwrap();
        assert_eq!(p["matchPresenceData"]["sessionLoopState"], "INGAME");
    }

    #[test]
    fn ignore_les_presences_des_amis() {
        let presences = vec![
            json!({ "puuid": "un-ami", "product": "valorant", "private": encode(json!({"a": 1})) }),
        ];
        assert!(presence_du_jeu(&presences, "moi").is_none());
    }

    #[test]
    fn jeu_ferme_n_est_pas_une_erreur() {
        let presences =
            vec![json!({ "puuid": "moi", "product": "riot_client", "private": encode(json!({})) })];
        assert!(presence_du_jeu(&presences, "moi").is_none());
    }

    #[test]
    fn une_presence_illisible_ne_fait_pas_tomber_l_application() {
        assert!(decoder_presence(&json!({ "private": "pas du base64 !!" })).is_none());
        assert!(decoder_presence(&json!({ "private": null })).is_none());
        assert!(decoder_presence(&json!({})).is_none());
        // Du base64 valide qui ne contient pas de JSON.
        let faux = base64::engine::general_purpose::STANDARD.encode("bonjour");
        assert!(decoder_presence(&json!({ "private": faux })).is_none());
    }
}
