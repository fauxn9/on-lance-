//! La coquille : une fenetre, une icone dans la barre des taches, et une boucle
//! qui bat toutes les deux secondes.
//!
//! Tout ce qui decide vit dans `agent-core` et `presence-core`, testes sans
//! Windows ni Valorant. Ce fichier-ci ne fait que brancher : lire l'agent,
//! envoyer au serveur, prevenir l'interface. Il doit rester assez mince pour
//! qu'on puisse le lire en entier avant de croire qu'il marche.
//!
//! UN CHOIX DE STRUCTURE QUI MERITE UN MOT
//!
//! L'`Agent` n'est PAS partagé. Il appartient a la tache de fond, et rien
//! d'autre ne le touche ; ce que l'interface consulte est un instantane
//! (`Partagee`) que cette tache met a jour a chaque battement. La raison est
//! bete mais couteuse a decouvrir tard : `Agent::battre` est asynchrone, et un
//! Mutex ordinaire tenu a travers un `await` bloquerait toute l'interface
//! pendant cinq secondes le jour ou le client Riot cesse de repondre.

mod config;

use agent_core::serveur::{ClientServeur, ErreurServeur};
use agent_core::{Agent, EtatAffiche};
use config::Config;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, State};

/// Deux secondes : assez fin pour ne rater aucune transition, assez large pour
/// que la charge reste invisible — c'est un appel sur la boucle locale, pas un
/// appel reseau.
const PERIODE: Duration = Duration::from_secs(2);

/// Ce que la tache de fond publie pour l'interface.
#[derive(Debug, Clone, Default)]
struct Partagee {
    etat: Option<EtatAffiche>,
    /// Le puuid lu en local. Sert a l'appairage : c'est la preuve que ce PC est
    /// bien connecte avec le compte Valorant declare sur le site.
    puuid: Option<String>,
}

pub struct Etat {
    partagee: Mutex<Partagee>,
    config: Mutex<Config>,
    chemin_config: PathBuf,
    serveur: ClientServeur,
}

/// Ce que l'interface affiche. Un seul objet, renvoye a chaque battement :
/// l'interface n'a aucun etat a elle, donc rien a resynchroniser.
#[derive(Debug, Clone, Serialize)]
pub struct Vue {
    pub appairee: bool,
    pub utilisateur: Option<String>,
    pub riot_id: Option<String>,
    pub site: String,
    pub version: String,
    /// `None` tant que le premier battement n'a pas eu lieu.
    pub etat: Option<EtatAffiche>,
}

fn vue(etat: &Etat) -> Vue {
    let c = etat.config.lock().unwrap();
    Vue {
        appairee: c.appairee(),
        utilisateur: c.utilisateur.clone(),
        riot_id: c.riot_id.clone(),
        site: config::site(),
        version: agent_core::VERSION.to_string(),
        etat: etat.partagee.lock().unwrap().etat.clone(),
    }
}

#[tauri::command]
fn etat_actuel(etat: State<'_, Etat>) -> Vue {
    vue(&etat)
}

/// Echange le code a six caracteres contre un jeton durable.
///
/// Le puuid local part avec la demande quand il est connu. Si le compte ouvert
/// sur ce PC n'est pas celui declare sur le site, le serveur ne rebranche RIEN
/// tout seul : il le dit, et c'est l'utilisateur qui tranche. Rebasculer un
/// compte en silence est exactement le bug qu'a corrige la brique 4.
#[tauri::command]
async fn appairer(code: String, etat: State<'_, Etat>) -> Result<String, String> {
    let code = code.trim().to_string();
    if code.is_empty() {
        return Err("Entre le code affiché sur ton tableau de bord.".into());
    }

    let puuid = etat.partagee.lock().unwrap().puuid.clone();
    let nom = config::nom_machine();

    let reponse = etat
        .serveur
        .appairer(&code, puuid.as_deref(), &nom)
        .await
        .map_err(|e| match e {
            // Le message du serveur est ecrit en francais et pour un humain :
            // on le montre tel quel plutot que d'en fabriquer un autre.
            ErreurServeur::Refus { message, .. } => message,
            ErreurServeur::Reseau(_) => {
                "Impossible de joindre onlance.xyz. Vérifie ta connexion.".to_string()
            }
        })?;

    let message = reponse.message.clone();
    let mut c = etat.config.lock().unwrap();
    c.jeton = Some(reponse.jeton);
    c.utilisateur = reponse.utilisateur.display_name;
    c.riot_id = reponse.utilisateur.riot_id;
    c.nom_appareil = Some(nom);

    if let Err(err) = c.enregistrer(&etat.chemin_config) {
        // L'appairage tient pour cette session, mais il faudra recommencer au
        // prochain lancement — et l'utilisateur doit l'apprendre maintenant,
        // pas demain.
        return Ok(format!(
            "{message}\n\nAttention : la configuration n'a pas pu être enregistrée ({err}). \
             Il faudra refaire l'appairage au prochain lancement."
        ));
    }
    Ok(message)
}

