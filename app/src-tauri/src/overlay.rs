//! Brique 6 : l'overlay en jeu.
//!
//! UNE fenêtre transparente posée exactement sur celle du jeu. Elle laisse
//! passer les clics et ne prend jamais le focus : le jeu garde la souris et le
//! clavier. Elle ne s'affiche que quand le jeu est au premier plan (un Alt+Tab
//! vers le bureau la fait disparaître). Pendant la partie, la fenêtre
//! principale est fermée : chaque WebView ouverte coûte des dizaines de Mo.
//!
//! Il faut le jeu en « Fenêtré sans bordure » : par-dessus un plein écran
//! exclusif, rien ne peut s'afficher sans injection dans le jeu, et on
//! n'injecte rien.

use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

pub const LABEL: &str = "overlay";

/// Mode d'essai pour le développement (variable ONLANCE_OVERLAY) : l'overlay
/// s'ouvre sans partie et reste visible même sans la fenêtre du jeu.
pub fn essai() -> bool {
    std::env::var_os("ONLANCE_OVERLAY").is_some()
}
/// Doivent être identiques à ceux de la fenêtre principale : toutes les
/// WebView d'une app partagent le même navigateur, lancé avec ces options.
const ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --disable-gpu";

#[derive(Default)]
pub struct EtatOverlay {
    edition: AtomicBool,
    masque: AtomicBool,
    /// Prix total de chaque objet (Data Dragon), pour estimer l'or de chacun.
    prix: Mutex<HashMap<u32, u32>>,
    /// Catalogue compact des objets achetables, pour le prochain achat.
    catalogue: Mutex<Option<Value>>,
    /// Ton pick en sélection des champions (champion, poste, file).
    pub pick: Mutex<Option<Value>>,
    /// Dernier rectangle où l'overlay a été posé : on ne le repose que s'il
    /// change (chaque déplacement fait redessiner toute la page).
    place: Mutex<Option<(i32, i32, i32, i32)>>,
}

// ---------------------------------------------------------------- raccourcis

fn raccourci_masquer() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyH)
}
fn raccourci_edition() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyE)
}

/// Branché sur le plugin de raccourcis globaux. Les raccourcis ne sont
/// enregistrés que pendant une partie : le reste du temps, Ctrl+Maj+H et
/// Ctrl+Maj+E appartiennent aux autres applications.
pub fn sur_raccourci(app: &AppHandle, raccourci: &Shortcut, etat: ShortcutState) {
    if etat != ShortcutState::Pressed {
        return;
    }
    let o = app.state::<EtatOverlay>();
    if *raccourci == raccourci_masquer() {
        let m = !o.masque.load(Ordering::Relaxed);
        o.masque.store(m, Ordering::Relaxed);
        let _ = app.emit_to(LABEL, "overlay-masque", m);
    } else if *raccourci == raccourci_edition() {
        let e = !o.edition.load(Ordering::Relaxed);
        o.edition.store(e, Ordering::Relaxed);
        if let Some(w) = app.get_webview_window(LABEL) {
            // En édition, l'overlay prend la souris (pour déplacer les widgets),
            // toujours sans prendre le focus au jeu.
            #[cfg(windows)]
            {
                let h = hwnd(&w);
                let _ = app.run_on_main_thread(move || win::traversable(h, !e));
            }
            #[cfg(not(windows))]
            let _ = w.set_ignore_cursor_events(!e);
        }
        let _ = app.emit_to(LABEL, "overlay-edition", e);
    }
}

// ---------------------------------------------------------------- Windows

