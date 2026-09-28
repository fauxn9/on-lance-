//! La coque Tauri : relie le suivi du client League (crate `lcu`), le serveur
//! On lance ? et l'interface.

mod serveur;

use lcu::{EtatClient, Evenement, FinDePartie};
use serde_json::{json, Value};
use serveur::{Jetons, Serveur};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::mpsc;

struct Etat {
    client: Mutex<EtatClient>,
    jetons: Mutex<Jetons>,
    chemin_jetons: PathBuf,
    serveur: Serveur,
}

impl Etat {
    /// Le compte à afficher : celui du client s'il est ouvert, sinon le dernier vu.
    fn compte_courant(&self) -> Option<(String, Option<String>)> {
        let client = self.client.lock().unwrap();
        if let Some(c) = &client.compte {
            return Some((c.puuid.clone(), client.plateforme.clone()));
        }
        let j = self.jetons.lock().unwrap();
        let puuid = j.dernier.clone()?;
        let plateforme = j.plateformes.get(&puuid).cloned();
        Some((puuid, plateforme))
    }

    /// Jeton d'appareil pour ce compte ; enregistre le compte au premier passage.
    async fn jeton(&self, puuid: &str, plateforme: Option<&str>) -> Result<String, String> {
        if let Some(t) = self.jetons.lock().unwrap().jetons.get(puuid) {
            return Ok(t.clone());
        }
        let plateforme = plateforme.ok_or("Lance League of Legends une première fois pour relier ton compte.")?;
        // Riot ID du compte ouvert dans le client (le serveur en a besoin pour
        // retrouver le puuid chiffré de l'API Riot).
        let riot_id = {
            let c = self.client.lock().unwrap();
            c.compte.as_ref().filter(|c| c.puuid == puuid).map(|c| (c.game_name.clone(), c.tag_line.clone()))
        };
        let jeton = self
            .serveur
            .enregistrer(puuid, plateforme, riot_id.as_ref().map(|(n, t)| (n.as_str(), t.as_str())))
            .await?;
        let mut j = self.jetons.lock().unwrap();
        j.jetons.insert(puuid.to_string(), jeton.clone());
        j.plateformes.insert(puuid.to_string(), plateforme.to_string());
        j.dernier = Some(puuid.to_string());
        j.sauver(&self.chemin_jetons);
        Ok(jeton)
    }

    async fn appel(&self, methode: &str, chemin: &str, corps: Option<Value>) -> Result<Value, String> {
        let (puuid, plateforme) = self.compte_courant().ok_or("Aucun compte pour l'instant : lance League of Legends.")?;
        let jeton = self.jeton(&puuid, plateforme.as_deref()).await?;
        let rep = match methode {
            "GET" => self.serveur.get(&jeton, chemin).await,
            _ => self.serveur.post(&jeton, chemin, &corps.unwrap_or(Value::Null)).await,
        };
        // Jeton refusé (base remise à zéro…) : on l'oublie, il sera recréé.
        if let Err(e) = &rep {
            if e.starts_with("Jeton") {
                self.jetons.lock().unwrap().jetons.remove(&puuid);
            }
        }
        rep
    }
}

#[tauri::command]
fn etat_client(etat: State<'_, Etat>) -> EtatClient {
    etat.client.lock().unwrap().clone()
}

#[tauri::command]
async fn profil(etat: State<'_, Etat>) -> Result<Value, String> {
    etat.appel("GET", "/profile", None).await
}

#[tauri::command]
async fn parties(etat: State<'_, Etat>, avant: Option<i64>, file: Option<String>) -> Result<Value, String> {
    let mut chemin = format!("/matches?limit=20&file={}", file.as_deref().unwrap_or("toutes"));
    if let Some(a) = avant {
        chemin.push_str(&format!("&before={a}"));
    }
    etat.appel("GET", &chemin, None).await
}

fn lcu_courant() -> Result<lcu::Lcu, String> {
    lcu::lockfile::trouver().map(|l| lcu::Lcu::new(&l)).ok_or_else(|| "Le client League est fermé.".into())
}

