/**
 * Echelle de rang Valorant.
 *
 * Riot numerote les rangs lui-meme, et l'API HenrikDev nous rend cet entier
 * dans `player.tier.id`. On n'invente donc aucune echelle : elle est verifiee
 * sur des vraies parties (12 = Gold 1 ... 19 = Diamond 2, ids contigus).
 *
 * Cet entier sert a une seule chose : constituer le groupe de comparaison. Un
 * Platine ne doit pas etre juge a l'aune d'un Fer, et surtout pas a l'aune d'un
 * seuil que j'aurais decide au doigt mouille.
 */

const PALIERS = [
  'Fer', 'Bronze', 'Argent', 'Or', 'Platine',
  'Diamant', 'Ascendant', 'Immortel', 'Radiant',
];

/** Premier id de chaque palier : Fer 1 = 3, puis 3 divisions par palier. */
const PREMIER_ID = 3;

/** 0 = non classe. Renvoie null si l'id ne correspond a rien de connu. */
export function nomDuRang(tierId) {
  if (!Number.isInteger(tierId) || tierId <= 0) return null;
  if (tierId >= 27) return 'Radiant';

  const i = tierId - PREMIER_ID;
  if (i < 0) return null;

  const palier = PALIERS[Math.floor(i / 3)];
  return palier ? `${palier} ${(i % 3) + 1}` : null;
}

/** Palier seul ("Platine"), sans la division. */
export function palierDuRang(tierId) {
  const nom = nomDuRang(tierId);
  return nom ? nom.replace(/ \d$/, '') : null;
}

/** Ecart en divisions entre deux rangs. */
export const ecartDeRang = (a, b) => Math.abs(a - b);

/** Un joueur non classe n'entre dans aucun groupe de comparaison. */
export const estClasse = (tierId) => Number.isInteger(tierId) && tierId > 0;
