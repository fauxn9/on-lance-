import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DELAIS_MS, MAX_EVENEMENTS, nettoyerEvenements, contientUneFin, creerRelanceur,
} from '../src/services/relance.js';

const silence = { log() {}, error() {} };

/** Attente instantanee qui note ce qu'on lui a demande d'attendre. */
function fauxDelais() {
  const vus = [];
  return { vus, attendre: async (ms) => { vus.push(ms); } };
}

/* --- Ce qu'on accepte d'un client ----------------------------------------- */

test('seuls les types connus passent', () => {
  const propres = nettoyerEvenements([
    { type: 'fin' }, { type: 'FIN' }, { type: 'inconnu' },
    { type: 42 }, null, 'fin', {},
  ]);
  assert.deepEqual(propres, [{ type: 'fin' }, { type: 'fin' }]);
});

test('le lot est borne', () => {
  // Le jeton d'appareil identifie une personne, pas un programme de confiance :
  // rien ne garantit que ce qui arrive vienne bien de notre application.
  const enorme = Array.from({ length: 500 }, () => ({ type: 'debut' }));
  assert.equal(nettoyerEvenements(enorme).length, MAX_EVENEMENTS);
});

test('un corps absurde ne fait pas tomber le serveur', () => {
  for (const brut of [null, undefined, 'fin', 42, { type: 'fin' }]) {
    assert.deepEqual(nettoyerEvenements(brut), []);
  }
});

test('on ne garde que le type, rien d’autre', () => {
  // Le score et la map arrivent du client : on ne s'en sert pas, donc on ne
  // les recopie pas. Ce qui compte, c'est le match reellement publie par l'API.
  const [e] = nettoyerEvenements([{ type: 'fin', score: { nous: 13 }, mapCode: 'Triad' }]);
  assert.deepEqual(Object.keys(e), ['type']);
});

test('contientUneFin repere la fin de partie dans le lot', () => {
  assert.equal(contientUneFin([{ type: 'debut' }, { type: 'fin' }]), true);
  assert.equal(contientUneFin([{ type: 'debut' }, { type: 'esquive' }]), false);
  assert.equal(contientUneFin([]), false);
  assert.equal(contientUneFin(null), false);
});

/* --- Les tentatives -------------------------------------------------------- */

test('on s’arrete des qu’un match est trouve', async () => {
  const { vus, attendre } = fauxDelais();
  let appels = 0;
  const r = creerRelanceur({
    attendre,
    journal: silence,
    executer: async () => { appels += 1; return appels === 2 ? 1 : 0; },
  });

  r.declencher(8);
  await new Promise((res) => setImmediate(res));

  assert.equal(appels, 2, 'deux tentatives, pas plus');
  assert.deepEqual(vus, [DELAIS_MS[0], DELAIS_MS[1]]);
});

test('les tentatives s’espacent', async () => {
  const { vus, attendre } = fauxDelais();
  const r = creerRelanceur({ attendre, journal: silence, executer: async () => 0 });

  r.declencher(8);
  await new Promise((res) => setImmediate(res));

  assert.deepEqual(vus, DELAIS_MS);
  // Elles doivent bien aller croissant, sinon l'espacement ne sert a rien.
  assert.deepEqual([...DELAIS_MS].sort((a, b) => a - b), DELAIS_MS);
});

test('une tentative en echec n’annule pas les suivantes', async () => {
  // L'API peut etre indisponible une minute et revenir.
  const { attendre } = fauxDelais();
  let appels = 0;
  const r = creerRelanceur({
    attendre,
    journal: silence,
    executer: async () => {
      appels += 1;
      if (appels === 1) throw new Error('API indisponible');
      return appels === 3 ? 1 : 0;
    },
  });

  r.declencher(8);
  await new Promise((res) => setImmediate(res));
  assert.equal(appels, 3);
});

test('une seule serie par personne a la fois', async () => {
  // Sans ce garde-fou, un PC qui repete son battement — ou deux PC appairés au
  // meme compte — doubleraient les appels a l'API.
  const { attendre } = fauxDelais();
  let appels = 0;
  const r = creerRelanceur({
    attendre, journal: silence, executer: async () => { appels += 1; return 0; },
  });

  assert.equal(r.declencher(8), true);
  assert.equal(r.declencher(8), false, 'la deuxieme demande est ignoree');
  assert.deepEqual([...r.enCours()], [8]);

  await new Promise((res) => setImmediate(res));
  assert.equal(appels, DELAIS_MS.length, 'une seule serie a tourne');
});

test('deux personnes differentes ne se bloquent pas', async () => {
  const { attendre } = fauxDelais();
  const r = creerRelanceur({ attendre, journal: silence, executer: async () => 0 });
  assert.equal(r.declencher(8), true);
  assert.equal(r.declencher(9), true);
  assert.equal(r.enCours().size, 2);
  await new Promise((res) => setImmediate(res));
});

test('la serie se libere a la fin, meme si tout a echoue', async () => {
  const { attendre } = fauxDelais();
  const r = creerRelanceur({
    attendre, journal: silence, executer: async () => { throw new Error('KO'); },
  });

  r.declencher(8);
  await new Promise((res) => setImmediate(res));
  assert.equal(r.enCours().size, 0, 'sinon la personne ne serait plus jamais relancee');
});

test('sans identifiant, on ne declenche rien', async () => {
  const r = creerRelanceur({ journal: silence, executer: async () => 0 });
  assert.equal(r.declencher(null), false);
  assert.equal(r.declencher(undefined), false);
});

test('la tentative qui a marche est ecrite dans le journal', async () => {
  // C'est la mesure : au bout de quelques soirees, on saura combien de temps
  // HenrikDev met a publier un match, et on pourra resserrer les delais.
  const { attendre } = fauxDelais();
  const lignes = [];
  let appels = 0;
  const r = creerRelanceur({
    attendre,
    journal: { log: (m) => lignes.push(m), error() {} },
    executer: async () => { appels += 1; return appels === 3 ? 2 : 0; },
  });

  r.declencher(8);
  await new Promise((res) => setImmediate(res));

  assert.equal(lignes.length, 1);
  assert.match(lignes[0], /2 match\(s\)/);
  assert.match(lignes[0], /tentative 3\/5/);
  assert.match(lignes[0], /\+60s/);
});
