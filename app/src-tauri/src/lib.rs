//! La coque Tauri : relie le suivi du client League (crate `lcu`), le serveur
//! On lance ? et l'interface.

mod overlay;
mod serveur;

use lcu::{Etape, EtatClient, Evenement, FinDePartie};
use serde_json::{json, Value};
use serveur::{Jetons, Serveur};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindowBuilder};
use tokio::sync::mpsc;

struct Etat {
    client: Mutex<EtatClient>,
    jetons: Mutex<Jetons>,
    chemin_jetons: PathBuf,
    serveur: Serveur,
    /// Un seul enregistrement à la fois : au démarrage, profil, historique et
    /// synchro demandent un jeton en même temps.
    inscription: tokio::sync::Mutex<()>,
    /// Parties ARAM Mayhem déjà partagées pendant cette session.
    mayhem: Mutex<HashSet<u64>>,
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
        // Les demandes suivantes attendent ici, puis trouvent le jeton créé
        // par la première au lieu d'enregistrer un appareil de plus.
        let _verrou = self.inscription.lock().await;
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
            "DELETE" => self.serveur.delete(&jeton, chemin).await,
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

/// Catalogue des augments (nom, rareté, icône) pour la Draft et l'overlay.
#[tauri::command]
async fn augments(etat: State<'_, Etat>) -> Result<Value, String> {
    etat.serveur.stats_get("/augments").await
}

/// Counters d'un champion à un poste : sur le patch en cours ou les 3 derniers.
#[tauri::command]
async fn counters(etat: State<'_, Etat>, champion: u32, role: Option<String>, patchs: Option<u32>) -> Result<Value, String> {
    let mut chemin = format!("/counters/{champion}?patchs={}", if patchs == Some(3) { 3 } else { 1 });
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

/// Écran de chargement : la partie en cours et ses 10 joueurs. L'interface
/// rappelle cette commande tant que l'analyse n'est pas complète.
#[tauri::command]
async fn partie_en_cours(etat: State<'_, Etat>) -> Result<Value, String> {
    let partie = etat.client.lock().unwrap().partie;
    let chemin = match partie {
        Some(id) => format!("/live?gameId={id}"),
        None => "/live".to_string(),
    };
    etat.appel("GET", &chemin, None).await
}

/// Horloge de la partie en cours, lue dans le jeu (secondes).
#[tauri::command]
async fn temps_de_jeu() -> Option<f64> {
    lcu::client::temps_de_jeu().await
}

/// Coach : le focus du moment, sur les dernières parties à ton poste.
#[tauri::command]
async fn coach(etat: State<'_, Etat>) -> Result<Value, String> {
    etat.appel("GET", "/coach", None).await
}

/// Debrief d'après-partie (brique 7), calculé par le serveur.
#[tauri::command]
async fn debrief(etat: State<'_, Etat>, match_id: String) -> Result<Value, String> {
    if match_id.is_empty() || !match_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return Err("Partie invalide.".into());
    }
    etat.appel("GET", &format!("/debrief/{match_id}"), None).await
}

/// Profil de la personne (brique 8) : relie le compte ouvert au profil de
/// cette installation, et le renomme si `pseudo` est donné.
#[tauri::command]
async fn identite(etat: State<'_, Etat>, pseudo: Option<String>) -> Result<Value, String> {
    let installation = {
        let mut j = etat.jetons.lock().unwrap();
        if j.installation.is_none() {
            j.installation = Some(serveur::identifiant_aleatoire());
            j.sauver(&etat.chemin_jetons);
        }
        j.installation.clone()
    };
    etat.appel("POST", "/identite", Some(json!({ "installation": installation, "pseudo": pseudo }))).await
}

/// Groupes et fil des potes : l'interface appelle ces routes-là, et seulement elles.
#[tauri::command]
async fn potes(etat: State<'_, Etat>, methode: String, chemin: String, corps: Option<Value>) -> Result<Value, String> {
    let permis = ["/groupes", "/fil"].iter().any(|p| chemin == *p || chemin.starts_with(&format!("{p}/")) || chemin.starts_with(&format!("{p}?")));
    if !permis || chemin.contains("..") {
        return Err("Route non permise.".into());
    }
    match methode.as_str() {
        "GET" => etat.appel("GET", &chemin, None).await,
        "POST" => etat.appel("POST", &chemin, Some(corps.unwrap_or(json!({})))).await,
        "DELETE" => etat.appel("DELETE", &chemin, None).await,
        _ => Err("Méthode non permise.".into()),
    }
}

/// Mise à jour disponible ? `null` si l'app est à jour. Les mises à jour
/// sont signées : l'app refuse tout paquet qui n'est pas signé par notre clé.
#[tauri::command]
async fn verifier_maj(app: AppHandle) -> Result<Value, String> {
    use tauri_plugin_updater::UpdaterExt;
    let maj = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    Ok(json!({
        "actuelle": app.package_info().version.to_string(),
        "disponible": maj.map(|m| json!({ "version": m.version, "notes": m.body, "date": m.date.map(|d| d.to_string()) })),
    }))
}

/// Télécharge et installe la mise à jour, puis relance l'app. Jamais pendant
/// une partie. La progression part en événements `maj-progression`.
#[tauri::command]
async fn installer_maj(app: AppHandle, etat: State<'_, Etat>) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    if etat.client.lock().unwrap().etape.en_partie() {
        return Err("Pas pendant une partie : la mise à jour attendra la fin.".into());
    }
    let maj = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or("Tu as déjà la dernière version.")?;
    let (a, b) = (app.clone(), app.clone());
    let mut recu: u64 = 0;
    maj.download_and_install(
        move |morceau, total| {
            recu += morceau as u64;
            let _ = a.emit("maj-progression", json!({ "recu": recu, "total": total }));
        },
        move || {
            let _ = b.emit("maj-installation", ());
        },
    )
    .await
    .map_err(|e| format!("Mise à jour interrompue : {e}"))?;
    app.restart();
}

