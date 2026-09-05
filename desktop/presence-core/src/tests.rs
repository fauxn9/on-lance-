//! Ces tests rejouent un VRAI releve : la soiree du 4 septembre 2026, du moment
//! ou le groupe se forme (23:18) jusqu'au retour au menu (23:56:44), avec
//! l'esquive en selection d'agents et la remise a zero du score qui precede la
//! fin. Chaque ligne du scenario correspond a une ligne de la sortie de
//! `scripts/sonde-lockfile.mjs --suivi`.
//!
//! Verifie ensuite contre HenrikDev : la partie existe (Haven, 23 rounds, debut
//! a 21:20:17 UTC), ce qui confirme le score 13-10 et le nom de map.
//!
//! Ce sont les memes cas que `test/presence.test.js` cote serveur. Deux
//! implementations, un seul jeu de faits : si les deux divergent un jour, c'est
//! ici qu'on le verra.

use super::*;
use serde_json::json;

fn poser(objet: &mut Value, chemin: &str, valeur: Value) {
    let parts: Vec<&str> = chemin.split('.').collect();
    let mut noeud = objet;
    for p in &parts[..parts.len() - 1] {
        if !noeud.get(*p).map(Value::is_object).unwrap_or(false) {
            noeud[*p] = json!({});
        }
        noeud = noeud.get_mut(*p).unwrap();
    }
    noeud[parts[parts.len() - 1]] = valeur;
}

/// L'etat initial, tel que la sonde l'a vide a 23:13:15.
fn base() -> Value {
    json!({
        "isValid": true,
        "matchPresenceData": {
            "gameScoreType": "Rounds", "matchMap": "", "provisioningFlow": "Invalid",
            "queueId": "competitive", "sessionLoopState": "MENUS"
        },
        "partyPresenceData": {
            "partyId": "141f7d02", "partySize": 2, "partyState": "DEFAULT",
            "partyOwnerMatchMap": "", "partyOwnerSessionLoopState": "MENUS",
            "partyOwnerMatchScoreAllyTeam": 0, "partyOwnerMatchScoreEnemyTeam": 0,
            "isPartyOwner": true, "maxPartySize": 5
        },
        "playerPresenceData": { "competitiveTier": 17, "accountLevel": 277 },
        "partySize": 2, "queueId": "competitive", "provisioningFlow": "Invalid",
        "partyOwnerMatchScoreAllyTeam": 0, "partyOwnerMatchScoreEnemyTeam": 0
    })
}

const fn s(h: i64, m: i64, sec: i64) -> i64 {
    ((h * 60 + m) * 60 + sec) * 1000
}