/// Oublie ce PC, localement.
///
/// Le jeton reste valable cote serveur : c'est depuis le tableau de bord qu'on
/// revoque un appareil. C'est volontaire — un PC volé ne doit pas pouvoir
/// effacer ses propres traces.
#[tauri::command]
fn oublier(etat: State<'_, Etat>) -> Result<(), String> {
    let mut c = etat.config.lock().unwrap();
    *c = Config::default();
    c.enregistrer(&etat.chemin_config)
        .map_err(|e| e.to_string())
}

/// La boucle de fond. Elle possede l'agent et ne le prete a personne.
///
/// Elle n'echoue jamais et ne s'arrete jamais : un serveur injoignable, un
/// client Riot ferme, une route qui change — tout ca est normal pour une
/// application qui tourne en fond toute la journee.
async fn boucle(app: AppHandle) {
    let mut agent = Agent::nouveau(agent_core::riot::chemin_lockfile());

    loop {
        let maintenant = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);

        let evenements = agent.battre(maintenant).await;

        let etat = app.state::<Etat>();
        {
            let mut p = etat.partagee.lock().unwrap();
            p.etat = Some(agent.etat().clone());
            p.puuid = agent.puuid().map(str::to_string);
        }

        let v = vue(&etat);
        let etat_partie = v.etat.as_ref().and_then(|e| e.etat);
        let _ = app.emit("etat", &v);

        if !evenements.is_empty() {
            for e in &evenements {
                println!("[onlance] {e:?}");
            }
            let _ = app.emit("evenements", &evenements);
        }

        // Rien a transmettre tant que le PC n'est pas appairé.
        let jeton = etat.config.lock().unwrap().jeton.clone();
        if let Some(jeton) = jeton {
            if let Err(err) = etat.serveur.battement(&jeton, etat_partie, &evenements).await {
                // Pas de fenetre d'erreur : on retente dans deux secondes.
                eprintln!("[onlance] battement non transmis : {err}");
            }
        }

        tokio::time::sleep(PERIODE).await;
    }
}

/// Icone dans la barre des taches.
///
/// L'application est faite pour etre oubliee : on la lance une fois, elle
/// tourne. Fermer la fenetre la CACHE au lieu de quitter — sinon la premiere
/// croix cliquee arrete la detection de fin de partie sans que personne ne
/// comprenne pourquoi les notifications se sont taries.
fn installer_barre_des_taches(app: &AppHandle) -> tauri::Result<()> {
    let ouvrir = MenuItem::with_id(app, "ouvrir", "Ouvrir", true, None::<&str>)?;
    let quitter = MenuItem::with_id(app, "quitter", "Quitter", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&ouvrir, &quitter])?;

    TrayIconBuilder::with_id("principale")
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("On lance ?")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, ev| match ev.id().as_ref() {
            "ouvrir" => montrer(app),
            "quitter" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

fn montrer(app: &AppHandle) {
    if let Some(f) = app.get_webview_window("main") {
        let _ = f.show();
        let _ = f.unminimize();
        let _ = f.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![etat_actuel, appairer, oublier])
        .setup(|app| {
            let base = app.path().app_config_dir()?;
            let chemin_config = config::chemin_config(base);

            app.manage(Etat {
                partagee: Mutex::new(Partagee::default()),
                config: Mutex::new(Config::charger(&chemin_config)),
                chemin_config,
                serveur: ClientServeur::nouveau(config::site(), agent_core::VERSION),
            });

            installer_barre_des_taches(app.handle())?;

            let poignee = app.handle().clone();
            tauri::async_runtime::spawn(boucle(poignee));
            Ok(())
        })
        .on_window_event(|fenetre, evenement| {
            // Fermer, c'est cacher. Quitter se fait par la barre des taches.
            if let tauri::WindowEvent::CloseRequested { api, .. } = evenement {
                api.prevent_close();
                let _ = fenetre.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("le lancement de l'application a échoué");
}
