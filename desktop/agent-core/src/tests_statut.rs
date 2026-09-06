//! Le statut Discord est PUBLIC : la liste d'amis de quelqu'un le lit.
//!
//! Un rang faux ou une place inventee ne se rattrapent pas — ils ont deja ete
//! vus. Ces tests insistent donc sur « ne rien dire » autant que sur « dire
//! juste », et rejouent le cycle reel d'une soiree : menus, selection, partie,
//! retour aux menus.

use crate::statut::*;
use crate::EtatAffiche;
use presence_core::{Etat, Score};
use std::collections::BTreeMap;

const T0: i64 = 1_757_160_000_000;

fn etat(e: Option<Etat>) -> EtatAffiche {
    EtatAffiche {
        etat: e,
        map_code: None,
        queue: Some("competitive".into()),
        party_size: None,
        tier: Some(16), // Platine 2
        client_riot: e.is_some(),
        score: None,
        souci: None,
    }
}

/// La table que le serveur fournit, reduite a ce dont les tests ont besoin.
fn codes() -> BTreeMap<String, String> {
    [("bonsai", "Split"), ("ascent", "Ascent"), ("triad", "Haven")]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
}

fn donnees() -> DonneesStatut {
    DonneesStatut {
        semaine: Some(PlaceSemaine { place: 3, sur: 9, rr: 64 }),
        serie: Some(Serie { genre: "victoires".into(), n: 3 }),
        derniere: Some(DernierePartie {
            map: Some("Split".into()),
            place: Some(5),
            sur: Some(5),
            kills: Some(12),
            deaths: Some(17),
            assists: Some(4),
        }),
    }
}

/* --- L'echelle de rang, la meme que cote serveur -------------------------- */

#[test]
fn les_rangs_correspondent_a_ce_que_publie_riot() {
    // Memes valeurs que test/analysis.test.js, observees sur de vraies parties.
    assert_eq!(nom_du_rang(Some(12)).as_deref(), Some("Or 1"));
    assert_eq!(nom_du_rang(Some(14)).as_deref(), Some("Or 3"));
    assert_eq!(nom_du_rang(Some(16)).as_deref(), Some("Platine 2"));
    assert_eq!(nom_du_rang(Some(19)).as_deref(), Some("Diamant 2"));
    assert_eq!(nom_du_rang(Some(3)).as_deref(), Some("Fer 1"));
    assert_eq!(nom_du_rang(Some(27)).as_deref(), Some("Radiant"));
}

#[test]
fn un_rang_inconnu_ne_produit_rien_plutot_qu_un_rang_faux() {
    for t in [None, Some(0), Some(-1), Some(1)] {
        assert_eq!(nom_du_rang(t), None, "tier {t:?}");
    }
}

/* --- Les reglages, parce que c'est public --------------------------------- */

#[test]
fn coupe_le_statut_disparait_entierement() {
    let r = Reglages { actif: false, montrer_rang: true };
    assert_eq!(composer(&etat(Some(Etat::Ingame)), Some(&donnees()), &codes(), r, Some(T0), T0), None);
}

#[test]
fn rang_masque_il_ne_figure_nulle_part() {
    // Ni sur la ligne principale, ni en info-bulle de la petite icone : couper
    // le rang a un seul endroit reviendrait a ne pas le couper.
    let r = Reglages { actif: true, montrer_rang: false };
    let mut e = etat(Some(Etat::Ingame));
    e.map_code = Some("Ascent".into());
    let p = composer(&e, Some(&donnees()), &codes(), r, Some(T0), T0).unwrap();

    assert!(!p.state.clone().unwrap_or_default().contains("Platine"));
    assert_eq!(p.petit_texte, None);
}

/* --- Le cycle d'une soiree ------------------------------------------------- */

