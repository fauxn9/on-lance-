//! Import d'un build dans le client : page de runes, sorts, set d'items.
//!
//! Tout passe par les routes que le client expose pour ça, exactement comme
//! si le joueur le faisait à la main. Les charges utiles sont construites par
//! des fonctions pures, testées ; seul l'envoi touche au client.

use crate::client::{Erreur, Lcu};
use reqwest::Method;
use serde_json::{json, Value};

pub const PREFIXE: &str = "On lance ?";
const FLASH: u32 = 4;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PageRunes {
    pub nom: String,
    pub style: u32,
    pub sous_style: u32,
    /// Clé de voûte, 3 principales, 2 secondaires, 3 fragments.
    pub perks: Vec<u32>,
}

/// Page à supprimer avant de créer la nôtre : notre ancienne page si elle
/// existe, sinon — quand le client n'a plus de place — la page actuelle, à
/// condition qu'elle soit modifiable. `Err` si rien ne peut être libéré.
pub fn page_a_liberer(pages: &[Value], place_libre: bool) -> Result<Option<u64>, &'static str> {
    if let Some(p) = pages.iter().find(|p| {
        p["name"].as_str().is_some_and(|n| n.starts_with(PREFIXE)) && p["isDeletable"] == true
    }) {
        return Ok(p["id"].as_u64());
    }
    if place_libre {
        return Ok(None);
    }
    pages
        .iter()
        .find(|p| p["current"] == true && p["isDeletable"] == true)
        .map(|p| p["id"].as_u64())
        .ok_or("plus de place pour une page de runes")
}

pub fn corps_page(page: &PageRunes) -> Value {
    json!({
        "name": page.nom,
        "primaryStyleId": page.style,
        "subStyleId": page.sous_style,
        "selectedPerkIds": page.perks,
        "current": true,
    })
}

pub async fn importer_runes(lcu: &Lcu, page: &PageRunes) -> Result<(), Erreur> {
    if page.perks.len() != 9 {
        return Err(Erreur::Appel("page de runes incomplète".into()));
    }
    let pages = lcu.get("/lol-perks/v1/pages").await?.and_then(|v| v.as_array().cloned()).unwrap_or_default();
    let place = lcu.get("/lol-perks/v1/inventory").await?.map(|v| v["canAddCustomPage"] == true).unwrap_or(true);
    let a_liberer = page_a_liberer(&pages, place).map_err(|e| Erreur::Appel(e.into()))?;
    if let Some(id) = a_liberer {
        lcu.envoyer(Method::DELETE, &format!("/lol-perks/v1/pages/{id}"), None).await?;
    }
    lcu.envoyer(Method::POST, "/lol-perks/v1/pages", Some(&corps_page(page))).await?;
    Ok(())
}

/// Les sorts recommandés, en gardant le Saut éclair sur la touche où le
/// joueur l'a déjà (D ou F) : la mémoire musculaire passe avant tout.
pub fn ordonner_sorts(recommandes: [u32; 2], actuels: [u32; 2]) -> [u32; 2] {
    let [a, b] = recommandes;
    let autre = if a == FLASH { b } else { a };
    if a != FLASH && b != FLASH {
        return recommandes;
    }
    match actuels {
        [_, f] if f == FLASH => [autre, FLASH],
        _ => [FLASH, autre],
    }
}

pub async fn importer_sorts(lcu: &Lcu, sorts: [u32; 2]) -> Result<(), Erreur> {
    let corps = json!({ "spell1Id": sorts[0], "spell2Id": sorts[1] });
    lcu.envoyer(Method::PATCH, "/lol-champ-select/v1/session/my-selection", Some(&corps)).await?;
    Ok(())
}

/// Un set d'items « On lance ? » pour un champion. `carte` : 11 (Faille) ou 12 (ARAM).
pub fn set_items(champion: u32, titre: &str, carte: u32, blocs: &[(String, Vec<u32>)]) -> Value {
    let blocs: Vec<Value> = blocs
        .iter()
        .filter(|(_, ids)| !ids.is_empty())
        .map(|(nom, ids)| json!({ "type": nom, "items": ids.iter().map(|i| json!({ "id": i.to_string(), "count": 1 })).collect::<Vec<_>>() }))
        .collect();
    json!({
        "uid": format!("onlance-{champion}-{carte}"),
        "title": format!("{PREFIXE} {titre}"),
        "associatedChampions": [champion],
        "associatedMaps": [carte],
        "blocks": blocs,
        "map": "any",
        "mode": "any",
        "preferredItemSlots": [],
        "sortrank": 0,
        "startedFrom": "blank",
        "type": "custom",
    })
}

