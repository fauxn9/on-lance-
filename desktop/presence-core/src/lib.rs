//! Lecture de la presence locale du client Riot — le noyau de l'application PC.
//!
//! Ce crate ne parle a personne : ni reseau, ni fichier, ni Tauri. Il transforme
//! une charge utile de presence en instantane, puis une suite d'instantanes en
//! EVENEMENTS. C'est volontaire — la partie difficile (decider qu'une partie
//! vient de finir) doit pouvoir se tester sans client Riot, sans Valorant, et
//! sans Windows.
//!
//! C'est la transposition de `src/services/presence.js`, avec les memes regles
//! et le meme jeu de tests : le releve reel du 4 septembre 2026, du groupe qui
//! se forme jusqu'au retour au menu. Trois pieges s'y sont montres, chacun
//! produisant un bug silencieux :
//!
//!   1. LE SCORE EST REMIS A ZERO AVANT LE RETOUR AU MENU (huit secondes
//!      d'ecart). Lire le score au moment du retour au menu donne 0-0 a toutes
//!      les parties. On garde le dernier score connu et on refuse toute BAISSE.
//!
//!   2. PREGAME -> MENUS SANS PASSER PAR INGAME, C'EST UNE ESQUIVE. Traiter
//!      tout retour au menu comme une fin annoncerait une partie fantome.
//!
//!   3. LES CHAMPS `partyOwner*` DECRIVENT LE CHEF DE GROUPE, PAS SOI. Ils
//!      coincident tant qu'on est chef, ce qui rend l'erreur invisible au test.
//!
//! Enfin, l'etat de partie n'est cherche par AUCUN nom de champ : on le
//! reconnait a sa valeur (MENUS / PREGAME / INGAME). Deux versions de la sonde
//! ont echoue parce que Riot avait deplace `sessionLoopState` dans un
//! sous-objet — et ont echoue en silence.

use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;

/// Etat de partie tel que le client l'ecrit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum Etat {
    Menus,
    Pregame,
    Ingame,
}