#[test]
fn valorant_ferme_le_statut_parle_du_groupe() {
    let p = composer(&etat(None), Some(&donnees()), &codes(), Reglages::default(), None, T0).unwrap();
    assert_eq!(p.details, "Pas en jeu");
    assert_eq!(p.state.as_deref(), Some("3e du groupe · +64 RR cette semaine"));
    assert_eq!(p.debut_s, None, "pas de chrono quand on ne joue pas");
    assert_eq!(p.grande_image, "logo");
}

#[test]
fn dans_les_menus_le_rang_et_la_serie() {
    let p = composer(&etat(Some(Etat::Menus)), Some(&donnees()), &codes(), Reglages::default(), None, T0)
        .unwrap();
    assert_eq!(p.details, "Dans les menus");
    assert_eq!(p.state.as_deref(), Some("Platine 2 · 3 victoires d'affilée"));
}

#[test]
fn selection_d_agents_porte_la_map() {
    let mut e = etat(Some(Etat::Pregame));
    e.map_code = Some("Ascent".into());
    e.party_size = Some(3);
    let p = composer(&e, Some(&donnees()), &codes(), Reglages::default(), None, T0).unwrap();

    assert_eq!(p.details, "Sélection d'agents — Ascent");
    assert_eq!(p.state.as_deref(), Some("Platine 2 · à 3"));
    assert_eq!(p.grande_image, "map_ascent");
}

#[test]
fn en_partie_le_score_et_le_chrono() {
    let mut e = etat(Some(Etat::Ingame));
    e.map_code = Some("Ascent".into());
    e.party_size = Some(3);
    e.score = Some(Score { nous: 9, eux: 6 });

    let p = composer(&e, Some(&donnees()), &codes(), Reglages::default(), Some(T0), T0 + 60_000).unwrap();
    assert_eq!(p.details, "En partie — Ascent");
    assert_eq!(p.state.as_deref(), Some("Platine 2 · 9–6 · à 3"));
    // Discord fait defiler les secondes lui-meme depuis cet instant : c'est ce
    // qui permet d'afficher un chrono sans envoyer une mise a jour par seconde.
    assert_eq!(p.debut_s, Some(T0 / 1000));
}

#[test]
fn le_chrono_est_en_SECONDES_pas_en_millisecondes() {
    // Se tromper d'unite affiche « 55 ans » au lieu de « 3 minutes », et rien
    // dans le code ne le signale.
    let p = composer(&etat(Some(Etat::Ingame)), None, &codes(), Reglages::default(), Some(T0), T0).unwrap();
    let s = p.debut_s.unwrap();
    assert!(s > 1_600_000_000 && s < 2_000_000_000, "horodatage invraisemblable : {s}");
}

/* --- Le coeur de l'idee : le verdict du groupe ----------------------------- */

#[test]
fn juste_apres_une_partie_le_statut_annonce_la_place_dans_le_groupe() {
    let p = composer(
        &etat(Some(Etat::Menus)),
        Some(&donnees()),
        &codes(),
        Reglages::default(),
        Some(T0),
        T0 + 3 * 60_000, // trois minutes apres
    )
    .unwrap();

    assert_eq!(p.details, "Sort d'une game sur Split");
    assert_eq!(p.state.as_deref(), Some("Dernier du groupe · 12/17/4"));
    assert_eq!(p.grande_image, "map_split");
}

#[test]
fn passe_le_delai_le_statut_redevient_neutre() {
    // Sinon « sort d'une game » resterait affiche toute la nuit.
    let p = composer(
        &etat(Some(Etat::Menus)),
        Some(&donnees()),
        &codes(),
        Reglages::default(),
        Some(T0),
        T0 + FRAICHEUR_PARTIE_MS + 1,
    )
    .unwrap();
    assert_eq!(p.details, "Dans les menus");
}