/// Ajoute (ou remplace) notre set dans la liste des sets du joueur, sans
/// toucher aux siens.
pub fn fusionner_set(existant: &Value, set: Value) -> Value {
    let uid = set["uid"].clone();
    let mut sets: Vec<Value> = existant["itemSets"].as_array().cloned().unwrap_or_default();
    sets.retain(|s| s["uid"] != uid);
    sets.push(set);
    json!({
        "accountId": existant["accountId"],
        "itemSets": sets,
        "timestamp": existant["timestamp"].as_i64().unwrap_or(0) + 1,
    })
}

pub async fn importer_items(lcu: &Lcu, set: Value) -> Result<(), Erreur> {
    let id = lcu
        .get("/lol-summoner/v1/current-summoner")
        .await?
        .and_then(|v| v["summonerId"].as_u64())
        .ok_or_else(|| Erreur::Appel("identifiant d'invocateur introuvable".into()))?;
    let chemin = format!("/lol-item-sets/v1/item-sets/{id}/sets");
    let existant = lcu.get(&chemin).await?.unwrap_or_else(|| json!({ "itemSets": [] }));
    lcu.envoyer(Method::PUT, &chemin, Some(&fusionner_set(&existant, set))).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remplace_notre_ancienne_page_en_priorite() {
        let pages = vec![
            json!({ "id": 1, "name": "Ma page", "isDeletable": true, "current": true }),
            json!({ "id": 2, "name": "On lance ? Sett", "isDeletable": true, "current": false }),
        ];
        assert_eq!(page_a_liberer(&pages, false), Ok(Some(2)));
        assert_eq!(page_a_liberer(&pages[..1], true), Ok(None), "de la place : on ne supprime rien");
        assert_eq!(page_a_liberer(&pages[..1], false), Ok(Some(1)), "plus de place : la page actuelle");
        let bloquee = vec![json!({ "id": 3, "name": "Pré-réglée", "isDeletable": false, "current": true })];
        assert!(page_a_liberer(&bloquee, false).is_err());
    }

    #[test]
    fn corps_de_page() {
        let p = PageRunes { nom: "On lance ? Sett".into(), style: 8000, sous_style: 8400, perks: vec![8010, 9111, 9104, 8299, 8444, 8451, 5008, 5008, 5011] };
        let c = corps_page(&p);
        assert_eq!(c["primaryStyleId"], 8000);
        assert_eq!(c["selectedPerkIds"].as_array().unwrap().len(), 9);
        assert_eq!(c["current"], true);
    }

    #[test]
    fn flash_reste_sur_sa_touche() {
        assert_eq!(ordonner_sorts([4, 12], [14, 4]), [12, 4], "Flash sur F : il y reste");
        assert_eq!(ordonner_sorts([12, 4], [4, 14]), [4, 12], "Flash sur D : il y reste");
        assert_eq!(ordonner_sorts([4, 12], [0, 0]), [4, 12]);
        assert_eq!(ordonner_sorts([11, 12], [4, 14]), [11, 12], "pas de Flash : rien à respecter");
    }

    #[test]
    fn set_ajoute_sans_toucher_aux_autres() {
        let existant = json!({ "accountId": 42, "timestamp": 10, "itemSets": [
            { "uid": "a-moi", "title": "Mon set" },
            { "uid": "onlance-875-11", "title": "On lance ? ancien" },
        ]});
        let set = set_items(875, "Sett · Top", 11, &[("Départ".into(), vec![1055, 2003]), ("Vide".into(), vec![])]);
        let f = fusionner_set(&existant, set);
        let sets = f["itemSets"].as_array().unwrap();
        assert_eq!(sets.len(), 2);
        assert_eq!(sets[0]["uid"], "a-moi");
        assert_eq!(sets[1]["title"], "On lance ? Sett · Top");
        assert_eq!(sets[1]["blocks"].as_array().unwrap().len(), 1, "bloc vide retiré");
        assert_eq!(sets[1]["blocks"][0]["items"][0]["id"], "1055");
        assert_eq!(f["timestamp"], 11);
    }
}
