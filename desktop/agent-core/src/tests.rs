//! Boucle complete, testee sans Valorant et sans Windows.
//!
//! On lance un faux client Riot sur un port libre, on ecrit un lockfile qui
//! pointe dessus, et on fait tourner l'agent. Le faux client rejoue la soiree
//! du 4 septembre : menus, groupe, selection, esquive, partie, fin.
//!
//! Le lockfile porte `http` et pas `https` : le protocole est un champ du
//! fichier, pas une constante du code, donc un stub en clair est un cas
//! legitime. L'acceptation du certificat auto-signe du vrai client reste, elle,
//! une seule ligne de configuration de reqwest, verifiee sur la vraie machine
//! par `scripts/sonde-lockfile.mjs`.

use super::*;
use base64::Engine;
use presence_core::{Etat, Evenement, Score};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

const PUUID: &str = "274cbb77-27ef-5f4c-b026-8e2f3c93f5f8";

fn encode(v: &Value) -> String {
    base64::engine::general_purpose::STANDARD.encode(v.to_string())
}

/// Les etats successifs que le faux client servira, un par appel.
fn scenario() -> Vec<Option<Value>> {
    let p = |etat: &str, map: &str, taille: i64, party: &str, nous: i64, eux: i64| {
        Some(json!({
            "matchPresenceData": {
                "sessionLoopState": etat, "matchMap": map, "queueId": "competitive"
            },
            "partyPresenceData": {
                "partyState": party, "partySize": taille,
                "partyOwnerSessionLoopState": etat,
                "partyOwnerMatchScoreAllyTeam": nous,
                "partyOwnerMatchScoreEnemyTeam": eux
            },
            "playerPresenceData": { "competitiveTier": 17 }
        }))
    };
    vec![
        p("MENUS", "", 2, "DEFAULT", 0, 0),
        p("MENUS", "", 3, "DEFAULT", 0, 0),        // un pote rejoint
        p("MENUS", "", 3, "MATCHMAKING", 0, 0),    // recherche
        p("PREGAME", "Juliett", 3, "DEFAULT", 0, 0),
        p("MENUS", "", 3, "MATCHMAKING", 0, 0),    // esquive
        p("PREGAME", "Triad", 3, "DEFAULT", 0, 0),
        p("INGAME", "Triad", 3, "DEFAULT", 0, 0),
        p("INGAME", "Triad", 3, "DEFAULT", 12, 10),
        p("INGAME", "Triad", 3, "DEFAULT", 13, 10),
        p("INGAME", "Triad", 3, "DEFAULT", 0, 0),  // remise a zero AVANT la fin
        p("MENUS", "", 3, "DEFAULT", 0, 0),        // fin
        None,                                       // Valorant ferme
    ]
}

/// Faux client Riot : sert /entitlements et /chat/v4/presences en clair.
async fn faux_client_riot(etapes: Vec<Option<Value>>) -> (u16, Arc<Mutex<usize>>) {
    let ecoute = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = ecoute.local_addr().unwrap().port();
    let curseur = Arc::new(Mutex::new(0usize));
    let c = curseur.clone();

    tokio::spawn(async move {
        loop {
            let Ok((mut flux, _)) = ecoute.accept().await else {
                return;
            };
            let etapes = etapes.clone();
            let c = c.clone();
            tokio::spawn(async move {
                let mut tampon = vec![0u8; 4096];
                let n = flux.read(&mut tampon).await.unwrap_or(0);
                let requete = String::from_utf8_lossy(&tampon[..n]).to_string();

                let corps = if requete.contains("/entitlements/v1/token") {
                    json!({ "subject": PUUID }).to_string()
                } else if requete.contains("/chat/v4/presences") {
                    // Chaque lecture avance d'une etape, puis reste sur la
                    // derniere : l'agent peut battre plus souvent que prevu
                    // sans faire dérailler le scenario.
                    let i = {
                        let mut g = c.lock().unwrap();
                        let i = *g;
                        if *g + 1 < etapes.len() {
                            *g += 1;
                        }
                        i
                    };
                    let mut liste = vec![json!({
                        "puuid": PUUID, "product": "riot_client",
                        "private": encode(&json!({ "bruit": true }))
                    })];
                    if let Some(prive) = &etapes[i] {
                        liste.push(json!({
                            "puuid": PUUID, "product": "valorant",
                            "private": encode(prive)
                        }));
                    }
                    json!({ "presences": liste }).to_string()
                } else {
                    "{}".to_string()
                };

                let reponse = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    corps.len(),
                    corps
                );
                let _ = flux.write_all(reponse.as_bytes()).await;
                let _ = flux.flush().await;
            });
        }
    });

    (port, curseur)
}

fn ecrire_lockfile(port: u16) -> (tempo::Repertoire, PathBuf) {
    let rep = tempo::Repertoire::nouveau();
    let chemin = rep.chemin().join("lockfile");
    std::fs::write(&chemin, format!("Riot Client:4242:{port}:motdepasse:http")).unwrap();
    (rep, chemin)
}

