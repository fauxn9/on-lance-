//! Ce qui s'affiche sur le statut Discord.
//!
//! POURQUOI CE N'EST PAS QU'UN LIBELLE
//!
//! Un statut qui dit « En partie — Ascent » est le statut d'un tracker. Celui-ci
//! porte ce que fait le projet : la place dans le groupe sur la derniere partie,
//! le classement de la semaine, la serie en cours. C'est-a-dire les trois seules
//! choses qui se commentent toutes seules sur un vocal — et donc les trois
//! seules qui donnent envie a quelqu'un de demander « c'est quoi ce truc ».
//!
//! CE MODULE NE CONNAIT PAS DISCORD. Il transforme un etat de jeu et quelques
//! faits venus du serveur en lignes de texte, et rien d'autre. Toute la logique
//! est donc testable sans Discord installe, sans Valorant, et sans reseau —
//! c'est ce qui permet de verifier ici, sur Linux, un affichage qui n'existera
//! que sur le PC de quelqu'un d'autre.

use crate::EtatAffiche;
use presence_core::Etat;
use serde::Deserialize;
use std::collections::BTreeMap;

/// Au-dela, « sort d'une game » n'est plus vrai : la personne est retournee
/// dans les menus depuis un moment et le statut doit redevenir neutre.
pub const FRAICHEUR_PARTIE_MS: i64 = 20 * 60 * 1000;

// ---------------------------------------------------------------------------
// L'echelle de rang
// ---------------------------------------------------------------------------

/// Riot numerote les rangs lui-meme et le client publie cet entier tel quel.
/// Meme echelle que `src/services/tiers.js` cote serveur : trois divisions par
/// palier a partir de Fer 1 = 3. Les tests en dessous rejouent les memes
/// valeurs, verifiees sur de vraies parties.
const PALIERS: [&str; 9] = [
    "Fer", "Bronze", "Argent", "Or", "Platine", "Diamant", "Ascendant", "Immortel", "Radiant",
];
const PREMIER_ID: i64 = 3;

/// `None` pour non classe (0) ou pour un id inconnu — on prefere ne rien
/// afficher qu'afficher un rang faux sur un statut public.
pub fn nom_du_rang(tier: Option<i64>) -> Option<String> {
    let id = tier?;
    if id <= 0 {
        return None;
    }
    if id >= 27 {
        return Some("Radiant".to_string());
    }
    let i = id - PREMIER_ID;
    if i < 0 {
        return None;
    }
    let palier = PALIERS.get((i / 3) as usize)?;
    Some(format!("{palier} {}", (i % 3) + 1))
}

// ---------------------------------------------------------------------------
// Ce que le serveur nous donne
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize, Default, PartialEq)]
pub struct PlaceSemaine {
    pub place: i64,
    pub sur: i64,
    pub rr: i64,
}

#[derive(Debug, Clone, Deserialize, Default, PartialEq)]
pub struct Serie {
    /// « victoires » ou « defaites ».
    #[serde(rename = "type")]
    pub genre: String,
    pub n: i64,
}

#[derive(Debug, Clone, Deserialize, Default, PartialEq)]
pub struct DernierePartie {
    pub map: Option<String>,
    pub place: Option<i64>,
    pub sur: Option<i64>,
    pub kills: Option<i64>,
    pub deaths: Option<i64>,
    pub assists: Option<i64>,
}

#[derive(Debug, Clone, Deserialize, Default, PartialEq)]
pub struct DonneesStatut {
    pub semaine: Option<PlaceSemaine>,
    pub serie: Option<Serie>,
    pub derniere: Option<DernierePartie>,
}

/// Reglages de la personne. Le statut est PUBLIC : tout ce qu'il revele doit
/// pouvoir etre coupe depuis la fenetre, sans avoir a desinstaller.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Reglages {
    pub actif: bool,
    pub montrer_rang: bool,
}

impl Default for Reglages {
    fn default() -> Self {
        Self { actif: true, montrer_rang: true }
    }
}

