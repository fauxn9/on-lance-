import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DISCORD_CLIENT_ID = '1234567890';
process.env.DISCORD_CLIENT_SECRET = 'secret-client-de-test';

const discord = await import('../src/services/discord.js');
const { safeNext } = await import('../src/services/urls.js');

/* --- Redirection apres connexion ------------------------------------------ */

test('safeNext laisse passer un chemin interne', () => {
  assert.equal(safeNext('/leaderboard.html'), '/leaderboard.html');
  assert.equal(safeNext('/rejoindre.html?i=abc123'), '/rejoindre.html?i=abc123');
});

test('safeNext refuse tout ce qui sort du site', () => {
  const dehors = [
    'https://faux-site.example',
    'http://faux-site.example',
    '//faux-site.example',          // protocol-relative : un autre site malgre le "/"
    '/\\faux-site.example',         // "\" traite comme "/" par certains navigateurs
    'javascript:alert(1)',
    'faux-site.example',
  ];
  for (const v of dehors) {
    assert.equal(safeNext(v), '/dashboard.html', `laisse passer : ${v}`);
  }
});

test('safeNext refuse une valeur avec saut de ligne', () => {
  // La valeur repart dans un en-tete Set-Cookie puis dans un Location : un
  // saut de ligne permettrait d'en fabriquer un second.
  assert.equal(safeNext('/ok\r\nSet-Cookie: a=b'), '/dashboard.html');
});

test('safeNext retombe sur le defaut quand il n’y a rien a lire', () => {
  for (const v of [null, undefined, '', 42, {}]) {
    assert.equal(safeNext(v), '/dashboard.html');
  }
  assert.equal(safeNext(null, '/groupes.html'), '/groupes.html');
});

/* --- URL d'autorisation Discord ------------------------------------------- */

test("l'URL Discord ne demande que l'identite", () => {
  const url = new URL(discord.authorizeUrl({
    state: 'jeton-anti-csrf',
    redirectUri: 'https://onlance.xyz/auth/discord/callback',
  }));

  // Promesse faite sur la page de connexion : ni serveurs, ni messages, ni amis.
  assert.equal(url.searchParams.get('scope'), 'identify');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('client_id'), '1234567890');
  assert.equal(url.searchParams.get('state'), 'jeton-anti-csrf');
  assert.equal(
    url.searchParams.get('redirect_uri'),
    'https://onlance.xyz/auth/discord/callback',
  );
  assert.equal(url.origin + url.pathname, 'https://discord.com/oauth2/authorize');
});

test("l'URL d'autorisation ne contient jamais le secret client", () => {
  const url = discord.authorizeUrl({ state: 's', redirectUri: 'https://onlance.xyz/cb' });
  assert.ok(!url.includes('secret-client-de-test'));
  assert.ok(!url.includes('client_secret'));
});

test('isConfigured exige les deux identifiants', () => {
  assert.equal(discord.isConfigured(), true);
});
