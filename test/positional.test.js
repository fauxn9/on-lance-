import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  distanceMeters,
  bearing,
  angleDelta,
  toMinimap,
  analyzeDeath,
  analyzeMatch,
  aggregateDeaths,
  aggregateByMap,
  detectPatterns,
  THRESHOLDS,
} from '../src/services/positional.js';
import { matchInsight } from '../src/services/coach.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// ---------------------------------------------------------------------------
// Geometrie de base
// ---------------------------------------------------------------------------

test('distanceMeters convertit les unites de jeu en metres (100 unites = 1 m)', () => {
  assert.ok(near(distanceMeters({ x: 0, y: 0 }, { x: 300, y: 400 }), 5));
  assert.ok(near(distanceMeters({ x: -100, y: 0 }, { x: 100, y: 0 }), 2));
  assert.equal(distanceMeters({ x: 5, y: 5 }, { x: 5, y: 5 }), 0);
});

test('bearing suit la convention verifiee sur l API : atan2(dy, dx)', () => {
  assert.ok(near(bearing({ x: 0, y: 0 }, { x: 100, y: 0 }), 0));
  assert.ok(near(bearing({ x: 0, y: 0 }, { x: 0, y: 100 }), Math.PI / 2));
  assert.ok(near(Math.abs(bearing({ x: 0, y: 0 }, { x: -100, y: 0 })), Math.PI));
});

test('angleDelta reste dans [0, PI] et gere le passage par 0', () => {
  assert.ok(near(angleDelta(0, Math.PI / 2), Math.PI / 2));
  // 350° et 10° sont a 20° l'un de l'autre, pas a 340°.
  const deg = (d) => (d * Math.PI) / 180;
  assert.ok(near(angleDelta(deg(350), deg(10)), deg(20), 1e-9));
  assert.ok(near(angleDelta(deg(10), deg(350)), deg(20), 1e-9));
  // Oppose parfait : PI, jamais plus.
  assert.ok(near(angleDelta(0, Math.PI), Math.PI));
  assert.ok(angleDelta(deg(-170), deg(170)) <= Math.PI);
});

test('toMinimap inverse bien les axes (le y du jeu alimente le x de l image)', () => {
  const cal = { xMultiplier: 7.8e-5, yMultiplier: -7.8e-5, xScalarToAdd: 0.842188, yScalarToAdd: 0.697578 };
  const p = toMinimap({ x: -2701, y: -4679 }, cal);
  assert.ok(near(p.x, -4679 * 7.8e-5 + 0.842188));
  assert.ok(near(p.y, -2701 * -7.8e-5 + 0.697578));
  assert.ok(p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1);
  assert.equal(toMinimap({ x: 0, y: 0 }, null), null);
});

// ---------------------------------------------------------------------------
// Analyse d'une mort
// ---------------------------------------------------------------------------

/** Kill dans la forme exacte de l'API v4 (verifiee le 02/09/2026). */
function rawKill({
  round = 0,
  timeMs = 20000,
  victimTeam = 'Red',
  deathAt = { x: 0, y: 0 },
  killerAt = { x: 1000, y: 0 },
  mates = [],
  killerView = 0,
} = {}) {
  return {
    round,
    time_in_round_in_ms: timeMs,
    time_in_match_in_ms: timeMs,
    killer: { puuid: 'killer', name: 'K', tag: 'x', team: victimTeam === 'Red' ? 'Blue' : 'Red' },
    victim: { puuid: 'me', name: 'Moi', tag: 'x', team: victimTeam },
    assistants: [],
    location: deathAt,
    weapon: { name: 'Vandal' },
    player_locations: [
      {
        player: { puuid: 'killer', name: 'K', tag: 'x', team: victimTeam === 'Red' ? 'Blue' : 'Red' },
        view_radians: killerView,
        location: killerAt,
      },
      ...mates.map((m, i) => ({
        player: { puuid: `mate${i}`, name: `Mate${i}`, tag: 'x', team: victimTeam },
        view_radians: 0,
        location: m,
      })),
    ],
  };
}

test('analyzeDeath mesure la distance du duel et celle du coequipier le plus proche', () => {
  const d = analyzeDeath({
    kill: rawKill({
      deathAt: { x: 0, y: 0 },
      killerAt: { x: 1500, y: 0 },          // 15 m
      mates: [{ x: 0, y: 2500 }, { x: 400, y: 0 }], // 25 m et 4 m
    }),
    victimTeam: 'Red',
  });

  assert.ok(near(d.duelDistance, 15));
  assert.ok(near(d.nearestTeammate, 4), 'doit retenir le plus proche, pas le premier de la liste');
  assert.equal(d.livingTeammates, 2);
  assert.equal(d.isolated, false);
  assert.equal(d.tradePossible, true);
  assert.equal(d.lastAlive, false);
});

test('analyzeDeath detecte la surextension au-dela du seuil', () => {
  const d = analyzeDeath({
    kill: rawKill({ mates: [{ x: 0, y: 2000 }] }), // 20 m > 15 m
    victimTeam: 'Red',
  });
  assert.equal(d.isolated, true);
  assert.equal(d.tradePossible, false);
  assert.ok(near(d.nearestTeammate, 20));
});