// ---------------------------------------------------------------------------
// Le resultat
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
pub struct Presence {
    pub details: String,
    pub state: Option<String>,
    /// Horodatage UNIX en SECONDES. Discord fait defiler le chrono lui-meme a
    /// partir de la : on n'a donc pas a rafraichir le statut chaque seconde,
    /// ce qui tombe bien puisqu'il n'en accepte qu'un toutes les quinze.
    pub debut_s: Option<i64>,
    pub grande_image: String,
    pub grand_texte: Option<String>,
    /// Embleme de rang. Toujours accompagne de `petit_texte`, jamais seul :
    /// une pastille sans info-bulle n'apprend rien a qui ne connait pas les
    /// emblemes de Valorant.
    pub petite_image: Option<String>,
    pub petit_texte: Option<String>,
}

/// Nom affichable d'une map, a partir du code interne publie par le client Riot.
///
/// Le client dit `Bonsai`, le site dit `Split` : ce sont deux mots pour la meme
/// map. La table de correspondance vient du serveur (`/visuels`, qui la tient
/// de valorant-api.com) et n'est JAMAIS recopiee ici — elle serait fausse a la
/// prochaine map ajoutee.
///
/// Sans table, on rend le code tel quel : mieux vaut afficher « Bonsai » que
/// rien du tout.
pub fn nom_de_map(code: Option<&str>, codes: &BTreeMap<String, String>) -> Option<String> {
    let c = code.filter(|c| !c.is_empty())?;
    Some(codes.get(&c.to_ascii_lowercase()).cloned().unwrap_or_else(|| c.to_string()))
}

/// Cle d'asset Discord, a partir du NOM AFFICHABLE de la map.
///
/// Volontairement le nom affichable et pas le code interne : le statut tire ses
/// maps de deux sources qui ne parlent pas la meme langue — la presence locale
/// (`Bonsai`) et le serveur (`Split`). Les faire converger ici est ce qui evite
/// d'avoir a televerser deux images par map, dont une resterait introuvable une
/// fois sur deux.
///
/// Les espaces deviennent des `_` : « The Range » -> `map_the_range`. Les cles
/// d'assets Discord n'acceptent pas d'espace.
pub fn cle_image(nom_map: Option<&str>) -> String {
    match nom_map {
        Some(m) if !m.is_empty() => {
            let propre: String = m
                .to_ascii_lowercase()
                .chars()
                .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
                .collect();
            format!("map_{propre}")
        }
        _ => "logo".to_string(),
    }
}

/// Cle d'asset de l'embleme de rang, a partir de l'identifiant publie par Riot.
///
/// Volontairement l'IDENTIFIANT et pas le nom : c'est la meme valeur que celle
/// qui sert deja a nommer le rang, donc les deux ne peuvent pas diverger. Riot
/// numerote ses paliers lui-meme et cette numerotation est stable (verifiee sur
/// de vraies parties) — `rang_16` designera toujours Platine 2.
///
/// `None` pour un non classe : pas de pastille plutot qu'une pastille fausse.
pub fn cle_rang(tier: Option<i64>) -> Option<String> {
    let id = tier?;
    if !(3..=27).contains(&id) {
        return None;
    }
    Some(format!("rang_{id}"))
}

fn place_en_mots(place: i64, sur: i64) -> String {
    if place == 1 {
        "1er du groupe".to_string()
    } else if place >= sur && sur > 1 {
        "Dernier du groupe".to_string()
    } else {
        format!("{place}e du groupe")
    }
}

fn ligne_semaine(s: &PlaceSemaine) -> String {
    let signe = if s.rr > 0 { "+" } else { "" };
    format!("{} · {signe}{} RR cette semaine", place_en_mots(s.place, s.sur), s.rr)
}

fn ligne_serie(s: &Serie) -> String {
    format!("{} {} d'affilée", s.n, s.genre)
}

/// Assemble les morceaux d'une ligne en sautant les absents, pour ne jamais
/// produire de « · · » ni de separateur en fin de ligne.
fn joindre(morceaux: Vec<Option<String>>) -> Option<String> {
    let gardes: Vec<String> = morceaux.into_iter().flatten().filter(|m| !m.is_empty()).collect();
    if gardes.is_empty() {
        None
    } else {
        Some(gardes.join(" · "))
    }
}

