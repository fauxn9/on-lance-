import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lignesMayhem, valider } from '../api/stats/mayhem.js';
import { classerAugments } from '../api/stats/build.js';

// Une partie telle que l'app l'envoie (lue dans l'historique du client).
const partie = (modif = {}) => ({
  gameId: 7998740078, plateforme: 'EUW1', version: '16.19.823.722', duree: 1047,
  joueurs: [53, 74, 12, 63, 18, 59, 54, 3, 202, 267].map((championId, i) => ({
    championId, equipe: i < 5 ? 100 : 200, victoire: i < 5, augments: i === 8 ? [1154, 1047, 1356, 1211] : [1001, 1002],
  })),
  ...modif,
});

test('une partie Mayhem valide est normalisée', () => {
  const p = valider(partie());
  assert.equal(p.patch, '16.19');
  assert.equal(p.joueurs.length, 10);
  assert.deepEqual(p.joueurs[8].augments, [1154, 1047, 1356, 1211]);
});

test('les parties incohérentes sont refusées', () => {
  assert.equal(valider(partie({ duree: 200 })), null, 'remake');
  assert.equal(valider(partie({ joueurs: partie().joueurs.slice(0, 9) })), null, 'neuf joueurs');
  const deuxGagnants = partie();
  deuxGagnants.joueurs[7].victoire = true;
  assert.equal(valider(deuxGagnants), null, 'deux équipes gagnantes');
  const sixBleus = partie();
  sixBleus.joueurs[5].equipe = 100;
  assert.equal(valider(sixBleus), null, 'six contre quatre');
  assert.equal(valider(partie({ plateforme: 'euw1; drop table' })), null);
  assert.equal(valider({ ...partie(), gameId: '12' }), null);
});

test('chaque joueur donne son champion et ses augments, sans pseudo', () => {
  const lignes = lignesMayhem(valider(partie()));
  const jhin = lignes.filter((l) => l.champion_id === 202);
  assert.equal(jhin.filter((l) => l.kind === 'champ').length, 1);
  assert.deepEqual(jhin.filter((l) => l.kind === 'augment').map((l) => l.key), ['1154', '1047', '1356', '1211']);
  assert.ok(jhin.every((l) => l.wins === 0 && l.role === 'ARAM'));
  assert.ok(lignes.every((l) => !('puuid' in l) && !('pseudo' in l)));
});

test('objets finaux et sorts, quand l’app les envoie', () => {
  const p = partie();
  p.joueurs[8] = { ...p.joueurs[8], items: [6676, 2523, 3031, 3036, 3006, 6696], sorts: [6, 4] };
  const objets = { complets: new Set([6676, 3031, 3036, 6696]), bottes: new Set([3006]) };
  const jhin = lignesMayhem(valider(p), objets).filter((l) => l.champion_id === 202);
  const cles = (kind) => jhin.filter((l) => l.kind === kind).map((l) => l.key);
  assert.deepEqual(cles('item'), ['6676', '3031', '3036', '6696']);
  assert.deepEqual(cles('core'), ['6676>3031>3036'], 'les trois premiers objets complets, dans l’ordre des cases');
  assert.deepEqual(cles('boots'), ['3006']);
  assert.deepEqual(cles('spells'), ['4,6']);
  // Une app 0.3.1 (sans objets) reste acceptée.
  assert.equal(lignesMayhem(valider(partie()), objets).filter((l) => l.kind === 'item').length, 0);
});

test('un augment beaucoup joué passe devant un coup de chance', () => {
  const rows = [
    { kind: 'champ', key: '', games: 1000, wins: 500 },
    { kind: 'augment', key: '1', games: 300, wins: 170 }, // 56,7 % sur 300 parties
    { kind: 'augment', key: '2', games: 3, wins: 3 }, // 100 % sur 3 parties
    { kind: 'augment', key: '3', games: 200, wins: 80 }, // 40 %
    { kind: 'augment', key: '4', games: 2, wins: 2 }, // trop peu joué : ignoré
  ];
  const a = classerAugments(rows);
  assert.deepEqual(a.map((x) => x.id), [1, 2, 3]);
  assert.deepEqual(a.map((x) => x.tier), ['S', 'A', 'B']);
  assert.ok(Math.abs(a[0].pickrate - 0.3) < 1e-9);
});