test('mourir en dernier survivant n est pas compte comme une mort isolee', () => {
  const d = analyzeDeath({ kill: rawKill({ mates: [] }), victimTeam: 'Red' });

  assert.equal(d.lastAlive, true);
  assert.equal(d.nearestTeammate, null);
  assert.equal(d.isolated, false, "etre seul quand tout le monde est mort n'est pas une erreur de placement");
  assert.equal(d.tradePossible, false);
});

test("l angle de vue n est retenu que si la derniere observation est assez recente", () => {
  const kill = rawKill({ timeMs: 30000, deathAt: { x: 0, y: 0 }, killerAt: { x: -1000, y: 0 } });

  // Observation 1 s avant la mort : retenue.
  const proche = analyzeDeath({
    kill,
    victimTeam: 'Red',
    lastSeen: { location: { x: 0, y: 0 }, view: 0, timeMs: 29000 },
  });
  assert.ok(proche.view, 'un ecart de 1 s doit etre exploitable');
  assert.equal(proche.view.gapMs, 1000);
  // Le joueur regardait vers +x, le tueur etait en -x : menace dans le dos.
  assert.ok(near(proche.view.deltaDeg, 180, 1e-6));
  assert.equal(proche.view.fromBehind, true);
  assert.equal(proche.view.outOfView, true);

  // Meme situation mais 6 s avant : ecartee, car le joueur a eu le temps de
  // pivoter entierement entre-temps.
  const loin = analyzeDeath({
    kill,
    victimTeam: 'Red',
    lastSeen: { location: { x: 0, y: 0 }, view: 0, timeMs: 24000 },
  });
  assert.equal(loin.view, null, `au-dela de ${THRESHOLDS.viewMaxGapMs} ms l'info n'est plus affirmable`);
});

test('une menace dans le champ de vision n est pas signalee comme un flank', () => {
  const kill = rawKill({ timeMs: 10000, deathAt: { x: 0, y: 0 }, killerAt: { x: 1000, y: 0 } });
  const d = analyzeDeath({
    kill,
    victimTeam: 'Red',
    lastSeen: { location: { x: 0, y: 0 }, view: 0, timeMs: 9500 }, // regarde droit vers le tueur
  });
  assert.ok(near(d.view.deltaDeg, 0, 1e-6));
  assert.equal(d.view.outOfView, false);
  assert.equal(d.view.fromBehind, false);
});

// ---------------------------------------------------------------------------
// Analyse d'un match complet
// ---------------------------------------------------------------------------

function rawMatch(kills) {
  return {
    metadata: {
      match_id: 'M-POS',
      map: { name: 'Ascent' },
      started_at: '2026-09-01T20:00:00Z',
    },
    players: [
      { puuid: 'me', team_id: 'Red', agent: { name: 'Skye' } },
      { puuid: 'mate0', team_id: 'Red', agent: { name: 'Omen' } },
      { puuid: 'killer', team_id: 'Blue', agent: { name: 'Jett' } },
    ],
    kills,
  };
}

test('analyzeMatch ne retient que les morts des joueurs suivis', () => {
  const autre = rawKill({ round: 1 });
  autre.victim = { puuid: 'inconnu', name: 'X', tag: 'x', team: 'Red' };

  const deaths = analyzeMatch({
    rawMatch: rawMatch([rawKill({ round: 0 }), autre]),
    puuids: ['me'],
  });

  assert.equal(deaths.length, 1, 'les morts des autres joueurs ne sont pas stockees');
  assert.equal(deaths[0].round, 0);
  assert.equal(deaths[0].matchId, 'M-POS');
  assert.equal(deaths[0].mapName, 'Ascent');
  assert.equal(deaths[0].agent, 'Skye');
});

test("une observation issue du kill courant ne sert pas a expliquer ce meme kill", () => {
  // Un seul kill dans le round : le joueur suivi meurt, il n'existe aucune
  // observation anterieure. Son angle doit rester inconnu.
  const deaths = analyzeMatch({ rawMatch: rawMatch([rawKill({ round: 0 })]), puuids: ['me'] });
  assert.equal(deaths[0].view, null);
});

test('analyzeMatch reconstitue l angle depuis un kill anterieur du meme round', () => {
  // Kill 1 : un coequipier meurt, le joueur suivi est localise (regard vers +x).
  const premier = rawKill({ round: 3, timeMs: 12000, deathAt: { x: 500, y: 500 } });
  premier.victim = { puuid: 'mate0', name: 'Mate0', tag: 'x', team: 'Red' };
  premier.player_locations.push({
    player: { puuid: 'me', name: 'Moi', tag: 'x', team: 'Red' },
    view_radians: 0,
    location: { x: 0, y: 0 },
  });

  // Kill 2, 1,2 s plus tard : le joueur suivi meurt, tueur dans son dos.
  const second = rawKill({ round: 3, timeMs: 13200, deathAt: { x: 0, y: 0 }, killerAt: { x: -1200, y: 0 } });

  const deaths = analyzeMatch({ rawMatch: rawMatch([premier, second]), puuids: ['me'] });
  assert.equal(deaths.length, 1);
  assert.equal(deaths[0].view.gapMs, 1200);
  assert.equal(deaths[0].view.fromBehind, true);
});

