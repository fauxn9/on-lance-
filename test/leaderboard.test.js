import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeRrEntry } from '../src/services/henrikdev.js';
import {
  weekStartOf,
  shiftWeek,
  previousWeek,
  weekLabel,
  weekBounds,
  buildLeaderboard,
  hasActivity,
  weeklyWinner,
} from '../src/services/leaderboard.js';

// ---------------------------------------------------------------------------
// Fixture : une entree d'historique RR dans la forme reelle de l'API v2,
// relevee le 02/09/2026 sur /valorant/v2/by-puuid/mmr-history.
// ---------------------------------------------------------------------------

function rawRr(overrides = {}) {
  return {
    tier: { id: 15, name: 'Platinum 1' },
    match_id: 'RR1',
    map: { id: 'x', name: 'Lotus' },
    season: { id: 's', short: 'e11a5' },
    rr: 19,
    last_change: -18,
    elo: 1219,
    refunded_rr: 0,
    was_derank_protected: false,
    date: '2026-09-02T18:38:19.703Z',
    ...overrides,
  };
}

test('normalizeRrEntry extrait le RR gagne/perdu de la vraie forme d API', () => {
  const e = normalizeRrEntry(rawRr());
  assert.equal(e.matchId, 'RR1');
  assert.equal(e.rrChange, -18);
  assert.equal(e.rrAfter, 19);
  assert.equal(e.tier, 'Platinum 1');
  assert.equal(e.map, 'Lotus');
  assert.equal(e.playedAt.toISOString(), '2026-09-02T18:38:19.703Z');
  assert.equal(e.derankProtected, false);
});

test('normalizeRrEntry ecarte une entree sans last_change plutot que de compter 0', () => {
  assert.equal(normalizeRrEntry(rawRr({ last_change: undefined })), null);
  assert.equal(normalizeRrEntry(rawRr({ last_change: null })), null);
  assert.equal(normalizeRrEntry({ ...rawRr(), match_id: undefined }), null);
  // 0 est une valeur legitime (match sans changement de RR) : elle passe.
  assert.equal(normalizeRrEntry(rawRr({ last_change: 0 })).rrChange, 0);
});

// ---------------------------------------------------------------------------
// Semaines
// ---------------------------------------------------------------------------

test('weekStartOf rend toujours le lundi de la semaine', () => {
  // 31/08/2026 est un lundi, 06/09/2026 un dimanche.
  assert.equal(weekStartOf(new Date('2026-08-31T10:00:00Z')), '2026-08-31');
  assert.equal(weekStartOf(new Date('2026-09-02T18:38:00Z')), '2026-08-31');
  assert.equal(weekStartOf(new Date('2026-09-06T12:00:00Z')), '2026-08-31');
});

test('weekStartOf decoupe la semaine sur le fuseau du groupe, pas sur UTC', () => {
  // Dimanche 6 septembre 23h00 a Paris (21h UTC) : encore la semaine du 31/08.
  assert.equal(weekStartOf(new Date('2026-09-06T21:00:00Z')), '2026-08-31');

  // Lundi 7 septembre 00h30 a Paris (22h30 UTC dimanche) : nouvelle semaine.
  // C'est LE cas qui casse si on raisonne en UTC — une game du dimanche soir
  // tres tard tomberait dans la mauvaise semaine.
  assert.equal(weekStartOf(new Date('2026-09-06T22:30:00Z')), '2026-09-07');
  assert.equal(weekStartOf(new Date('2026-09-06T22:30:00Z'), 'UTC'), '2026-08-31');
});

test('shiftWeek et previousWeek se deplacent de semaine en semaine', () => {
  assert.equal(previousWeek('2026-09-07'), '2026-08-31');
  assert.equal(shiftWeek('2026-08-31', 1), '2026-09-07');
  assert.equal(shiftWeek('2026-08-31', -2), '2026-08-17');
  // Passage d'annee : pas de piege, on ne manipule que des dates.
  assert.equal(shiftWeek('2026-12-28', 1), '2027-01-04');
});

test('weekLabel donne un libelle lisible en francais', () => {
  assert.equal(weekLabel('2026-08-31'), 'semaine du 31 août');
});

test('weekBounds cale le debut et la fin sur minuit heure de Paris', () => {
  // Fin aout : heure d'ete, Paris est a UTC+2, donc minuit local = 22h UTC la veille.
  const ete = weekBounds('2026-08-31');
  assert.equal(ete.startsAt.toISOString(), '2026-08-30T22:00:00.000Z');
  assert.equal(ete.endsAt.toISOString(), '2026-09-06T22:00:00.000Z');
});

