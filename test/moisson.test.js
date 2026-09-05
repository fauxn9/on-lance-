import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resumeDuJoueur, lignesDesDix } from '../src/services/moisson.js';

/**
 * Ces tests protegent la correction du 05/09/2026 : l'historique et la feuille
 * des dix ne dependent plus du cron `25 * * * *`, ils sont ecrits par la
 * detection, qui tient deja le match brut. La forme des donnees produites doit
 * donc rester STRICTEMENT identique a ce que le cron ecrivait, sinon on aurait
 * deplace le bug au lieu de le corriger.
 */

/** Match minimal, mais avec la vraie forme de la reponse HenrikDev v4. */
const matchBrut = () => ({
  metadata: {
    match_id: 'm-1',
    started_at: '2026-09-05T20:05:19.547Z',
    map: { name: 'Abyss' },
    queue: { name: 'Competitive', id: 'competitive' },
    rounds_played: 2,
  },
  rounds: [{ id: 0 }, { id: 1, plant: { round_time_in_ms: 30_000 } }],
  teams: [{ team_id: 'Blue', won: true }, { team_id: 'Red', won: false }],
  players: [
    { puuid: 'a', name: 'hkn', tag: '68100', team_id: 'Blue', agent: { name: 'Jett' },
      tier: { id: 16, name: 'Platinum 2' },
      stats: { score: 500, kills: 2, deaths: 2, assists: 1,
        headshots: 3, bodyshots: 5, legshots: 2, damage: { dealt: 300, received: 260 } } },
    { puuid: 'b', name: 'Autre', tag: '000', team_id: 'Red', agent: { name: 'Sage' },
      tier: { id: 15, name: 'Platinum 1' },
      stats: { score: 400, kills: 2, deaths: 1, assists: 0,
        headshots: 1, bodyshots: 4, legshots: 1, damage: { dealt: 200, received: 180 } } },
  ],
  kills: [
    { round: 0, time_in_round_in_ms: 8_000, victim: { puuid: 'a' }, killer: { puuid: 'b' } },
    { round: 0, time_in_round_in_ms: 25_000, victim: { puuid: 'b' }, killer: { puuid: 'a' } },
    { round: 1, time_in_round_in_ms: 25_000, victim: { puuid: 'b' }, killer: { puuid: 'a' } },
    { round: 1, time_in_round_in_ms: 45_000, victim: { puuid: 'a' }, killer: { puuid: 'b' } },
  ],
});

/* --- Le resume, c'est ce qui s'affiche dans l'historique -------------------- */

test('le resume porte le point de vue du joueur demande', () => {
  const a = resumeDuJoueur(matchBrut(), 'a');
  assert.equal(a.matchId, 'm-1');
  assert.equal(a.mapName, 'Abyss');
  assert.equal(a.agent, 'Jett');
  assert.equal(a.kills, 2);
  assert.equal(a.deaths, 2);
  assert.equal(a.won, true);

  const b = resumeDuJoueur(matchBrut(), 'b');
  assert.equal(b.agent, 'Sage');
  assert.equal(b.won, false, 'le camp suit le joueur, pas le match');
});

test("un joueur absent du match ne produit pas de ligne d'historique", () => {
  // Sinon la detection ecrirait une partie vide pour chaque membre du groupe
  // qui n'y jouait pas.
  assert.equal(resumeDuJoueur(matchBrut(), 'inconnu'), null);
});

test('un match sans metadonnees ne fait rien tomber', () => {
  for (const brut of [null, undefined, {}, { players: [] }, 42]) {
    assert.equal(resumeDuJoueur(brut, 'a'), null);
  }
});

test("l'ACS est arrondi, jamais laisse en decimal", () => {
  // La colonne est un entier : un flottant ferait echouer l'insertion, et
  // seulement en production, sur une partie au nombre de rounds impair.
  const a = resumeDuJoueur(matchBrut(), 'a');
  assert.equal(Number.isInteger(a.acs), true);
  assert.equal(Number.isInteger(a.headshotPct), true);
  assert.equal(a.acs, 250);              // 500 / 2 rounds
  assert.equal(a.headshotPct, 30);       // 3 / 10 tirs
});

