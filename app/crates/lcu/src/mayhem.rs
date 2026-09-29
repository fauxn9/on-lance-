//! ARAM Mayhem : Riot ne publie pas ces parties dans son API publique. Le
//! client, lui, les montre dans ton historique, avec les augments des 10
//! joueurs. On en tire un résumé anonyme (champion, équipe, victoire,
//! augments : aucun pseudo, aucun identifiant de joueur) que l'app partage
//! pour construire la tier list des augments.

use crate::client::Lcu;
use serde_json::{json, Value};
use std::collections::HashSet;

pub const FILE: u64 = 2400;

/// Résumé anonyme d'une partie détaillée (`/lol-match-history/v1/games/{id}`),
/// ou `None` si ce n'est pas une partie Mayhem complète.
pub fn resumer(g: &Value) -> Option<Value> {
    if g["queueId"].as_u64()? != FILE {
        return None;
    }
    let joueurs: Vec<Value> = g["participants"]
        .as_array()?
        .iter()
        .map(|p| {
            let st = &p["stats"];
            let augments: Vec<u64> = (1..=6).filter_map(|n| st[format!("playerAugment{n}")].as_u64()).filter(|&a| a > 0).collect();
            // Objets de fin de partie, dans l'ordre des cases (≈ l'ordre d'achat).
            let items: Vec<u64> = (0..=5).filter_map(|n| st[format!("item{n}")].as_u64()).filter(|&i| i > 0).collect();
            let sorts: Vec<u64> = [&p["spell1Id"], &p["spell2Id"]].iter().filter_map(|s| s.as_u64()).filter(|&s| s > 0).collect();
            json!({
                "championId": p["championId"],
                "equipe": p["teamId"],
                "victoire": st["win"].as_bool().unwrap_or(false),
                "augments": augments,
                "items": items,
                "sorts": sorts,
            })
        })
        .collect();
    if joueurs.len() != 10 {
        return None;
    }
    Some(json!({
        "gameId": g["gameId"],
        "plateforme": g["platformId"],
        "version": g["gameVersion"],
        "duree": g["gameDuration"],
        "joueurs": joueurs,
    }))
}

/// Tes dernières parties Mayhem pas encore partagées (`deja` : leurs gameId).
pub async fn recentes(lcu: &Lcu, deja: &HashSet<u64>) -> Vec<(u64, Value)> {
    let chemin = "/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=20";
    let Ok(Some(liste)) = lcu.get(chemin).await else { return Vec::new() };
    let ids: Vec<u64> = liste["games"]["games"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|g| g["queueId"].as_u64() == Some(FILE))
        .filter_map(|g| g["gameId"].as_u64())
        .filter(|id| !deja.contains(id))
        .collect();
    let mut out = Vec::new();
    for id in ids {
        if let Ok(Some(g)) = lcu.get(&format!("/lol-match-history/v1/games/{id}")).await {
            if let Some(r) = resumer(&g) {
                out.push((id, r));
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn partie(file: u64) -> Value {
        let participants: Vec<Value> = (0..10)
            .map(|i| {
                json!({
                    "championId": 200 + i, "teamId": if i < 5 { 100 } else { 200 }, "spell1Id": 6, "spell2Id": 4,
                    "stats": { "win": i < 5, "playerAugment1": 1154, "playerAugment2": 1047, "playerAugment3": 0, "playerAugment4": 0,
                               "item0": 6676, "item1": 0, "item2": 3031, "item6": 3340 }
                })
            })
            .collect();
        json!({
            "gameId": 7998740078u64, "queueId": file, "platformId": "EUW1", "gameVersion": "16.19.823.722", "gameDuration": 1047,
            "participantIdentities": [{ "player": { "gameName": "le FOUrbe", "puuid": "secret" } }],
            "participants": participants,
        })
    }

    #[test]
    fn resume_sans_identite() {
        let r = resumer(&partie(FILE)).unwrap();
        assert_eq!(r["joueurs"].as_array().unwrap().len(), 10);
        assert_eq!(r["joueurs"][0]["augments"], json!([1154, 1047]), "les emplacements vides ne comptent pas");
        assert_eq!(r["joueurs"][7]["victoire"], json!(false));
        assert_eq!(r["joueurs"][0]["items"], json!([6676, 3031]), "cases vides et bijou exclus");
        assert_eq!(r["joueurs"][0]["sorts"], json!([6, 4]));
        let texte = r.to_string();
        assert!(!texte.contains("FOUrbe") && !texte.contains("secret"), "aucun pseudo ni identifiant");
    }

    #[test]
    fn ignore_les_autres_files() {
        assert!(resumer(&partie(450)).is_none());
    }
}
