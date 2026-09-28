import { test } from 'node:test';
import assert from 'node:assert/strict';
import { achats, cleRunes, extraire, montees, ordreMax, patchDe, regrouper } from '../api/stats/extract.js';
import { choisir, construireBuild, lireRunes, postesProbables, wilson } from '../api/stats/build.js';
import { classer } from '../api/stats/items.js';
import { suggerer } from '../api/stats/suggestions.js';

// --- Une partie au format de l'API Riot (match-v5 + timeline), réduite ---
const ITEMS = {
  data: {
    1055: { gold: { purchasable: true, total: 450 }, into: ['3071'], depth: 1, tags: ['Damage'] },
    2003: { gold: { purchasable: true, total: 50 }, tags: ['Consumable'] },
    3340: { gold: { purchasable: true, total: 0 }, tags: ['Trinket'] },
    1001: { gold: { purchasable: true, total: 300 }, into: ['3047'], tags: ['Boots'] },
    3047: { gold: { purchasable: true, total: 1200 }, depth: 2, tags: ['Boots', 'Armor'] },
    3071: { gold: { purchasable: true, total: 3000 }, depth: 3, tags: ['Damage'] },
    3053: { gold: { purchasable: true, total: 3000 }, depth: 3, tags: ['Health'] },
    6333: { gold: { purchasable: true, total: 3100 }, depth: 3, tags: ['Damage'] },
    3065: { gold: { purchasable: true, total: 2800 }, depth: 3, tags: ['Health'] },
    3067: { gold: { purchasable: true, total: 800 }, into: ['3065'], depth: 2, tags: ['Health'] },
  },
};
const items = classer(ITEMS);

const perks = (ks) => ({
  statPerks: { offense: 5008, flex: 5008, defense: 5011 },
  styles: [
    { style: 8000, selections: [8010, 9111, 9104, 8299].map((perk) => ({ perk })) },
    { style: 8400, selections: [8444, 8451].map((perk) => ({ perk })) },
  ],
  ...ks,
});

function participant(id, teamId, championId, pos, win) {
  return {
    participantId: id, teamId, championId, teamPosition: pos, win, perks: perks(), summoner1Id: 12, summoner2Id: 4,
    gameEndedInEarlySurrender: false,
  };
}
const POS = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
const match = {
  metadata: { matchId: 'EUW1_1' },
  info: {
    queueId: 420, gameVersion: '16.19.712.3190',
    participants: [
      ...POS.map((p, i) => participant(i + 1, 100, [875, 64, 61, 145, 412][i], p, true)),
      ...POS.map((p, i) => participant(i + 6, 200, [122, 234, 103, 222, 111][i], p, false)),
    ],
  },
};
const ev = (type, participantId, t, extra) => ({ type, participantId, timestamp: t, ...extra });
const timeline = {
  info: {
    frames: [
      { events: [
        ev('ITEM_PURCHASED', 1, 12_000, { itemId: 1055 }),
        ev('ITEM_PURCHASED', 1, 13_000, { itemId: 2003 }),
        ev('ITEM_PURCHASED', 1, 13_500, { itemId: 2003 }),
        ev('ITEM_UNDO', 1, 14_000, { beforeId: 2003, afterId: 0 }), // une potion annulée
        ev('ITEM_PURCHASED', 1, 15_000, { itemId: 3340 }), // bijou : ignoré
        ...['Q', 'W', 'E', 'Q', 'Q', 'R', 'Q', 'E', 'Q', 'E', 'R', 'E', 'E', 'W', 'W'].map((k, i) =>
          ev('SKILL_LEVEL_UP', 1, 60_000 + i * 60_000, { skillSlot: { Q: 1, W: 2, E: 3, R: 4 }[k], levelUpType: 'NORMAL' })),
      ] },
      { events: [
        ev('ITEM_PURCHASED', 1, 420_000, { itemId: 1001 }),
        ev('ITEM_PURCHASED', 1, 600_000, { itemId: 3071 }),
        ev('ITEM_PURCHASED', 1, 700_000, { itemId: 3047 }),
        ev('ITEM_PURCHASED', 1, 900_000, { itemId: 3053 }),
        ev('ITEM_PURCHASED', 1, 1_300_000, { itemId: 6333 }),
        ev('ITEM_PURCHASED', 1, 1_500_000, { itemId: 3065 }),
      ] },
    ],
  },
};

