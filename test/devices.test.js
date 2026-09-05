import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  genererCode, normaliserCode, genererJeton, empreinte, memeEmpreinte,
  decisionVerification, MESSAGES_VERIFICATION, codeUtilisable,
} from '../src/services/devices.js';

/* --- Le code d'appairage -------------------------------------------------- */

test('le code evite les caracteres qui se lisent de travers', () => {
  // O/0, I/1 et S/5 sont exclus : un code recopie a la main ne doit pas obliger
  // a en regenerer un a chaque faute de lecture.
  const codes = Array.from({ length: 400 }, genererCode).join('');
  for (const interdit of ['O', '0', 'I', '1', 'S', '5']) {
    assert.ok(!codes.includes(interdit), `${interdit} ne doit pas apparaitre`);
  }
  assert.match(genererCode(), /^[A-Z2-9]{6}$/);
});

test('les codes ne se repetent pas', () => {
  const vus = new Set(Array.from({ length: 500 }, genererCode));
  assert.ok(vus.size > 495, `trop de collisions : ${vus.size}/500`);
});

test('la saisie est tolerante', () => {
  assert.equal(normaliserCode('ab2-cd 3'), 'AB2CD3');
  assert.equal(normaliserCode('  x9y8z7  '), 'X9Y8Z7');
  assert.equal(normaliserCode(null), '');
});

/* --- Le jeton d'appareil -------------------------------------------------- */

test('le jeton est long et imprevisible', () => {
  const jetons = new Set(Array.from({ length: 200 }, genererJeton));
  assert.equal(jetons.size, 200);
  assert.ok(genererJeton().length >= 40);
});

test("seule l'empreinte du jeton est stockable", () => {
  const j = genererJeton();
  const e = empreinte(j);
  assert.match(e, /^[0-9a-f]{64}$/);
  assert.ok(!e.includes(j), "l'empreinte ne doit pas contenir le jeton");
  assert.equal(empreinte(j), e, 'la même entrée donne la même empreinte');
  assert.notEqual(empreinte(genererJeton()), e);
});

test('la comparaison d’empreintes ne se laisse pas approcher', () => {
  const e = empreinte('abc');
  assert.equal(memeEmpreinte(e, empreinte('abc')), true);
  assert.equal(memeEmpreinte(e, empreinte('abd')), false);
  // Longueurs differentes : refus, sans lever.
  assert.equal(memeEmpreinte(e, 'court'), false);
  assert.equal(memeEmpreinte(null, undefined), true);
});

/* --- La validite d'un code ------------------------------------------------ */

const dans = (minutes) => new Date(Date.now() + minutes * 60_000).toISOString();

test('un code frais est utilisable', () => {
  assert.equal(codeUtilisable({ expires_at: dans(5), used_at: null }), true);
});

test('un code expire ou deja utilise ne vaut rien', () => {
  assert.equal(codeUtilisable({ expires_at: dans(-1), used_at: null }), false);
  assert.equal(codeUtilisable({ expires_at: dans(5), used_at: new Date().toISOString() }), false);
  assert.equal(codeUtilisable(null), false);
});

/* --- La verification du compte, le coeur de la brique --------------------- */

const PUUID = '274cbb77-27ef-5f4c-b026-8e2f3c93f5f8';

test('un puuid local identique au compte declare vaut preuve', () => {
  assert.equal(decisionVerification({ puuidLocal: PUUID, puuidLie: PUUID }), 'verifie');
});

test('un puuid different ne verifie rien et ne rebranche rien', () => {
  // Le point sensible : quelqu'un peut jouer sur un second compte, ou s'etre
  // trompe de Riot ID. Rebasculer tout seul est le bug que la brique 4 a repare.
  const d = decisionVerification({ puuidLocal: 'autre-puuid', puuidLie: PUUID });
  assert.equal(d, 'autre_compte');
  assert.match(MESSAGES_VERIFICATION[d], /Rien n'a été modifié/);
});

test('sans compte declare, on appaire mais on ne verifie pas', () => {
  assert.equal(decisionVerification({ puuidLocal: PUUID, puuidLie: null }), 'aucun_compte');
});

test('sans client Riot ouvert, la verification est simplement reportee', () => {
  const d = decisionVerification({ puuidLocal: null, puuidLie: PUUID });
  assert.equal(d, 'sans_puuid');
  assert.match(MESSAGES_VERIFICATION[d], /n'était pas ouvert/);
});

test('chaque decision a un message pour l’utilisateur', () => {
  for (const d of ['verifie', 'autre_compte', 'aucun_compte', 'sans_puuid']) {
    assert.equal(typeof MESSAGES_VERIFICATION[d], 'string');
    assert.ok(MESSAGES_VERIFICATION[d].length > 30, d);
  }
});