test('la reconstitution ne traverse pas les rounds', () => {
  const r1 = rawKill({ round: 1, timeMs: 50000 });
  r1.victim = { puuid: 'mate0', name: 'M', tag: 'x', team: 'Red' };
  r1.player_locations.push({
    player: { puuid: 'me', name: 'Moi', tag: 'x', team: 'Red' },
    view_radians: 0,
    location: { x: 0, y: 0 },
  });
  const r2 = rawKill({ round: 2, timeMs: 3000 });

  const deaths = analyzeMatch({ rawMatch: rawMatch([r1, r2]), puuids: ['me'] });
  assert.equal(deaths[0].view, null, 'une position du round precedent ne dit rien du round suivant');
});

// ---------------------------------------------------------------------------
// Agregation et patterns
// ---------------------------------------------------------------------------

function death(over = {}) {
  return {
    mapName: 'Ascent',
    lastAlive: false,
    nearestTeammate: 5,
    isolated: false,
    tradePossible: true,
    duelDistance: 15,
    view: null,
    ...over,
  };
}

test('aggregateDeaths sort les morts en dernier survivant des ratios de placement', () => {
  const agg = aggregateDeaths([
    death({ isolated: true, nearestTeammate: 20, tradePossible: false }),
    death(),
    death({ lastAlive: true, nearestTeammate: null }),
  ]);

  assert.equal(agg.deaths, 3);
  assert.equal(agg.lastAliveDeaths, 1);
  assert.equal(agg.positionalSample, 2, 'le dernier survivant ne compte pas dans l echantillon');
  assert.equal(agg.isolatedDeaths, 1);
  assert.equal(agg.tradeableDeaths, 1);
});

test('aggregateByMap regroupe et trie par nombre de morts', () => {
  const list = [
    death({ mapName: 'Split' }),
    death({ mapName: 'Ascent' }),
    death({ mapName: 'Ascent' }),
    death({ mapName: 'Ascent' }),
  ];
  const byMap = aggregateByMap(list);
  assert.deepEqual(byMap.map((m) => m.mapName), ['Ascent', 'Split']);
  assert.equal(byMap[0].deaths, 3);
});

test('detectPatterns ne conclut rien sur un echantillon trop petit', () => {
  const agg = aggregateDeaths([death({ isolated: true }), death({ isolated: true })]);
  assert.deepEqual(detectPatterns(agg), [], '2 morts ne font pas un pattern');
});

test('detectPatterns signale la surextension et cite sa taille d echantillon', () => {
  const deaths = [
    ...Array.from({ length: 7 }, () => death({ isolated: true, nearestTeammate: 22, tradePossible: false })),
    ...Array.from({ length: 3 }, () => death()),
  ];
  const patterns = detectPatterns(aggregateDeaths(deaths));
  const iso = patterns.find((p) => p.key === 'isolation');

  assert.ok(iso, 'le pattern doit etre detecte');
  assert.equal(iso.severity, 'fort', '70% de morts isolees est un signal fort');
  assert.equal(iso.sample, 10);
  assert.match(iso.fact, /7 morts sur 10/);
});

test("les faits sur l angle de vue disent explicitement sur combien de morts ils portent", () => {
  const deaths = [
    ...Array.from({ length: 8 }, () =>
      death({ view: { deltaDeg: 160, gapMs: 900, outOfView: true, fromBehind: true } }),
    ),
    ...Array.from({ length: 12 }, () => death()),
  ];
  const patterns = detectPatterns(aggregateDeaths(deaths));
  const behind = patterns.find((p) => p.key === 'from_behind');

  assert.ok(behind);
  assert.equal(behind.sample, 8, "l'echantillon est celui des morts avec regard connu, pas le total");
  assert.match(behind.fact, /ou la direction du regard est connue/);
});

// ---------------------------------------------------------------------------
// Insight de notification
// ---------------------------------------------------------------------------

test('matchInsight se tait quand le match ne montre rien de net', () => {
  assert.equal(matchInsight([]), null);
  assert.equal(matchInsight([death(), death()]), null, 'trop peu de morts pour affirmer quoi que ce soit');
  assert.equal(matchInsight(Array.from({ length: 8 }, () => death())), null);
});

test('matchInsight remonte un fait chiffre quand le pattern est franc', () => {
  const deaths = [
    ...Array.from({ length: 4 }, () => death({ isolated: true, nearestTeammate: 24, tradePossible: false })),
    ...Array.from({ length: 2 }, () => death()),
  ];
  const insight = matchInsight(deaths);
  assert.ok(insight);
  assert.match(insight, /4 de ses 6 morts/);
  assert.match(insight, /24 m en moyenne/);
});
