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
        let jeton = self.serveur.enregistrer(puuid, plateforme).await?;
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
        .invoke_handler(tauri::generate_handler![etat_client, profil, parties, synchroniser])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de l'application");
}
