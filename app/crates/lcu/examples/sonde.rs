//! Sonde : affiche en direct ce que l'app voit du client League.
//!
//!     cargo run -p lcu --example sonde
//!
//! Lance-la, puis ouvre League, entre dans une file, fais une partie : chaque
//! changement d'étape s'affiche avec l'heure.

use lcu::{superviser, Evenement};
use tokio::sync::mpsc;

#[tokio::main]
async fn main() {
    let (tx, mut rx) = mpsc::channel(32);
    tokio::spawn(superviser(tx));
    println!("Sonde lancée. En attente du client League…");
    while let Some(ev) = rx.recv().await {
        let heure = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() % 86400)
            .unwrap_or(0);
        let h = format!("{:02}:{:02}:{:02}", (heure / 3600 + 2) % 24, heure / 60 % 60, heure % 60);
        match ev {
            Evenement::Etat(e) => {
                let compte = e.compte.as_ref().map(|c| format!("{}#{} (niv. {})", c.game_name, c.tag_line, c.niveau)).unwrap_or("—".into());
                let rangs: Vec<String> = e.rangs.iter().map(|r| format!("{} {} {} PL", r.tier, r.division.clone().unwrap_or_default(), r.lp)).collect();
                println!("[{h}] étape {:?} (phase « {} ») · {} · {} · {}", e.etape, e.phase, compte, e.plateforme.unwrap_or("?".into()), rangs.join(", "));
            }
            Evenement::FinDePartie(f) => println!("[{h}] FIN DE PARTIE {} · file {:?} · variation {:?}", f.match_id, f.file, f.variation),
        }
    }
}