/// Recopie de la sortie `--suivi` : (instant, [(chemin, valeur)]).
fn releve() -> Vec<(i64, Vec<(&'static str, Value)>)> {
    let mut r: Vec<(i64, Vec<(&'static str, Value)>)> = vec![
        (s(23, 13, 15), vec![]),
        (
            s(23, 18, 16),
            vec![
                ("partyPresenceData.partySize", json!(3)),
                ("partySize", json!(3)),
            ],
        ),
        (
            s(23, 18, 18),
            vec![("partyPresenceData.partyState", json!("MATCHMAKING"))],
        ),
        (
            s(23, 19, 48),
            vec![
                ("matchPresenceData.matchMap", json!("Juliett")),
                ("matchPresenceData.provisioningFlow", json!("Matchmaking")),
                ("matchPresenceData.sessionLoopState", json!("PREGAME")),
                (
                    "partyPresenceData.partyOwnerSessionLoopState",
                    json!("PREGAME"),
                ),
                ("partyPresenceData.partyState", json!("DEFAULT")),
            ],
        ),
        // L'esquive : retour au menu sans avoir joue.
        (
            s(23, 20, 8),
            vec![
                ("matchPresenceData.sessionLoopState", json!("MENUS")),
                ("partyPresenceData.partyOwnerSessionLoopState", json!("MENUS")),
                ("partyPresenceData.partyState", json!("MATCHMAKING")),
            ],
        ),
        (
            s(23, 20, 20),
            vec![
                ("matchPresenceData.matchMap", json!("Triad")),
                ("matchPresenceData.sessionLoopState", json!("PREGAME")),
                (
                    "partyPresenceData.partyOwnerSessionLoopState",
                    json!("PREGAME"),
                ),
                ("partyPresenceData.partyState", json!("DEFAULT")),
            ],
        ),
        (
            s(23, 22, 11),
            vec![
                ("matchPresenceData.sessionLoopState", json!("INGAME")),
                (
                    "partyPresenceData.partyOwnerSessionLoopState",
                    json!("INGAME"),
                ),
            ],
        ),
    ];

    // Les rounds, dans l'ordre exact du releve.
    let rounds: [(i64, bool, i64); 23] = [
        (s(23, 24, 56), false, 1),
        (s(23, 26, 26), false, 2),
        (s(23, 27, 50), true, 1),
        (s(23, 30, 17), true, 2),
        (s(23, 32, 7), true, 3),
        (s(23, 33, 27), false, 3),
        (s(23, 34, 24), true, 4),
        (s(23, 36, 12), true, 5),
        (s(23, 37, 28), true, 6),
        (s(23, 39, 3), false, 4),
        (s(23, 40, 49), true, 7),
        (s(23, 42, 7), false, 5),
        (s(23, 43, 48), true, 8),
        (s(23, 44, 54), true, 9),
        (s(23, 46, 32), false, 6),
        (s(23, 47, 28), false, 7),
        (s(23, 48, 23), false, 8),
        (s(23, 49, 29), true, 10),
        (s(23, 50, 39), true, 11),
        (s(23, 51, 53), true, 12),
        (s(23, 53, 48), false, 9),
        (s(23, 55, 18), false, 10),
        (s(23, 56, 36), true, 13),
    ];
    for (t, nous, valeur) in rounds {
        let (imbrique, racine) = if nous {
            (
                "partyPresenceData.partyOwnerMatchScoreAllyTeam",
                "partyOwnerMatchScoreAllyTeam",
            )
        } else {
            (
                "partyPresenceData.partyOwnerMatchScoreEnemyTeam",
                "partyOwnerMatchScoreEnemyTeam",
            )
        };
        r.push((t, vec![(imbrique, json!(valeur)), (racine, json!(valeur))]));
    }

    // 23:56:38 — le score repart a zero HUIT SECONDES avant le retour au menu.
    r.push((
        s(23, 56, 38),
        vec![
            (
                "partyPresenceData.partyOwnerMatchScoreAllyTeam",
                json!(0),
            ),
            (
                "partyPresenceData.partyOwnerMatchScoreEnemyTeam",
                json!(0),
            ),
            ("partyOwnerMatchScoreAllyTeam", json!(0)),
            ("partyOwnerMatchScoreEnemyTeam", json!(0)),
        ],
    ));
    // 23:56:44 — seulement maintenant, l'etat revient au menu.
    r.push((
        s(23, 56, 44),
        vec![
            ("matchPresenceData.matchMap", json!("")),
            ("matchPresenceData.provisioningFlow", json!("Invalid")),
            ("matchPresenceData.sessionLoopState", json!("MENUS")),
            ("partyPresenceData.partyOwnerSessionLoopState", json!("MENUS")),
            ("partyPresenceData.partyOwnerMatchMap", json!("")),
        ],
    ));
    r
}

fn rejouer() -> Vec<Evenement> {
    let mut prive = base();
    let mut machine = Machine::nouvelle();
    let mut evenements = Vec::new();
    for (instant, diffs) in releve() {
        for (chemin, valeur) in diffs {
            poser(&mut prive, chemin, valeur);
        }
        evenements.extend(machine.avancer(lire_instantane(&prive), instant));
    }
    evenements
}

#[test]
fn une_seule_partie_malgre_deux_selections() {
    let evs = rejouer();
    assert_eq!(
        evs.iter()
            .filter(|e| matches!(e, Evenement::Debut { .. }))
            .count(),
        1
    );
    assert_eq!(
        evs.iter()
            .filter(|e| matches!(e, Evenement::Fin { .. }))
            .count(),
        1
    );
    assert_eq!(
        evs.iter()
            .filter(|e| matches!(e, Evenement::Selection { .. }))
            .count(),
        2
    );
}

#[test]
fn l_esquive_n_est_pas_une_partie() {
    // 23:20:08 : PREGAME -> MENUS sans INGAME. Compter ca comme une fin
    // annoncerait aux potes une partie qui n'a jamais eu lieu.
    let evs = rejouer();
    let esquives: Vec<_> = evs
        .iter()
        .filter_map(|e| match e {
            Evenement::Esquive { map_code, a } => Some((map_code.clone(), *a)),
            _ => None,
        })
        .collect();
    assert_eq!(esquives.len(), 1);
    assert_eq!(esquives[0].0.as_deref(), Some("Juliett"));
    assert_eq!(esquives[0].1, s(23, 20, 8));
}

#[test]
fn le_score_final_est_celui_d_avant_la_remise_a_zero() {
    // LE piege : a 23:56:38 le score repasse a 0-0, et ce n'est qu'a 23:56:44
    // que l'etat revient au menu. Lire le score au moment de la fin donnerait
    // 0-0 a toutes les parties, sans jamais lever d'erreur.
    let evs = rejouer();
    let fin = evs
        .iter()
        .find_map(|e| match e {
            Evenement::Fin { score, .. } => Some(*score),
            _ => None,
        })
        .expect("aucune fin de partie");
    assert_eq!(fin, Some(Score { nous: 13, eux: 10 }));
}

#[test]
fn la_map_et_la_duree_de_la_fin() {
    let evs = rejouer();
    let (map, queue, duree) = evs
        .iter()
        .find_map(|e| match e {
            Evenement::Fin {
                map_code,
                queue,
                duree_ms,
                ..
            } => Some((map_code.clone(), queue.clone(), *duree_ms)),
            _ => None,
        })
        .unwrap();
    assert_eq!(map.as_deref(), Some("Triad")); // Haven, d'apres valorant-api.com
    assert_eq!(queue.as_deref(), Some("competitive"));
    assert_eq!(duree, Some(s(23, 56, 44) - s(23, 22, 11)));
}

#[test]
fn le_groupe_est_detecte_avant_la_file() {
    let evs = rejouer();
    let groupe = evs
        .iter()
        .find_map(|e| match e {
            Evenement::Groupe { taille, a } => Some((*taille, *a)),
            _ => None,
        })
        .unwrap();
    let file = evs
        .iter()
        .find_map(|e| match e {
            Evenement::File { a, .. } => Some(*a),
            _ => None,
        })
        .unwrap();
    assert_eq!(groupe.0, 3);
    assert!(groupe.1 < file, "le groupe se forme avant la recherche");
    // 90 secondes d'avance sur la partie : de quoi prevenir les autres a temps.
    assert!(s(23, 22, 11) - groupe.1 > 200_000);
}

#[test]
fn une_defaite_zero_treize_garde_bien_un_zero() {
    // Le contre-exemple qui interdit la regle « garder le dernier score non nul ».
    let mut m = Machine::nouvelle();
    let inst = |etat: Etat, nous: i64, eux: i64| Instantane {
        etat: Some(etat),
        champ_etat: Some("matchPresenceData.sessionLoopState".into()),
        map_code: Some("Ascent".into()),
        queue: Some("competitive".into()),
        party_state: Some("DEFAULT".into()),
        party_size: Some(1),
        party_id: None,
        tier: None,
        score: Some(Score { nous, eux }),
    };

    let mut t = 0;
    m.avancer(Some(inst(Etat::Ingame, 0, 0)), t);
    for e in 1..=13 {
        t += 60_000;
        m.avancer(Some(inst(Etat::Ingame, 0, e)), t);
    }
    t += 2000;
    m.avancer(Some(inst(Etat::Ingame, 0, 0)), t); // remise a zero
    t += 6000;
    let evs = m.avancer(Some(inst(Etat::Menus, 0, 0)), t);

    let score = evs
        .iter()
        .find_map(|e| match e {
            Evenement::Fin { score, .. } => Some(*score),
            _ => None,
        })
        .unwrap();
    assert_eq!(score, Some(Score { nous: 0, eux: 13 }));
}

#[test]
fn l_etat_lu_est_le_sien_pas_celui_du_chef() {
    // Tant qu'on est chef, les deux coincident et l'erreur reste invisible.
    let i = lire_instantane(&json!({
        "matchPresenceData": { "sessionLoopState": "INGAME" },
        "partyPresenceData": { "partyOwnerSessionLoopState": "MENUS" }
    }))
    .unwrap();
    assert_eq!(i.etat, Some(Etat::Ingame));
    assert!(i.champ_etat.unwrap().starts_with("matchPresenceData."));
}

#[test]
fn l_etat_se_retrouve_meme_si_riot_deplace_le_champ() {
    // C'est exactement ce qui est arrive entre deux versions du client.
    let i = lire_instantane(&json!({
        "quelqueChose": { "deNouveau": { "etatDuJeu": "INGAME" } }
    }))
    .unwrap();
    assert_eq!(i.etat, Some(Etat::Ingame));
    assert_eq!(i.champ_etat.as_deref(), Some("quelqueChose.deNouveau.etatDuJeu"));
}

#[test]
fn quand_plus_rien_ne_correspond_on_le_dit() {
    let i = lire_instantane(&json!({ "isValid": true, "queueId": "competitive" })).unwrap();
    assert_eq!(i.etat, None);
    assert_eq!(i.champ_etat, None);
    assert_eq!(i.queue.as_deref(), Some("competitive")); // le reste reste lisible
}

#[test]
fn les_doublons_a_la_racine_servent_de_secours() {
    let i = lire_instantane(&json!({
        "matchPresenceData": { "sessionLoopState": "MENUS" },
        "partySize": 4, "queueId": "unrated"
    }))
    .unwrap();
    assert_eq!(i.party_size, Some(4));
    assert_eq!(i.queue.as_deref(), Some("unrated"));
}

#[test]
fn un_score_a_moitie_absent_n_existe_pas() {
    // Un 13-rien fabriquerait une victoire imaginaire.
    let i = lire_instantane(&json!({ "partyOwnerMatchScoreAllyTeam": 13 })).unwrap();
    assert_eq!(i.score, None);
}

#[test]
fn la_fermeture_du_jeu_se_distingue_d_une_fin_de_partie() {
    let mut m = Machine::nouvelle();
    m.avancer(lire_instantane(&base()), 0);
    let evs = m.avancer(None, 1000);
    assert_eq!(evs.len(), 1);
    assert!(matches!(evs[0], Evenement::Ferme { .. }));
}

#[test]
fn aplatir_descend_sans_casser_les_tableaux() {
    let p = aplatir(&json!({ "a": { "b": 1 }, "c": [1, 2], "d": "x" }));
    assert_eq!(p.get("a.b"), Some(&json!(1)));
    assert_eq!(p.get("c"), Some(&json!([1, 2])));
    assert_eq!(p.get("d"), Some(&json!("x")));
}

#[test]
fn trouver_etat_ignore_les_champs_du_chef() {
    let p = aplatir(&json!({ "partyOwnerSessionLoopState": "INGAME" }));
    assert!(trouver_etat(&p).is_none());
}