#[test]
fn premier_du_groupe_se_dit_autrement_que_dernier() {
    let mut d = donnees();
    d.derniere.as_mut().unwrap().place = Some(1);
    let p = composer(&etat(Some(Etat::Menus)), Some(&d), &codes(), Reglages::default(), Some(T0), T0)
        .unwrap();
    assert!(p.state.unwrap().starts_with("1er du groupe"));

    let mut d3 = donnees();
    d3.derniere.as_mut().unwrap().place = Some(3);
    d3.derniere.as_mut().unwrap().sur = Some(5);
    let p3 = composer(&etat(Some(Etat::Menus)), Some(&d3), &codes(), Reglages::default(), Some(T0), T0)
        .unwrap();
    assert!(p3.state.unwrap().starts_with("3e du groupe"));
}

/* --- Ce qui manque ne doit jamais produire de texte bancal ---------------- */

#[test]
fn sans_donnees_serveur_le_statut_reste_correct() {
    // Le cas du premier lancement, et celui d'une coupure reseau.
    let p = composer(&etat(Some(Etat::Menus)), None, &codes(), Reglages::default(), None, T0).unwrap();
    assert_eq!(p.details, "Dans les menus");
    assert_eq!(p.state.as_deref(), Some("Platine 2"));
}

#[test]
fn un_compte_tout_neuf_n_affiche_ni_zero_ni_separateur_orphelin() {
    let vide = DonneesStatut::default();
    let mut e = etat(Some(Etat::Menus));
    e.tier = None;

    let p = composer(&e, Some(&vide), &codes(), Reglages::default(), None, T0).unwrap();
    assert_eq!(p.details, "Dans les menus");
    assert_eq!(p.state, None, "aucune ligne plutot qu'une ligne vide");
}

#[test]
fn jamais_de_separateur_en_trop_quel_que_soit_le_trou() {
    // On balaie toutes les combinaisons d'absences : aucune ne doit produire
    // « · » colle, en tete ou en fin de ligne.
    for tier in [None, Some(16)] {
        for taille in [None, Some(1), Some(3)] {
            for score in [None, Some(Score { nous: 9, eux: 6 })] {
                for etat_jeu in [None, Some(Etat::Menus), Some(Etat::Pregame), Some(Etat::Ingame)] {
                    let mut e = etat(etat_jeu);
                    e.tier = tier;
                    e.party_size = taille;
                    e.score = score.clone();

                    let p = composer(&e, None, &codes(), Reglages::default(), Some(T0), T0).unwrap();
                    if let Some(s) = p.state {
                        assert!(!s.starts_with(" ·"), "debut bancal : {s:?}");
                        assert!(!s.ends_with("· "), "fin bancale : {s:?}");
                        assert!(!s.contains("·  ·"), "trou au milieu : {s:?}");
                        assert!(!s.trim().is_empty(), "ligne vide");
                    }
                    assert!(!p.details.trim().is_empty());
                }
            }
        }
    }
}

#[test]
fn un_groupe_d_une_seule_personne_ne_s_affiche_pas() {
    // « à 1 » ne veut rien dire : jouer seul est l'etat par defaut.
    let mut e = etat(Some(Etat::Ingame));
    e.party_size = Some(1);
    let p = composer(&e, None, &codes(), Reglages::default(), Some(T0), T0).unwrap();
    assert!(!p.state.unwrap_or_default().contains("à 1"));
}

#[test]
fn sans_map_connue_on_retombe_sur_le_logo() {
    assert_eq!(cle_image(None), "logo");
    assert_eq!(cle_image(Some("")), "logo");
    assert_eq!(cle_image(Some("Triad")), "map_triad");
}

/* --- Les deux langues de la map -------------------------------------------- */

