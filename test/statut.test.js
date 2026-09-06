import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SERIE_MINIMUM, serieEnCours, placeDansLaPartie, placeDeLaSemaine, construireStatut,
} from '../src/services/statut.js';

/**
 * Ce qui part sur le statut Discord est PUBLIC : la liste d'amis de quelqu'un
 * le lit. Une place fausse ou une serie inventee ne se rattrape pas — elle a
 * deja ete vue. D'ou l'insistance de ces tests sur « ne rien dire » plutot que
 * « dire approximativement ».
 */

const g = (won) => ({ won });

/* --- La serie --------------------------------------------------------------- */

test('une serie se compte depuis la partie la plus recente', () => {
  assert.deepEqual(
    serieEnCours([g(true), g(true), g(true), g(false), g(true)]),
    { type: 'victoires', n: 3 },
  );
});

test('les defaites aussi', () => {
  assert.deepEqual(serieEnCours([g(false), g(false)]), { type: 'defaites', n: 2 });
});

test('une seule partie ne fait pas une serie', () => {
  // Sinon le statut annoncerait « 1 victoire d'affilee » apres chaque game,
  // ce qui ne veut rien dire et use la blague.
  assert.equal(serieEnCours([g(true), g(false)]), null);
  assert.equal(SERIE_MINIMUM, 2);
});

test('les parties sans resultat connu sont ignorees, pas comptees comme des defaites', () => {
  // `won` vaut null tant que l'API n'a pas publie l'issue. Le traiter comme une
  // defaite afficherait une serie de defaites a quelqu'un qui vient de gagner.
  assert.deepEqual(
    serieEnCours([{ won: null }, g(true), g(true)]),
    { type: 'victoires', n: 2 },
  );
});

test('aucune partie, aucune serie', () => {
  for (const rien of [[], null, undefined, [{ won: null }]]) {
    assert.equal(serieEnCours(rien), null);
  }
});

/* --- La place dans la partie ------------------------------------------------ */

const STANDINGS = [
  { rank: 1, userId: 8, displayName: 'fauxn9', acs: 268, kills: 22, deaths: 14, assists: 5, won: true },
  { rank: 2, userId: 9, displayName: 'hayann', acs: 201, kills: 15, deaths: 13, assists: 11, won: true },
  { rank: 3, userId: 12, displayName: 'hkn', acs: 154, kills: 11, deaths: 18, assists: 4, won: true },
];

test('la place est celle du classement notifie, pas une recalculee', () => {
  const p = placeDansLaPartie(STANDINGS, 12);
  assert.equal(p.place, 3);
  assert.equal(p.sur, 3);
  assert.equal(p.kills, 11);
  assert.equal(p.deaths, 18);
});

test('un userId en chaine de caracteres est reconnu', () => {
  // Le jeton d'appareil ramene parfois l'identifiant en texte. Sans la
  // conversion, le statut n'afficherait jamais la derniere partie.
  assert.equal(placeDansLaPartie(STANDINGS, '9').place, 2);
});

test('quelqu un absent du classement ne recoit pas de place', () => {
  assert.equal(placeDansLaPartie(STANDINGS, 99), null);
  assert.equal(placeDansLaPartie([], 8), null);
  assert.equal(placeDansLaPartie(null, 8), null);
});

/* --- La place de la semaine ------------------------------------------------- */

const SEMAINE = [
  { rank: 1, userId: 9, displayName: 'hayann', rrTotal: 64 },
  { rank: 2, userId: 8, displayName: 'fauxn9', rrTotal: 41 },
  { rank: 3, userId: 12, displayName: 'hkn', rrTotal: -12 },
];

test('la place de la semaine porte le RR, meme negatif', () => {
  assert.deepEqual(placeDeLaSemaine(SEMAINE, 12), { place: 3, sur: 3, rr: -12 });
});

test('sans classement, rien', () => {
  assert.equal(placeDeLaSemaine(null, 8), null);
  assert.equal(placeDeLaSemaine(SEMAINE, 42), null);
});

/* --- Le tout ---------------------------------------------------------------- */

test('un compte tout neuf produit un statut vide, pas un statut a zero', () => {
  // Le cas du jour d'inscription. « 0e sur 0 » ou « 0 victoire d'affilee »
  // ressemblerait a un resultat ; l'absence, elle, se lit correctement.
  const s = construireStatut({
    userId: 20, classementSemaine: [], matchsRecents: [], derniereDetection: null,
  });
  assert.deepEqual(s, { semaine: null, serie: null, derniere: null });
});

test('le statut complet reunit les trois faits', () => {
  const s = construireStatut({
    userId: 12,
    classementSemaine: SEMAINE,
    matchsRecents: [g(false), g(false), g(true)],
    derniereDetection: {
      map_name: 'Split',
      started_at: '2026-09-06T11:44:19.447Z',
      standings: STANDINGS,
    },
  });

  assert.deepEqual(s.semaine, { place: 3, sur: 3, rr: -12 });
  assert.deepEqual(s.serie, { type: 'defaites', n: 2 });
  assert.equal(s.derniere.map, 'Split');
  assert.equal(s.derniere.place, 3);
  assert.equal(s.derniere.sur, 3);
  assert.equal(s.derniere.deaths, 18);
});

test('une derniere partie ou l on ne figure pas ne fabrique pas de place', () => {
  // Peut arriver : la detection appartient a un autre groupe. Mieux vaut une
  // partie sans place qu'une place inventee.
  const s = construireStatut({
    userId: 99,
    classementSemaine: SEMAINE,
    matchsRecents: [],
    derniereDetection: { map_name: 'Split', started_at: null, standings: STANDINGS },
  });
  assert.equal(s.derniere.map, 'Split');
  assert.equal(s.derniere.place, undefined);
});