test('patch lu dans la version du jeu', () => {
  assert.equal(patchDe('16.19.712.3190'), '16.19');
});

test('achats dans l’ordre, annulation retirée', () => {
  assert.deepEqual(achats(timeline, 1).map((a) => a.id), [1055, 2003, 3340, 1001, 3071, 3047, 3053, 6333, 3065]);
});

test('ordre des compétences : celle montée au max en premier passe devant', () => {
  const s = montees(timeline, 1);
  assert.equal(s.slice(0, 3), 'QWE');
  assert.equal(ordreMax(s), 'QEW');
  assert.equal(ordreMax('QW'), null, 'partie trop courte');
});

test('clé de runes complète, ou rien', () => {
  assert.equal(cleRunes(perks()), '8000:8010,9111,9104,8299|8400:8444,8451|5008,5008,5011');
  assert.equal(cleRunes({ styles: [] }), null);
});

test('extraction d’une partie classée', () => {
  const { patch, queue, lignes } = extraire(match, timeline, items);
  assert.equal(patch, '16.19');
  assert.equal(queue, 420);
  const sett = lignes.filter((l) => l.champion_id === 875);
  const par = (k) => sett.filter((l) => l.kind === k).map((l) => l.key);
  assert.deepEqual(par('champ'), ['']);
  assert.deepEqual(par('spells'), ['4,12'], 'sorts triés : Flash sur D ou F compte pareil');
  assert.deepEqual(par('start'), ['1055,2003'], 'potion annulée et bijou exclus');
  assert.deepEqual(par('boots'), ['3047']);
  assert.deepEqual(par('core'), ['3071>3053>6333']);
  assert.deepEqual(par('item').sort(), ['3053', '3065', '3071', '6333']);
  assert.deepEqual(par('skillmax'), ['QEW']);
  assert.deepEqual(par('matchup'), ['122'], 'adversaire direct : Darius au top');
  assert.ok(sett.every((l) => l.wins === 1 && l.role === 'TOP'));
  // Rien qui identifie un joueur.
  assert.ok(lignes.every((l) => !('puuid' in l)));
});

test('un remake ne compte pas', () => {
  const r = structuredClone(match);
  r.info.participants.forEach((p) => (p.gameEndedInEarlySurrender = true));
  assert.equal(extraire(r, timeline, items), null);
});

test('ARAM : un seul rôle, pas de matchup', () => {
  const a = structuredClone(match);
  a.info.queueId = 450;
  a.info.participants.forEach((p) => (p.teamPosition = ''));
  const { lignes } = extraire(a, timeline, items);
  assert.ok(lignes.every((l) => l.role === 'ARAM'));
  assert.ok(!lignes.some((l) => l.kind === 'matchup'));
});

test('regrouper additionne les doublons', () => {
  const r = regrouper([
    { champion_id: 1, role: 'TOP', kind: 'x', key: 'a', games: 1, wins: 1 },
    { champion_id: 1, role: 'TOP', kind: 'x', key: 'a', games: 1, wins: 0 },
  ]);
  assert.deepEqual(r, [{ champion_id: 1, role: 'TOP', kind: 'x', key: 'a', games: 2, wins: 1 }]);
});

test('Wilson : plus de parties, plus de confiance', () => {
  assert.ok(wilson(7, 10) < wilson(70, 100));
  assert.ok(wilson(700, 1000) > 0.67 && wilson(700, 1000) < 0.7);
  assert.equal(wilson(0, 0), 0);
});

