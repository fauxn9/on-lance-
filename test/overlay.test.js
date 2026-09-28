import { test } from 'node:test';
import assert from 'node:assert/strict';
import { competenceAMonter, ecartOr, milliers, objectifs, prochainsAchats } from '../app/src/lib/overlay/calculs.js';

test('dragon : 5:00 au début, +5 min après chaque dragon, ancien après une âme', () => {
  assert.deepEqual(objectifs([], 'ORDER').dragon, { genre: 'dragon', apparition: 300 });
  const d = (temps, equipe, element = 'Fire') => ({ genre: 'dragon', temps, equipe, element });
  const o = objectifs([d(310, 'ORDER'), d(700, 'CHAOS', 'Water')], 'ORDER');
  assert.deepEqual(o.dragon, { genre: 'dragon', apparition: 1000 });
  assert.deepEqual(o.compte, { nous: ['Fire'], eux: ['Water'] });
  assert.equal(o.baron, null, 'pas de baron avant le premier tué');
  const ame = objectifs([d(300, 'ORDER'), d(700, 'ORDER'), d(1100, 'ORDER'), d(1500, 'ORDER')], 'ORDER');
  assert.equal(ame.ame, 'nous');
  assert.deepEqual(ame.dragon, { genre: 'ancien', apparition: 1860 });
  const apresAncien = objectifs([{ genre: 'ancien', temps: 2000, equipe: 'CHAOS' }, { genre: 'baron', temps: 1500, equipe: 'ORDER' }], 'ORDER');
  assert.deepEqual(apresAncien.dragon, { genre: 'ancien', apparition: 2360 });
  assert.deepEqual(apresAncien.baron, { genre: 'baron', apparition: 1860 });
});

test('écart d’or : équipe et adversaire direct', () => {
  const j = [
    { equipe: 'ORDER', poste: 'TOP', valeur: 4000, moi: true }, { equipe: 'ORDER', poste: 'MIDDLE', valeur: 3000 },
    { equipe: 'CHAOS', poste: 'TOP', champion: 'Darius', valeur: 4500 }, { equipe: 'CHAOS', poste: 'MIDDLE', valeur: 2000 },
  ];
  assert.deepEqual(ecartOr(j), { nous: 7000, eux: 6500, ecart: 500, duel: { champion: 'Darius', ecart: -500 } });
  assert.equal(ecartOr([{ equipe: 'ORDER', valeur: 1 }]), null, 'sans « moi », rien');
});

test('compétence : ultime d’abord, départ du build, puis montée au max', () => {
  const ordre = { max: 'QEW', debut: 'QWE' };
  assert.equal(competenceAMonter(1, [0, 0, 0, 0], ordre), 'Q');
  assert.equal(competenceAMonter(2, [1, 0, 0, 0], ordre), 'W');
  assert.equal(competenceAMonter(3, [1, 1, 0, 0], ordre), 'E');
  assert.equal(competenceAMonter(4, [1, 1, 1, 0], ordre), 'Q');
  assert.equal(competenceAMonter(6, [3, 1, 1, 0], ordre), 'R');
  assert.equal(competenceAMonter(7, [3, 1, 1, 1], ordre), 'Q');
  assert.equal(competenceAMonter(8, [4, 1, 1, 1], ordre), 'E', 'Q plafonné à 4 au niveau 8');
  assert.equal(competenceAMonter(7, [4, 1, 1, 1], ordre), null, 'aucun point à dépenser');
  assert.equal(competenceAMonter(3, [1, 1, 0, 0], null), null, 'sans build, pas de conseil');
});

test('prochain achat : ordre du build, bottes une fois, adapté à la compo', () => {
  const items = {
    1: { t: ['Damage'] }, 2: { t: ['Damage'] }, 3: { t: ['Damage'] }, 10: { t: ['Boots'] }, 11: { t: ['Boots', 'Armor'] },
    20: { t: ['Damage'] }, 21: { t: ['Armor'] }, 22: { t: ['SpellBlock'] },
  };
  const build = { coeur: { ids: [1, 2, 3] }, bottes: { id: 10 }, situation: [{ id: 20 }, { id: 21 }, { id: 22 }] };
  assert.deepEqual(prochainsAchats(build, [], items, 0.5).suivants, [1, 10, 2]);
  assert.deepEqual(prochainsAchats(build, [1, 11], items, 0.5).suivants, [2, 3, 20], 'd’autres bottes suffisent');
  const physique = prochainsAchats(build, [1, 2, 3, 10], items, 0.8);
  assert.deepEqual(physique.suivants, [21, 20, 22]);
  assert.match(physique.raison, /physiques/);
  assert.deepEqual(prochainsAchats(build, [1, 2, 3, 10], items, 0.3).suivants, [22, 20, 21]);
  assert.equal(prochainsAchats(null, [], items, 0.5), null);
});

test('milliers signés', () => {
  assert.equal(milliers(1840), '+1,8 k');
  assert.equal(milliers(-450), '−450');
  assert.equal(milliers(0), '0');
});
