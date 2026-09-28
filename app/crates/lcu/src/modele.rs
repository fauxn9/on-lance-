//! Ce qu'on retient des réponses du client : le compte, le rang, la plateforme.

use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Compte {
    pub puuid: String,
    pub game_name: String,
    pub tag_line: String,
    pub niveau: u32,
    pub icone: u32,
}

/// `/lol-summoner/v1/current-summoner`
pub fn compte_depuis(v: &Value) -> Option<Compte> {
    let puuid = v.get("puuid")?.as_str()?.to_string();
    if puuid.is_empty() {
        return None;
    }
    Some(Compte {
        puuid,
        game_name: v.get("gameName").and_then(Value::as_str).unwrap_or_default().to_string(),
        tag_line: v.get("tagLine").and_then(Value::as_str).unwrap_or_default().to_string(),
        niveau: v.get("summonerLevel").and_then(Value::as_u64).unwrap_or(0) as u32,
        icone: v.get("profileIconId").and_then(Value::as_u64).unwrap_or(0) as u32,
    })
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rang {
    /// `RANKED_SOLO_5x5` ou `RANKED_FLEX_SR`.
    pub file: String,
    pub tier: String,
    pub division: Option<String>,
    pub lp: i32,
    pub victoires: u32,
    pub defaites: u32,
}

const FILES: [&str; 2] = ["RANKED_SOLO_5x5", "RANKED_FLEX_SR"];
const TIERS: [&str; 10] = [
    "IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND", "MASTER", "GRANDMASTER", "CHALLENGER",
];

/// `/lol-ranked/v1/current-ranked-stats`. Les files non classées sont ignorées.
pub fn rangs_depuis(v: &Value) -> Vec<Rang> {
    let Some(map) = v.get("queueMap") else { return Vec::new() };
    FILES
        .iter()
        .filter_map(|file| {
            let q = map.get(*file)?;
            let tier = q.get("tier").and_then(Value::as_str).unwrap_or_default();
            if !TIERS.contains(&tier) {
                return None;
            }
            let division = q
                .get("division")
                .and_then(Value::as_str)
                .filter(|d| matches!(*d, "I" | "II" | "III" | "IV"))
                .map(str::to_string);
            Some(Rang {
                file: file.to_string(),
                tier: tier.to_string(),
                division,
                lp: q.get("leaguePoints").and_then(Value::as_i64).unwrap_or(0) as i32,
                victoires: q.get("wins").and_then(Value::as_u64).unwrap_or(0) as u32,
                defaites: q.get("losses").and_then(Value::as_u64).unwrap_or(0) as u32,
            })
        })
        .collect()
}

impl Rang {
    /// Position absolue sur l'échelle : chaque division vaut 100 PL, Maître et
    /// au-dessus partagent une même base. Sert à calculer une variation de PL
    /// qui traverse une promotion ou une relégation.
    pub fn echelle(&self) -> Option<i32> {
        let t = TIERS.iter().position(|x| *x == self.tier)? as i32;
        if t >= 7 {
            return Some(7 * 400 + self.lp);
        }
        let d = match self.division.as_deref() {
            Some("IV") => 0,
            Some("III") => 1,
            Some("II") => 2,
            Some("I") => 3,
            _ => 0,
        };
        Some(t * 400 + d * 100 + self.lp)
    }

    pub fn parties(&self) -> u32 {
        self.victoires + self.defaites
    }
}

/// Variation de PL entre deux photos du même classement, `None` si rien n'a
/// bougé (partie annulée, file non classée…).
pub fn variation(avant: &Rang, apres: &Rang) -> Option<i32> {
    if avant.file != apres.file || apres.parties() <= avant.parties() {
        return None;
    }
    Some(apres.echelle()? - avant.echelle()?)
}

/// `EUW1` → `euw1`. Accepte aussi la région du client (`EUW`) en secours.
pub fn plateforme_depuis(platform_id: Option<&str>, region: Option<&str>) -> Option<String> {
    if let Some(p) = platform_id.filter(|p| !p.is_empty()) {
        return Some(p.to_ascii_lowercase());
    }
    let p = match region?.to_ascii_uppercase().as_str() {
        "EUW" => "euw1",
        "EUNE" => "eun1",
        "NA" => "na1",
        "KR" => "kr",
        "JP" => "jp1",
        "BR" => "br1",
        "LAN" => "la1",
        "LAS" => "la2",
        "OCE" => "oc1",
        "TR" => "tr1",
        "RU" => "ru",
        "ME" => "me1",
        "SG" | "PH" => "sg2",
        "TW" => "tw2",
        "VN" => "vn2",
        _ => return None,
    };
    Some(p.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn lit_le_compte() {
        let v = json!({ "puuid": "abc", "gameName": "Kasai", "tagLine": "EUW", "summonerLevel": 312, "profileIconId": 29 });
        let c = compte_depuis(&v).unwrap();
        assert_eq!(c.game_name, "Kasai");
        assert_eq!(c.niveau, 312);
        assert!(compte_depuis(&json!({ "puuid": "" })).is_none());
    }

    #[test]
    fn lit_les_rangs_et_ignore_le_non_classe() {
        let v = json!({ "queueMap": {
            "RANKED_SOLO_5x5": { "tier": "EMERALD", "division": "II", "leaguePoints": 64, "wins": 58, "losses": 49 },
            "RANKED_FLEX_SR": { "tier": "", "division": "NA", "leaguePoints": 0, "wins": 0, "losses": 0 },
            "RANKED_TFT": { "tier": "GOLD", "division": "I" }
        }});
        let r = rangs_depuis(&v);
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].tier, "EMERALD");
        assert_eq!(r[0].division.as_deref(), Some("II"));
        assert_eq!(r[0].lp, 64);
    }

    fn rang(tier: &str, div: Option<&str>, lp: i32, v: u32, d: u32) -> Rang {
        Rang { file: "RANKED_SOLO_5x5".into(), tier: tier.into(), division: div.map(Into::into), lp, victoires: v, defaites: d }
    }

    #[test]
    fn variation_simple_promotion_et_relegation() {
        assert_eq!(variation(&rang("EMERALD", Some("II"), 64, 58, 49), &rang("EMERALD", Some("II"), 85, 59, 49)), Some(21));
        // 90 PL en Émeraude II, +22 : promotion en Émeraude I à 12 PL.
        assert_eq!(variation(&rang("EMERALD", Some("II"), 90, 58, 49), &rang("EMERALD", Some("I"), 12, 59, 49)), Some(22));
        // Relégation de Diamant IV 5 PL vers Émeraude I 85 PL.
        assert_eq!(variation(&rang("DIAMOND", Some("IV"), 5, 10, 10), &rang("EMERALD", Some("I"), 85, 10, 11)), Some(-20));
        // Rien joué : pas de variation.
        assert_eq!(variation(&rang("GOLD", Some("I"), 50, 5, 5), &rang("GOLD", Some("I"), 50, 5, 5)), None);
    }

    #[test]
    fn plateforme() {
        assert_eq!(plateforme_depuis(Some("EUW1"), None).as_deref(), Some("euw1"));
        assert_eq!(plateforme_depuis(None, Some("EUNE")).as_deref(), Some("eun1"));
        assert_eq!(plateforme_depuis(Some(""), Some("KR")).as_deref(), Some("kr"));
        assert_eq!(plateforme_depuis(None, Some("???")), None);
    }
}
