//! Appels HTTPS au client League et à l'API de partie en direct.

use crate::lockfile::Lockfile;
use serde_json::Value;
use std::time::Duration;

#[derive(Debug, thiserror::Error)]
pub enum Erreur {
    #[error("appel local en échec : {0}")]
    Appel(String),
    #[error("réponse inattendue du client (HTTP {0})")]
    Statut(u16),
    #[error("WebSocket du client : {0}")]
    Ws(String),
    #[error("le client a refusé (HTTP {0}) : {1}")]
    Refus(u16, String),
}

/// Le client HTTP local.
///
/// `danger_accept_invalid_certs` mérite une explication : le client League et
/// le jeu présentent un certificat auto-signé pour 127.0.0.1, qu'aucune
/// autorité ne peut signer. La vérification est levée UNIQUEMENT sur ce
/// client-ci, qui ne sort jamais de la boucle locale. Le client qui parle au
/// serveur d'On lance ? est un autre objet, avec la vérification intacte.
fn http_local() -> reqwest::Client {
    reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(Duration::from_secs(4))
        .no_proxy()
        .build()
        .expect("client HTTP local")
}

#[derive(Clone)]
pub struct Lcu {
    base: String,
    autorisation: String,
    http: reqwest::Client,
}

impl Lcu {
    pub fn new(lock: &Lockfile) -> Self {
        Self { base: lock.base_url(), autorisation: lock.autorisation(), http: http_local() }
    }

    /// `Ok(None)` : la route existe mais n'a rien à dire (404), ce qui est
    /// courant (pas de partie en cours, pas de session de sélection…).
    pub async fn get(&self, chemin: &str) -> Result<Option<Value>, Erreur> {
        let rep = self
            .http
            .get(format!("{}{}", self.base, chemin))
            .header("Authorization", &self.autorisation)
            .send()
            .await
            .map_err(|e| Erreur::Appel(e.to_string()))?;
        match rep.status().as_u16() {
            200..=299 => rep.json::<Value>().await.map(Some).map_err(|e| Erreur::Appel(e.to_string())),
            404 => Ok(None),
            s => Err(Erreur::Statut(s)),
        }
    }

    /// Écriture dans le client (brique 4 : runes, sorts, sets d'items). Toujours
    /// déclenchée par l'utilisateur ou par un réglage qu'il a activé.
    pub async fn envoyer(&self, methode: reqwest::Method, chemin: &str, corps: Option<&Value>) -> Result<Option<Value>, Erreur> {
        let mut req = self.http.request(methode, format!("{}{}", self.base, chemin)).header("Authorization", &self.autorisation);
        if let Some(c) = corps {
            req = req.json(c);
        }
        let rep = req.send().await.map_err(|e| Erreur::Appel(e.to_string()))?;
        let statut = rep.status().as_u16();
        if !(200..300).contains(&statut) {
            let detail = rep.text().await.unwrap_or_default();
            return Err(Erreur::Refus(statut, detail.chars().take(200).collect()));
        }
        let texte = rep.text().await.unwrap_or_default();
        Ok(if texte.trim().is_empty() { None } else { serde_json::from_str(&texte).ok() })
    }
}

/// Le jeu est-il jouable ? L'API de partie en direct (port 2999) ne répond
/// qu'une fois l'écran de chargement terminé. C'est l'API officielle du jeu.
pub async fn jeu_charge() -> bool {
    static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    let http = CLIENT.get_or_init(http_local);
    matches!(
        http.get("https://127.0.0.1:2999/liveclientdata/gamestats").send().await,
        Ok(r) if r.status().is_success()
    )
}
