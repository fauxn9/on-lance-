// Test d'intégration contre la vraie base (npm run test:db).
// Écrit sous un faux patch « test.0 » et nettoie derrière lui.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { query, db } from '../api/db.js';
import { ecrire } from '../api/stats/crawler.js';

const PATCH = 'test.0';
after(async () => {
  await query('delete from stats where patch = $1', [PATCH]);
  await db().end();
});

test('ecrire additionne les compteurs, partie après partie', async () => {
  await query('delete from stats where patch = $1', [PATCH]);
  const partie = (win) => ({
    patch: PATCH, queue: 420,
    lignes: [
      { champion_id: 875, role: 'TOP', kind: 'champ', key: '', games: 1, wins: win },
      { champion_id: 875, role: 'TOP', kind: 'item', key: '3071', games: 1, wins: win },
      { champion_id: 875, role: 'TOP', kind: 'item', key: '3071', games: 1, wins: win }, // doublon dans la même partie
    ],
  });
  await ecrire(partie(1));
  await ecrire(partie(0));
  const { rows } = await query(
    'select kind, key, games, wins from stats where patch = $1 order by champion_id, kind, key',
    [PATCH],
  );
  const par = Object.fromEntries(rows.map((r) => [`${r.kind}:${r.key}`, [r.games, r.wins]]));
  assert.deepEqual(par['champ:'], [2, 1]);
  assert.deepEqual(par['item:3071'], [4, 2]);
  assert.deepEqual(par['matches:'], [2, 0], 'une ligne « matches » par partie');
});
