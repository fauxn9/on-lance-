//! Le cerveau de l'application PC, sans interface et sans Tauri.
//!
//! Tout ce qui decide vit ici ; la couche Tauri ne fait qu'ouvrir une fenetre
//! et appeler `Agent::battre()` toutes les deux secondes. Cette separation
//! n'est pas cosmetique : elle permet de tester la boucle complete — lockfile,
//! client Riot, machine a etats, envoi au serveur — sur Linux, sans Valorant,
//! avec un faux client Riot.

pub mod riot;
pub mod serveur;
pub mod statut;

use presence_core::{Etat, Evenement, Machine, Score};
use riot::{ClientRiot, ErreurRiot};
use serde::Serialize;
use std::path::PathBuf;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Ce que l'interface a besoin de savoir, et rien de plus.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct EtatAffiche {
    /// `None` : Valorant n'est pas lance. Ce n'est pas une panne.
    pub etat: Option<Etat>,
    pub map_code: Option<String>,
    pub queue: Option<String>,
    pub party_size: Option<i64>,
    /// Rang competitif, tel que le client Riot le publie. Sert a remplir la
    /// fenetre quand aucune partie n'est en cours — c'est l'etat le plus
    /// frequent de la journee, il n'a pas a etre vide.
    pub tier: Option<i64>,
    pub client_riot: bool,
    /// Score de la partie en cours, tel que la machine le FIGE.
    ///
    /// Volontairement celui de la machine et pas celui de l'instantane : le
    /// client Riot remet la presence a 0-0 au retour au menu, et lire la valeur
    /// brute afficherait donc 0-0 a la fin de chaque partie. La machine, elle,
    /// refuse toute baisse — voir l'en-tete de presence-core.
    pub score: Option<Score>,
    /// Dernier probleme rencontre, deja redige pour un humain.
    pub souci: Option<String>,
}

pub struct Agent {
    chemin_lockfile: PathBuf,
    machine: Machine,
    /// Le puuid ne change pas tant que le client Riot tourne ; on le garde pour
    /// ne pas redemander un jeton d'entitlements toutes les deux secondes.
    puuid: Option<String>,
    dernier_etat: EtatAffiche,
}

impl Agent {
    pub fn nouveau(chemin_lockfile: PathBuf) -> Self {
        Self {
            chemin_lockfile,
            machine: Machine::nouvelle(),
            puuid: None,
            dernier_etat: EtatAffiche {
                etat: None,
                map_code: None,
                queue: None,
                party_size: None,
                tier: None,
                client_riot: false,
                score: None,
                souci: None,
            },
        }
    }

    pub fn etat(&self) -> &EtatAffiche {
        &self.dernier_etat
    }

    /// Le puuid deja lu, s'il l'a ete. Sert a l'appairage.
    pub fn puuid(&self) -> Option<&str> {
        self.puuid.as_deref()
    }

    /// Lit le client Riot une fois et fait avancer la machine.
    ///
    /// Ne renvoie jamais d'erreur : un client ferme, un lockfile qui disparait,
    /// une route qui change — tout ca est normal et se raconte dans
    /// `EtatAffiche.souci`. Une application de fond qui s'arrete parce que le
    /// jeu est ferme serait absurde.
    pub async fn battre(&mut self, maintenant: i64) -> Vec<Evenement> {
        let client = match ClientRiot::detecter(&self.chemin_lockfile) {
            Ok(c) => c,
            Err(err) => {
                // Le client Riot est parti : le puuid memorise ne vaut plus
                // rien, le prochain demarrage changera de port et de compte
                // possible.
                self.puuid = None;
                self.dernier_etat = EtatAffiche {
                    etat: None,
                    map_code: None,
                    queue: None,
                    party_size: None,
                    tier: None,
                    client_riot: false,
                    score: None,
                    souci: match err {
                        ErreurRiot::ClientAbsent => None, // pas un souci, un fait
                        autre => Some(autre.to_string()),
                    },
                };
                return self.machine.avancer(None, maintenant);
            }
        };

        if self.puuid.is_none() {
            match client.puuid().await {
                Ok(p) => self.puuid = Some(p),
                Err(err) => {
                    self.dernier_etat.client_riot = true;
                    self.dernier_etat.souci = Some(err.to_string());
                    return Vec::new();
                }
            }
        }
        let puuid = self.puuid.clone().unwrap();

        let prive = match client.presence(&puuid).await {
            Ok(p) => p,
            Err(err) => {
                self.dernier_etat.client_riot = true;
                self.dernier_etat.souci = Some(err.to_string());
                return Vec::new();
            }
        };

        let instantane = prive.as_ref().and_then(presence_core::lire_instantane);

        self.dernier_etat = EtatAffiche {
            etat: instantane.as_ref().and_then(|i| i.etat),
            map_code: instantane.as_ref().and_then(|i| i.map_code.clone()),
            queue: instantane.as_ref().and_then(|i| i.queue.clone()),
            party_size: instantane.as_ref().and_then(|i| i.party_size),
            tier: instantane.as_ref().and_then(|i| i.tier),
            client_riot: true,
            // Rempli juste apres `avancer`, quand la machine a vu ce tour-ci.
            score: None,
            // Une presence lue mais dont l'etat reste introuvable, c'est le
            // signe que Riot a encore deplace le champ. On le dit, plutot que
            // d'afficher un tiret et de laisser chercher.
            souci: match &instantane {
                Some(i) if i.etat.is_none() => {
                    Some("état de partie introuvable dans la présence".into())
                }
                _ => None,
            },
        };

        let evenements = self.machine.avancer(instantane, maintenant);

        // APRES `avancer`, pas avant : la machine doit avoir vu l'instantane de
        // ce tour-ci, sinon le score affiche aurait toujours deux secondes de
        // retard — visible a l'oeil nu sur le dernier round d'une partie.
        self.dernier_etat.score = self.machine.score();

        evenements
    }
}

#[cfg(test)]
mod tests;

#[cfg(test)]
#[path = "tests_statut.rs"]
mod tests_statut;
