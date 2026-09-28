//! La boucle qui suit le client League du lancement à la fermeture.
//!
//! - Pas de client : on regarde toutes les 3 s si le lockfile est apparu.
//! - Client trouvé : état initial par HTTP, puis WebSocket pour les
//!   changements en direct. Un appel HTTP toutes les 3 s sert en plus de
//!   battement de cœur : si le client ne répond plus, on repart à zéro, et si
//!   le WebSocket tombe tout seul, l'app continue en mode interrogation.
//! - Pendant une partie : on note l'identifiant de la partie et le rang de
//!   départ ; à l'écran de fin, on attend que le client publie le nouveau rang
//!   pour en déduire la variation exacte de PL.

use crate::client::{jeu_charge, Lcu};
use crate::lockfile::{self, Lockfile};
use crate::modele::{compte_depuis, plateforme_depuis, rangs_depuis, variation, Compte, Rang};
use crate::phase::{etape, Etape};
use crate::selection::{selection_depuis, Selection};
use crate::ws;
use serde::Serialize;
use serde_json::Value;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio::time::{interval, sleep, MissedTickBehavior};

const PHASE: &str = "/lol-gameflow/v1/gameflow-phase";
const COMPTE: &str = "/lol-summoner/v1/current-summoner";
const RANGS: &str = "/lol-ranked/v1/current-ranked-stats";
const SESSION: &str = "/lol-gameflow/v1/session";
const SELECTION: &str = "/lol-champ-select/v1/session";

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EtatClient {
    pub etape: Etape,
    /// Phase brute du client, pour le débogage.
    pub phase: String,
    pub compte: Option<Compte>,
    pub plateforme: Option<String>,
    pub rangs: Vec<Rang>,
    /// Sélection des champions en cours (brique 4).
    pub selection: Option<Selection>,
    /// Identifiant de la partie en cours, du chargement à la fin (brique 5).
    pub partie: Option<u64>,
}