/// Le statut a afficher, ou `None` s'il ne faut rien afficher du tout.
///
/// @param debut_partie_ms  quand l'etat courant a commence (pour le chrono)
/// @param maintenant_ms    l'heure, injectee pour que les tests soient stables
pub fn composer(
    etat: &EtatAffiche,
    donnees: Option<&DonneesStatut>,
    codes: &BTreeMap<String, String>,
    reglages: Reglages,
    debut_partie_ms: Option<i64>,
    maintenant_ms: i64,
) -> Option<Presence> {
    if !reglages.actif {
        return None;
    }

    let rang = if reglages.montrer_rang { nom_du_rang(etat.tier) } else { None };
    // Liees a dessein : couper le rang doit retirer la pastille AUSSI, sinon
    // l'embleme continuerait de le trahir en image.
    let embleme = rang.as_ref().and_then(|_| cle_rang(etat.tier));

    let groupe = match etat.party_size {
        Some(n) if n > 1 => Some(format!("à {n}")),
        _ => None,
    };

    let semaine = donnees.and_then(|d| d.semaine.as_ref()).map(ligne_semaine);
    let serie = donnees.and_then(|d| d.serie.as_ref()).map(ligne_serie);

    // Valorant ferme : le statut ne parle plus de partie, il parle du groupe.
    // C'est l'etat le plus frequent de la journee, et donc celui qui a le plus
    // d'occasions d'etre lu par quelqu'un qui ne connait pas le site.
    let Some(en_jeu) = etat.etat else {
        return Some(Presence {
            details: "Pas en jeu".to_string(),
            state: joindre(vec![semaine.or(serie)]),
            debut_s: None,
            grande_image: "logo".to_string(),
            grand_texte: Some("On lance ?".to_string()),
            petite_image: embleme,
            petit_texte: rang,
        });
    };

    // Traduit AVANT tout usage : le reste du module ne manipule plus que des
    // noms affichables, donc une seule langue.
    let map = nom_de_map(etat.map_code.as_deref(), codes);
    let image = cle_image(map.as_deref());

    match en_jeu {
        Etat::Ingame => {
            let score = etat.score.as_ref().map(|s| format!("{}–{}", s.nous, s.eux));
            Some(Presence {
                details: match &map {
                    Some(m) => format!("En partie — {m}"),
                    None => "En partie".to_string(),
                },
                state: joindre(vec![rang.clone(), score, groupe]),
                debut_s: debut_partie_ms.map(|ms| ms / 1000),
                grande_image: image,
                grand_texte: map,
                petite_image: embleme,
                petit_texte: rang,
            })
        }

        Etat::Pregame => Some(Presence {
            details: match &map {
                Some(m) => format!("Sélection d'agents — {m}"),
                None => "Sélection d'agents".to_string(),
            },
            state: joindre(vec![rang.clone(), groupe]),
            debut_s: None,
            grande_image: image,
            grand_texte: map,
            petite_image: embleme,
            petit_texte: rang,
        }),

        Etat::Menus => {
            // LE COEUR DE L'IDEE.
            //
            // Juste apres une partie, le statut annonce la place dans le
            // groupe. Finir dernier et que tout le serveur le lise pendant
            // vingt minutes, c'est exactement ce que fait le site — et c'est ce
            // qui fait poser la question a ceux qui passent.
            let fraiche = donnees
                .and_then(|d| d.derniere.as_ref())
                .filter(|_| debut_partie_ms.is_some_and(|d| maintenant_ms - d < FRAICHEUR_PARTIE_MS))
                .filter(|p| p.place.is_some());

            if let Some(p) = fraiche {
                let verdict = place_en_mots(p.place.unwrap_or(0), p.sur.unwrap_or(0));
                let feuille = match (p.kills, p.deaths, p.assists) {
                    (Some(k), Some(d), Some(a)) => Some(format!("{k}/{d}/{a}")),
                    _ => None,
                };
                return Some(Presence {
                    details: match &p.map {
                        Some(m) => format!("Sort d'une game sur {m}"),
                        None => "Sort d'une game".to_string(),
                    },
                    state: joindre(vec![Some(verdict), feuille]),
                    debut_s: None,
                    grande_image: cle_image(p.map.as_deref()),
                    grand_texte: p.map.clone(),
                    petite_image: embleme,
                    petit_texte: rang,
                });
            }

            Some(Presence {
                details: "Dans les menus".to_string(),
                state: joindre(vec![rang.clone(), serie.or(semaine)]),
                debut_s: None,
                grande_image: "logo".to_string(),
                grand_texte: Some("On lance ?".to_string()),
                petite_image: embleme,
                petit_texte: rang,
            })
        }
    }
}
