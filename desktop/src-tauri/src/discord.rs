//! Le statut Rich Presence, pose sur Discord.
//!
//! CE QUE CETTE COUCHE FAIT, ET SURTOUT CE QU'ELLE NE FAIT PAS
//!
//! Elle ne decide rien : `agent_core::statut::composer` compose les lignes, ici
//! on ne fait que les transmettre. Tout ce qui merite d'etre teste vit donc
//! dans agent-core, qui se compile et se teste sans Discord ni Windows.
//!
//! AUCUN COMPTE DISCORD N'EST TOUCHE
//!
//! Le Rich Presence passe par un tuyau nomme LOCAL (`\\?\pipe\discord-ipc-N`),
//! ouvert par le client Discord deja lance sur la machine. L'application ne
//! detient aucun jeton, ne se connecte a aucun compte, et ne lit rien : elle
//! pose un statut, c'est tout. Discord ferme, il ne se passe simplement rien.
//!
//! LA LIMITE DES QUINZE SECONDES
//!
//! Discord n'accepte qu'une mise a jour d'activite toutes les 15 secondes.
//! Notre boucle bat toutes les 2 secondes : sans la temporisation ci-dessous,
//! Discord finirait par ignorer les envois, et le statut se figerait sans le
//! moindre message d'erreur. On ne renvoie donc que si le contenu a CHANGE et
//! que le delai est passe.
//!
//! Le chronometre, lui, ne coute rien : on transmet l'instant de debut une
//! seule fois et Discord fait defiler les secondes de son cote.

use agent_core::statut::Presence;
use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};

/// Impose par Discord. En dessous, les mises a jour sont silencieusement
/// ignorees — donc pire qu'un refus, puisqu'on croirait qu'elles passent.
const DELAI_MIN_MS: i64 = 15_000;

/// Discord ferme est le cas NORMAL, pas une panne : on ne retente pas en
/// boucle, ce serait ouvrir un tuyau toutes les deux secondes pour rien.
const DELAI_RECONNEXION_MS: i64 = 60_000;

pub struct Vitrine {
    identifiant: String,
    site: String,
    releases: String,
    client: Option<DiscordIpcClient>,
    /// Ce qui est REELLEMENT affiche en ce moment, pour ne renvoyer que sur
    /// changement. Sans ca, on consommerait le quota a repeter la meme chose.
    pose: Option<Presence>,
    dernier_envoi_ms: i64,
    prochaine_tentative_ms: i64,
}

impl Vitrine {
    pub fn nouvelle(identifiant: impl Into<String>, site: &str) -> Self {
        Self {
            identifiant: identifiant.into(),
            site: site.trim_end_matches('/').to_string(),
            releases: "https://github.com/fauxn9/on-lance-/releases".to_string(),
            client: None,
            pose: None,
            dernier_envoi_ms: 0,
            prochaine_tentative_ms: 0,
        }
    }

    /// Vrai si le statut a effectivement ete transmis a Discord ce tour-ci.
    pub fn poser(&mut self, voulu: Option<&Presence>, maintenant_ms: i64) -> bool {
        // Statut coupe dans les reglages : on efface ce qui traine et on rend
        // la main. Ne rien faire laisserait le dernier statut affiche pour
        // toujours, ce qui serait la pire facon de respecter un refus.
        let Some(voulu) = voulu else {
            if self.pose.is_some() {
                if let Some(c) = self.client.as_mut() {
                    let _ = c.clear_activity();
                }
                self.pose = None;
            }
            return false;
        };

        if self.identifiant.is_empty() {
            return false;
        }
        if self.pose.as_ref() == Some(voulu) {
            return false; // rien de neuf : on ne depense pas le quota
        }
        if maintenant_ms - self.dernier_envoi_ms < DELAI_MIN_MS {
            return false; // trop tot, on repassera au prochain battement
        }
        if !self.connecte(maintenant_ms) {
            return false;
        }

        let mut activite = activity::Activity::new().details(voulu.details.clone());

        if let Some(s) = voulu.state.clone() {
            activite = activite.state(s);
        }
        if let Some(debut) = voulu.debut_s {
            activite = activite.timestamps(activity::Timestamps::new().start(debut));
        }

        let mut visuels = activity::Assets::new().large_image(voulu.grande_image.clone());
        if let Some(t) = voulu.grand_texte.clone() {
            visuels = visuels.large_text(t);
        }
        if let Some(t) = voulu.petit_texte.clone() {
            // Le rang en petite pastille, avec son nom en info-bulle.
            visuels = visuels.small_image("rang").small_text(t);
        }
        activite = activite.assets(visuels);

        // Deux boutons, le maximum autorise. Le second est le vrai moteur :
        // quelqu'un lit le statut d'un ami et s'installe en deux clics.
        activite = activite.buttons(vec![
            activity::Button::new("Voir le classement", self.site.clone()),
            activity::Button::new("Installer l'app", self.releases.clone()),
        ]);

        match self.client.as_mut().unwrap().set_activity(activite) {
            Ok(()) => {
                self.pose = Some(voulu.clone());
                self.dernier_envoi_ms = maintenant_ms;
                true
            }
            Err(err) => {
                // Discord a ete ferme entre-temps : le tuyau est mort, on
                // repartira d'une connexion neuve.
                eprintln!("[onlance] statut Discord non transmis : {err}");
                self.client = None;
                self.pose = None;
                self.prochaine_tentative_ms = maintenant_ms + DELAI_RECONNEXION_MS;
                false
            }
        }
    }

    fn connecte(&mut self, maintenant_ms: i64) -> bool {
        if self.client.is_some() {
            return true;
        }
        if maintenant_ms < self.prochaine_tentative_ms {
            return false;
        }

        let mut c = DiscordIpcClient::new(&self.identifiant);
        match c.connect() {
            Ok(()) => {
                self.client = Some(c);
                true
            }
            Err(_) => {
                // Silencieux : Discord ferme est le cas courant, et une erreur
                // par minute dans la console n'apprendrait rien a personne.
                self.prochaine_tentative_ms = maintenant_ms + DELAI_RECONNEXION_MS;
                false
            }
        }
    }
}

impl Drop for Vitrine {
    /// L'application se ferme : on retire le statut plutot que de laisser
    /// « En partie — Ascent » affiche jusqu'au redemarrage de Discord.
    fn drop(&mut self) {
        if let Some(c) = self.client.as_mut() {
            let _ = c.clear_activity();
            let _ = c.close();
        }
    }
}
