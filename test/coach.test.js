import { test } from 'node:test';
import assert from 'node:assert/strict';
import { choisirFocus, FICHES, habitudes, MIN_PARTIES, tenu } from '../api/coach.js';
import { MESURES, tranche } from '../api/stats/reperes.js';

// Un rang où la vision par minute tourne autour de 1,0 et les morts autour de
// 5 par 30 min (1 000 joueurs mesurés).
function histo(mesure, centre, etalement) {
  const h = new Map();
  for (let i = 0; i < 1000; i++) {
    const v = centre + ((i % 21) - 10) / 10 * etalement;
    const t = tranche(mesure, v);
    h.set(t, (h.get(t) ?? 0) + 1);
  }
  return [...h].map(([t, games]) => ({ tranche: t, games }));
}
const HISTOS = { vision: histo('vision', 1.0, 0.5), morts: histo('morts', 5, 3) };
const partie = (vision, morts) => ({ valeurs: { vision, morts } });

test('habitude : souvent dans le bas de son rang', () => {
  // 10 parties à 0,5 de vision par minute : une habitude, pas un accident.
  const parties = Array.from({ length: 10 }, () => partie(0.5, 5));
  const h = habitudes(parties, HISTOS, 'UTILITY');
  assert.ok(h.vision.position > 0.75, `position ${h.vision.position}`);
  assert.equal(h.vision.souvent, 10);
  assert.ok(Math.abs(h.vision.cible - 1.0) < 0.11, `cible ${h.vision.cible}`);
  assert.equal(choisirFocus(h), 'vision');
});

test('une mauvaise partie isolée ne fait pas un focus', () => {
  const parties = [partie(0.2, 14), ...Array.from({ length: 9 }, () => partie(1.2, 4))];
  const h = habitudes(parties, HISTOS, 'UTILITY');
  assert.equal(choisirFocus(h), null);
});

test('pas de conclusion sous le minimum de parties', () => {
  const h = habitudes(Array.from({ length: MIN_PARTIES - 1 }, () => partie(0.3, 12)), HISTOS, 'UTILITY');
  assert.deepEqual(h, {});
});

test('focus : le plus coûteux, sauf celui qu’on vient de valider', () => {
  const parties = Array.from({ length: 10 }, () => partie(0.6, 11));
  const h = habitudes(parties, HISTOS, 'UTILITY');
  const premier = choisirFocus(h);
  assert.ok(['vision', 'morts'].includes(premier));
  assert.equal(choisirFocus(h, [premier]), premier === 'vision' ? 'morts' : 'vision');
});

test('objectif tenu, selon le sens de la mesure', () => {
  assert.equal(tenu('vision', 1.2, 1.0), true);
  assert.equal(tenu('vision', 0.8, 1.0), false);
  assert.equal(tenu('morts', 4, 5), true, 'moins de morts que la cible = tenu');
  assert.equal(tenu('morts', 7, 5), false);
});

test('chaque mesure a sa fiche : titre, conseil, objectif en clair', () => {
  for (const m of Object.keys(MESURES)) {
    assert.ok(FICHES[m]?.titre && FICHES[m].conseil, m);
    assert.equal(typeof FICHES[m].unite(1), 'string');
  }
  assert.equal(FICHES.vision.unite(1.1), '1,1 de vision par minute');
});
