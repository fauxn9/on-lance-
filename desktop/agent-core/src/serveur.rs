//! Le dialogue avec On lance ? (le vrai serveur, pas le client Riot).
//!
//! Deux appels seulement : l'appairage, une fois dans la vie de l'application,
//! et le battement de coeur, qui porte l'etat de partie et les evenements.
//!
//! Ce client-ci verifie les certificats normalement. Seul le client qui joint
//! la boucle locale accepte un certificat auto-signe, et pour une raison
//! precise ecrite dans `riot.rs`.

use presence_core::{Etat, Evenement};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

#[derive(Debug, thiserror::Error)]
pub enum ErreurServeur {
    #[error("serveur injoignable : {0}")]
    Reseau(String),
    /// Le serveur a repondu, mais il refuse. Le message vient de lui : il est
    /// ecrit pour etre montre tel quel a l'utilisateur.
    #[error("{message}")]
    Refus { statut: u16, message: String },
}

#[derive(Debug, Deserialize)]
pub struct ReponseAppairage {
    pub jeton: String,
    pub verification: String,
    pub message: String,
    pub utilisateur: Utilisateur,
}

#[derive(Debug, Deserialize)]
pub struct Utilisateur {
    #[serde(rename = "displayName")]
    pub display_name: Option<String>,
    #[serde(rename = "riotId")]
    pub riot_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ReponseBattement {
    pub ok: bool,
    pub utilisateur: Option<String>,
    pub verifie: Option<bool>,
}

#[derive(Debug, Serialize)]
struct CorpsAppairage<'a> {
    code: &'a str,
    puuid: Option<&'a str>,
    nom: &'a str,
    version: &'a str,
}

#[derive(Debug, Serialize)]
struct CorpsBattement<'a> {
    version: &'a str,
    etat: Option<Etat>,
    evenements: &'a [Evenement],
}

#[derive(Debug, Deserialize)]
struct CorpsErreur {
    error: Option<String>,
}

pub struct ClientServeur {
    base: String,
    http: reqwest::Client,
    version: String,
}

impl ClientServeur {
    pub fn nouveau(base: impl Into<String>, version: impl Into<String>) -> Self {
        Self {
            // Une base avec un slash final produirait des URL a double slash,
            // qu'Express traite comme des chemins differents.
            base: base.into().trim_end_matches('/').to_string(),
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(10))
                .build()
                .expect("client HTTP"),
            version: version.into(),
        }
    }

    async fn lire_reponse<T: for<'de> Deserialize<'de>>(
        rep: reqwest::Response,
    ) -> Result<T, ErreurServeur> {
        let statut = rep.status().as_u16();
        let texte = rep
            .text()
            .await
            .map_err(|e| ErreurServeur::Reseau(e.to_string()))?;

        if !(200..300).contains(&statut) {
            // On prefere le message du serveur, ecrit en francais et pour un
            // humain, a un « HTTP 404 » que personne ne sait interpreter.
            let message = serde_json::from_str::<CorpsErreur>(&texte)
                .ok()
                .and_then(|c| c.error)
                .unwrap_or_else(|| format!("Le serveur a répondu {statut}"));
            return Err(ErreurServeur::Refus { statut, message });
        }

        serde_json::from_str::<T>(&texte).map_err(|e| ErreurServeur::Reseau(e.to_string()))
    }

    /// Echange le code a six caracteres contre un jeton durable.
    ///
    /// Le puuid local part avec : c'est lui qui permet au serveur de verifier
    /// que le compte Riot declare sur le site est bien celui ouvert sur ce PC.
    pub async fn appairer(
        &self,
        code: &str,
        puuid: Option<&str>,
        nom: &str,
    ) -> Result<ReponseAppairage, ErreurServeur> {
        let rep = self
            .http
            .post(format!("{}/devices/pair", self.base))
            .json(&CorpsAppairage {
                code,
                puuid,
                nom,
                version: &self.version,
            })
            .send()
            .await
            .map_err(|e| ErreurServeur::Reseau(e.to_string()))?;
        Self::lire_reponse(rep).await
    }

    /// Lecture d'une route du site, au nom de l'appareil appairé.
    ///
    /// C'est ce qui permet a l'application d'afficher les memes donnees que le
    /// site — classement, historique, coach — sans navigateur ni cookie. Le
    /// serveur n'ouvre que des routes de LECTURE a un jeton d'appareil.
    pub async fn lire(&self, jeton: &str, chemin: &str) -> Result<Value, ErreurServeur> {
        let rep = self
            .http
            .get(format!("{}{}", self.base, chemin))
            .bearer_auth(jeton)
            .send()
            .await
            .map_err(|e| ErreurServeur::Reseau(e.to_string()))?;
        Self::lire_reponse(rep).await
    }

    /// Battement de coeur : dit que le PC est la, et porte ce qui vient de se
    /// passer.
    ///
    /// Les evenements sont envoyes en lot plutot qu'un par un : deux d'entre
    /// eux peuvent tomber dans le meme intervalle de deux secondes (le score
    /// change et la partie se termine), et les separer inventerait un ordre.
    pub async fn battement(
        &self,
        jeton: &str,
        etat: Option<Etat>,
        evenements: &[Evenement],
    ) -> Result<ReponseBattement, ErreurServeur> {
        let rep = self
            .http
            .post(format!("{}/devices/heartbeat", self.base))
            .bearer_auth(jeton)
            .json(&CorpsBattement {
                version: &self.version,
                etat,
                evenements,
            })
            .send()
            .await
            .map_err(|e| ErreurServeur::Reseau(e.to_string()))?;
        Self::lire_reponse(rep).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn la_base_ne_produit_pas_de_double_slash() {
        let c = ClientServeur::nouveau("https://onlance.xyz/", "0.1.0");
        assert_eq!(c.base, "https://onlance.xyz");
    }

    #[test]
    fn le_corps_d_appairage_a_les_bons_noms_de_champs() {
        // Le serveur lit `code`, `puuid`, `nom`, `version` : un renommage
        // silencieux cote Rust passerait les tests unitaires et casserait en
        // production.
        let corps = CorpsAppairage {
            code: "AB2CD3",
            puuid: Some("274cbb77"),
            nom: "PC de William",
            version: "0.1.0",
        };
        let v = serde_json::to_value(&corps).unwrap();
        assert_eq!(v["code"], "AB2CD3");
        assert_eq!(v["puuid"], "274cbb77");
        assert_eq!(v["nom"], "PC de William");
        assert_eq!(v["version"], "0.1.0");
    }

    #[test]
    fn un_puuid_absent_part_en_null_pas_en_chaine_vide() {
        // Le serveur teste `typeof req.body.puuid === 'string'` : une chaine
        // vide passerait pour un puuid et casserait la verification.
        let corps = CorpsAppairage {
            code: "AB2CD3",
            puuid: None,
            nom: "PC",
            version: "0.1.0",
        };
        assert!(serde_json::to_value(&corps).unwrap()["puuid"].is_null());
    }

    #[test]
    fn les_evenements_partent_avec_leur_type() {
        let evs = vec![Evenement::Fin {
            map_code: Some("Triad".into()),
            queue: Some("competitive".into()),
            score: Some(presence_core::Score { nous: 13, eux: 10 }),
            duree_ms: Some(2_073_000),
            a: 1_788_558_004_000,
        }];
        let v = serde_json::to_value(&evs).unwrap();
        assert_eq!(v[0]["type"], "fin");
        assert_eq!(v[0]["score"]["nous"], 13);
        assert_eq!(v[0]["map_code"], "Triad");
    }
}