// Position, taille et passage des clics sont réglés directement par Windows,
// pas par tao (la couche fenêtre de Tauri) : à chaque changement, tao réécrit
// tous les styles de la fenêtre et perdrait les nôtres (jamais activée,
// traversée par les clics, hors d'Alt+Tab).
#[cfg(windows)]
mod win {
    use windows_sys::Win32::Foundation::{HWND, RECT};
    // Ces appels partent d'un fil de fond vers une fenêtre du fil principal :
    // toujours en version « postée » (ShowWindowAsync, SWP_ASYNCWINDOWPOS),
    // pour ne jamais attendre le fil principal pendant qu'il attend autre chose.
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        FindWindowW, GetForegroundWindow, GetWindowLongPtrW, GetWindowRect, SetWindowLongPtrW, SetWindowPos, ShowWindowAsync,
        GWL_EXSTYLE, HWND_TOPMOST, SWP_ASYNCWINDOWPOS, SWP_NOACTIVATE, SW_SHOWNOACTIVATE, WS_EX_LAYERED, WS_EX_NOACTIVATE,
        WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT,
    };

    /// La fenêtre du jeu (pas celle du client) et son rectangle en pixels réels.
    pub fn jeu() -> Option<(isize, (i32, i32, i32, i32))> {
        let titre: Vec<u16> = "League of Legends (TM) Client\0".encode_utf16().collect();
        // SAFETY: chaîne UTF-16 terminée par un zéro, vivante pendant l'appel.
        let h = unsafe { FindWindowW(std::ptr::null(), titre.as_ptr()) };
        if h.is_null() {
            return None;
        }
        let mut r = RECT { left: 0, top: 0, right: 0, bottom: 0 };
        // SAFETY: `h` vient de FindWindowW, `r` est un RECT valide.
        if unsafe { GetWindowRect(h, &mut r) } == 0 {
            return None;
        }
        Some((h as isize, (r.left, r.top, r.right - r.left, r.bottom - r.top)))
    }

    pub fn premier_plan() -> isize {
        // SAFETY: aucun argument.
        unsafe { GetForegroundWindow() as isize }
    }

    /// Jamais activée (le jeu garde le focus, même quand on clique dessus en
    /// mode édition), absente d'Alt+Tab, traversée par les clics. Puis
    /// affichée sans activation.
    pub fn preparer(h: isize) {
        let h = h as HWND;
        // SAFETY: `h` est la fenêtre de l'overlay, créée par nous.
        unsafe {
            let ex = GetWindowLongPtrW(h, GWL_EXSTYLE);
            let ajout = WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW | WS_EX_LAYERED | WS_EX_TRANSPARENT;
            SetWindowLongPtrW(h, GWL_EXSTYLE, ex | ajout as isize);
            ShowWindowAsync(h, SW_SHOWNOACTIVATE);
        }
    }

    /// Les clics traversent l'overlay (`true`) ou le touchent (mode édition).
    pub fn traversable(h: isize, oui: bool) {
        let h = h as HWND;
        // SAFETY: `h` est la fenêtre de l'overlay.
        unsafe {
            let ex = GetWindowLongPtrW(h, GWL_EXSTYLE);
            let t = WS_EX_TRANSPARENT as isize;
            SetWindowLongPtrW(h, GWL_EXSTYLE, if oui { ex | t } else { ex & !t });
        }
    }

    /// Place l'overlay au premier plan, sur le rectangle donné, sans l'activer.
    pub fn placer(h: isize, (x, y, l, ht): (i32, i32, i32, i32)) {
        // SAFETY: `h` est la fenêtre de l'overlay.
        unsafe {
            SetWindowPos(h as HWND, HWND_TOPMOST, x, y, l, ht, SWP_NOACTIVATE | SWP_ASYNCWINDOWPOS);
        }
    }
}

fn hwnd(w: &WebviewWindow) -> isize {
    w.hwnd().map(|h| h.0 as isize).unwrap_or(0)
}

/// Pose l'overlay sur la fenêtre du jeu, ou sur l'écran principal à défaut.
fn caler(w: &WebviewWindow) {
    #[cfg(windows)]
    {
        let rect = win::jeu().map(|(_, r)| r).filter(|r| r.2 > 0 && r.3 > 0).or_else(|| {
            let m = w.primary_monitor().ok().flatten()?;
            Some((m.position().x, m.position().y, m.size().width as i32, m.size().height as i32))
        });
        let o = w.app_handle().state::<EtatOverlay>();
        let mut place = o.place.lock().unwrap();
        if let Some(r) = rect.filter(|r| *place != Some(*r)) {
            win::placer(hwnd(w), r);
            *place = Some(r);
        }
    }
    #[cfg(not(windows))]
    if let Ok(Some(m)) = w.primary_monitor() {
        let _ = w.set_position(*m.position());
        let _ = w.set_size(*m.size());
    }
}

// ---------------------------------------------------------------- objets

