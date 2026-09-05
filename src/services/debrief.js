/**
 * Debrief d'UNE partie.
 *
 * CE QUE C'EST, ET CE QUE CE N'EST PAS
 *
 * Le barème du coach (analysis.js) refuse de conclure sous vingt joueurs
 * comparables, et il a raison : un constat tire de trop peu de monde n'est
 * qu'un hasard mis en forme. Ici on n'a QUE les neuf autres joueurs de la
 * partie. C'est en dessous de ce seuil, et de loin.
 *
 * On ne prétend donc pas au même statut. Le debrief ne dit pas « voilà ton
 * défaut », il dit « voilà ce qui a le moins bien marché CE SOIR, et voilà
 * comment ça se compare a d'habitude ». D'ou trois precautions qui ne sont pas
 * decoratives :
 *
 *   1. La comparaison se fait aux NEUF AUTRES DE CETTE PARTIE. Pas a une
 *      moyenne inventee, pas a un seuil decide a l'avance : aux gens qui
 *      etaient sur le serveur.
 *   2. Chaque constat porte l'habitude du joueur a cote. Encaisser 190 degats
 *      par round ne veut rien dire seul ; en encaisser 190 quand on en prend
 *      165 d'habitude, si.
 *   3. La taille d'echantillon accompagne chaque ligne, et un axe trop maigre
 *      sur cette partie est ecarte plutot qu'affiche avec une reserve que
 *      personne ne lira.
 */

import { AXES, agreger, mediane, position } from './analysis.js';

/**
 * Sous ces seuils, l'axe ne dit rien sur une seule partie.
 *
 * Ils sont bien plus bas que ceux du barème sur 14 jours — c'est le prix a
 * payer pour parler d'une partie — mais pas nuls : trois morts mesurables, ce
 * n'est pas un pattern, c'est le minimum pour que le pourcentage ne saute pas
 * de 0 a 100 sur un seul evenement.
 */
const PLANCHERS = {
  isolement: 3, trade: 3, entree: 3, apres_plant: 3,
  ouverture: 8, degats_recus: 8, degats_infliges: 8,
  precision: 25,
};

const arrondi = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);

/**
 * Construit le debrief d'une partie.
 *
 * @param mesures  lignes match_players de CETTE partie (les dix joueurs)
 * @param puuid    le joueur suivi
 * @param habitude son agregat sur la periode, ou null s'il n'y en a pas encore
 * @param max      nombre de constats a garder
 */
export function construireDebrief({ mesures, puuid, habitude = null, max = 3 }) {
  const maLigne = (mesures ?? []).find((m) => m.puuid === puuid);
  if (!maLigne) return { constats: [], joueurs: 0 };

  const moi = agreger([maLigne]);
  const autres = (mesures ?? [])
    .filter((m) => m.puuid !== puuid)
    .map((m) => agreger([m]));

  const constats = [];

  for (const axe of AXES) {
    const valeur = moi[axe.champ];
    const n = moi.echantillons?.[axe.cle] ?? 0;

    if (typeof valeur !== 'number' || Number.isNaN(valeur)) continue;
    if (n < (PLANCHERS[axe.cle] ?? 5)) continue;

    // Les autres joueurs doivent avoir eux aussi de quoi etre compares, sinon
    // on classe un joueur contre des zeros.
    const valeursAutres = autres
      .filter((a) => (a.echantillons?.[axe.cle] ?? 0) >= (PLANCHERS[axe.cle] ?? 5))
      .map((a) => a[axe.champ])
      .filter((v) => typeof v === 'number' && !Number.isNaN(v));

    if (valeursAutres.length < 3) continue;

    const pos = position(valeur, valeursAutres, axe.mauvais);
    if (pos === null || pos <= 0.5) continue; // meilleur que la moitie : rien a dire

    const habituel = habitude ? habitude[axe.champ] : null;

    constats.push({
      cle: axe.cle,
      titre: axe.titre,
      unite: axe.unite,
      valeur: arrondi(valeur),
      // La reference, ici, ce sont les autres joueurs DE CETTE PARTIE.
      medianeMatch: arrondi(mediane(valeursAutres)),
      // Et l'habitude du joueur, quand on la connait : c'est elle qui dit si
      // la partie sortait de l'ordinaire ou si c'est simplement son niveau.
      habitude: arrondi(habituel),
      ecartHabitude: typeof habituel === 'number' && Number.isFinite(habituel)
        ? arrondi(valeur - habituel) : null,
      echantillon: n,
      compares: valeursAutres.length,
      position: Number(pos.toFixed(3)),
      pire: valeursAutres.filter((v) => (axe.mauvais === 'haut' ? v > valeur : v < valeur)).length,
    });
  }

  constats.sort((a, b) => b.position - a.position);

  return {
    constats: constats.slice(0, max),
    joueurs: autres.length + 1,
  };
}

/**
 * Phrase courte pour un constat, pensee pour etre lue en une seconde apres une
 * partie — pas pour tenir lieu d'analyse.
 */
export function phraseDebrief(c) {
  const u = c.unite ?? '';
  const rang = `${c.pire + 1}${c.pire === 0 ? 'er' : 'e'} sur ${c.compares + 1}`;
  const habitude = c.habitude === null
    ? ''
    : ` — ${c.ecartHabitude > 0 ? '+' : ''}${c.ecartHabitude}${u} par rapport à ton habitude`;
  return `${c.valeur}${u} contre ${c.medianeMatch}${u} pour les autres, ${rang}${habitude}`;
}

/**
 * Reconstitue le score d'une partie a partir du nombre de rounds et de l'issue.
 *
 * On ne stocke pas le score par equipe : `match_players` ne garde que le
 * nombre de rounds et un booleen `won`. C'est suffisant, parce que le format
 * est contraint — premier a treize. En temps reglementaire le vainqueur a donc
 * treize, et le perdant le reste. Au-dela de vingt-quatre rounds on est en
 * prolongation, jouee par paires : chaque paire ajoute un round a chacun.
 *
 * Ce n'est qu'un repli. Le score OBSERVE par l'application PC, gele juste
 * avant la remise a zero, reste prioritaire : il a ete vu, pas deduit.
 */
export function scoreDepuisRounds(rounds, gagne) {
  const r = Number(rounds);
  if (!Number.isInteger(r) || r < 13 || typeof gagne !== 'boolean') return null;

  const vainqueur = r <= 24 ? 13 : 13 + Math.floor((r - 24) / 2);
  const perdant = r - vainqueur;
  if (perdant < 0) return null;

  return gagne ? { nous: vainqueur, eux: perdant } : { nous: perdant, eux: vainqueur };
}
