import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wrap } from '../src/services/http.js';

/* Faux objets Express, reduits a ce que wrap() touche. */
const faussesReponses = () => {
  const res = {
    code: null, corps: null, headersSent: false,
    status(c) { res.code = c; return res; },
    json(o) { res.corps = o; res.headersSent = true; return res; },
  };
  return res;
};

const attendre = () => new Promise((r) => setImmediate(r));

test('wrap transmet next : une barriere doit pouvoir laisser passer', async () => {
  // Le bug reel : wrap ne passait que (req, res). `next` valait undefined dans
  // requireMember, et toutes les pages de groupe repondaient en 500
  // « next is not a function ».
  let passe = false;
  const barriere = wrap(async (_req, _res, next) => { next(); });

  await barriere({}, faussesReponses(), () => { passe = true; });
  await attendre();

  assert.equal(passe, true);
});

test('wrap laisse une barriere refuser sans appeler next', async () => {
  let passe = false;
  const res = faussesReponses();
  const barriere = wrap(async (_req, r, _next) => {
    r.status(403).json({ error: "Tu n'es pas membre de ce groupe" });
  });

  await barriere({}, res, () => { passe = true; });
  await attendre();

  assert.equal(passe, false);
  assert.equal(res.code, 403);
});

test('wrap transforme une erreur asynchrone en 500 avec son message', async () => {
  const res = faussesReponses();
  const handler = wrap(async () => { throw new Error('la base a dit non'); });

  await handler({}, res, () => {});
  await attendre();

  assert.equal(res.code, 500);
  assert.deepEqual(res.corps, { error: 'la base a dit non' });
});

test('wrap attrape aussi une erreur levee avant le premier await', async () => {
  const res = faussesReponses();
  const handler = wrap(() => { throw new Error('synchrone'); });

  await handler({}, res, () => {});
  await attendre();

  assert.equal(res.code, 500);
});

test('wrap ne repond pas deux fois quand la reponse est deja partie', async () => {
  // Sinon Express leve « headers already sent », qui masque l'erreur d'origine.
  const res = faussesReponses();
  const handler = wrap(async (_req, r) => {
    r.status(200).json({ ok: true });
    throw new Error('erreur apres coup');
  });

  await handler({}, res, () => {});
  await attendre();

  assert.equal(res.code, 200);
  assert.deepEqual(res.corps, { ok: true });
});