/// Un repertoire temporaire minimal, pour ne pas ajouter de dependance.
mod tempo {
    use std::path::{Path, PathBuf};
    pub struct Repertoire(PathBuf);
    impl Repertoire {
        pub fn nouveau() -> Self {
            let p = std::env::temp_dir().join(format!(
                "onlance-test-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            std::fs::create_dir_all(&p).unwrap();
            Self(p)
        }
        pub fn chemin(&self) -> &Path {
            &self.0
        }
    }
    impl Drop for Repertoire {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
}

async fn derouler() -> Vec<Evenement> {
    let (port, _) = faux_client_riot(scenario()).await;
    let (_rep, chemin) = ecrire_lockfile(port);
    let mut agent = Agent::nouveau(chemin);

    let mut tous = Vec::new();
    for i in 0..scenario().len() {
        tous.extend(agent.battre(i as i64 * 2000).await);
    }
    tous
}

#[tokio::test]
async fn la_boucle_complete_produit_les_bons_evenements() {
    let evs = derouler().await;
    let types: Vec<&str> = evs
        .iter()
        .map(|e| match e {
            Evenement::Groupe { .. } => "groupe",
            Evenement::File { .. } => "file",
            Evenement::Selection { .. } => "selection",
            Evenement::Esquive { .. } => "esquive",
            Evenement::Debut { .. } => "debut",
            Evenement::Fin { .. } => "fin",
            Evenement::Ferme { .. } => "ferme",
        })
        .collect();

    assert_eq!(
        types,
        vec![
            "groupe", "file", "selection", "esquive", "file", "selection", "debut", "fin", "ferme"
        ]
    );
}

#[tokio::test]
async fn le_score_final_survit_a_la_remise_a_zero() {
    // Le piege n°1, teste de bout en bout cette fois : le faux client sert
    // bien un 0-0 juste avant le retour au menu.
    let evs = derouler().await;
    let (score, map) = evs
        .iter()
        .find_map(|e| match e {
            Evenement::Fin {
                score, map_code, ..
            } => Some((*score, map_code.clone())),
            _ => None,
        })
        .expect("aucune fin de partie");
    assert_eq!(score, Some(Score { nous: 13, eux: 10 }));
    assert_eq!(map.as_deref(), Some("Triad"));
}

#[tokio::test]
async fn l_agent_lit_le_puuid_une_seule_fois() {
    let (port, _) = faux_client_riot(scenario()).await;
    let (_rep, chemin) = ecrire_lockfile(port);
    let mut agent = Agent::nouveau(chemin);

    agent.battre(0).await;
    assert_eq!(agent.puuid(), Some(PUUID));
    agent.battre(2000).await;
    assert_eq!(agent.puuid(), Some(PUUID));
}

#[tokio::test]
async fn sans_client_riot_l_agent_ne_tombe_pas() {
    // Le cas le plus courant de la journee : personne ne joue.
    let rep = tempo::Repertoire::nouveau();
    let mut agent = Agent::nouveau(rep.chemin().join("lockfile-absent"));

    let evs = agent.battre(0).await;
    assert!(evs.is_empty(), "aucun evenement sans client");
    assert!(!agent.etat().client_riot);
    // Client absent n'est PAS un souci a afficher : c'est l'etat normal.
    assert_eq!(agent.etat().souci, None);
}

#[tokio::test]
async fn un_lockfile_illisible_est_signale_sans_faire_tomber_l_agent() {
    let rep = tempo::Repertoire::nouveau();
    let chemin = rep.chemin().join("lockfile");
    std::fs::write(&chemin, "ceci n'est pas un lockfile").unwrap();
    let mut agent = Agent::nouveau(chemin);

    agent.battre(0).await;
    assert!(agent.etat().souci.is_some(), "le souci doit être dit");
    assert!(!agent.etat().client_riot);
}

#[tokio::test]
async fn un_champ_d_etat_introuvable_est_dit_au_lieu_d_etre_tu() {
    // Exactement ce qui est arrive quand Riot a deplace `sessionLoopState` :
    // la presence se lit, mais l'etat n'y est plus sous une forme reconnue.
    let (port, _) = faux_client_riot(vec![Some(json!({ "queueId": "competitive" }))]).await;
    let (_rep, chemin) = ecrire_lockfile(port);
    let mut agent = Agent::nouveau(chemin);

    agent.battre(0).await;
    assert_eq!(agent.etat().etat, None);
    assert!(agent.etat().client_riot);
    assert!(agent
        .etat()
        .souci
        .as_deref()
        .unwrap_or_default()
        .contains("introuvable"));
}

#[tokio::test]
async fn l_etat_affiche_suit_la_partie() {
    let (port, _) = faux_client_riot(scenario()).await;
    let (_rep, chemin) = ecrire_lockfile(port);
    let mut agent = Agent::nouveau(chemin);

    for i in 0..7 {
        agent.battre(i * 2000).await;
    }
    assert_eq!(agent.etat().etat, Some(Etat::Ingame));
    assert_eq!(agent.etat().map_code.as_deref(), Some("Triad"));
    assert_eq!(agent.etat().party_size, Some(3));
    assert_eq!(agent.etat().queue.as_deref(), Some("competitive"));
}

#[tokio::test]
async fn le_rang_remonte_jusqu_a_la_fenetre() {
    // C'est ce qui remplit l'ecran quand aucune partie n'est en cours — l'etat
    // le plus frequent de la journee.
    let (port, _) = faux_client_riot(scenario()).await;
    let (_rep, chemin) = ecrire_lockfile(port);
    let mut agent = Agent::nouveau(chemin);

    agent.battre(0).await;
    assert_eq!(agent.etat().tier, Some(17)); // Platine 3
}
