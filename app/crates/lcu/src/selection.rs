//! La sélection des champions, telle que le client la voit.
//!
//! On ne garde que ce qui est visible pour tout le monde : champions, postes,
//! bans, chrono. Les pseudos des alliés ne sont même pas lus : Riot les masque
//! en classée, et une app qui les révélerait serait bannie (à juste titre).

use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Allie {
    /// Champion verrouillé ou survolé (0 : aucun).
    pub champion: u32,
    /// Intention affichée pendant la phase de planification.
    pub intention: u32,
    pub poste: Option<String>,
    pub moi: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Selection {
    /// `PLANNING`, `BAN_PICK`, `FINALIZATION`…
    pub phase: String,
    pub temps_restant_ms: i64,
    /// File de la partie (420 classée Solo/Duo, 450 ARAM…), lue à part.
    pub file: Option<u32>,
    pub mon_poste: Option<String>,
    pub mon_champion: Option<u32>,
    pub verrouille: bool,
    pub allies: Vec<Allie>,
    /// Picks adverses visibles.
    pub ennemis: Vec<u32>,
    pub bans: Vec<u32>,
    /// ARAM : champions sur le banc.
    pub banc: Vec<u32>,
    pub sorts: [u32; 2],
}

fn poste(v: &Value) -> Option<String> {
    let p = match v.as_str()? {
        "top" => "TOP",
        "jungle" => "JUNGLE",
        "middle" => "MIDDLE",
        "bottom" => "BOTTOM",
        "utility" => "UTILITY",
        _ => return None,
    };
    Some(p.to_string())
}

fn u(v: &Value) -> u32 {
    v.as_u64().unwrap_or(0) as u32
}

/// `/lol-champ-select/v1/session`
pub fn selection_depuis(v: &Value) -> Option<Selection> {
    let moi = v.get("localPlayerCellId")?.as_i64()?;
    let actions: Vec<&Value> = v["actions"].as_array().into_iter().flatten().filter_map(Value::as_array).flatten().collect();

    let allies: Vec<Allie> = v["myTeam"]
        .as_array()?
        .iter()
        .map(|a| Allie {
            champion: u(&a["championId"]),
            intention: u(&a["championPickIntent"]),
            poste: poste(&a["assignedPosition"]),
            moi: a["cellId"].as_i64() == Some(moi),
        })
        .collect();
    let mien = v["myTeam"].as_array()?.iter().find(|a| a["cellId"].as_i64() == Some(moi))?;
    let mon_champion = [u(&mien["championId"]), u(&mien["championPickIntent"])].into_iter().find(|c| *c > 0);
    let verrouille = actions
        .iter()
        .any(|a| a["actorCellId"].as_i64() == Some(moi) && a["type"] == "pick" && a["completed"] == true);

    let ennemis = v["theirTeam"].as_array().into_iter().flatten().map(|e| u(&e["championId"])).filter(|c| *c > 0).collect();

    let mut bans: Vec<u32> = ["myTeamBans", "theirTeamBans"]
        .iter()
        .flat_map(|k| v["bans"][k].as_array().cloned().unwrap_or_default())
        .map(|b| u(&b))
        .chain(actions.iter().filter(|a| a["type"] == "ban" && a["completed"] == true).map(|a| u(&a["championId"])))
        .filter(|c| *c > 0)
        .collect();
    bans.sort_unstable();
    bans.dedup();

    // Le banc ARAM a changé de forme selon les versions du client.
    let banc = match v.get("benchChampions").and_then(Value::as_array) {
        Some(l) => l.iter().map(|b| u(&b["championId"])).filter(|c| *c > 0).collect(),
        None => v["benchChampionIds"].as_array().into_iter().flatten().map(u).filter(|c| *c > 0).collect(),
    };

    Some(Selection {
        phase: v["timer"]["phase"].as_str().unwrap_or_default().to_string(),
        temps_restant_ms: v["timer"]["adjustedTimeLeftInPhase"].as_i64().unwrap_or(0),
        file: None,
        mon_poste: poste(&mien["assignedPosition"]),
        mon_champion,
        verrouille,
        allies,
        ennemis,
        bans,
        banc,
        sorts: [u(&mien["spell1Id"]), u(&mien["spell2Id"])],
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn session() -> Value {
        json!({
            "localPlayerCellId": 2,
            "actions": [
                [{ "actorCellId": 0, "championId": 157, "completed": true, "type": "ban" },
                 { "actorCellId": 5, "championId": 238, "completed": true, "type": "ban" }],
                [{ "actorCellId": 2, "championId": 875, "completed": false, "isInProgress": true, "type": "pick" }]
            ],
            "bans": { "myTeamBans": [157], "theirTeamBans": [238] },
            "myTeam": [
                { "cellId": 0, "assignedPosition": "jungle", "championId": 64, "championPickIntent": 0, "gameName": "", "puuid": "", "spell1Id": 11, "spell2Id": 4 },
                { "cellId": 1, "assignedPosition": "middle", "championId": 0, "championPickIntent": 61 },
                { "cellId": 2, "assignedPosition": "top", "championId": 875, "championPickIntent": 875, "spell1Id": 4, "spell2Id": 14 },
                { "cellId": 3, "assignedPosition": "bottom", "championId": 0, "championPickIntent": 0 },
                { "cellId": 4, "assignedPosition": "utility", "championId": 0, "championPickIntent": 0 }
            ],
            "theirTeam": [
                { "cellId": 5, "championId": 122 }, { "cellId": 6, "championId": 0 }, { "cellId": 7, "championId": 103 }
            ],
            "timer": { "phase": "BAN_PICK", "adjustedTimeLeftInPhase": 21500 }
        })
    }

    #[test]
    fn lit_la_selection() {
        let s = selection_depuis(&session()).unwrap();
        assert_eq!(s.phase, "BAN_PICK");
        assert_eq!(s.temps_restant_ms, 21500);
        assert_eq!(s.mon_poste.as_deref(), Some("TOP"));
        assert_eq!(s.mon_champion, Some(875));
        assert!(!s.verrouille, "le pick est en cours, pas validé");
        assert_eq!(s.ennemis, vec![122, 103]);
        assert_eq!(s.bans, vec![157, 238]);
        assert_eq!(s.sorts, [4, 14]);
        assert_eq!(s.allies.len(), 5);
        assert!(s.allies[2].moi);
        assert_eq!(s.allies[1].intention, 61);
    }

    #[test]
    fn verrouillage_et_intention() {
        let mut v = session();
        v["actions"][1][0]["completed"] = json!(true);
        v["myTeam"][2]["championId"] = json!(0);
        v["myTeam"][2]["championPickIntent"] = json!(85);
        let s = selection_depuis(&v).unwrap();
        assert!(s.verrouille);
        assert_eq!(s.mon_champion, Some(85), "sans champion choisi, l'intention compte");
    }

    #[test]
    fn banc_aram_des_deux_formes() {
        let mut v = session();
        v["benchChampions"] = json!([{ "championId": 222 }, { "championId": 12 }]);
        assert_eq!(selection_depuis(&v).unwrap().banc, vec![222, 12]);
        let mut w = session();
        w["benchChampionIds"] = json!([99]);
        assert_eq!(selection_depuis(&w).unwrap().banc, vec![99]);
    }

    #[test]
    fn aucun_pseudo_ne_sort_d_ici() {
        let texte = serde_json::to_string(&selection_depuis(&session()).unwrap()).unwrap();
        assert!(!texte.contains("gameName") && !texte.contains("puuid"));
    }
}