/// Build recommandé d'un champion (brique 3), pour un poste et une file.
#[tauri::command]
async fn build_champion(etat: State<'_, Etat>, champion: u32, role: Option<String>, file: Option<u32>) -> Result<Value, String> {
    let mut chemin = format!("/champion/{champion}?queue={}", file.unwrap_or(420));
    if let Some(r) = role.filter(|r| r.chars().all(|c| c.is_ascii_uppercase())) {
        chemin.push_str(&format!("&role={r}"));
    }
    etat.serveur.stats_get(&chemin).await
}

/// Suggestions de picks pour la sélection en cours. Le pool du joueur vient
/// de ses maîtrises, lues sur le client.
#[tauri::command]
async fn suggestions(etat: State<'_, Etat>) -> Result<Value, String> {
    let (sel, puuid) = {
        let c = etat.client.lock().unwrap();
        (c.selection.clone().ok_or("Pas de sélection des champions en cours.")?, c.compte.as_ref().map(|c| c.puuid.clone()))
    };
    let lcu = lcu_courant()?;
    let maitrises = lcu.get("/lol-champion-mastery/v1/local-player/champion-mastery").await.ok().flatten();
    let pool: Vec<Value> = maitrises
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default()
        .iter()
        .map(|m| json!({ "championId": m["championId"], "points": m["championPoints"] }))
        .collect();
    let allies: Vec<u32> = sel
        .allies
        .iter()
        .filter(|a| !a.moi)
        .map(|a| if a.champion > 0 { a.champion } else { a.intention })
        .filter(|c| *c > 0)
        .collect();
    let mut banc = sel.banc.clone();
    banc.extend(sel.mon_champion);
    let corps = json!({
        "queue": sel.file.unwrap_or(420), "role": sel.mon_poste, "ennemis": sel.ennemis,
        "allies": allies, "bans": sel.bans, "pool": pool, "banc": banc,
    });
    let jeton = puuid.and_then(|p| etat.jetons.lock().unwrap().jetons.get(&p).cloned());
    etat.serveur.stats_post(jeton.as_deref(), "/suggestions", &corps).await
}

/// Importe un build dans le client : `parties` parmi « runes », « sorts », « items ».
#[tauri::command]
async fn importer(etat: State<'_, Etat>, build: Value, titre: String, parties: Vec<String>) -> Result<Vec<String>, String> {
    use lcu::import::{self, PageRunes, PREFIXE};
    let lcu = lcu_courant()?;
    let sel = etat.client.lock().unwrap().selection.clone();
    let champion = build["championId"].as_u64().ok_or("Build sans champion.")? as u32;
    let titre: String = titre.chars().take(40).collect();
    let ids = |v: &Value| -> Vec<u32> { v.as_array().into_iter().flatten().filter_map(Value::as_u64).map(|x| x as u32).collect() };
    let mut faits = Vec::new();

    if parties.iter().any(|p| p == "runes") && build["runes"].is_object() {
        let r = &build["runes"];
        let page = PageRunes {
            nom: format!("{PREFIXE} {titre}"),
            style: r["primaryStyleId"].as_u64().unwrap_or(0) as u32,
            sous_style: r["subStyleId"].as_u64().unwrap_or(0) as u32,
            perks: ids(&r["selectedPerkIds"]),
        };
        import::importer_runes(&lcu, &page).await.map_err(|e| format!("Runes : {e}"))?;
        faits.push("runes".to_string());
    }
    if parties.iter().any(|p| p == "sorts") {
        if let (Some(s), [a, b]) = (&sel, ids(&build["sorts"]["ids"]).as_slice()) {
            let sorts = import::ordonner_sorts([*a, *b], s.sorts);
            import::importer_sorts(&lcu, sorts).await.map_err(|e| format!("Sorts : {e}"))?;
            faits.push("sorts".to_string());
        }
    }
    if parties.iter().any(|p| p == "items") {
        let mut blocs = vec![
            ("Départ".to_string(), ids(&build["depart"]["ids"])),
            ("Cœur du build".to_string(), ids(&build["coeur"]["ids"])),
        ];
        if let Some(b) = build["bottes"]["id"].as_u64() {
            blocs.push(("Bottes".to_string(), vec![b as u32]));
        }
        blocs.push(("Selon la partie".to_string(), build["situation"].as_array().into_iter().flatten().filter_map(|s| s["id"].as_u64()).map(|x| x as u32).collect()));
        let carte = if matches!(build["queue"].as_u64(), Some(450) | Some(2400)) { 12 } else { 11 };
        import::importer_items(&lcu, import::set_items(champion, &titre, carte, &blocs)).await.map_err(|e| format!("Items : {e}"))?;
        faits.push("items".to_string());
    }
    Ok(faits)
}

