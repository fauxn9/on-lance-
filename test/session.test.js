import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

// Le secret doit exister AVANT l'import de config.js : sinon un secret aleatoire
// est tire au demarrage et les valeurs attendues ci-dessous changeraient a chaque
// execution.
process.env.SESSION_SECRET = 'secret-de-test-0123456789abcdef';

const { createSession, readSession, readCookie, sessionCookie, clearCookie, randomToken, COOKIE } =
  await import('../src/services/session.js');

/* --- Aller-retour ---------------------------------------------------------- */

test('un cookie fraichement cree se relit', () => {
  assert.equal(readSession(createSession(42)), 42);
});

test('un cookie absent, vide ou mal forme ne donne pas de session', () => {
  for (const mauvais of [null, undefined, '', 'nimportequoi', 'sanspoint', '.', 'a.', '.b', 42, {}]) {
    assert.equal(readSession(mauvais), null, `accepte a tort : ${JSON.stringify(mauvais)}`);
  }
});

/* --- Ce que la signature protege ------------------------------------------ */

test("modifier l'identifiant invalide la signature", () => {
  const cookie = createSession(1);
  const [charge] = cookie.split('.');
  const signature = cookie.split('.')[1];

  // Meme charge que pour l'utilisateur 2, mais signee pour l'utilisateur 1.
  const autre = createSession(2).split('.')[0];
  assert.notEqual(autre, charge);
  assert.equal(readSession(`${autre}.${signature}`), null);
});

test('une signature bidon est rejetee', () => {
  const [charge] = createSession(7).split('.');
  assert.equal(readSession(`${charge}.${Buffer.from('x'.repeat(32)).toString('base64url')}`), null);
});

test('une charge non signee est rejetee', () => {
  // Le cas le plus tentant pour un attaquant : fabriquer la charge soi-meme.
  const charge = Buffer.from(JSON.stringify({ u: 1, e: Date.now() + 60_000 })).toString('base64url');
  assert.equal(readSession(charge), null);
  assert.equal(readSession(`${charge}.`), null);
});

test('un cookie signe avec un autre secret est rejete', () => {
  // C'est la propriete qui rend le changement de SESSION_SECRET utile : il
  // deconnecte tout le monde d'un coup, seul moyen de revoquer les sessions en
  // masse puisqu'elles ne sont pas stockees. C'est aussi ce qui empeche de
  // fabriquer un cookie sans connaitre le secret du serveur.
  const charge = Buffer.from(JSON.stringify({ u: 3, e: Date.now() + 60_000 }))
    .toString('base64url');
  const signature = createHmac('sha256', 'un-autre-secret-totalement-different')
    .update(charge).digest().toString('base64url');

  assert.equal(readSession(`${charge}.${signature}`), null);
});

/* --- Expiration ------------------------------------------------------------ */

test('un cookie expire est refuse meme correctement signe', () => {
  const cookie = createSession(9);
  assert.equal(readSession(cookie), 9);

  // On avance l'horloge au-dela des 30 jours de validite.
  const vrai = Date.now;
  Date.now = () => vrai() + 31 * 86_400_000;
  try {
    assert.equal(readSession(cookie), null);
  } finally {
    Date.now = vrai;
  }
});

/* --- Lecture de l'en-tete Cookie ------------------------------------------ */

test('readCookie isole le bon cookie parmi les autres', () => {
  const header = `theme=dark; ${COOKIE}=abc.def; autre=1`;
  assert.equal(readCookie(header), 'abc.def');
  assert.equal(readCookie(header, 'theme'), 'dark');
  assert.equal(readCookie(header, 'inconnu'), null);
  assert.equal(readCookie(null), null);
});

test('readCookie ne confond pas un nom qui finit pareil', () => {
  // "faux_onlance_session" contient le nom recherche : une recherche par
  // inclusion renverrait la mauvaise valeur.
  assert.equal(readCookie(`faux_${COOKIE}=piege`), null);
});

test('readCookie decode la valeur et tolere les espaces', () => {
  assert.equal(readCookie(`  ${COOKIE} = a%2Eb `), 'a.b');
});

/* --- En-tete Set-Cookie ---------------------------------------------------- */

test('le cookie de session est inaccessible au JavaScript de la page', () => {
  const entete = sessionCookie('valeur');
  assert.match(entete, /HttpOnly/);
  // SameSite=Lax est necessaire : le retour de Discord est une redirection
  // depuis un autre site, et Strict ne laisserait pas passer le cookie.
  assert.match(entete, /SameSite=Lax/);
  assert.match(entete, /Path=\//);
  assert.match(entete, /Max-Age=2592000/);
});

test('la deconnexion envoie un cookie qui expire immediatement', () => {
  assert.match(clearCookie(), /Max-Age=0/);
});

/* --- Jetons ---------------------------------------------------------------- */

test('randomToken produit des jetons distincts et hexadecimaux', () => {
  const jetons = new Set(Array.from({ length: 200 }, () => randomToken(16)));
  assert.equal(jetons.size, 200);
  for (const j of jetons) assert.match(j, /^[0-9a-f]{32}$/);
});