/* --- La feuille des dix ---------------------------------------------------- */

test('la feuille contient une ligne par joueur du match', () => {
  const lignes = lignesDesDix({ raw: matchBrut(), matchId: 'm-1', mapName: 'Abyss' });
  assert.equal(lignes.length, 2);
  assert.deepEqual(lignes.map((l) => l.puuid), ['a', 'b']);
});

test('la feuille reprend le pseudo, le tag et le rang tels quels', () => {
  // C'est ce que le debrief affiche a cote de l'image de l'agent. Un tag perdu
  // ici et le tableau des scores devient anonyme.
  const [a] = lignesDesDix({ raw: matchBrut(), matchId: 'm-1', mapName: 'Abyss' });
  assert.equal(a.name, 'hkn');
  assert.equal(a.tag, '68100');
  assert.equal(a.tierId, 16);
  assert.equal(a.tierName, 'Platinum 2');
  assert.equal(a.agent, 'Jett');
  assert.equal(a.team, 'Blue');
});

test('le camp gagnant vient de teams, pas du joueur', () => {
  const lignes = lignesDesDix({ raw: matchBrut(), matchId: 'm-1', mapName: 'Abyss' });
  assert.equal(lignes.find((l) => l.puuid === 'a').won, true);
  assert.equal(lignes.find((l) => l.puuid === 'b').won, false);
});

test('les mesures positionnelles arrivent bien dans la feuille', () => {
  // Le barème du coach lit ces colonnes. Si la moisson les laissait a zero, le
  // coach ne dirait plus rien — sans lever la moindre erreur.
  const morts = [
    { victimPuuid: 'a', lastAlive: false, nearestTeammate: 22, isolated: true, tradePossible: false },
    { victimPuuid: 'a', lastAlive: false, nearestTeammate: 4, isolated: false, tradePossible: true },
  ];
  const [a] = lignesDesDix({ raw: matchBrut(), matchId: 'm-1', mapName: 'Abyss', morts });
  assert.equal(a.mortsPositionnelles, 2);
  assert.equal(a.mortsIsolees, 1);
  assert.equal(a.mortsNonTradables, 1);
  assert.equal(a.ouvertures, 1);
  assert.equal(a.mortsPrecoces, 1);
});

test('sans geometrie, la feuille reste ecrite avec des zeros', () => {
  // Cas reel : une map sans calibration. On prefere un tableau des scores
  // complet et des colonnes positionnelles a zero plutot que pas de debrief.
  const [a] = lignesDesDix({ raw: matchBrut(), matchId: 'm-1', mapName: null, morts: [] });
  assert.equal(a.mortsIsolees, 0);
  assert.equal(a.mortsNonTradables, 0);
  assert.equal(a.kills, 2, 'le scoreboard, lui, est bien la');
  assert.equal(a.degatsInfliges, 300);
});

test('un match vide ne produit aucune ligne', () => {
  for (const brut of [null, undefined, {}, { players: [] }]) {
    assert.deepEqual(lignesDesDix({ raw: brut, matchId: 'x', mapName: null }), []);
  }
});

test('aucune ligne ne sort avec un champ undefined', () => {
  // pg refuse `undefined` en parametre : une seule colonne oubliee et toute la
  // transaction de la feuille echoue.
  const nu = { metadata: { match_id: 'm' }, players: [{ puuid: 'z' }], rounds: [], teams: [] };
  const [z] = lignesDesDix({ raw: nu, matchId: 'm', mapName: null });
  for (const [cle, valeur] of Object.entries(z)) {
    assert.notEqual(valeur, undefined, `champ undefined : ${cle}`);
  }
});