impl Default for EtatClient {
    fn default() -> Self {
        Self { etape: Etape::Hors, phase: String::new(), compte: None, plateforme: None, rangs: Vec::new(), selection: None, partie: None }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinDePartie {
    pub puuid: String,
    /// Identifiant au format de l'API Riot : `EUW1_7123456789`.
    pub match_id: String,
    /// Type de file du client (`RANKED_SOLO_5x5`, `ARAM_UNRANKED_5x5`…).
    pub file: Option<String>,
    /// Variation de PL, seulement pour une partie classée dont le client a
    /// publié le nouveau rang.
    pub variation: Option<i32>,
    pub rang_apres: Option<Rang>,
}

#[derive(Debug, Clone)]
pub enum Evenement {
    Etat(EtatClient),
    FinDePartie(FinDePartie),
}

#[derive(Default, Clone)]
struct Suivi {
    game_id: Option<u64>,
    file: Option<String>,
    avant: Option<Rang>,
}

/// Tourne jusqu'à la fin de l'application.
pub async fn superviser(tx: mpsc::Sender<Evenement>) {
    let mut envoye = EtatClient::default();
    let _ = tx.send(Evenement::Etat(envoye.clone())).await;
    loop {
        let Some(lock) = lockfile::trouver() else {
            if envoye.etape != Etape::Hors {
                envoye = EtatClient::default();
                let _ = tx.send(Evenement::Etat(envoye.clone())).await;
            }
            sleep(Duration::from_secs(3)).await;
            continue;
        };
        if let Err(()) = session_client(&lock, &mut envoye, &tx).await {
            // Client en train de démarrer, ou lockfile laissé par un plantage.
            sleep(Duration::from_secs(2)).await;
        }
        if tx.is_closed() {
            return;
        }
    }
}

enum Recu {
    Ev(Option<ws::EvenementLcu>),
    Tick,
}

/// Une connexion au client, de la découverte à la déconnexion.
async fn session_client(lock: &Lockfile, envoye: &mut EtatClient, tx: &mpsc::Sender<Evenement>) -> Result<(), ()> {
    let lcu = Lcu::new(lock);
    let phase = match lcu.get(PHASE).await {
        Ok(Some(Value::String(p))) => p,
        _ => return Err(()),
    };

    let mut etat = EtatClient { phase, ..EtatClient::default() };
    rafraichir(&lcu, &mut etat).await;
    etat.plateforme = plateforme(&lcu).await;

    let (ev_tx, ev_rx) = mpsc::channel(64);
    let lock_ws = lock.clone();
    let ecoute = tokio::spawn(async move { ws::ecouter(&lock_ws, &[PHASE, COMPTE, RANGS, SELECTION], ev_tx).await });
    let mut rx = Some(ev_rx);

    let mut tick = interval(Duration::from_secs(3));
    tick.set_missed_tick_behavior(MissedTickBehavior::Delay);
    let mut suivi = Suivi::default();
    let mut ticks: u32 = 0;
    // File de la sélection en cours (420, 450…), lue une fois par sélection.
    let mut file_selection: Option<u32> = None;

    loop {
        let recu = match rx.as_mut() {
            Some(r) => tokio::select! {
                ev = r.recv() => Recu::Ev(ev),
                _ = tick.tick() => Recu::Tick,
            },
            None => {
                tick.tick().await;
                Recu::Tick
            }
        };
        match recu {
            Recu::Ev(Some(ev)) => appliquer(&mut etat, &ev),
            // WebSocket perdu : on continue en interrogeant le client.
            Recu::Ev(None) => rx = None,
            Recu::Tick => {
                ticks += 1;
                match lcu.get(PHASE).await {
                    Ok(Some(Value::String(p))) => etat.phase = p,
                    Ok(_) => {}
                    Err(_) => break, // le client ne répond plus
                }
                // Sans WebSocket, le compte et le rang sont relus toutes les 30 s.
                if rx.is_none() && ticks % 10 == 0 {
                    rafraichir(&lcu, &mut etat).await;
                }
            }
        }

        let en_jeu = matches!(etat.phase.as_str(), "GameStart" | "InProgress" | "Reconnect");
        let nouvelle = etape(&etat.phase, en_jeu && jeu_charge().await);
        transition(&lcu, &mut suivi, etat.etape, nouvelle, &etat, tx).await;
        etat.etape = nouvelle;
        etat.partie = if nouvelle.en_partie() { suivi.game_id } else { None };

        // Sélection des champions : état initial par HTTP (le WebSocket ne
        // prévient que des changements), et la file une fois pour toutes.
        if nouvelle == Etape::Selection {
            if etat.selection.is_none() {
                if let Ok(Some(v)) = lcu.get(SELECTION).await {
                    etat.selection = selection_depuis(&v);
                }
            }
            if file_selection.is_none() {
                if let Ok(Some(s)) = lcu.get(SESSION).await {
                    file_selection = s["gameData"]["queue"]["id"].as_u64().map(|q| q as u32);
                }
            }
            if let Some(s) = etat.selection.as_mut() {
                s.file = file_selection;
            }
        } else {
            etat.selection = None;
            file_selection = None;
        }

        if etat != *envoye {
            *envoye = etat.clone();
            if tx.send(Evenement::Etat(etat.clone())).await.is_err() {
                break;
            }
        }
    }

    ecoute.abort();
    *envoye = EtatClient::default();
    let _ = tx.send(Evenement::Etat(envoye.clone())).await;
    Ok(())
}

fn appliquer(etat: &mut EtatClient, ev: &ws::EvenementLcu) {
    match ev.uri.as_str() {
        PHASE => {
            if let Some(p) = ev.data.as_str() {
                etat.phase = p.to_string();
            }
        }
        COMPTE => {
            if let Some(c) = compte_depuis(&ev.data) {
                etat.compte = Some(c);
            }
        }
        RANGS => etat.rangs = rangs_depuis(&ev.data),
        SELECTION => {
            etat.selection = if ev.type_evenement == "Delete" { None } else { selection_depuis(&ev.data) };
        }
        _ => {}
    }
}

async fn rafraichir(lcu: &Lcu, etat: &mut EtatClient) {
    if let Ok(Some(v)) = lcu.get(COMPTE).await {
        etat.compte = compte_depuis(&v);
    }
    if let Ok(Some(v)) = lcu.get(RANGS).await {
        etat.rangs = rangs_depuis(&v);
    }
}

async fn plateforme(lcu: &Lcu) -> Option<String> {
    let id = lcu.get("/lol-platform-config/v1/namespaces/LoginDataPacket/platformId").await.ok().flatten();
    let region = lcu.get("/riotclient/region-locale").await.ok().flatten();
    plateforme_depuis(
        id.as_ref().and_then(Value::as_str),
        region.as_ref().and_then(|r| r.get("region")).and_then(Value::as_str),
    )
}

async fn transition(lcu: &Lcu, suivi: &mut Suivi, avant: Etape, apres: Etape, etat: &EtatClient, tx: &mpsc::Sender<Evenement>) {
    // En partie : on retient l'identifiant de la partie et le rang de départ.
    // L'identifiant peut valoir 0 au tout début du chargement : on réessaie.
    if apres.en_partie() && suivi.game_id.is_none() {
        if let Ok(Some(s)) = lcu.get(SESSION).await {
            let donnees = &s["gameData"];
            suivi.game_id = donnees["gameId"].as_u64().filter(|g| *g > 0);
            suivi.file = donnees["queue"]["type"].as_str().filter(|f| !f.is_empty()).map(str::to_string);
            suivi.avant = suivi.file.as_ref().and_then(|f| etat.rangs.iter().find(|r| &r.file == f).cloned());
        }
    }

    if apres == Etape::Fin && avant != Etape::Fin {
        let fini = std::mem::take(suivi);
        if let (Some(game_id), Some(compte), Some(plateforme)) = (fini.game_id, etat.compte.clone(), etat.plateforme.clone()) {
            let match_id = format!("{}_{}", plateforme.to_ascii_uppercase(), game_id);
            tokio::spawn(fin_de_partie(lcu.clone(), compte.puuid, match_id, fini.file, fini.avant, tx.clone()));
        }
    } else if !apres.en_partie() && apres != Etape::Fin {
        // Retour aux menus sans écran de fin (esquive, plantage) : on oublie.
        *suivi = Suivi::default();
    }
}

/// Attend que le client publie le nouveau rang (quelques secondes après
/// l'écran de fin), pour une variation de PL exacte, puis prévient l'app.
async fn fin_de_partie(
    lcu: Lcu,
    puuid: String,
    match_id: String,
    file: Option<String>,
    avant: Option<Rang>,
    tx: mpsc::Sender<Evenement>,
) {
    let mut resultat = (None, None);
    if let Some(avant) = &avant {
        for _ in 0..24 {
            sleep(Duration::from_secs(5)).await;
            let Ok(Some(v)) = lcu.get(RANGS).await else { continue };
            if let Some(apres) = rangs_depuis(&v).into_iter().find(|r| r.file == avant.file) {
                if let Some(d) = variation(avant, &apres) {
                    resultat = (Some(d), Some(apres));
                    break;
                }
            }
        }
    }
    let _ = tx
        .send(Evenement::FinDePartie(FinDePartie { puuid, match_id, file, variation: resultat.0, rang_apres: resultat.1 }))
        .await;
}
