// Le catalogue des augments (nom, rareté, icône), chargé une fois par
// fenêtre et partagé par la Draft et l'overlay.

import * as api from './api.js';

const etat = $state({ catalogue: null });
let enVol = null;

export function chargerAugments() {
  enVol ??= api.augments()
    .then((c) => (etat.catalogue = c))
    .catch(() => (enVol = null));
  return enVol;
}

export const augs = {
  get pret() { return etat.catalogue != null; },
  /** { n: nom, r: 'argent' | 'or' | 'prisme', i: icône } */
  info: (id) => etat.catalogue?.[id] ?? null,
};
