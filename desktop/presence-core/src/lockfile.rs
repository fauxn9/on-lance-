//! Le fichier que le client Riot ecrit lui-meme au demarrage.
//!
//! `%LOCALAPPDATA%\Riot Games\Riot Client\Config\lockfile`, une seule ligne :
//!
//! ```text
//! Riot Client:2224:64019:YG68Ah...EWMg:https
//! nom:pid:port:motdepasse:protocole
//! ```
//!
//! Sa seule presence est deja une information : pas de fichier, pas de client
//! lance. Et il disparait a la fermeture, donc on le relit a chaque fois plutot
//! que de garder le port en memoire — un client redemarre change de port.
//!
//! L'analyse est isolee ici parce qu'elle est pure : c'est la partie qu'on peut
//! tester sans Windows et sans client Riot.

/// Un mot de passe contient parfois des caracteres inattendus ; le port et le
/// pid sont les seuls champs sur lesquels on impose une forme.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Lockfile {
    pub nom: String,
    pub pid: u32,
    pub port: u16,
    pub mot_de_passe: String,
    pub protocole: String,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ErreurLockfile {
    /// Moins de cinq champs : ce n'est pas un lockfile.
    Forme,
    /// Port ou pid illisible.
    Nombre,
    /// Mot de passe vide : inutilisable pour s'authentifier.
    SansMotDePasse,
}

/// Analyse le contenu brut du lockfile.
///
/// On decoupe sur les quatre premiers deux-points seulement : rien ne garantit
/// que le protocole soit le dernier champ pour toujours, et un decoupage
/// complet casserait si Riot en ajoutait un.
pub fn parser(brut: &str) -> Result<Lockfile, ErreurLockfile> {
    let ligne = brut.trim();
    let champs: Vec<&str> = ligne.splitn(5, ':').collect();
    if champs.len() < 5 {
        return Err(ErreurLockfile::Forme);
    }

    let pid = champs[1].parse::<u32>().map_err(|_| ErreurLockfile::Nombre)?;
    let port = champs[2].parse::<u16>().map_err(|_| ErreurLockfile::Nombre)?;
    if champs[3].is_empty() {
        return Err(ErreurLockfile::SansMotDePasse);
    }

    Ok(Lockfile {
        nom: champs[0].to_string(),
        pid,
        port,
        mot_de_passe: champs[3].to_string(),
        // Le protocole peut trainer un retour a la ligne ou un champ ajoute.
        protocole: champs[4]
            .split(':')
            .next()
            .unwrap_or("https")
            .trim()
            .to_string(),
    })
}

impl Lockfile {
    /// En-tete Authorization, deja prete. Le nom d'utilisateur est toujours
    /// `riot` : c'est le client qui l'impose, pas nous.
    pub fn autorisation(&self) -> String {
        use base64::Engine;
        let brut = format!("riot:{}", self.mot_de_passe);
        format!(
            "Basic {}",
            base64::engine::general_purpose::STANDARD.encode(brut)
        )
    }

    pub fn base_url(&self) -> String {
        format!("{}://127.0.0.1:{}", self.protocole, self.port)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Ligne reellement lue sur la machine de test le 5 septembre 2026,
    /// mot de passe remplace.
    const REEL: &str = "Riot Client:2224:64019:YG68AhXXXXXXXXXXXXEWMg:https";

    #[test]
    fn lit_un_vrai_lockfile() {
        let l = parser(REEL).unwrap();
        assert_eq!(l.nom, "Riot Client");
        assert_eq!(l.pid, 2224);
        assert_eq!(l.port, 64019);
        assert_eq!(l.protocole, "https");
        assert_eq!(l.base_url(), "https://127.0.0.1:64019");
    }

    #[test]
    fn tolere_les_retours_a_la_ligne() {
        assert_eq!(parser(&format!("{REEL}\r\n")).unwrap().port, 64019);
    }

    #[test]
    fn un_mot_de_passe_contenant_des_deux_points_reste_entier() {
        // Le decoupage limite a cinq morceaux sert exactement a ca.
        let l = parser("Riot Client:1:2:ab:cd:ef:https").unwrap();
        assert_eq!(l.mot_de_passe, "ab");
        assert_eq!(l.protocole, "cd");
    }

    #[test]
    fn refuse_ce_qui_n_est_pas_un_lockfile() {
        assert_eq!(parser(""), Err(ErreurLockfile::Forme));
        assert_eq!(parser("n'importe quoi"), Err(ErreurLockfile::Forme));
        assert_eq!(parser("a:b:c:d:e"), Err(ErreurLockfile::Nombre));
        assert_eq!(
            parser("Riot Client:1:2::https"),
            Err(ErreurLockfile::SansMotDePasse)
        );
    }

    #[test]
    fn l_autorisation_est_du_basic_riot() {
        let l = parser("Riot Client:1:2:secret:https").unwrap();
        // "riot:secret" en base64.
        assert_eq!(l.autorisation(), "Basic cmlvdDpzZWNyZXQ=");
    }
}