#[tauri::command]
async fn synchroniser(app: AppHandle, etat: State<'_, Etat>) -> Result<Value, String> {
    let v = etat.appel("POST", "/sync", Some(json!({}))).await?;
    let _ = app.emit("historique", &v);
    Ok(v)
}

/// Nouveau compte dans le client : on le relie et on récupère son historique.
async fn compte_detecte(app: AppHandle) {
    let etat = app.state::<Etat>();
    if let Some((puuid, _)) = etat.compte_courant() {
        let mut j = etat.jetons.lock().unwrap();
        j.dernier = Some(puuid);
        j.sauver(&etat.chemin_jetons);
    }
    match etat.appel("POST", "/sync", Some(json!({}))).await {
        Ok(v) => {
            let _ = app.emit("historique", &v);
        }
        Err(e) => {
            let _ = app.emit("erreur-serveur", &e);
        }
    }
}

/// Fin de partie : on envoie la variation de PL, puis on va chercher la partie.
/// Riot la publie avec un peu de retard, d'où deux tentatives espacées.
async fn partie_terminee(app: AppHandle, fin: FinDePartie) {
    let etat = app.state::<Etat>();
    if let (Some(delta), Some(file)) = (fin.variation, fin.file.as_deref()) {
        if file.starts_with("RANKED_") {
            let r = fin.rang_apres.as_ref();
            let corps = json!({
                "matchId": fin.match_id, "queue": file, "delta": delta,
                "lpAfter": r.map(|r| r.lp), "tierAfter": r.map(|r| r.tier.clone()),
                "divisionAfter": r.and_then(|r| r.division.clone()),
            });
            let _ = etat.appel("POST", "/lp", Some(corps)).await;
        }
    }
    let _ = app.emit("fin-de-partie", &fin);
    for attente in [30, 90] {
        tokio::time::sleep(Duration::from_secs(attente)).await;
        if let Ok(v) = etat.appel("POST", "/sync", Some(json!({}))).await {
            let ajoutees = v["added"].as_u64().unwrap_or(0);
            let _ = app.emit("historique", &v);
            if ajoutees > 0 {
                break;
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let chemin_jetons = app.path().app_data_dir()?.join("comptes.json");
            app.manage(Etat {
                client: Mutex::new(EtatClient::default()),
                jetons: Mutex::new(Jetons::charger(&chemin_jetons)),
                chemin_jetons,
                serveur: Serveur::new(),
            });

            let (tx, mut rx) = mpsc::channel::<Evenement>(32);
            tauri::async_runtime::spawn(lcu::superviser(tx));

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                while let Some(ev) = rx.recv().await {
                    match ev {
                        Evenement::Etat(e) => {
                            let nouveau_compte = {
                                let etat = handle.state::<Etat>();
                                let mut client = etat.client.lock().unwrap();
                                let avant = client.compte.as_ref().map(|c| c.puuid.clone());
                                let apres = e.compte.as_ref().map(|c| c.puuid.clone());
                                *client = e.clone();
                                apres.is_some() && apres != avant
                            };
                            let _ = handle.emit("client", &e);
                            if nouveau_compte {
                                tauri::async_runtime::spawn(compte_detecte(handle.clone()));
                            }
                        }
                        Evenement::FinDePartie(fin) => {
                            tauri::async_runtime::spawn(partie_terminee(handle.clone(), fin));
                        }
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![etat_client, profil, parties, synchroniser, build_champion, suggestions, importer])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de l'application");
}
