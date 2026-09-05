//! Ce que l'application retient d'un lancement a l'autre.
//!
//! Un seul fichier JSON dans le dossier de configuration de l'utilisateur. Il
//! contient le jeton d'appareil — celui obtenu en echange du code a six
//! caracteres — et rien d'autre de sensible : pas de mot de passe, pas de jeton
//! Riot, pas de session Discord.
//!
//! Le jeton vaut acces au compte : il est ecrit dans le dossier de l'utilisateur
//! courant, jamais a cote de l'executable (un dossier partage, ou une
//! installation lue par tous les comptes de la machine, le rendrait visible aux
//! autres sessions Windows).

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const SITE_PAR_DEFAUT: &str = "https://onlance.xyz";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Config {
    /// Absent tant que le PC n'est pas appairé.
    #[serde(default)]
    pub jeton: Option<String>,
    #[serde(default)]
    pub utilisateur: Option<String>,
    #[serde(default)]
    pub riot_id: Option<String>,
    #[serde(default)]
    pub nom_appareil: Option<String>,
}

impl Config {
    pub fn appairee(&self) -> bool {
        self.jeton.is_some()
    }

    /// Lit la configuration. Un fichier absent ou abime rend une config vide :
    /// l'application redemande simplement un code d'appairage, ce qui est
    /// toujours preferable a un ecran d'erreur dont personne ne sait sortir.
    pub fn charger(chemin: &Path) -> Self {
        std::fs::read_to_string(chemin)
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default()
    }

    pub fn enregistrer(&self, chemin: &Path) -> std::io::Result<()> {
        if let Some(parent) = chemin.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(chemin, serde_json::to_string_pretty(self)?)
    }
}

/// Adresse du serveur.
///
/// Surchargeable par `ONLANCE_URL` : c'est ce qui permet de faire tourner
/// l'application contre un serveur local pendant le developpement sans
/// recompiler ni toucher au code.
pub fn site() -> String {
    std::env::var("ONLANCE_URL")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| SITE_PAR_DEFAUT.to_string())
}

/// Nom propose pour cet appareil, pour que la liste des PC appairés sur le site
/// soit lisible sans effort.
pub fn nom_machine() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "PC".to_string())
}

pub fn chemin_config(base: PathBuf) -> PathBuf {
    base.join("config.json")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temporaire() -> PathBuf {
        let p = std::env::temp_dir().join(format!(
            "onlance-cfg-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        p.join("config.json")
    }

    #[test]
    fn une_config_absente_n_est_pas_une_erreur() {
        let c = Config::charger(Path::new("/n/existe/pas/config.json"));
        assert!(!c.appairee());
    }

    #[test]
    fn un_fichier_abime_repart_sur_une_config_vide() {
        // Plutot que de bloquer sur un ecran d'erreur : on redemande un code.
        let chemin = temporaire();
        std::fs::create_dir_all(chemin.parent().unwrap()).unwrap();
        std::fs::write(&chemin, "{ ceci n'est pas du json").unwrap();
        assert!(!Config::charger(&chemin).appairee());
        let _ = std::fs::remove_dir_all(chemin.parent().unwrap());
    }

    #[test]
    fn ce_qui_est_enregistre_se_relit() {
        let chemin = temporaire();
        let c = Config {
            jeton: Some("jeton-secret".into()),
            utilisateur: Some("fauxn9".into()),
            riot_id: Some("fauxn9#LUVGF".into()),
            nom_appareil: Some("PC de William".into()),
        };
        c.enregistrer(&chemin).unwrap();

        let relu = Config::charger(&chemin);
        assert!(relu.appairee());
        assert_eq!(relu.jeton.as_deref(), Some("jeton-secret"));
        assert_eq!(relu.riot_id.as_deref(), Some("fauxn9#LUVGF"));
        let _ = std::fs::remove_dir_all(chemin.parent().unwrap());
    }

    #[test]
    fn le_site_par_defaut_est_la_production() {
        // Sans variable d'environnement, aucune chance de pointer par accident
        // sur une machine de developpement.
        std::env::remove_var("ONLANCE_URL");
        assert_eq!(site(), "https://onlance.xyz");
    }
}