test('weekBounds suit le changement d heure', () => {
  // Debut janvier : heure d'hiver, Paris est a UTC+1, donc minuit local = 23h UTC.
  const hiver = weekBounds('2026-01-05');
  assert.equal(hiver.startsAt.toISOString(), '2026-01-04T23:00:00.000Z');

  // La semaine qui contient le passage a l'heure d'ete (29 mars 2026) commence
  // en UTC+1 et se termine en UTC+2 : les deux bornes n'ont pas le meme decalage.
  const bascule = weekBounds('2026-03-23');
  assert.equal(bascule.startsAt.toISOString(), '2026-03-22T23:00:00.000Z');
  assert.equal(bascule.endsAt.toISOString(), '2026-03-29T22:00:00.000Z');
});

test('weekBounds respecte un autre fuseau', () => {
  const utc = weekBounds('2026-08-31', 'UTC');
  assert.equal(utc.startsAt.toISOString(), '2026-08-31T00:00:00.000Z');
});

// ---------------------------------------------------------------------------
// Classement
// ---------------------------------------------------------------------------

const MEMBERS = [
  { userId: 1, displayName: 'Alex' },
  { userId: 2, displayName: 'Sam' },
  { userId: 3, displayName: 'Theo' },
];

test('buildLeaderboard somme le RR de la semaine et classe du meilleur au pire', () => {
  const standings = buildLeaderboard({
    members: MEMBERS,
    rrRows: [
      { userId: 1, rrChange: 20 },
      { userId: 1, rrChange: -15 },
      { userId: 1, rrChange: 22 },   // Alex : +27 en 3 matchs
      { userId: 2, rrChange: 18 },
      { userId: 2, rrChange: 19 },   // Sam  : +37 en 2 matchs
      { userId: 3, rrChange: -20 },  // Theo : -20 en 1 match
    ],
  });

  assert.deepEqual(standings.map((s) => s.displayName), ['Sam', 'Alex', 'Theo']);
  assert.equal(standings[0].rrTotal, 37);
  assert.equal(standings[0].matches, 2);
  assert.equal(standings[1].rrTotal, 27);
  assert.equal(standings[1].bestGain, 22);
  assert.equal(standings[1].worstLoss, -15);
  assert.deepEqual(standings.map((s) => s.rank), [1, 2, 3]);
});

test('buildLeaderboard garde les membres qui n ont pas joue, a 0 RR et 0 match', () => {
  const standings = buildLeaderboard({
    members: MEMBERS,
    rrRows: [{ userId: 1, rrChange: 25 }],
  });

  assert.equal(standings.length, 3, 'les absents restent visibles au classement');
  const theo = standings.find((s) => s.displayName === 'Theo');
  assert.equal(theo.rrTotal, 0);
  assert.equal(theo.matches, 0);
  assert.equal(theo.bestGain, null);
});

test('buildLeaderboard departage un meme total par le nombre de matchs joues', () => {
  const standings = buildLeaderboard({
    members: MEMBERS.slice(0, 2),
    rrRows: [
      { userId: 1, rrChange: 10 },
      { userId: 1, rrChange: 20 }, // Alex : +30 en 2 matchs
      { userId: 2, rrChange: 30 }, // Sam  : +30 en 1 match -> plus efficace
    ],
  });
  assert.deepEqual(standings.map((s) => s.displayName), ['Sam', 'Alex']);
});

test('buildLeaderboard ignore le RR d un joueur qui n est plus membre du groupe', () => {
  const standings = buildLeaderboard({
    members: MEMBERS.slice(0, 1),
    rrRows: [
      { userId: 1, rrChange: 12 },
      { userId: 99, rrChange: 500 }, // ancien membre : ne doit pas apparaitre
    ],
  });
  assert.equal(standings.length, 1);
  assert.equal(standings[0].rrTotal, 12);
});

test('hasActivity et weeklyWinner : une semaine sans match ne designe aucun vainqueur', () => {
  const vide = buildLeaderboard({ members: MEMBERS, rrRows: [] });
  assert.equal(hasActivity(vide), false);
  assert.equal(weeklyWinner(vide), null);
});

test('weeklyWinner designe le premier et signale une egalite parfaite', () => {
  const net = buildLeaderboard({
    members: MEMBERS.slice(0, 2),
    rrRows: [
      { userId: 1, rrChange: 40 },
      { userId: 2, rrChange: 10 },
    ],
  });
  assert.equal(weeklyWinner(net).displayName, 'Alex');
  assert.equal(weeklyWinner(net).tied, false);

  const exAequo = buildLeaderboard({
    members: MEMBERS.slice(0, 2),
    rrRows: [
      { userId: 1, rrChange: 25 },
      { userId: 2, rrChange: 25 },
    ],
  });
  assert.equal(weeklyWinner(exAequo).tied, true, 'meme RR et meme nombre de matchs');
});