#[test]
fn le_code_local_et_le_nom_du_serveur_donnent_la_MEME_cle_d_image() {
    // LE PIEGE. Le client Riot publie « Bonsai », le serveur renvoie « Split » :
    // deux mots pour la meme map. Sans traduction, il faudrait televerser deux
    // images par map — et une sur deux resterait introuvable, sans erreur.
    let mut e = etat(Some(Etat::Ingame));
    e.map_code = Some("Bonsai".into()); // ce que dit le client Riot

    let en_partie = composer(&e, None, &codes(), Reglages::default(), Some(T0), T0).unwrap();

    // Et ce que dit le serveur pour la meme map, juste apres la partie.
    let apres = composer(
        &etat(Some(Etat::Menus)),
        Some(&donnees()), // derniere.map = "Split"
        &codes(),
        Reglages::default(),
        Some(T0),
        T0 + 60_000,
    )
    .unwrap();

    assert_eq!(en_partie.grande_image, "map_split");
    assert_eq!(apres.grande_image, "map_split");
    assert_eq!(en_partie.details, "En partie — Split", "le nom affiche aussi");
}

#[test]
fn une_map_inconnue_de_la_table_reste_lisible() {
    // Une map ajoutee par Riot avant que /visuels soit rafraichi. Mieux vaut
    // « Bonsai » et une vignette manquante qu'un statut vide.
    let mut e = etat(Some(Etat::Ingame));
    e.map_code = Some("MapToutJuste".into());
    let p = composer(&e, None, &BTreeMap::new(), Reglages::default(), Some(T0), T0).unwrap();
    assert_eq!(p.details, "En partie — MapToutJuste");
    assert_eq!(p.grande_image, "map_maptoutjuste");
}

#[test]
fn les_espaces_ne_passent_pas_dans_une_cle_d_asset() {
    // Discord refuse les espaces dans les cles. « The Range » doit devenir
    // map_the_range, pas « map_the range » — silencieusement introuvable.
    assert_eq!(cle_image(Some("The Range")), "map_the_range");
    assert!(!cle_image(Some("The Range")).contains(' '));
}

/* --- L'embleme de rang ------------------------------------------------------ */

#[test]
fn l_embleme_suit_l_identifiant_publie_par_riot() {
    // Meme identifiant que celui qui nomme le rang : les deux ne peuvent pas
    // diverger, puisqu'ils lisent la meme valeur.
    assert_eq!(cle_rang(Some(3)).as_deref(), Some("rang_3"));   // Fer 1
    assert_eq!(cle_rang(Some(16)).as_deref(), Some("rang_16")); // Platine 2
    assert_eq!(cle_rang(Some(27)).as_deref(), Some("rang_27")); // Radiant
}

#[test]
fn pas_d_embleme_pour_un_non_classe_ni_pour_un_id_absurde() {
    for t in [None, Some(0), Some(2), Some(28), Some(-5)] {
        assert_eq!(cle_rang(t), None, "tier {t:?}");
    }
}

#[test]
fn l_embleme_et_le_nom_apparaissent_ensemble_ou_pas_du_tout() {
    // Le piege : couper le rang mais laisser la pastille. L'embleme trahirait
    // le rang en image alors que la personne vient justement de le masquer.
    let coupe = Reglages { actif: true, montrer_rang: false };
    let p = composer(&etat(Some(Etat::Ingame)), None, &codes(), coupe, Some(T0), T0).unwrap();
    assert_eq!(p.petite_image, None);
    assert_eq!(p.petit_texte, None);

    let montre = composer(&etat(Some(Etat::Ingame)), None, &codes(), Reglages::default(), Some(T0), T0).unwrap();
    assert_eq!(montre.petite_image.as_deref(), Some("rang_16"));
    assert_eq!(montre.petit_texte.as_deref(), Some("Platine 2"));
}

#[test]
fn un_non_classe_garde_un_statut_sans_pastille() {
    let mut e = etat(Some(Etat::Ingame));
    e.tier = Some(0);
    let p = composer(&e, None, &codes(), Reglages::default(), Some(T0), T0).unwrap();
    assert_eq!(p.petite_image, None);
    assert_eq!(p.petit_texte, None);
    assert!(!p.details.is_empty(), "le statut reste affiche");
}