impl Etat {
    fn depuis(texte: &str) -> Option<Etat> {
        match texte.to_ascii_uppercase().as_str() {
            "MENUS" => Some(Etat::Menus),
            "PREGAME" => Some(Etat::Pregame),
            "INGAME" => Some(Etat::Ingame),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Score {
    pub nous: i64,
    pub eux: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Instantane {
    pub etat: Option<Etat>,
    /// Nom du champ ou l'etat a ete trouve. Sert au journal : le jour ou Riot
    /// le deplace encore, on veut le lire dans les logs, pas le deviner.
    pub champ_etat: Option<String>,
    pub map_code: Option<String>,
    pub queue: Option<String>,
    pub party_state: Option<String>,
    pub party_size: Option<i64>,
    pub party_id: Option<String>,
    pub tier: Option<i64>,
    pub score: Option<Score>,
}

/// Ce que la machine annonce au reste de l'application.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Evenement {
    /// Le groupe grandit — c'est le « on lance ? » du nom du site.
    Groupe { taille: i64, a: i64 },
    /// Le groupe part en recherche de partie.
    File { taille: Option<i64>, a: i64 },
    /// Une partie est trouvee, selection d'agents.
    Selection { map_code: Option<String>, a: i64 },
    /// Quelqu'un a quitte la selection : personne n'a joue.
    Esquive { map_code: Option<String>, a: i64 },
    /// La partie commence pour de bon.
    Debut { map_code: Option<String>, a: i64 },
    /// Retour au menu depuis INGAME : la seule vraie fin de partie.
    Fin {
        map_code: Option<String>,
        queue: Option<String>,
        score: Option<Score>,
        duree_ms: Option<i64>,
        a: i64,
    },
    /// Le jeu n'est plus la.
    Ferme { a: i64 },
}

/// Aplatit les sous-objets : `matchPresenceData.sessionLoopState`, etc.
///
/// BTreeMap et pas HashMap : l'ordre de parcours doit etre le meme d'une
/// execution a l'autre, sinon `trouver_etat` pourrait designer un champ
/// different selon les jours.
pub fn aplatir(valeur: &Value) -> BTreeMap<String, Value> {
    let mut sortie = BTreeMap::new();
    aplatir_dans(valeur, "", &mut sortie);
    sortie
}

fn aplatir_dans(valeur: &Value, prefixe: &str, sortie: &mut BTreeMap<String, Value>) {
    if let Value::Object(map) = valeur {
        for (cle, val) in map {
            let chemin = if prefixe.is_empty() {
                cle.clone()
            } else {
                format!("{prefixe}.{cle}")
            };
            if val.is_object() {
                aplatir_dans(val, &chemin, sortie);
            } else {
                sortie.insert(chemin, val.clone());
            }
        }
    }
}

/// Retrouve l'etat de partie par sa VALEUR, et pas par son nom.
///
/// Les champs `partyOwner*` sont ignores volontairement : ils portent la meme
/// valeur, mais celle du chef de groupe. Les confondre marche tant qu'on est
/// chef et casse des qu'on ne l'est plus.
pub fn trouver_etat(plat: &BTreeMap<String, Value>) -> Option<(String, Etat)> {
    for (cle, val) in plat {
        if cle.to_ascii_lowercase().contains("partyowner") {
            continue;
        }
        if let Some(texte) = val.as_str() {
            if let Some(etat) = Etat::depuis(texte) {
                return Some((cle.clone(), etat));
            }
        }
    }
    None
}

/// Premiere valeur non vide parmi plusieurs chemins possibles.
fn premier<'a>(plat: &'a BTreeMap<String, Value>, chemins: &[&str]) -> Option<&'a Value> {
    for c in chemins {
        match plat.get(*c) {
            Some(Value::Null) | None => continue,
            Some(Value::String(s)) if s.is_empty() => continue,
            Some(v) => return Some(v),
        }
    }
    None
}

fn texte(plat: &BTreeMap<String, Value>, chemins: &[&str]) -> Option<String> {
    premier(plat, chemins).and_then(|v| v.as_str().map(str::to_string))
}

fn entier(plat: &BTreeMap<String, Value>, chemins: &[&str]) -> Option<i64> {
    premier(plat, chemins).and_then(|v| match v {
        Value::Number(n) => n.as_i64(),
        Value::String(s) => s.parse::<i64>().ok(),
        _ => None,
    })
}

/// Transforme la charge utile decodee en instantane exploitable.
///
/// `map_code` reste le nom interne (Triad, Juliett...). La traduction en nom
/// affichable se fait cote serveur, depuis valorant-api.com : aucune table
/// ecrite a la main ici, elle serait fausse a la prochaine map ajoutee.
pub fn lire_instantane(prive: &Value) -> Option<Instantane> {
    if !prive.is_object() {
        return None;
    }
    let plat = aplatir(prive);
    let trouve = trouver_etat(&plat);

    let nous = entier(
        &plat,
        &[
            "partyPresenceData.partyOwnerMatchScoreAllyTeam",
            "partyOwnerMatchScoreAllyTeam",
        ],
    );
    let eux = entier(
        &plat,
        &[
            "partyPresenceData.partyOwnerMatchScoreEnemyTeam",
            "partyOwnerMatchScoreEnemyTeam",
        ],
    );

    Some(Instantane {
        etat: trouve.as_ref().map(|(_, e)| *e),
        champ_etat: trouve.map(|(c, _)| c),
        map_code: texte(&plat, &["matchPresenceData.matchMap", "matchMap"]),
        queue: texte(&plat, &["matchPresenceData.queueId", "queueId"]),
        party_state: texte(&plat, &["partyPresenceData.partyState", "partyState"]),
        party_size: entier(&plat, &["partyPresenceData.partySize", "partySize"]),
        party_id: texte(&plat, &["partyPresenceData.partyId", "partyId"]),
        tier: entier(
            &plat,
            &["playerPresenceData.competitiveTier", "competitiveTier"],
        ),
        // Un score n'existe que si ses DEUX moities existent : une seule
        // moitie ne veut rien dire et fabriquerait un 13-0 imaginaire.
        score: match (nous, eux) {
            (Some(nous), Some(eux)) => Some(Score { nous, eux }),
            _ => None,
        },
    })
}

/// Le score a-t-il BAISSE ? Alors c'est une remise a zero, pas un round perdu.
///
/// Toute la parade au piege n°1. Tester « non nul » ne suffirait pas : une
/// defaite 0-13 laisse legitimement notre score a zero du debut a la fin.
fn a_baisse(avant: Option<Score>, apres: Score) -> bool {
    match avant {
        Some(a) => apres.nous < a.nous || apres.eux < a.eux,
        None => false,
    }
}

/// Machine a etats : on lui donne les instantanes au fil de l'eau, elle rend
/// les evenements qui viennent de se produire.
#[derive(Debug, Default)]
pub struct Machine {
    precedent: Option<Instantane>,
    /// Dernier score credible de la partie en cours.
    score_gele: Option<Score>,
    /// Horodatage du passage a INGAME.
    debut_partie: Option<i64>,
}

impl Machine {
    pub fn nouvelle() -> Self {
        Self::default()
    }

