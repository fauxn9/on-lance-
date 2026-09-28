//! Le client du serveur On lance ? (onlance.xyz), et les jetons d'appareil.
//!
//! Le jeton reste côté Rust : l'interface ne le voit jamais.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

pub struct Serveur {
    base: String,
    http: reqwest::Client,
}

impl Serveur {
    /// `ONLANCE_URL` permet de pointer l'app sur un serveur local en développement.
    pub fn new() -> Self {
        let base = std::env::var("ONLANCE_URL").unwrap_or_else(|_| "https://onlance.xyz".into());
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(90)) // un serveur Render endormi met ~1 min à se réveiller
            .user_agent(concat!("OnLance/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("client HTTP");
        Self { base: base.trim_end_matches('/').to_string(), http }
    }

    async fn envoyer(&self, req: reqwest::RequestBuilder) -> Result<Value, String> {
        let rep = req.send().await.map_err(|_| "Serveur On lance ? injoignable.".to_string())?;
        let statut = rep.status();
        let corps: Value = if statut == reqwest::StatusCode::NO_CONTENT { Value::Null } else { rep.json().await.unwrap_or(Value::Null) };
        if statut.is_success() {
            Ok(corps)
        } else {
            Err(corps["erreur"].as_str().map(str::to_string).unwrap_or_else(|| format!("Erreur du serveur (HTTP {statut}).")))
        }
    }

    pub async fn enregistrer(&self, puuid: &str, plateforme: &str) -> Result<String, String> {
        let corps = json!({ "puuid": puuid, "platform": plateforme, "appVersion": env!("CARGO_PKG_VERSION") });
        let v = self.envoyer(self.http.post(format!("{}/api/app/register", self.base)).json(&corps)).await?;
        v["token"].as_str().map(str::to_string).ok_or_else(|| "Réponse d'enregistrement invalide.".into())
    }

    pub async fn get(&self, jeton: &str, chemin: &str) -> Result<Value, String> {
        self.envoyer(self.http.get(format!("{}/api/app{}", self.base, chemin)).bearer_auth(jeton)).await
    }

    pub async fn post(&self, jeton: &str, chemin: &str, corps: &Value) -> Result<Value, String> {
        self.envoyer(self.http.post(format!("{}/api/app{}", self.base, chemin)).bearer_auth(jeton).json(corps)).await
    }

    /// Statistiques publiques (/api/stats) : le jeton est facultatif et ne sert
    /// qu'à personnaliser les suggestions avec l'historique du joueur.
    pub async fn stats_get(&self, chemin: &str) -> Result<Value, String> {
        self.envoyer(self.http.get(format!("{}/api/stats{}", self.base, chemin))).await
    }

    pub async fn stats_post(&self, jeton: Option<&str>, chemin: &str, corps: &Value) -> Result<Value, String> {
        let mut req = self.http.post(format!("{}/api/stats{}", self.base, chemin)).json(corps);
        if let Some(j) = jeton {
            req = req.bearer_auth(j);
        }
        self.envoyer(req).await
    }
}

/// Jetons par compte, et le dernier compte vu : l'app peut afficher son
/// historique même quand le client League est fermé.
#[derive(Default, Serialize, Deserialize)]
pub struct Jetons {
    pub dernier: Option<String>,
    pub plateformes: HashMap<String, String>,
    pub jetons: HashMap<String, String>,
}

impl Jetons {
    pub fn charger(chemin: &Path) -> Self {
        std::fs::read_to_string(chemin).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
    }

    pub fn sauver(&self, chemin: &PathBuf) {
        if let Some(dossier) = chemin.parent() {
            let _ = std::fs::create_dir_all(dossier);
        }
        if let Ok(s) = serde_json::to_string_pretty(self) {
            let _ = std::fs::write(chemin, s);
        }
    }
}
