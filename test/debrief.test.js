import { test } from 'node:test';
import assert from 'node:assert/strict';
import { construireDebrief, phraseDebrief, scoreDepuisRounds } from '../src/services/debrief.js';

/**
 * Ligne match_players d'un joueur, telle qu'elle sort de la base.
 * Valeurs par defaut « moyennes » ; on ne surcharge que ce que le test regarde.
 */
const joueur = (puuid, sur = {}) => ({
  puuid, tierId: 17, rounds: 24, morts: 16,
  mortsPrecoces: 5, mortsApresPlant: 3, ouvertures: 2,
  mortsPositionnelles: 15, mortsIsolees: 5, mortsNonTradables: 10,
  degatsInfliges: 24 * 150, degatsRecus: 24 * 150,
  tirs: 90, headshots: 22,
  ...sur,
});

/** Neuf adversaires ordinaires, plus le joueur suivi. */
const partie = (moi) => [moi, ...Array.from({ length: 9 }, (_, i) => joueur(`autre-${i}`))];

test('le constat le plus net sort en premier', () => {
  // Il encaisse le double des autres : c'est ca qu'on doit lire d'abord.
  const moi = joueur('moi', { degatsRecus: 24 * 300 });
  const { constats } = construireDebrief({ mesures: partie(moi), puuid: 'moi' });

  assert.ok(constats.length > 0);
  assert.equal(constats[0].cle, 'degats_recus');
  assert.equal(constats[0].valeur, 300);
  assert.equal(constats[0].medianeMatch, 150);
  assert.equal(constats[0].pire, 0, 'personne n’a fait pire');
});

test('trois constats au maximum', () => {
  const moi = joueur('moi', {
    degatsRecus: 24 * 300, ouvertures: 9, mortsIsolees: 13,
    mortsNonTradables: 14, mortsPrecoces: 12, headshots: 5,
  });
  const { constats } = construireDebrief({ mesures: partie(moi), puuid: 'moi' });
  assert.equal(constats.length, 3);
});

test('un joueur meilleur que la moitie du serveur ne recoit aucun reproche', () => {
  // Le point qui empeche le debrief de devenir un reproche automatique : une
  // bonne partie doit pouvoir ne rien produire du tout.
  const moi = joueur('moi', {
    degatsRecus: 24 * 80, degatsInfliges: 24 * 260,
    ouvertures: 0, mortsIsolees: 0, mortsNonTradables: 1,
    mortsPrecoces: 0, mortsApresPlant: 0, headshots: 45,
  });
  const { constats } = construireDebrief({ mesures: partie(moi), puuid: 'moi' });
  assert.deepEqual(constats, []);
});

test('un axe trop maigre sur cette partie est ecarte', () => {
  // Deux morts positionnelles, c'est 0 % ou 50 % selon un seul evenement.
  const moi = joueur('moi', { mortsPositionnelles: 2, mortsIsolees: 2, morts: 2 });
  const { constats } = construireDebrief({ mesures: partie(moi), puuid: 'moi' });
  assert.ok(!constats.some((c) => c.cle === 'isolement'), 'isolement doit être écarté');
});

test('sans adversaires comparables, on ne conclut rien', () => {
  // Comparer un joueur a deux personnes, ce n'est pas comparer.
  const moi = joueur('moi', { degatsRecus: 24 * 300 });
  const mesures = [moi, joueur('a'), joueur('b')];
  const { constats } = construireDebrief({ mesures, puuid: 'moi' });
  assert.deepEqual(constats, []);
});

test('un joueur absent de la partie ne produit rien', () => {
  const r = construireDebrief({ mesures: partie(joueur('moi')), puuid: 'inconnu' });
  assert.deepEqual(r.constats, []);
  assert.equal(r.joueurs, 0);
});

test('l’habitude accompagne le constat quand on la connait', () => {
  // C'est elle qui distingue « mauvaise partie » de « son niveau ».
  const moi = joueur('moi', { degatsRecus: 24 * 300 });
  const { constats } = construireDebrief({
    mesures: partie(moi), puuid: 'moi',
    habitude: { degatsRecusParRound: 165 },
  });
  const c = constats.find((x) => x.cle === 'degats_recus');
  assert.equal(c.habitude, 165);
  assert.equal(c.ecartHabitude, 135);
});

test('sans habitude connue, le constat tient quand meme', () => {
  const moi = joueur('moi', { degatsRecus: 24 * 300 });
  const { constats } = construireDebrief({ mesures: partie(moi), puuid: 'moi' });
  const c = constats.find((x) => x.cle === 'degats_recus');
  assert.equal(c.habitude, null);
  assert.equal(c.ecartHabitude, null);
});

test('la phrase dit la valeur, la reference, le rang et l’ecart', () => {
  const moi = joueur('moi', { degatsRecus: 24 * 300 });
  const { constats } = construireDebrief({
    mesures: partie(moi), puuid: 'moi',
    habitude: { degatsRecusParRound: 165 },
  });
  const p = phraseDebrief(constats[0]);
  assert.match(p, /300 contre 150 pour les autres/);
  assert.match(p, /1er sur 10/);
  assert.match(p, /\+135 par rapport à ton habitude/);
});

test('le nombre de joueurs de la partie est rendu', () => {
  const r = construireDebrief({ mesures: partie(joueur('moi')), puuid: 'moi' });
  assert.equal(r.joueurs, 10);
});

/* --- Le score reconstitue -------------------------------------------------- */

test('le score se deduit du nombre de rounds en temps reglementaire', () => {
  // La vraie partie du 4 septembre : 23 rounds, gagnee. C'etait 13-10.
  assert.deepEqual(scoreDepuisRounds(23, true), { nous: 13, eux: 10 });
  assert.deepEqual(scoreDepuisRounds(23, false), { nous: 10, eux: 13 });
  assert.deepEqual(scoreDepuisRounds(13, true), { nous: 13, eux: 0 });
  assert.deepEqual(scoreDepuisRounds(24, true), { nous: 13, eux: 11 });
});

test('la prolongation se joue par paires', () => {
  assert.deepEqual(scoreDepuisRounds(26, true), { nous: 14, eux: 12 });
  assert.deepEqual(scoreDepuisRounds(28, false), { nous: 13, eux: 15 });
});

test('un nombre de rounds impossible ne produit pas de score invente', () => {
  for (const mauvais of [null, undefined, 0, 5, NaN, 'vingt-trois']) {
    assert.equal(scoreDepuisRounds(mauvais, true), null);
  }
  assert.equal(scoreDepuisRounds(23, null), null, 'sans issue connue, pas de score');
});

test('un nombre rendu sous forme de chaine reste accepte', () => {
  // Le pilote Postgres rend certaines colonnes numeriques en texte : refuser
  // '23' ferait disparaitre le score en production sans rien casser en test.
  assert.deepEqual(scoreDepuisRounds('23', true), { nous: 13, eux: 10 });
});