    pub fn etat(&self) -> Option<Etat> {
        self.precedent.as_ref().and_then(|p| p.etat)
    }

    pub fn score(&self) -> Option<Score> {
        self.score_gele
    }

    /// `maintenant` est un horodatage en millisecondes, fourni par l'appelant :
    /// la machine reste pure et donc rejouable a l'identique dans les tests.
    pub fn avancer(&mut self, instantane: Option<Instantane>, maintenant: i64) -> Vec<Evenement> {
        let mut evs = Vec::new();

        let Some(inst) = instantane else {
            if self.precedent.is_some() {
                evs.push(Evenement::Ferme { a: maintenant });
            }
            self.precedent = None;
            self.score_gele = None;
            self.debut_partie = None;
            return evs;
        };

        let av = self.precedent.clone();

        // --- Le score -------------------------------------------------------
        // On ne retient un score que pendant la partie, et jamais s'il baisse.
        if inst.etat == Some(Etat::Ingame) {
            if let Some(score) = inst.score {
                if !a_baisse(self.score_gele, score) {
                    self.score_gele = Some(score);
                }
            }
        }

        // --- Le cycle de partie ----------------------------------------------
        let avant = av.as_ref().and_then(|a| a.etat);
        let apres = inst.etat;

        if avant != apres {
            match (avant, apres) {
                (_, Some(Etat::Pregame)) => evs.push(Evenement::Selection {
                    map_code: inst.map_code.clone(),
                    a: maintenant,
                }),
                (_, Some(Etat::Ingame)) => {
                    self.debut_partie = Some(maintenant);
                    self.score_gele = inst.score;
                    evs.push(Evenement::Debut {
                        map_code: inst.map_code.clone(),
                        a: maintenant,
                    });
                }
                // Piege n°2 : personne n'a joue.
                (Some(Etat::Pregame), Some(Etat::Menus)) => evs.push(Evenement::Esquive {
                    map_code: av.as_ref().and_then(|a| a.map_code.clone()),
                    a: maintenant,
                }),
                // Piege n°1 : le score courant vaut deja 0-0, on rend celui
                // d'avant. Et la map est deja effacee : c'est celle de
                // l'instantane precedent qui vaut.
                (Some(Etat::Ingame), Some(Etat::Menus)) => {
                    evs.push(Evenement::Fin {
                        map_code: av.as_ref().and_then(|a| a.map_code.clone()),
                        queue: av.as_ref().and_then(|a| a.queue.clone()),
                        score: self.score_gele,
                        duree_ms: self.debut_partie.map(|d| maintenant - d),
                        a: maintenant,
                    });
                    self.score_gele = None;
                    self.debut_partie = None;
                }
                _ => {}
            }
        }

        // --- Le groupe ------------------------------------------------------
        // Volontairement APRES le cycle de partie. Les deux se produisent dans
        // le meme battement lors d'une esquive : le joueur quitte la selection
        // (esquive) ET le groupe repart en recherche (file). Raconte dans cet
        // ordre, l'enchainement se lit tout seul ; dans l'autre, la file
        // precede sa propre cause.
        if let Some(av) = &av {
            let avant_taille = av.party_size.unwrap_or(0);
            if let Some(taille) = inst.party_size {
                if taille > avant_taille && taille >= 2 {
                    evs.push(Evenement::Groupe {
                        taille,
                        a: maintenant,
                    });
                }
            }
            let etait = av.party_state.as_deref() == Some("MATCHMAKING");
            let est = inst.party_state.as_deref() == Some("MATCHMAKING");
            if !etait && est {
                evs.push(Evenement::File {
                    taille: inst.party_size,
                    a: maintenant,
                });
            }
        }

        self.precedent = Some(inst);
        evs
    }
}

pub mod lockfile;

#[cfg(test)]
mod tests;