/// L'overlay demande ses réglages, ton pick et le catalogue des objets.
#[tauri::command]
async fn etat_overlay(app: AppHandle) -> Value {
    overlay::etat_initial(&app).await
}

/// Rouvre la fenêtre principale (fermée pendant la partie pour la RAM), ou la
/// ramène devant si elle existe.
fn ouvrir_principale(app: &AppHandle, focus: bool) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        if focus {
            let _ = w.set_focus();
        }
        return;
    }
    let Some(cfg) = app.config().app.windows.iter().find(|w| w.label == "main").cloned() else { return };
    if let Ok(b) = WebviewWindowBuilder::from_config(app, &cfg) {
        let _ = b.focused(focus).build();
    }
}

fn rouvrir(app: &AppHandle) {
    let h = app.clone();
    tauri::async_runtime::spawn(async move { ouvrir_principale(&h, true) });
}

/// La partie est jouable : l'overlay s'ouvre et la fenêtre principale se
/// ferme. Elle revient à la fin. Rien ne change si le jeu est en plein écran
/// exclusif (l'overlay y serait invisible).
fn suivre_partie(app: &AppHandle, etape: Etape) {
    if overlay::essai() {
        return;
    }
    // Jeu en plein écran exclusif : prévenu une fois par partie, pas à chaque
    // changement d'état du client.
    static PREVENU: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    let en_jeu = etape == Etape::EnJeu;
    if !en_jeu {
        PREVENU.store(false, std::sync::atomic::Ordering::Relaxed);
    }
    if en_jeu && !overlay::ouverte(app) {
        if lcu::jeu::mode_fenetre() == Some(0) {
            if !PREVENU.swap(true, std::sync::atomic::Ordering::Relaxed) {
                let _ = app.emit("overlay-impossible", "plein-ecran");
            }
            return;
        }
        if overlay::ouvrir(app).is_ok() {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.destroy();
            }
        }
    } else if !en_jeu && overlay::ouverte(app) {
        // D'abord la fenêtre principale, ensuite seulement l'overlay : il
        // reste toujours une fenêtre ouverte, sinon l'app se fermerait.
        ouvrir_principale(app, false);
        overlay::fermer(app);
    }
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
    partager_mayhem(&app).await;
}