/// Prix et catalogue des objets du patch en cours, chargés une fois par
/// session depuis Data Dragon.
pub async fn catalogue(app: &AppHandle) -> Option<Value> {
    let o = app.state::<EtatOverlay>();
    if let Some(c) = o.catalogue.lock().unwrap().clone() {
        return Some(c);
    }
    let http = reqwest::Client::builder().timeout(Duration::from_secs(15)).build().ok()?;
    let base = "https://ddragon.leagueoflegends.com";
    let versions: Value = http.get(format!("{base}/api/versions.json")).send().await.ok()?.json().await.ok()?;
    let version = versions[0].as_str()?;
    let items: Value = http.get(format!("{base}/cdn/{version}/data/fr_FR/item.json")).send().await.ok()?.json().await.ok()?;

    let mut prix = HashMap::new();
    let mut compact = Map::new();
    for (id, it) in items["data"].as_object()? {
        let Ok(n) = id.parse::<u32>() else { continue };
        let total = it["gold"]["total"].as_u64().unwrap_or(0) as u32;
        prix.insert(n, total);
        let faille = it["maps"]["11"].as_bool().unwrap_or(false) || it["maps"]["12"].as_bool().unwrap_or(false);
        if it["gold"]["purchasable"].as_bool().unwrap_or(false) && faille && total > 0 {
            compact.insert(id.clone(), json!({ "n": it["name"], "p": total, "t": it["tags"], "d": it["depth"].as_u64().unwrap_or(1) }));
        }
    }
    let c = json!({ "version": version, "items": compact });
    *o.prix.lock().unwrap() = prix;
    *o.catalogue.lock().unwrap() = Some(c.clone());
    Some(c)
}

// ---------------------------------------------------------------- cycle de vie

pub fn ouverte(app: &AppHandle) -> bool {
    app.get_webview_window(LABEL).is_some()
}

/// Ouvre l'overlay (s'il ne l'est pas déjà) et lance sa boucle.
pub fn ouvrir(app: &AppHandle) -> tauri::Result<()> {
    if ouverte(app) {
        return Ok(());
    }
    let o = app.state::<EtatOverlay>();
    o.edition.store(false, Ordering::Relaxed);
    o.masque.store(false, Ordering::Relaxed);
    *o.place.lock().unwrap() = None;

    let w = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into()))
        .title("On lance ? · overlay")
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .focusable(false)
        .visible(false)
        .additional_browser_args(ARGS)
        .build()?;
    caler(&w);
    // Les styles d'une fenêtre se changent depuis son propre fil (le principal) :
    // depuis un autre, Windows attendrait que le principal réponde.
    #[cfg(windows)]
    {
        let h = hwnd(&w);
        let _ = app.run_on_main_thread(move || win::preparer(h));
    }
    #[cfg(not(windows))]
    {
        let _ = w.set_ignore_cursor_events(true);
        let _ = w.show();
    }

    let gs = app.global_shortcut();
    let _ = gs.register(raccourci_masquer());
    let _ = gs.register(raccourci_edition());
    tauri::async_runtime::spawn(boucle(app.clone()));
    Ok(())
}

pub fn fermer(app: &AppHandle) {
    let gs = app.global_shortcut();
    let _ = gs.unregister(raccourci_masquer());
    let _ = gs.unregister(raccourci_edition());
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.destroy();
    }
}

/// Tant que l'overlay est ouvert : toutes les 500 ms, est-ce que le jeu est
/// au premier plan ? Toutes les secondes, l'état de la partie. Toutes les
/// 3 s, la position de la fenêtre du jeu (elle peut changer d'écran).
async fn boucle(app: AppHandle) {
    let _ = catalogue(&app).await;
    let mut visible_avant: Option<bool> = None;
    let mut tour: u32 = 0;
    loop {
        let Some(w) = app.get_webview_window(LABEL) else { break };
        let o = app.state::<EtatOverlay>();

        #[cfg(windows)]
        {
            let devant = win::premier_plan();
            let jeu = win::jeu();
            let visible = essai() || o.edition.load(Ordering::Relaxed) || devant == hwnd(&w) || jeu.is_some_and(|(h, _)| h == devant);
            if visible_avant != Some(visible) {
                visible_avant = Some(visible);
                let _ = app.emit_to(LABEL, "overlay-visible", visible);
            }
            if tour % 6 == 5 {
                caler(&w);
            }
        }

        if tour % 2 == 0 {
            if let Some(v) = lcu::jeu::donnees().await {
                let resume = {
                    let prix = o.prix.lock().unwrap();
                    lcu::jeu::resumer(&v, |id| prix.get(&id).copied().unwrap_or(0))
                };
                if let Some(r) = resume {
                    let _ = app.emit_to(LABEL, "jeu", &r);
                }
            }
        }
        tour = tour.wrapping_add(1);
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
}

/// Ce que l'overlay demande en arrivant : réglages courants, ton pick et le
/// catalogue des objets.
pub async fn etat_initial(app: &AppHandle) -> Value {
    let cat = catalogue(app).await;
    let o = app.state::<EtatOverlay>();
    json!({
        "edition": o.edition.load(Ordering::Relaxed),
        "masque": o.masque.load(Ordering::Relaxed),
        "pick": o.pick.lock().unwrap().clone(),
        "catalogue": cat,
    })
}
