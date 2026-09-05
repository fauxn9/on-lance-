import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aplatir, trouverEtat, lireInstantane, creerMachine,
} from '../src/services/presence.js';

/**
 * Ces tests rejouent un VRAI releve : la soiree du 4 septembre 2026, du
 * moment ou le groupe se forme (23:18) jusqu'au retour au menu (23:56:44),
 * avec l'esquive en selection d'agents et la remise a zero du score qui
 * precede la fin. Rien n'est invente : chaque ligne du scenario ci-dessous
 * correspond a une ligne de la sortie de scripts/sonde-lockfile.mjs --suivi.
 *
 * Verifie ensuite contre HenrikDev : la partie existe (Haven, 23 rounds,
 * debut a 21:20:17 UTC), ce qui confirme le score 13-10 et le nom de map.
 */

/* --- Reconstitution du releve --------------------------------------------- */

const poser = (objet, chemin, valeur) => {
  const parts = chemin.split('.');
  let n = objet;
  for (const p of parts.slice(0, -1)) { n[p] ??= {}; n = n[p]; }
  n[parts.at(-1)] = valeur;
  return objet;
};

/** L'etat initial, tel que la sonde l'a vide a 23:13:15. */
const base = () => ({
  isValid: true,
  matchPresenceData: {
    gameScoreType: 'Rounds', matchMap: '', provisioningFlow: 'Invalid',
    queueId: 'competitive', sessionLoopState: 'MENUS',
  },
  partyPresenceData: {
    partyId: '141f7d02', partySize: 2, partyState: 'DEFAULT',
    partyOwnerMatchMap: '', partyOwnerSessionLoopState: 'MENUS',
    partyOwnerMatchScoreAllyTeam: 0, partyOwnerMatchScoreEnemyTeam: 0,
    isPartyOwner: true, maxPartySize: 5,
  },
  playerPresenceData: { competitiveTier: 17, accountLevel: 277 },
  partySize: 2, queueId: 'competitive', provisioningFlow: 'Invalid',
  partyOwnerMatchScoreAllyTeam: 0, partyOwnerMatchScoreEnemyTeam: 0,
});

const S = (h, m, s) => ((h * 60 + m) * 60 + s) * 1000;

/** [instant, {chemin: valeur}] — recopie de la sortie --suivi. */
const RELEVE = [
  [S(23, 13, 15), {}],
  [S(23, 18, 16), { 'partyPresenceData.partySize': 3, partySize: 3 }],
  [S(23, 18, 18), { 'partyPresenceData.partyState': 'MATCHMAKING' }],
  [S(23, 19, 48), {
    'matchPresenceData.matchMap': 'Juliett',
    'matchPresenceData.provisioningFlow': 'Matchmaking',
    'matchPresenceData.sessionLoopState': 'PREGAME',
    'partyPresenceData.partyOwnerSessionLoopState': 'PREGAME',
    'partyPresenceData.partyState': 'DEFAULT',
  }],
  // L'esquive : retour au menu sans avoir joue.
  [S(23, 20, 8), {
    'matchPresenceData.sessionLoopState': 'MENUS',
    'partyPresenceData.partyOwnerSessionLoopState': 'MENUS',
    'partyPresenceData.partyState': 'MATCHMAKING',
  }],
  [S(23, 20, 20), {
    'matchPresenceData.matchMap': 'Triad',
    'matchPresenceData.sessionLoopState': 'PREGAME',
    'partyPresenceData.partyOwnerSessionLoopState': 'PREGAME',
    'partyPresenceData.partyState': 'DEFAULT',
  }],
  [S(23, 22, 11), {
    'matchPresenceData.sessionLoopState': 'INGAME',
    'partyPresenceData.partyOwnerSessionLoopState': 'INGAME',
  }],
];

