// Suivi de la partie en cours (brique 5). Tant qu'une partie charge ou se
// joue, on demande au serveur où en est l'analyse des 10 joueurs, toutes les
// 1,5 s, jusqu'à ce qu'elle soit complète. La dernière partie reste affichée
// après la fin, jusqu'à la suivante.

import * as api from './api.js';

const etat = $state({ donnees: null, cherche: false, erreur: null, horsApi: false });

// Files que Riot ne publie pas dans son API (ARAM Mayhem) : rien à demander au serveur.
const HORS_API = new Set([2400]);

export const partie = {
  get donnees() { return etat.donnees; },
  // En partie, mais le serveur ne la voit pas encore (Riot met parfois
  // quelques secondes à la publier).
  get cherche() { return etat.cherche; },
  get erreur() { return etat.erreur; },
  // Partie d'un mode que Riot ne publie pas : pas d'analyse des 10 joueurs.
  get horsApi() { return etat.horsApi; },
};

let cle = null;
let generation = 0;
let minuterie = null;

async function boucle(g) {
  try {
    const v = await api.partieEnCours();
    if (g !== generation) return;
    etat.erreur = null;
    if (v?.enCours) {
      etat.donnees = v;
      etat.cherche = false;
      if (v.complet) return;
    } else {
      etat.cherche = true;
    }
    minuterie = setTimeout(() => boucle(g), v?.enCours ? 1500 : 3000);
  } catch (e) {
    if (g !== generation) return;
    etat.erreur = String(e);
    minuterie = setTimeout(() => boucle(g), 5000);
  }
}

export function suivre(etape, gameId, file = null) {
  const enPartie = etape === 'chargement' || etape === 'en_jeu';
  etat.horsApi = enPartie && HORS_API.has(file);
  if (!enPartie || etat.horsApi) {
    etat.cherche = false;
    if (cle !== null) {
      cle = null;
      generation++;
      clearTimeout(minuterie);
    }
    return;
  }
  const k = String(gameId ?? 'inconnue');
  if (k === cle) return;
  cle = k;
  // Nouvelle partie : l'ancienne s'efface.
  if (gameId && etat.donnees && etat.donnees.gameId !== gameId) etat.donnees = null;
  generation++;
  clearTimeout(minuterie);
  boucle(generation);
}
