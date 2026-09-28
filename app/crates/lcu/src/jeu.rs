//! La partie en cours, vue par l'API officielle de données en direct du jeu
//! (port 2999), résumée pour l'overlay (brique 6).
//!
//! Tout ce qu'on en tire est déjà visible en jeu : objets de chacun (tableau
//! des scores), objectifs tués (annoncés à toute la partie), ton niveau et tes
//! compétences. Rien sur les temps de recharge adverses : c'est interdit par
//! Riot, et ce n'est pas dans cette API de toute façon.

use serde::Serialize;
use serde_json::Value;
use std::path::Path;
use std::time::Duration;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Joueur {
    /// Identifiant Data Dragon du champion (« Ahri », « MonkeyKing »…).
    pub champion: String,
    /// `ORDER` (bleu) ou `CHAOS` (rouge).
    pub equipe: String,
    pub poste: Option<String>,
    pub niveau: u32,
    pub items: Vec<u32>,
    /// Valeur de ses objets en pièces d'or : l'estimation de l'or gagné que
    /// tout le monde peut faire en regardant le tableau des scores.
    pub valeur: u32,
    pub moi: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Objectif {
    /// `dragon`, `ancien`, `baron` ou `heraut`.
    pub genre: String,
    /// Secondes de jeu au moment de la mort du monstre.
    pub temps: f64,
    pub equipe: Option<String>,
    /// Élément du dragon (`Fire`, `Water`, `Earth`, `Air`, `Chemtech`, `Hextech`).
    pub element: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnJeu {
    /// Secondes de jeu.
    pub temps: f64,
    /// `CLASSIC`, `ARAM`, `CHERRY`…
    pub mode: String,
    pub or: f64,
    pub niveau: u32,
    /// Niveaux de Q, W, E, R.
    pub competences: [u32; 4],
    pub joueurs: Vec<Joueur>,
    pub objectifs: Vec<Objectif>,
}

fn texte(v: &Value) -> Option<String> {
    v.as_str().filter(|s| !s.is_empty()).map(str::to_string)
}

/// « game_character_displayname_MonkeyKing » → « MonkeyKing ».
pub fn champion_depuis(brut: &str) -> String {
    brut.rsplit('_').next().unwrap_or(brut).to_string()
}

/// Résume `/liveclientdata/allgamedata`. `prix` donne la valeur totale d'un
/// objet (Data Dragon) ; 0 si inconnu.
pub fn resumer(v: &Value, prix: impl Fn(u32) -> u32) -> Option<EnJeu> {
    let actif = &v["activePlayer"];
    let mon_id = texte(&actif["riotId"]).or_else(|| texte(&actif["summonerName"]));
    let meme = |p: &Value| {
        mon_id.is_some() && (texte(&p["riotId"]) == mon_id || texte(&p["summonerName"]) == mon_id)
    };

    let joueurs: Vec<Joueur> = v["allPlayers"]
        .as_array()?
        .iter()
        .map(|p| {
            let items: Vec<&Value> = p["items"].as_array().map(|a| a.iter().collect()).unwrap_or_default();
            let valeur = items
                .iter()
                .filter(|i| !i["consumable"].as_bool().unwrap_or(false))
                .map(|i| prix(i["itemID"].as_u64().unwrap_or(0) as u32) * i["count"].as_u64().unwrap_or(1).max(1) as u32)
                .sum();
            Joueur {
                champion: texte(&p["rawChampionName"]).map(|r| champion_depuis(&r)).unwrap_or_default(),
                equipe: texte(&p["team"]).unwrap_or_default(),
                poste: texte(&p["position"]).filter(|s| s != "NONE"),
                niveau: p["level"].as_u64().unwrap_or(0) as u32,
                items: items.iter().filter_map(|i| i["itemID"].as_u64()).map(|x| x as u32).collect(),
                valeur,
                moi: meme(p),
            }
        })
        .collect();

    // Qui a tué quoi : le tueur est un joueur (nom ou Riot ID), on en déduit l'équipe.
    let equipe_de = |nom: &str| {
        v["allPlayers"].as_array().into_iter().flatten().find_map(|p| {
            let noms = [texte(&p["riotIdGameName"]), texte(&p["summonerName"]), texte(&p["riotId"])];
            noms.iter().flatten().any(|n| n == nom).then(|| texte(&p["team"])).flatten()
        })
    };
    let objectifs = v["events"]["Events"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|e| {
            let genre = match e["EventName"].as_str()? {
                "DragonKill" if e["DragonType"].as_str() == Some("Elder") => "ancien",
                "DragonKill" => "dragon",
                "BaronKill" => "baron",
                "HeraldKill" => "heraut",
                _ => return None,
            };
            Some(Objectif {
                genre: genre.into(),
                temps: e["EventTime"].as_f64().unwrap_or(0.0),
                equipe: e["KillerName"].as_str().and_then(|n| equipe_de(n)),
                element: texte(&e["DragonType"]).filter(|d| d != "Elder"),
            })
        })
        .collect();

    let niv = |k: &str| actif["abilities"][k]["abilityLevel"].as_u64().unwrap_or(0) as u32;
    Some(EnJeu {
        temps: v["gameData"]["gameTime"].as_f64().unwrap_or(0.0),
        mode: texte(&v["gameData"]["gameMode"]).unwrap_or_default(),
        or: actif["currentGold"].as_f64().unwrap_or(0.0),
        niveau: actif["level"].as_u64().unwrap_or(0) as u32,
        competences: [niv("Q"), niv("W"), niv("E"), niv("R")],
        joueurs,
        objectifs,
    })
}

/// Toutes les données de la partie en cours, ou `None` hors partie.
pub async fn donnees() -> Option<Value> {
    static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    let http = CLIENT.get_or_init(|| {
        // Même raison que pour le client League : certificat auto-signé, en local uniquement.
        reqwest::Client::builder()
            .danger_accept_invalid_certs(true)
            .timeout(Duration::from_secs(3))
            .no_proxy()
            .build()
            .expect("client HTTP local")
    });
    let rep = http.get("https://127.0.0.1:2999/liveclientdata/allgamedata").send().await.ok()?;
    if !rep.status().is_success() {
        return None;
    }
    rep.json().await.ok()
}

/// Mode d'affichage du jeu lu dans `Config/game.cfg` : 0 plein écran,
/// 1 fenêtré, 2 fenêtré sans bordure. L'overlay ne se voit pas en plein écran.
pub fn mode_fenetre_depuis(cfg: &str) -> Option<u8> {
    cfg.lines().find_map(|l| l.trim().strip_prefix("WindowMode=")?.trim().parse().ok())
}

pub fn mode_fenetre() -> Option<u8> {
    crate::lockfile::dossiers_candidats()
        .iter()
        .find_map(|d| std::fs::read_to_string(Path::new(d).join("Config").join("game.cfg")).ok())
        .and_then(|c| mode_fenetre_depuis(&c))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn partie() -> Value {
        json!({
            "activePlayer": {
                "riotId": "Kasai#EUW", "level": 7, "currentGold": 1234.5,
                "abilities": { "Q": { "abilityLevel": 3 }, "W": { "abilityLevel": 1 }, "E": { "abilityLevel": 2 }, "R": { "abilityLevel": 1 } }
            },
            "allPlayers": [
                { "riotId": "Kasai#EUW", "riotIdGameName": "Kasai", "rawChampionName": "game_character_displayname_Sett", "team": "ORDER", "position": "TOP", "level": 7,
                  "items": [ { "itemID": 3071, "count": 1 }, { "itemID": 2003, "count": 2, "consumable": true }, { "itemID": 1001, "count": 1 } ] },
                { "riotId": "RoiDuTop#EUW", "riotIdGameName": "RoiDuTop", "rawChampionName": "game_character_displayname_MonkeyKing", "team": "CHAOS", "position": "TOP", "level": 6,
                  "items": [ { "itemID": 1055, "count": 1 } ] }
            ],
            "events": { "Events": [
                { "EventName": "GameStart", "EventTime": 0.0 },
                { "EventName": "DragonKill", "EventTime": 400.5, "DragonType": "Fire", "KillerName": "Kasai" },
                { "EventName": "DragonKill", "EventTime": 1900.0, "DragonType": "Elder", "KillerName": "RoiDuTop" },
                { "EventName": "BaronKill", "EventTime": 1500.0, "KillerName": "Inconnu" }
            ] },
            "gameData": { "gameTime": 512.3, "gameMode": "CLASSIC" }
        })
    }

    #[test]
    fn resume_une_partie() {
        let prix = |id| match id { 3071 => 3000, 1001 => 300, 1055 => 450, 2003 => 50, _ => 0 };
        let r = resumer(&partie(), prix).unwrap();
        assert_eq!(r.temps, 512.3);
        assert_eq!(r.competences, [3, 1, 2, 1]);
        assert_eq!(r.joueurs[0].champion, "Sett");
        assert!(r.joueurs[0].moi);
        assert!(!r.joueurs[1].moi);
        assert_eq!(r.joueurs[1].champion, "MonkeyKing");
        assert_eq!(r.joueurs[0].valeur, 3300, "les potions ne comptent pas");
        assert_eq!(r.joueurs[0].poste.as_deref(), Some("TOP"));
        assert_eq!(r.objectifs.len(), 3);
        assert_eq!(r.objectifs[0].genre, "dragon");
        assert_eq!(r.objectifs[0].equipe.as_deref(), Some("ORDER"));
        assert_eq!(r.objectifs[0].element.as_deref(), Some("Fire"));
        assert_eq!(r.objectifs[1].genre, "ancien");
        assert_eq!(r.objectifs[1].equipe.as_deref(), Some("CHAOS"));
        assert_eq!(r.objectifs[2].equipe, None, "tueur inconnu : pas d'équipe inventée");
    }

    #[test]
    fn lit_le_mode_daffichage() {
        assert_eq!(mode_fenetre_depuis("[General]\nWindowMode=2\nWidth=1920"), Some(2));
        assert_eq!(mode_fenetre_depuis("[General]\nWidth=1920"), None);
    }
}