// Les rounds, dans l'ordre exact du releve : [instant, camp, valeur].
const ROUNDS = [
  [S(23, 24, 56), 'eux', 1], [S(23, 26, 26), 'eux', 2],
  [S(23, 27, 50), 'nous', 1], [S(23, 30, 17), 'nous', 2],
  [S(23, 32, 7), 'nous', 3], [S(23, 33, 27), 'eux', 3],
  [S(23, 34, 24), 'nous', 4], [S(23, 36, 12), 'nous', 5],
  [S(23, 37, 28), 'nous', 6], [S(23, 39, 3), 'eux', 4],
  [S(23, 40, 49), 'nous', 7], [S(23, 42, 7), 'eux', 5],
  [S(23, 43, 48), 'nous', 8], [S(23, 44, 54), 'nous', 9],
  [S(23, 46, 32), 'eux', 6], [S(23, 47, 28), 'eux', 7],
  [S(23, 48, 23), 'eux', 8], [S(23, 49, 29), 'nous', 10],
  [S(23, 50, 39), 'nous', 11], [S(23, 51, 53), 'nous', 12],
  [S(23, 53, 48), 'eux', 9], [S(23, 55, 18), 'eux', 10],
  [S(23, 56, 36), 'nous', 13],
];

for (const [t, camp, valeur] of ROUNDS) {
  const cle = camp === 'nous' ? 'AllyTeam' : 'EnemyTeam';
  RELEVE.push([t, {
    [`partyPresenceData.partyOwnerMatchScore${cle}`]: valeur,
    [`partyOwnerMatchScore${cle}`]: valeur,
  }]);
}

// 23:56:38 — le score repart a zero HUIT SECONDES avant le retour au menu.
RELEVE.push([S(23, 56, 38), {
  'partyPresenceData.partyOwnerMatchScoreAllyTeam': 0,
  'partyPresenceData.partyOwnerMatchScoreEnemyTeam': 0,
  partyOwnerMatchScoreAllyTeam: 0, partyOwnerMatchScoreEnemyTeam: 0,
}]);
// 23:56:44 — seulement maintenant, l'etat revient au menu.
RELEVE.push([S(23, 56, 44), {
  'matchPresenceData.matchMap': '',
  'matchPresenceData.provisioningFlow': 'Invalid',
  'matchPresenceData.sessionLoopState': 'MENUS',
  'partyPresenceData.partyOwnerSessionLoopState': 'MENUS',
  'partyPresenceData.partyOwnerMatchMap': '',
}]);

/** Rejoue le releve et rend tous les evenements produits. */
function rejouer() {
  const prive = base();
  let t = 0;
  const machine = creerMachine({ horloge: () => t });
  const evenements = [];
  for (const [instant, diffs] of RELEVE) {
    t = instant;
    for (const [chemin, valeur] of Object.entries(diffs)) poser(prive, chemin, valeur);
    evenements.push(...machine.avancer(lireInstantane(prive)));
  }
  return { evenements, machine };
}

/* --- Ce que le releve doit produire --------------------------------------- */

test('une seule partie est detectee, malgre deux selections d’agents', () => {
  const { evenements } = rejouer();
  assert.equal(evenements.filter((e) => e.type === 'debut').length, 1);
  assert.equal(evenements.filter((e) => e.type === 'fin').length, 1);
  assert.equal(evenements.filter((e) => e.type === 'selection').length, 2);
});

test('l’esquive en selection d’agents n’est pas une partie', () => {
  // 23:20:08 : PREGAME -> MENUS sans INGAME. Compter ca comme une fin
  // annoncerait aux potes une partie qui n'a jamais eu lieu.
  const { evenements } = rejouer();
  const esquives = evenements.filter((e) => e.type === 'esquive');
  assert.equal(esquives.length, 1);
  assert.equal(esquives[0].mapCode, 'Juliett');
  assert.equal(esquives[0].a, S(23, 20, 8));
});

test('le score final est celui d’avant la remise a zero', () => {
  // LE piege : a 23:56:38 le score repasse a 0-0, et ce n'est qu'a 23:56:44
  // que l'etat revient au menu. Lire le score au moment de la fin donnerait
  // 0-0 a toutes les parties, sans jamais lever d'erreur.
  const { evenements } = rejouer();
  const fin = evenements.find((e) => e.type === 'fin');
  assert.deepEqual(fin.score, { nous: 13, eux: 10 });
});

test('la map de la fin est celle d’avant l’effacement', () => {
  const { evenements } = rejouer();
  const fin = evenements.find((e) => e.type === 'fin');
  assert.equal(fin.mapCode, 'Triad');   // Haven, d'apres valorant-api.com
  assert.equal(fin.queue, 'competitive');
});

test('la duree de partie correspond au releve', () => {
  // 23:22:11 -> 23:56:44
  const { evenements } = rejouer();
  const fin = evenements.find((e) => e.type === 'fin');
  assert.equal(fin.dureeMs, S(23, 56, 44) - S(23, 22, 11));
  assert.equal(Math.round(fin.dureeMs / 60000), 35);
});

