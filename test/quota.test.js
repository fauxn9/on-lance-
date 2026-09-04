import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { verifierQuota, consommerQuota, viderQuota } from '../src/services/quota.js';

const MAX = 3;
const FENETRE = 30 * 60_000;
const opts = (maintenant) => ({ max: MAX, fenetreMs: FENETRE, maintenant });

beforeEach(viderQuota);

test('les trois premieres questions passent, la quatrieme est refusee', () => {
  const t = 1_000_000;
  for (let i = 0; i < MAX; i += 1) {
    const q = verifierQuota('u', opts(t));
    assert.equal(q.autorise, true, `question ${i + 1} refusee a tort`);
    assert.equal(q.restantes, MAX - i);
    consommerQuota('u', { maintenant: t });
  }
  assert.equal(verifierQuota('u', opts(t)).autorise, false);
});

test("l'attente annoncee est celle qui libere la premiere place", () => {
  const t = 1_000_000;
  // Trois questions espacees de cinq minutes.
  for (let i = 0; i < MAX; i += 1) consommerQuota('u', { maintenant: t + i * 5 * 60_000 });

  const q = verifierQuota('u', opts(t + 10 * 60_000));
  assert.equal(q.autorise, false);
  // La plus ancienne date de 10 min : il reste 20 min avant qu'elle sorte.
  assert.equal(Math.round(q.reprendDansMs / 60_000), 20);
});

test('la fenetre glisse : une place se libere sans tout remettre a zero', () => {
  const t = 1_000_000;
  consommerQuota('u', { maintenant: t });
  consommerQuota('u', { maintenant: t + 20 * 60_000 });
  consommerQuota('u', { maintenant: t + 25 * 60_000 });

  assert.equal(verifierQuota('u', opts(t + 26 * 60_000)).autorise, false);

  // A t+31, la premiere est sortie de la fenetre : une seule place, pas trois.
  const q = verifierQuota('u', opts(t + 31 * 60_000));
  assert.equal(q.autorise, true);
  assert.equal(q.restantes, 1);
});

test('le quota est par personne', () => {
  const t = 1_000_000;
  for (let i = 0; i < MAX; i += 1) consommerQuota('a', { maintenant: t });

  assert.equal(verifierQuota('a', opts(t)).autorise, false);
  assert.equal(verifierQuota('b', opts(t)).autorise, true, "le quota de a ne doit pas toucher b");
});

test('verifier ne consomme rien par lui-meme', () => {
  const t = 1_000_000;
  for (let i = 0; i < 10; i += 1) verifierQuota('u', opts(t));
  assert.equal(verifierQuota('u', opts(t)).restantes, MAX);
});

test('un quota releve prend effet immediatement', () => {
  // C'est ce qui permet d'ouvrir les vannes via CHAT_MAX sans redeployer de code.
  const t = 1_000_000;
  for (let i = 0; i < MAX; i += 1) consommerQuota('u', { maintenant: t });

  assert.equal(verifierQuota('u', opts(t)).autorise, false);
  assert.equal(verifierQuota('u', { max: 10, fenetreMs: FENETRE, maintenant: t }).autorise, true);
});

test('les horodatages sortis de la fenetre ne sont pas gardes en memoire', () => {
  const t = 1_000_000;
  consommerQuota('u', { maintenant: t });
  // Bien apres : l'entree doit disparaitre plutot que de grossir indefiniment.
  const q = verifierQuota('u', opts(t + 10 * FENETRE));
  assert.equal(q.restantes, MAX);
});
