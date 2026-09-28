import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HostLimiter, parseLimits, RiotLimiter } from '../api/limiter.js';
import { RiotApi, accountRegionOf, regionOf } from '../api/riot.js';
import { matchRow } from '../api/sync.js';
import { ladder } from '../api/routes.js';

// Horloge factice : sleep() fait avancer le temps au lieu d'attendre.
function fakeClock() {
  let t = 1_000_000;
  return { now: () => t, sleep: async (ms) => { t += ms; }, advance: (ms) => { t += ms; } };
}

test('parseLimits lit l’en-tête de Riot', () => {
  assert.deepEqual(parseLimits('20:1,100:120'), [{ max: 20, windowMs: 1000 }, { max: 100, windowMs: 120000 }]);
  assert.equal(parseLimits(''), null);
  assert.equal(parseLimits('abc'), null);
});

test('le limiteur ne dépasse jamais aucune fenêtre', async () => {
  const c = fakeClock();
  const l = new HostLimiter({ limits: parseLimits('20:1,100:120'), now: c.now, sleep: c.sleep });
  const t0 = c.now();
  for (let i = 0; i < 101; i++) await l.acquire();
  // 100 requêtes max en 2 minutes : la 101e attend la sortie de la 1re.
  assert.ok(c.now() - t0 >= 120_000, `trop tôt : ${c.now() - t0} ms`);
  // Et jamais plus de 20 dans une même seconde.
  const hits = l.hits;
  for (let i = 20; i < hits.length; i++) assert.ok(hits[i] - hits[i - 20] >= 1000);
});

test('la priorité basse laisse 30 % de la fenêtre aux demandes à l’écran', () => {
  const c = fakeClock();
  const l = new HostLimiter({ limits: parseLimits('10:10'), now: c.now, sleep: c.sleep });
  for (let i = 0; i < 7; i++) l.hits.push(c.now());
  assert.ok(l.wait('low') > 0, 'le fond doit attendre');
  assert.equal(l.wait('high'), 0, 'l’interactif passe');
});

test('un 429 met toute la route en pause puis réessaie', async () => {
  const c = fakeClock();
  const limiter = new RiotLimiter({ limits: parseLimits('100:1'), now: c.now, sleep: c.sleep });
  const calls = [];
  const responses = [
    new Response('{}', { status: 429, headers: { 'retry-after': '3' } }),
    new Response(JSON.stringify({ ok: 1 }), { status: 200, headers: { 'x-app-rate-limit': '500:10' } }),
  ];
  const riot = new RiotApi({ key: 'k', limiter, fetch: async (url) => { calls.push([url, c.now()]); return responses.shift(); }, sleep: c.sleep });
  const out = await riot.get('euw1', '/x');
  assert.deepEqual(out, { ok: 1 });
  assert.equal(calls.length, 2);
  assert.ok(calls[1][1] - calls[0][1] >= 3000, 'doit attendre le Retry-After');
  // La limite annoncée par Riot remplace la valeur par défaut.
  assert.deepEqual(limiter.host('euw1').limits, [{ max: 500, windowMs: 10000 }]);
});

test('un 404 n’est pas une erreur', async () => {
  const riot = new RiotApi({ key: 'k', fetch: async () => new Response('', { status: 404 }) });
  assert.equal(await riot.get('euw1', '/absent'), null);
});

test('routage des régions', () => {
  assert.equal(regionOf('euw1'), 'europe');
  assert.equal(regionOf('kr'), 'asia');
  assert.equal(regionOf('vn2'), 'sea');
  assert.equal(accountRegionOf('vn2'), 'asia');
});

test('matchRow garde la ligne du bon joueur', () => {
  const m = {
    metadata: { matchId: 'EUW1_123456789' },
    info: {
      queueId: 420, gameStartTimestamp: 1700000000000, gameEndTimestamp: 1700001884000, gameDuration: 1884,
      gameVersion: '16.19.1.123',
      participants: [
        { puuid: 'autre', championId: 1 },
        {
          puuid: 'moi', championId: 875, championName: 'Sett', teamPosition: 'TOP', win: true,
          kills: 8, deaths: 3, assists: 6, totalMinionsKilled: 220, neutralMinionsKilled: 25, goldEarned: 13400,
          totalDamageDealtToChampions: 28400, visionScore: 24, champLevel: 16,
          item0: 3071, item1: 3053, item2: 6333, item3: 3047, item4: 0, item5: 0, item6: 3364,
          summoner1Id: 4, summoner2Id: 12,
          perks: { styles: [{ style: 8000, selections: [{ perk: 8010 }] }, { style: 8400 }] },
        },
      ],
    },
  };
  const row = matchRow(m, 'moi');
  assert.equal(row.match_id, 'EUW1_123456789');
  assert.equal(row.duration_s, 1884);
  assert.equal(row.cs, 245);
  assert.deepEqual(row.items, [3071, 3053, 6333, 3047, 0, 0, 3364]);
  assert.equal(row.keystone, 8010);
  assert.equal(row.secondary_style, 8400);
  assert.equal(matchRow(m, 'inconnu'), null);
});

test('matchRow convertit les anciennes durées en millisecondes', () => {
  const m = { metadata: { matchId: 'EUW1_1' }, info: { queueId: 450, gameCreation: 1, gameDuration: 1_200_000, participants: [{ puuid: 'p', championId: 1, championName: 'Annie' }] } };
  assert.equal(matchRow(m, 'p').duration_s, 1200);
});

test('échelle continue des rangs', () => {
  assert.equal(ladder('IRON', 'IV', 0), 0);
  assert.equal(ladder('EMERALD', 'II', 64), 5 * 400 + 200 + 64);
  assert.equal(ladder('CHALLENGER', 'I', 1200), 2800 + 1200);
  assert.equal(ladder('???', 'I', 0), null);
});
