// Le coach, partagé par l'Accueil, l'Après-partie et l'écran de chargement :
// chargé une fois, rechargé quand de nouvelles parties arrivent.

import * as api from './api.js';

const etat = $state({ donnees: null, chargement: false, erreur: null });
export const coach = {
  get donnees() { return etat.donnees; },
  get chargement() { return etat.chargement; },
  get erreur() { return etat.erreur; },
};

let enVol = null;
export function chargerCoach() {
  enVol ??= (async () => {
    etat.chargement = true;
    try {
      etat.donnees = await api.coach();
      etat.erreur = null;
    } catch (e) {
      etat.erreur = String(e);
    } finally {
      etat.chargement = false;
      enVol = null;
    }
  })();
  return enVol;
}

// Les tournures partagées : le poste en minuscules dans une phrase, le groupe
// de comparaison, l'objectif avec son sens.
const POSTES = { TOP: 'top', JUNGLE: 'jungle', MIDDLE: 'mid', BOTTOM: 'ADC', UTILITY: 'support' };
export const posteTexte = (role) => POSTES[role] ?? '';
export function groupeTexte(c) {
  if (!c?.groupe) return '';
  const joueurs = `joueurs ${posteTexte(c.role)}`;
  return c.groupe.palier === 'TOUS' ? `${joueurs} de tous rangs` : `${joueurs} en ${c.groupe.nom}`;
}
export const objectifTexte = (f) => `${f.sens === 'haut' ? 'Au moins' : 'Au plus'} ${f.objectif}`;