test('choisir ignore un winrate miraculeux sur trop peu de parties', () => {
  const opts = [
    { key: 'a', games: 800, wins: 424 }, // 53 % sur 800
    { key: 'b', games: 12, wins: 10 }, // 83 % sur 12
    { key: 'c', games: 300, wins: 150 }, // 50 %
  ];
  assert.equal(choisir(opts, 1112).key, 'a');
});

test('lireRunes remet les runes dans l’ordre du client', () => {
  const r = lireRunes('8000:8010,9111,9104,8299|8400:8444,8451|5008,5008,5011');
  assert.equal(r.primaryStyleId, 8000);
  assert.equal(r.subStyleId, 8400);
  assert.deepEqual(r.selectedPerkIds, [8010, 9111, 9104, 8299, 8444, 8451, 5008, 5008, 5011]);
});

test('construireBuild assemble tout', () => {
  const rows = [
    { kind: 'champ', key: '', games: 1000, wins: 520 },
    { kind: 'runes', key: '8000:8010,9111,9104,8299|8400:8444,8451|5008,5008,5011', games: 700, wins: 370 },
    { kind: 'runes', key: '8100:8112,8139,8138,8135|8000:9111,8014|5008,5008,5011', games: 300, wins: 150 },
    { kind: 'spells', key: '4,12', games: 900, wins: 470 },
    { kind: 'core', key: '3071>3053>6333', games: 300, wins: 170 },
    { kind: 'item', key: '3071', games: 900, wins: 470 },
    { kind: 'item', key: '3065', games: 200, wins: 110 },
    { kind: 'matchup', key: '122', games: 80, wins: 50 },
    { kind: 'matchup', key: '85', games: 60, wins: 22 },
  ];
  const b = construireBuild(rows);
  assert.equal(b.games, 1000);
  assert.equal(b.fiable, true);
  assert.equal(b.runes.primaryStyleId, 8000);
  assert.deepEqual(b.coeur.ids, [3071, 3053, 6333]);
  assert.deepEqual(b.situation.map((s) => s.id), [3065], 'un item du cœur n’est pas « de situation »');
  assert.equal(b.matchups.favorables[0].championId, 122);
  assert.equal(b.matchups.difficiles[0].championId, 85);
  assert.equal(construireBuild([]).fiable, false);
});

test('postes probables des adversaires', () => {
  const roles = {
    122: { TOP: 0.9, JUNGLE: 0.1 }, 234: { JUNGLE: 0.95 }, 103: { MIDDLE: 0.97 },
    222: { BOTTOM: 0.98 }, 111: { UTILITY: 0.9, JUNGLE: 0.1 },
  };
  assert.deepEqual(postesProbables([111, 222, 103, 234, 122], roles), { 122: 'TOP', 234: 'JUNGLE', 103: 'MIDDLE', 222: 'BOTTOM', 111: 'UTILITY' });
});

test('suggestions : le bon matchup passe devant, les bannis disparaissent', () => {
  const base = { 875: { games: 2000, wins: 1010, part: 0.9 }, 85: { games: 1500, wins: 765, part: 0.8 }, 133: { games: 800, wins: 400, part: 0.7 } };
  const duels = { 85: { games: 120, wins: 78 }, 875: { games: 200, wins: 90 } };
  const s = suggerer({
    role: 'TOP', face: 122, exclus: [133],
    pool: [{ championId: 875, points: 90_000 }, { championId: 85, points: 5_000 }, { championId: 133, points: 40_000 }],
    base, duels,
  });
  assert.equal(s[0].championId, 85);
  assert.ok(s[0].raisons.some((r) => r.type === 'contre' && r.championId === 122));
  assert.ok(!s.some((x) => x.championId === 133));
  assert.ok(s.every((x) => x.note >= 0 && x.note <= 100));
});

test('suggestions ARAM : on classe le banc', () => {
  const base = { 222: { games: 3000, wins: 1620 }, 875: { games: 2500, wins: 1175 } };
  const s = suggerer({ role: 'ARAM', banc: [875, 222], base });
  assert.deepEqual(s.map((x) => x.championId), [222, 875]);
});
