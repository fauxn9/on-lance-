//! Le lockfile du client League : `LeagueClient:pid:port:motdepasse:https`.
//!
//! Il n'existe que pendant que le client tourne, dans son dossier
//! d'installation. Un client redémarré change de port ET de mot de passe : on
//! relit donc le fichier à chaque connexion, jamais de cache.

use base64::Engine;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Lockfile {
    pub pid: u32,
    pub port: u16,
    pub mot_de_passe: String,
    pub protocole: String,
}

impl Lockfile {
    pub fn parser(brut: &str) -> Result<Self, String> {
        let champs: Vec<&str> = brut.trim().split(':').collect();
        if champs.len() != 5 {
            return Err(format!("{} champs au lieu de 5", champs.len()));
        }
        Ok(Self {
            pid: champs[1].parse().map_err(|_| "pid illisible")?,
            port: champs[2].parse().map_err(|_| "port illisible")?,
            mot_de_passe: champs[3].to_string(),
            protocole: champs[4].to_string(),
        })
    }

    pub fn base_url(&self) -> String {
        format!("{}://127.0.0.1:{}", self.protocole, self.port)
    }

    pub fn ws_url(&self) -> String {
        format!("wss://127.0.0.1:{}/", self.port)
    }

    /// En-tête `Authorization` : l'utilisateur est toujours `riot`.
    pub fn autorisation(&self) -> String {
        let brut = format!("riot:{}", self.mot_de_passe);
        format!("Basic {}", base64::engine::general_purpose::STANDARD.encode(brut))
    }
}

/// Lit `product_install_full_path` dans le fichier de réglages que le Riot
/// Client tient à jour pour League.
pub fn chemin_depuis_reglages(contenu: &str) -> Option<PathBuf> {
    contenu.lines().find_map(|ligne| {
        let reste = ligne.trim().strip_prefix("product_install_full_path:")?;
        let chemin = reste.trim().trim_matches('"').trim_matches('\'');
        (!chemin.is_empty()).then(|| PathBuf::from(chemin))
    })
}

/// Dossiers où chercher le lockfile, du plus sûr au plus probable.
pub fn dossiers_candidats() -> Vec<PathBuf> {
    let mut v = Vec::new();
    if let Ok(d) = std::env::var("ONLANCE_LOL_DIR") {
        v.push(PathBuf::from(d));
    }
    let program_data = std::env::var("PROGRAMDATA").unwrap_or_else(|_| r"C:\ProgramData".into());
    let reglages = Path::new(&program_data)
        .join("Riot Games")
        .join("Metadata")
        .join("league_of_legends.live")
        .join("league_of_legends.live.product_settings.yaml");
    if let Some(d) = std::fs::read_to_string(reglages).ok().as_deref().and_then(chemin_depuis_reglages) {
        v.push(d);
    }
    v.push(PathBuf::from(r"C:\Riot Games\League of Legends"));
    v.dedup();
    v
}

/// Le lockfile du client s'il tourne, sinon `None`.
pub fn trouver() -> Option<Lockfile> {
    dossiers_candidats()
        .into_iter()
        .find_map(|d| std::fs::read_to_string(d.join("lockfile")).ok())
        .and_then(|brut| Lockfile::parser(&brut).ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lit_un_lockfile() {
        let l = Lockfile::parser("LeagueClient:18236:61234:AbC-dEf_123:https").unwrap();
        assert_eq!(l.pid, 18236);
        assert_eq!(l.port, 61234);
        assert_eq!(l.base_url(), "https://127.0.0.1:61234");
        assert_eq!(l.ws_url(), "wss://127.0.0.1:61234/");
        // base64("riot:AbC-dEf_123")
        assert_eq!(l.autorisation(), "Basic cmlvdDpBYkMtZEVmXzEyMw==");
    }

    #[test]
    fn refuse_un_lockfile_tronque() {
        assert!(Lockfile::parser("LeagueClient:1:2").is_err());
        assert!(Lockfile::parser("LeagueClient:x:2:p:https").is_err());
    }

    #[test]
    fn lit_le_dossier_dinstallation() {
        let yaml = "patchline_patching_ask_policy: \"ask\"\nproduct_install_full_path: \"C:/Riot Games/League of Legends\"\nproduct_install_root: \"C:/Riot Games/\"\n";
        assert_eq!(chemin_depuis_reglages(yaml), Some(PathBuf::from("C:/Riot Games/League of Legends")));
        assert_eq!(chemin_depuis_reglages("rien: \"ici\""), None);
    }
}
