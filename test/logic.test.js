import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeMatch } from '../src/services/henrikdev.js';
import { rankGroupInMatch, assignTones, intensityFromGap } from '../src/services/ranking.js';
import { findSharedMatches, buildPuuidIndex } from '../src/services/detection.js';
import { buildUserPrompt, pickAngle, STYLE_ANGLES } from '../src/services/messages.js';

// ---------------------------------------------------------------------------
// Fixtures : une reponse HenrikDev simplifiee, dans la forme documentee de l'API.
// ---------------------------------------------------------------------------

function rawMatch({ matchId = 'M1', startedAt = '2026-09-01T20:00:00Z', map = 'Bind' } = {}) {
  const mk = (puuid, name, score, kills, deaths, assists, team, agent) => ({
    puuid,
    name,
    tag: 'EUW',
    team_id: team,
    agent: { name: agent },
    stats: {
      score,
      kills,
      deaths,
      assists,
      headshots: 20,
      bodyshots: 60,
      legshots: 20,
      damage: { dealt: kills * 900 },
    },
  });

  return {
    metadata: {
      match_id: matchId,
      map: { name: map },
      queue: { name: 'Competitive' },
      started_at: startedAt,
      rounds_played: 20,
    },
    teams: [
      { team_id: 'Red', won: true },
      { team_id: 'Blue', won: false },
    ],
    players: [
      mk('p-alex', 'Alex', 6000, 24, 12, 4, 'Red', 'Jett'),      // ACS 300
      mk('p-sam', 'Sam', 4400, 15, 15, 9, 'Red', 'Omen'),        // ACS 220
      mk('p-theo', 'Theo', 2600, 8, 20, 6, 'Red', 'Killjoy'),    // ACS 130
      mk('p-inconnu1', 'Random', 4000, 14, 14, 3, 'Red', 'Sova'),
      mk('p-inconnu2', 'Ennemi', 5000, 20, 16, 2, 'Blue', 'Reyna'),
    ],
  };
}

const GROUP_MEMBERS = [
  { userId: 1, displayName: 'Alex', puuid: 'p-alex' },
  { userId: 2, displayName: 'Sam', puuid: 'p-sam' },
  { userId: 3, displayName: 'Theo', puuid: 'p-theo' },
];

// ---------------------------------------------------------------------------

test('normalizeMatch extrait les champs attendus', () => {
  const m = normalizeMatch(rawMatch());
  assert.equal(m.matchId, 'M1');
  assert.equal(m.map, 'Bind');
  assert.equal(m.roundsPlayed, 20);
  assert.equal(m.players.length, 5);
  assert.equal(m.players.find((p) => p.puuid === 'p-alex').won, true);
  assert.equal(m.players.find((p) => p.puuid === 'p-inconnu2').won, false);
});

test('rankGroupInMatch ne classe que les membres du groupe, tries par ACS', () => {
  const m = normalizeMatch(rawMatch());
  const standings = rankGroupInMatch(m, buildPuuidIndex(GROUP_MEMBERS));

  assert.equal(standings.length, 3, 'les joueurs hors groupe sont exclus');
  assert.deepEqual(
    standings.map((s) => s.displayName),
    ['Alex', 'Sam', 'Theo'],
  );
  assert.equal(standings[0].acs, 300);
  assert.equal(standings[2].acs, 130);
  assert.equal(standings[2].gapToFirst, 170);
});

test('assignTones : 1er hype, milieu push, dernier roast', () => {
  const m = normalizeMatch(rawMatch());
  const toned = assignTones(rankGroupInMatch(m, buildPuuidIndex(GROUP_MEMBERS)));
  assert.deepEqual(
    toned.map((s) => s.tone),
    ['hype', 'push', 'roast'],
  );
});

test('assignTones a 2 joueurs : le 2e est le dernier, donc roast par defaut', () => {
  const m = normalizeMatch(rawMatch());
  const duo = GROUP_MEMBERS.slice(0, 2);
  const toned = assignTones(rankGroupInMatch(m, buildPuuidIndex(duo)));
  assert.deepEqual(toned.map((s) => s.tone), ['hype', 'roast']);

  const adouci = assignTones(rankGroupInMatch(m, buildPuuidIndex(duo)), {
    twoPlayerSecondTone: 'push',
  });
  assert.deepEqual(adouci.map((s) => s.tone), ['hype', 'push']);
});

test('intensityFromGap dose le message selon l ecart reel', () => {
  assert.equal(intensityFromGap(5), 'serre');
  assert.equal(intensityFromGap(40), 'net');
  assert.equal(intensityFromGap(170), 'large');
});

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

const NOW = new Date('2026-09-01T22:00:00Z');

function matchesFor(puuidsPresent, opts) {
  const m = normalizeMatch(rawMatch(opts));
  const map = new Map();
  for (const p of puuidsPresent) map.set(p, [m]);
  return map;
}

