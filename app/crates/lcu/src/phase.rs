//! Les phases du client, ramenées aux six étapes que l'app montre.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Etape {
    /// Client LoL fermé.
    Hors,
    Menus,
    File,
    Selection,
    /// La partie charge : le jeu est lancé mais pas encore jouable.
    Chargement,
    EnJeu,
    Fin,
}

/// `phase` : la valeur brute de `/lol-gameflow/v1/gameflow-phase`.
/// `jeu_charge` : l'API de partie en direct répond (le jeu est jouable).
pub fn etape(phase: &str, jeu_charge: bool) -> Etape {
    match phase {
        "Matchmaking" | "ReadyCheck" | "CheckedIntoTournament" => Etape::File,
        "ChampSelect" => Etape::Selection,
        "GameStart" | "InProgress" | "Reconnect" => {
            if jeu_charge {
                Etape::EnJeu
            } else {
                Etape::Chargement
            }
        }
        "WaitingForStats" | "PreEndOfGame" | "EndOfGame" => Etape::Fin,
        // None, Lobby, et les échecs (FailedToLaunch, TerminatedInError…).
        _ => Etape::Menus,
    }
}

impl Etape {
    /// Une partie est en cours (du chargement jusqu'à l'écran de fin exclu).
    pub fn en_partie(self) -> bool {
        matches!(self, Etape::Chargement | Etape::EnJeu)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn toutes_les_phases_connues() {
        assert_eq!(etape("None", false), Etape::Menus);
        assert_eq!(etape("Lobby", false), Etape::Menus);
        assert_eq!(etape("Matchmaking", false), Etape::File);
        assert_eq!(etape("ReadyCheck", false), Etape::File);
        assert_eq!(etape("ChampSelect", false), Etape::Selection);
        assert_eq!(etape("GameStart", false), Etape::Chargement);
        assert_eq!(etape("InProgress", false), Etape::Chargement);
        assert_eq!(etape("InProgress", true), Etape::EnJeu);
        assert_eq!(etape("Reconnect", true), Etape::EnJeu);
        assert_eq!(etape("WaitingForStats", false), Etape::Fin);
        assert_eq!(etape("EndOfGame", false), Etape::Fin);
    }

    #[test]
    fn une_phase_inconnue_ne_casse_rien() {
        assert_eq!(etape("PhaseAjouteeParRiotEn2027", false), Etape::Menus);
    }
}
