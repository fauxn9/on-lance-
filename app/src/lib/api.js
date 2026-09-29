// Pont vers le Rust. Hors de Tauri (aperçu dans un navigateur), l'app tourne
// en mode démo avec des données inventées : pratique pour travailler
// l'interface sans lancer League.

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import * as demo from './demo.js';

export const enTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const etatClient = () => (enTauri ? invoke('etat_client') : demo.etatClient());
export const profil = () => (enTauri ? invoke('profil') : demo.profil());
export const parties = (avant, file) => (enTauri ? invoke('parties', { avant, file }) : demo.parties(avant, file));
export const synchroniser = () => (enTauri ? invoke('synchroniser') : demo.synchroniser());
export const buildChampion = (champion, role, file) =>
  enTauri ? invoke('build_champion', { champion, role, file }) : demo.buildChampion(champion, role, file);
export const suggestions = () => (enTauri ? invoke('suggestions') : demo.suggestions());
export const partieEnCours = () => (enTauri ? invoke('partie_en_cours') : demo.partieEnCours());
export const tempsDeJeu = () => (enTauri ? invoke('temps_de_jeu') : Promise.resolve(754));
export const debrief = (matchId) => (enTauri ? invoke('debrief', { matchId }) : demo.debrief(matchId));
export const identite = (pseudo = null) => (enTauri ? invoke('identite', { pseudo }) : demo.identite(pseudo));
export const potes = (methode, chemin, corps = null) => (enTauri ? invoke('potes', { methode, chemin, corps }) : demo.potes(methode, chemin, corps));
export const etatOverlay = () => (enTauri ? invoke('etat_overlay') : demo.etatOverlay());
export const importer = (build, titre, parties) =>
  enTauri ? invoke('importer', { build, titre, parties }) : demo.importer(parties);

export function ecouter(nom, fn) {
  if (!enTauri) return demo.ecouter(nom, fn);
  const p = listen(nom, (e) => fn(e.payload));
  return () => p.then((stop) => stop());
}

export async function fenetre(action) {
  if (!enTauri) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const w = getCurrentWindow();
  if (action === 'reduire') w.minimize();
  else if (action === 'agrandir') w.toggleMaximize();
  else if (action === 'fermer') w.close();
}