test('detecte un match ou 2+ membres du groupe etaient presents', () => {
  const found = findSharedMatches({
    members: GROUP_MEMBERS,
    matchesByPuuid: matchesFor(['p-alex', 'p-sam', 'p-theo']),
    processedIds: new Set(),
    now: NOW,
  });
  assert.equal(found.length, 1);
  assert.equal(found[0].membersInMatch.length, 3);
});

test('ignore un match ou un seul membre du groupe a joue', () => {
  const found = findSharedMatches({
    members: GROUP_MEMBERS,
    matchesByPuuid: matchesFor(['p-alex']),
    processedIds: new Set(),
    now: NOW,
  });
  assert.equal(found.length, 0, 'jouer seul ne declenche pas de notif de groupe');
});

test('anti-doublon : un match deja traite n est jamais renotifie', () => {
  const found = findSharedMatches({
    members: GROUP_MEMBERS,
    matchesByPuuid: matchesFor(['p-alex', 'p-sam']),
    processedIds: new Set(['M1']),
    now: NOW,
  });
  assert.equal(found.length, 0);
});

test('ignore les matchs hors de la fenetre de lookback', () => {
  const found = findSharedMatches({
    members: GROUP_MEMBERS,
    matchesByPuuid: matchesFor(['p-alex', 'p-sam'], {
      startedAt: '2026-08-25T20:00:00Z', // une semaine avant
    }),
    processedIds: new Set(),
    now: NOW,
  });
  assert.equal(found.length, 0, "l'historique ancien ne genere pas de notif au premier lancement");
});

test('reporte un match trop recent (stats pas encore stabilisees cote API)', () => {
  const found = findSharedMatches({
    members: GROUP_MEMBERS,
    matchesByPuuid: matchesFor(['p-alex', 'p-sam'], {
      startedAt: '2026-09-01T21:59:30Z', // 30 secondes avant "now"
    }),
    processedIds: new Set(),
    now: NOW,
  });
  assert.equal(found.length, 0, 'sera repris au prochain passage du cron');
});

test('plusieurs matchs distincts sont rendus du plus ancien au plus recent', () => {
  const m1 = normalizeMatch(rawMatch({ matchId: 'M1', startedAt: '2026-09-01T19:00:00Z' }));
  const m2 = normalizeMatch(rawMatch({ matchId: 'M2', startedAt: '2026-09-01T20:30:00Z' }));
  const byPuuid = new Map([
    ['p-alex', [m2, m1]],
    ['p-sam', [m2, m1]],
    ['p-theo', [m1]],
  ]);

  const found = findSharedMatches({
    members: GROUP_MEMBERS,
    matchesByPuuid: byPuuid,
    processedIds: new Set(),
    now: NOW,
  });

  assert.equal(found.length, 2);
  assert.deepEqual(found.map((f) => f.match.matchId), ['M1', 'M2']);
  assert.equal(found[0].membersInMatch.length, 3);
  assert.equal(found[1].membersInMatch.length, 2);
});

// ---------------------------------------------------------------------------
// Variete des messages (roast/hype/push differents et originaux a chaque fois)
// ---------------------------------------------------------------------------

test('pickAngle pioche un angle valide de la liste, de facon deterministe via le rand injecte', () => {
  assert.equal(pickAngle(() => 0), STYLE_ANGLES[0]);
  assert.equal(pickAngle(() => 0.999), STYLE_ANGLES[STYLE_ANGLES.length - 1]);
});

test('pickAngle varie sur plusieurs appels (pas toujours le meme angle)', () => {
  const seen = new Set();
  for (let i = 0; i < 50; i++) seen.add(pickAngle());
  assert.ok(seen.size > 1, 'un seul angle est toujours ressorti sur 50 tirages');
});

test('buildUserPrompt impose l angle stylistique dans le prompt envoye a l IA', () => {
  const m = normalizeMatch(rawMatch());
  const standings = assignTones(rankGroupInMatch(m, buildPuuidIndex(GROUP_MEMBERS)));
  const prompt = buildUserPrompt({
    player: standings[2],
    standings,
    match: m,
    angle: 'un angle de test bien reconnaissable',
  });
  assert.match(prompt, /ANGLE STYLISTIQUE IMPOSE/);
  assert.match(prompt, /un angle de test bien reconnaissable/);
});

test('buildUserPrompt inclut les derniers messages du joueur pour lui interdire de les repeter', () => {
  const m = normalizeMatch(rawMatch());
  const standings = assignTones(rankGroupInMatch(m, buildPuuidIndex(GROUP_MEMBERS)));
  const withHistory = buildUserPrompt({
    player: standings[2],
    standings,
    match: m,
    angle: 'angle',
    recentMessages: ['Theo, cette game restera dans les annales... des pires.'],
  });
  assert.match(withHistory, /DERNIERS MESSAGES ENVOYES/);
  assert.match(withHistory, /restera dans les annales/);

  const withoutHistory = buildUserPrompt({ player: standings[2], standings, match: m, angle: 'angle' });
  assert.doesNotMatch(withoutHistory, /DERNIERS MESSAGES ENVOYES/);
});