test('le groupe qui s’agrandit est detecte avant la file', () => {
  const { evenements } = rejouer();
  const groupe = evenements.find((e) => e.type === 'groupe');
  const file = evenements.find((e) => e.type === 'file');
  assert.equal(groupe.taille, 3);
  assert.ok(groupe.a < file.a, 'le groupe se forme avant de lancer la recherche');
  // 90 secondes d'avance sur la partie : de quoi prevenir les autres a temps.
  assert.ok(S(23, 22, 11) - groupe.a > 200_000);
});

/* --- Les regles, prises une par une --------------------------------------- */

test('une defaite 0-13 garde bien un zero, ce n’est pas une remise a zero', () => {
  // Le contre-exemple qui interdit la regle « garder le dernier score non nul ».
  let t = 0;
  const m = creerMachine({ horloge: () => t });
  const inst = (etat, nous, eux) => ({
    etat, mapCode: 'Ascent', queue: 'competitive', partyState: 'DEFAULT',
    partySize: 1, score: { nous, eux },
  });

  m.avancer(inst('INGAME', 0, 0));
  for (let e = 1; e <= 13; e += 1) { t += 60_000; m.avancer(inst('INGAME', 0, e)); }
  t += 2000; m.avancer(inst('INGAME', 0, 0));      // remise a zero
  t += 6000;
  const evs = m.avancer(inst('MENUS', 0, 0));

  assert.deepEqual(evs.find((e) => e.type === 'fin').score, { nous: 0, eux: 13 });
});

test('l’etat lu est le sien, pas celui du chef de groupe', () => {
  // Tant qu'on est chef, les deux coincident et l'erreur reste invisible.
  const i = lireInstantane({
    matchPresenceData: { sessionLoopState: 'INGAME' },
    partyPresenceData: { partyOwnerSessionLoopState: 'MENUS' },
  });
  assert.equal(i.etat, 'INGAME');
  assert.match(i.champEtat, /^matchPresenceData\./);
});

test('l’etat se retrouve meme si Riot deplace encore le champ', () => {
  // C'est exactement ce qui est arrive entre deux versions du client : le
  // champ a change de place, et le chercher par son nom renvoyait `undefined`
  // sans la moindre erreur.
  const i = lireInstantane({ quelqueChose: { deNouveau: { etatDuJeu: 'INGAME' } } });
  assert.equal(i.etat, 'INGAME');
  assert.equal(i.champEtat, 'quelqueChose.deNouveau.etatDuJeu');
});

test('quand plus rien ne correspond, on le dit', () => {
  const i = lireInstantane({ isValid: true, queueId: 'competitive' });
  assert.equal(i.etat, null);
  assert.equal(i.champEtat, null);
  assert.equal(i.queue, 'competitive');   // le reste reste lisible
});

test('les doublons a la racine servent de secours', () => {
  const i = lireInstantane({
    matchPresenceData: { sessionLoopState: 'MENUS' },
    partySize: 4, queueId: 'unrated',
  });
  assert.equal(i.partySize, 4);
  assert.equal(i.queue, 'unrated');
});

test('la fermeture du jeu se distingue d’une fin de partie', () => {
  const m = creerMachine();
  m.avancer(lireInstantane(base()));
  const evs = m.avancer(null);
  assert.equal(evs.length, 1);
  assert.equal(evs[0].type, 'ferme');
});

test('aplatir descend dans les sous-objets sans casser les tableaux', () => {
  const p = aplatir({ a: { b: 1 }, c: [1, 2], d: 'x' });
  assert.deepEqual(p, { 'a.b': 1, c: [1, 2], d: 'x' });
});

test('trouverEtat ignore les champs du chef de groupe', () => {
  assert.equal(trouverEtat({ partyOwnerSessionLoopState: 'INGAME' }), null);
});

test('l’esquive est racontée avant le retour en file', () => {
  // Les deux tombent dans le meme battement (23:20:08). Dans l'autre ordre, la
  // file d'attente precederait sa propre cause — et le portage Rust de cette
  // machine doit produire exactement la meme suite.
  const { evenements } = rejouer();
  const types = evenements.map((e) => e.type);
  assert.deepEqual(types, [
    'groupe', 'file', 'selection', 'esquive', 'file', 'selection', 'debut', 'fin',
  ]);
});
