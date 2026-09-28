//! Tout ce que l'app lit sur le PC du joueur, et rien de plus.
//!
//! CE QU'ON FAIT, ET CE QU'ON NE FAIT PAS
//!
//! On lit le lockfile que le client League écrit lui-même, et on interroge son
//! serveur local (HTTPS + WebSocket). Pendant une partie, on interroge l'API de
//! données en direct que le jeu expose sur le port 2999. Rien d'autre : aucune
//! injection, aucune lecture de la mémoire d'un processus, aucun fichier du jeu
//! modifié. C'est la condition pour rester dans les règles de Riot.
//!
//! Les routes du client ne sont pas documentées par Riot et peuvent changer à
//! chaque mise à jour : leur absence est un cas normal, jamais une panne.

pub mod client;
pub mod lockfile;
pub mod modele;
pub mod phase;
pub mod superviseur;
pub mod ws;

pub use client::{Erreur, Lcu};
pub use lockfile::Lockfile;
pub use modele::{Compte, Rang};
pub use phase::Etape;
pub use superviseur::{superviser, EtatClient, Evenement, FinDePartie};