/// Tes parties ARAM Mayhem, lues dans le client, partagées sans pseudo pour
/// la tier list des augments : Riot ne publie pas ces parties dans son API.
async fn partager_mayhem(app: &AppHandle) {
    let etat = app.state::<Etat>();
    let Ok(lcu) = lcu_courant() else { return };
    let deja = etat.mayhem.lock().unwrap().clone();
    let parties = lcu::mayhem::recentes(&lcu, &deja).await;
    if parties.is_empty() {
        return;
    }
    let corps = json!({ "parties": parties.iter().map(|(_, p)| p).collect::<Vec<_>>() });
    if etat.appel("POST", "/mayhem", Some(corps)).await.is_ok() {
        etat.mayhem.lock().unwrap().extend(parties.iter().map(|(id, _)| *id));
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
    // Une partie Mayhem n'arrivera jamais par Riot : on la lit dans le client
    // dès qu'il l'a rangée dans l'historique.
    let h = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(20)).await;
        partager_mayhem(&h).await;
    });
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
    // Si l'app venait à ne plus répondre, Windows remplacerait l'overlay (posé
    // sur tout l'écran, au-dessus du jeu) par une image figée qui bloque le jeu.
    // Sans ce « fantôme », une fenêtre bloquée reste transparente et traversable.
    #[cfg(windows)]
    // SAFETY: aucun argument, à appeler avant toute fenêtre.
    unsafe {
        windows_sys::Win32::UI::WindowsAndMessaging::DisableProcessWindowsGhosting();
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, raccourci, evenement| overlay::sur_raccourci(app, raccourci, evenement.state()))
                .build(),
        )
        .setup(|app| {
            app.manage(overlay::EtatOverlay::default());
            // Développement : ONLANCE_OVERLAY=1 ouvre l'overlay sans partie
            // (avec une fausse API de jeu sur le port 2999).
            if overlay::essai() {
                let h = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(Duration::from_millis(1500)).await;
                    if overlay::ouvrir(&h).is_ok() {
                        if let Some(w) = h.get_webview_window("main") {
                            let _ = w.destroy();
                        }
                    }
                });
            }

            // Icône près de l'horloge : le seul accès à l'app pendant une
            // partie, quand sa fenêtre est fermée.
            let ouvrir = MenuItem::with_id(app, "ouvrir", "Ouvrir On lance ?", true, None::<&str>)?;
            let quitter = MenuItem::with_id(app, "quitter", "Quitter", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&ouvrir, &quitter])?;
            let mut icone = TrayIconBuilder::with_id("principal")
                .tooltip("On lance ?")
                .menu(&menu)
                .show_menu_on_left_click(false)
                // Ces gestionnaires tournent sur le fil principal : y créer une
                // fenêtre bloque l'app (WebView2). On la crée depuis un fil de fond.
                .on_menu_event(|app, e| match e.id.as_ref() {
                    "ouvrir" => rouvrir(app),
                    "quitter" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, e| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                        rouvrir(tray.app_handle());
                    }
                });
            if let Some(i) = app.default_window_icon() {
                icone = icone.icon(i.clone());
            }
            icone.build(app)?;

            let chemin_jetons = app.path().app_data_dir()?.join("comptes.json");
            app.manage(Etat {
                client: Mutex::new(EtatClient::default()),
                jetons: Mutex::new(Jetons::charger(&chemin_jetons)),
                chemin_jetons,
                serveur: Serveur::new(),
                inscription: tokio::sync::Mutex::new(()),
                mayhem: Mutex::new(HashSet::new()),
            });

            let (tx, mut rx) = mpsc::channel::<Evenement>(32);
            tauri::async_runtime::spawn(lcu::superviser(tx));

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                while let Some(ev) = rx.recv().await {
                    match ev {
                        Evenement::Etat(e) => {
                            // Ton pick, gardé pour l'overlay (la sélection disparaît au chargement).
                            if let Some(s) = &e.selection {
                                if let Some(c) = s.mon_champion {
                                    let pick = json!({ "championId": c, "poste": s.mon_poste, "file": s.file });
                                    *handle.state::<overlay::EtatOverlay>().pick.lock().unwrap() = Some(pick);
                                }
                            }
                            suivre_partie(&handle, e.etape);
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
        .invoke_handler(tauri::generate_handler![etat_client, profil, parties, synchroniser, build_champion, suggestions, importer, partie_en_cours, etat_overlay, debrief, identite, potes, temps_de_jeu, counters, augments, verifier_maj, installer_maj, coach])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de l'application");
}
