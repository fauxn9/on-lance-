/* Parcours complet de la brique 4/6, joue dans un vrai navigateur.
 *
 * Ce fichier ne tourne PAS avec `npm test` : il a besoin de Playwright, qui
 * telecharge des navigateurs et n'a rien a faire dans les dependances d'un
 * serveur. Pour le lancer :
 *
 *     npm i -D playwright && npx playwright install chromium
 *     node test/manuel/parcours-brique4.mjs
 *
 * Il ne teste pas le serveur (celui-la a besoin de Postgres) mais le
 * JavaScript des pages : un faux serveur repond aux memes routes, le parcours
 * est joue du lien d'invitation jusqu'a la deconnexion, et toute erreur
 * JavaScript fait echouer.
 */
import express from 'express';
import { chromium } from 'playwright';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUB = join(dirname(fileURLToPath(import.meta.url)), '../../public');
const PORT = 3141;

/* --- Faux serveur ---------------------------------------------------------- */

let connecte = false;
let riotLie = false;
let groupes = [];

const app = express();
app.use(express.json());

app.get('/auth/me', (_q, r) => r.json({
  discordConfigured: true,
  user: connecte
    ? {
        id: 7, displayName: riotLie ? 'fauxn9' : 'Willy', discordUsername: 'willy',
        avatarUrl: null, riotId: riotLie ? 'fauxn9#LUVGF' : null,
        riotVerified: false, tier: riotLie ? 'Gold 2' : null,
      }
    : null,
}));

app.get('/auth/discord', (q, r) => { connecte = true; r.redirect(q.query.next ?? '/dashboard.html'); });
app.post('/auth/logout', (_q, r) => { connecte = false; r.json({ ok: true }); });

app.get('/invite/:t', (q, r) => (q.params.t === 'bon'
  ? r.json({ name: 'Les cinq du soir', owner: 'hayann', members: 3, alreadyMember: false })
  : r.status(404).json({ error: 'Invitation invalide ou expirée' })));

app.post('/invite/:t/accept', (_q, r) => r.json({ groupId: 1, name: 'Les cinq du soir', nouveau: true }));

app.post('/accounts/link', (q, r) => {
  if (q.body.riotName === 'pris') {
    return r.status(409).json({ error: 'Ce compte Valorant est déjà rattaché au profil de hayann.', code: 'deja_pris' });
  }
  riotLie = true;
  r.json({ status: 'adopted', riotId: `${q.body.riotName}#${q.body.riotTag}`, recupere: 12 });
});

app.get('/me/groups', (_q, r) => r.json({ groups: groupes }));
app.post('/groups', (q, r) => {
  const g = { id: groupes.length + 1, name: q.body.name, joinCode: 'ABC123', inviteToken: 'bon', role: 'owner', members: 1 };
  groupes.push(g);
  r.status(201).json({ ...g, invite_token: 'bon', inviteUrl: `http://localhost:${PORT}/rejoindre.html?i=bon` });
});

/* Le classement rendu par le serveur est deja trie et rangé : on reproduit ca,
   sinon on ne testerait pas ce que la page recoit vraiment. `bonus` simule les
   trois games gagnees entre le premier affichage et le rafraichissement. */
const standings = (bonus = 0) => [
  { userId: 7, displayName: 'fauxn9', rrTotal: 63 + bonus, matches: 5, bestGain: 24 },
  { userId: 8, displayName: 'hayann', rrTotal: 71, matches: 6, bestGain: 21 },
  { userId: 9, displayName: 'Triple T', rrTotal: -12, matches: 4, bestGain: 18 },
].sort((a, b) => b.rrTotal - a.rrTotal).map((s, i) => ({ ...s, rank: i + 1 }));

app.get('/groups/:id/leaderboard', (_q, r) => r.json({
  weekStart: '2026-08-31', label: 'semaine du 31 août', endsAt: new Date(Date.now() + 3 * 86400000).toISOString(),
  isCurrentWeek: true, standings: standings(),
}));
app.post('/groups/:id/leaderboard/refresh', (_q, r) => r.json({
  weekStart: '2026-08-31', label: 'semaine du 31 août', endsAt: new Date(Date.now() + 3 * 86400000).toISOString(),
  isCurrentWeek: true, refreshed: true, standings: standings(40),
}));
app.get('/groups/:id/leaderboard/history', (_q, r) => r.json([
  { week_start: '2026-08-24', winner_name: 'hayann', winner_rr: 92 },
]));

app.get('/me/matches', (q, r) => {
  const offset = Number(q.query.offset ?? 0);
  const total = 14;
  const n = Math.min(10, total - offset);
  r.json({
    matches: Array.from({ length: n }, (_, i) => ({
      matchId: `m${offset + i}`, playedAt: new Date(Date.now() - (offset + i) * 3600000).toISOString(),
      map: 'Ascent', mode: 'Competitive', agent: 'Jett', roundsPlayed: 24,
      acs: 210 + i, kills: 18, deaths: 14, assists: 4, headshotPct: 22,
      won: i % 2 === 0, rrChange: i % 2 === 0 ? 21 : -17, tier: 'Gold 2',
      withGroup: i === 0,
    })),
    hasMore: offset + n < total,
  });
});

/* Meme forme que buildCoachReport() : agregat global, decoupage par map,
   faits, et texte seulement si generate=1. Ascent a un gros echantillon, Abyss
   un echantillon trop petit — les deux chemins doivent etre couverts. */
const parMap = [
  { mapName: 'Ascent', deaths: 96, lastAliveDeaths: 8, positionalSample: 88, isolatedDeaths: 57,
    tradeableDeaths: 19, medianTeammateDistance: 17.7, medianDuelDistance: 15.8, viewSample: 74 },
  { mapName: 'Lotus', deaths: 51, lastAliveDeaths: 4, positionalSample: 47, isolatedDeaths: 17,
    tradeableDeaths: 16, medianTeammateDistance: 12.4, medianDuelDistance: 14.1, viewSample: 40 },
  { mapName: 'Abyss', deaths: 6, lastAliveDeaths: 1, positionalSample: 5, isolatedDeaths: 4,
    tradeableDeaths: 1, medianTeammateDistance: 19.2, medianDuelDistance: 16.0, viewSample: 3 },
];

app.get('/me/coach', (q, r) => {
  if (Number(q.query.days) === 7) {
    return r.json({ periodLabel: 'les 7 derniers jours', deaths: 0,
      message: "Aucune mort analysee sur la periode. Le job d'analyse tourne toutes les heures." });
  }
  const somme = (k) => parMap.reduce((t, m) => t + m[k], 0);
  r.json({
    periodLabel: `les ${q.query.days ?? 14} derniers jours`,
    aggregate: {
      deaths: somme('deaths'), lastAliveDeaths: somme('lastAliveDeaths'),
      positionalSample: somme('positionalSample'), isolatedDeaths: somme('isolatedDeaths'),
      tradeableDeaths: somme('tradeableDeaths'), medianTeammateDistance: 15.6,
      medianDuelDistance: 15.8, viewSample: somme('viewSample'),
      outOfViewDeaths: 41, fromBehindDeaths: 12,
    },
    byMap: parMap,
    patterns: [
      { key: 'isolation', severity: 'fort', sample: 140,
        fact: '78 morts sur 140 a plus de 15 m du coequipier le plus proche (56%)' },
      { key: 'no_trade', severity: 'net', sample: 140,
        fact: 'seulement 36 morts sur 140 avec un coequipier a moins de 8 m (26%)' },
    ],
    text: q.query.generate === '1' ? 'Texte du coach généré.' : null,
    generated: q.query.generate === '1',
  });
});

app.get('/me/heatmap', (q, r) => {
  const m = parMap.find((x) => x.mapName === q.query.map);
  r.json({
    map: q.query.map,
    // Abyss sans minimap calibree : le chemin degrade doit tenir.
    minimapUrl: q.query.map === 'Abyss' ? null
      : 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    points: Array.from({ length: m ? m.deaths : 0 }, (_, i) => ({
      x: 0.1 + ((i * 7) % 80) / 100, y: 0.1 + ((i * 13) % 80) / 100,
      isolated: i % 2 === 0, lastAlive: i % 11 === 0,
      nearestTeammate: 6 + (i % 20), duelDistance: 10 + (i % 15),
      round: 1 + (i % 24), matchId: `m${i}`, playedAt: new Date().toISOString(),
    })),
  });
});

app.get('/push/public-key', (_q, r) => r.json({ publicKey: '' }));

// Permet au scenario de revenir a l'etat « connecte, mais sans Riot ID ».
app.get('/__delier', (_q, r) => { riotLie = false; r.json({ ok: true }); });

app.use(express.static(PUB));
app.get('/', (_q, r) => r.sendFile(join(PUB, 'landing.html')));

const server = app.listen(PORT);

/* --- Parcours -------------------------------------------------------------- */

const base = `http://127.0.0.1:${PORT}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();

await page.route('**/*', (route) => {
  const url = route.request().url();
  if (url.startsWith(base) || url.startsWith('data:')) return route.continue();
  return route.abort();
});

const erreurs = [];
page.on('pageerror', (e) => erreurs.push(`[pageerror] ${e.message}`));
page.on('console', (m) => {
  const t = m.text();
  if (m.type() !== 'error') return;
  if (/net::ERR_FAILED|fonts\.googleapis|status of (404|409)/.test(t)) return; // ressources externes coupees exprès
  erreurs.push(`[console] ${t}`);
});

const etapes = [];
const verifie = async (nom, fn) => {
  try { await fn(); etapes.push(`ok   ${nom}`); }
  catch (e) {
    etapes.push(`KO   ${nom} — ${e.message}`);
    etapes.push(`     page: ${(await texte()).replace(/\s+/g, ' ').slice(0, 220)}`);
  }
};
const texte = async () => (await page.locator('body').innerText()).toLowerCase();

/* Les pages remplissent leur contenu par fetch apres le chargement : chaque
   verification attend d'abord le texte qu'elle vient controler. */
const attends = (re, timeout = 8000) =>
  page.waitForFunction(
    ({ source, flags }) => new RegExp(source, flags).test(document.body.innerText),
    { source: re.source, flags: re.flags },
    { timeout },
  );

// 1. Invitation invalide
await verifie('invitation invalide -> message clair', async () => {
  await page.goto(`${base}/rejoindre.html?i=nope`);
  await attends(/ne mène nulle part|plus valable/i);
  const t = await texte();
  if (!/ne mène nulle part|plus valable/i.test(t)) throw new Error(t.slice(0, 160));
});

// 2. Invitation valide, visiteur non connecte
await verifie('invitation valide -> apercu du groupe + bouton Discord', async () => {
  await page.goto(`${base}/rejoindre.html?i=bon`);
  await attends(/Continuer avec Discord/i);
  const t = await texte();
  if (!t.includes('les cinq du soir')) throw new Error('nom du groupe absent');
  if (!t.includes('hayann')) throw new Error('proprietaire absent');
  if (!t.includes('3 membres')) throw new Error('nombre de membres absent');
  if (!t.includes('continuer avec discord')) throw new Error('bouton Discord absent');
});

// 3. OAuth puis saisie du Riot ID
await verifie('connexion Discord -> ecran Riot ID', async () => {
  await page.click('#goDiscord');
  await attends(/Ton compte Valorant/i);
  const t = await texte();
  if (!t.includes('ton compte valorant')) throw new Error(t.slice(0, 200));
});

await verifie('Riot ID sans tag -> refus cote page, aucun appel serveur', async () => {
  await page.fill('#riot', 'fauxn9');
  await page.click('#linkBtn');
  const t = await texte();
  if (!t.includes('il manque le tag')) throw new Error(t.slice(0, 200));
});

await verifie('Riot ID deja pris -> 409 explique', async () => {
  await page.fill('#riot', 'pris#EUW');
  await page.click('#linkBtn');
  await page.waitForFunction(() => document.getElementById('riotNote').textContent.includes('déjà rattaché'));
});

await verifie('Riot ID libre -> adoption annoncee', async () => {
  await page.fill('#riot', 'fauxn9#LUVGF');
  await page.click('#linkBtn');
  await page.waitForFunction(() => !document.getElementById('stOk').hidden);
  const t = await texte();
  if (!t.includes('bienvenue dans les cinq du soir')) throw new Error('bienvenue absente');
  if (!t.includes('12 parties')) throw new Error('parties adoptees non annoncees');
});

// 4. Groupes
await verifie('page groupes -> vide puis creation + lien d’invitation', async () => {
  await page.goto(`${base}/groupes.html`);
  await attends(/aucun groupe/i);
  let t = await texte();
  if (!t.includes("tu n'es dans aucun groupe")) throw new Error(t.slice(0, 200));

  await page.fill('#nom', 'Les cinq du soir');
  await page.click('#creer');
  await page.waitForSelector('.grp code');
  t = await texte();
  if (!t.includes('rejoindre.html?i=bon')) throw new Error('lien d’invitation absent');
  if (!t.includes('propriétaire')) throw new Error('role absent');
});

// 5. Classement
await verifie('classement -> lignes, ma ligne, historique', async () => {
  await page.goto(`${base}/leaderboard.html`);
  await page.waitForSelector('.row');
  const t = await texte();
  if (!t.includes('hayann') || !t.includes('triple t')) throw new Error('membres absents');
  if (!t.includes('clôture dans')) throw new Error('compte a rebours absent');
  if (!t.includes('tableau d’honneur') && !t.includes("tableau d'honneur")) throw new Error('tableau d’honneur absent');
  if (await page.locator('.row--me').count() !== 1) throw new Error('ma propre ligne non repérable');
  if (!/groupe=1/.test(page.url())) throw new Error(`URL non normalisee : ${page.url()}`);
});

await verifie('rafraichir -> le classement bouge et la montee est signalee', async () => {
  // La page rafraichit toute seule apres le premier affichage : c'est ce
  // mouvement-la que quelqu'un qui vient de gagner trois games doit voir.
  await page.waitForFunction(() => document.querySelector('.delta--up') !== null, null, { timeout: 15000 });
  const t = await texte();
  if (!t.includes('+103')) throw new Error('nouveau total absent');
  if (!t.includes('▲ 1')) throw new Error('montee non signalee');

  // Et un clic manuel ne casse rien.
  await page.click('#refresh');
  await page.waitForFunction(() => !document.getElementById('refresh').disabled);
  if (!(await texte()).includes('+103')) throw new Error('total perdu apres clic');
});

// 6. Tableau de bord
await verifie('tableau de bord -> tuiles, coach, pagination', async () => {
  await page.goto(`${base}/dashboard.html`);
  await page.waitForSelector('.game');
  let t = await texte();
  if (!t.includes('fauxn9#luvgf')) throw new Error('Riot ID absent de l’en-tete');
  if (!t.includes('gold 2')) throw new Error('tier absent');
  if (!t.includes('78 morts sur 140')) throw new Error('pattern du coach absent');
  if (await page.locator('.game').count() !== 10) throw new Error('mauvais nombre de parties');
  if (!t.includes('10 affichées')) throw new Error('compteur absent');

  await page.click('#moreBtn');
  await page.waitForFunction(() => document.querySelectorAll('.game').length === 14);
  t = await texte();
  if (!t.includes('14 affichées')) throw new Error('compteur non mis a jour');
  if (await page.locator('#moreBtn').isVisible()) throw new Error('bouton « voir plus » encore visible sans reste');
});

await verifie('coach a la demande -> texte genere', async () => {
  await page.click('#genBtn');
  await page.waitForFunction(() => document.body.innerText.toLowerCase().includes('texte du coach'));
});

// 6 bis. Tableau de bord sans Riot ID : c'est le seul endroit hors invitation
// ou l'on peut le renseigner, donc le formulaire doit y etre.
await verifie('tableau de bord sans Riot ID -> formulaire de rattachement', async () => {
  await page.request.get(`${base}/__delier`);
  await page.goto(`${base}/dashboard.html`);
  await attends(/rattache ton compte valorant/i);
  if (await page.locator('.game').count() !== 0) throw new Error('parties affichees sans compte lie');

  await page.fill('#riot', 'fauxn9');
  await page.click('#linkBtn');
  await page.waitForFunction(() => document.getElementById('riotNote').textContent.includes('manque le tag'));

  await page.fill('#riot', 'fauxn9#LUVGF');
  await page.click('#linkBtn');
  await page.waitForFunction(() => document.getElementById('riotNote').dataset.kind === 'ok');
  const t = await texte();
  if (!t.includes('12 parties')) throw new Error('adoption non annoncee');
});

// 6 ter. Coach positionnel — la brique 5
await verifie('coach -> tuiles, faits, onglets de map et heatmap', async () => {
  await page.goto(`${base}/coach.html`);
  await attends(/morts analysées/i);
  const t = await texte();
  if (!t.includes('153')) throw new Error('total des morts absent');
  if (!t.includes('78 morts sur 140')) throw new Error('faits mesures absents');
  if (!t.includes('sur demande')) throw new Error("l'IA devrait attendre une demande explicite");

  if (await page.locator('.tab').count() !== 3) throw new Error('mauvais nombre de maps');
  await page.waitForSelector('.dot');
  if (await page.locator('.dot').count() !== 96) throw new Error('mauvais nombre de points sur Ascent');
  if (!(await texte()).includes('pire map')) throw new Error('verdict absent sur Ascent');
});

await verifie('coach -> survol d’un point, changement de map, echantillon trop petit', async () => {
  await page.locator('.dot').first().dispatchEvent('mouseenter');
  await page.waitForFunction(() => !document.getElementById('tip').hidden);
  if (!(await page.locator('#tip').innerText()).includes('m')) throw new Error('infobulle vide');

  // Abyss : 6 morts et pas de minimap calibree — la page doit refuser de
  // conclure au lieu d'annoncer une "pire map" sur 5 morts.
  await page.click('.tab[data-map="Abyss"]');
  await attends(/trop peu pour en conclure/i);
  if (await page.locator('#minimap').isVisible()) throw new Error('minimap affichee sans URL');
  if (!(await texte()).includes('pas de minimap calibrée')) throw new Error('absence de minimap non expliquee');
  if (await page.locator('.dot').count() !== 6) throw new Error('points non recharges pour Abyss');
});

await verifie('coach -> generation a la demande et periode sans donnees', async () => {
  await page.click('#genBtn');
  await attends(/texte du coach généré/i);

  await page.click('.pill[data-days="7"]');
  await attends(/aucune mort analysee/i);
  if (await page.locator('#main').isVisible()) throw new Error('sections affichees sans donnees');
});

// 7. Landing
await verifie('landing -> CTA adapte a l’etat connecte', async () => {
  await page.goto(base);
  await page.waitForFunction(() => document.getElementById('navCta').textContent.toLowerCase().includes('tableau de bord'));
});

// 8. Deconnexion
await verifie('deconnexion -> page protegee renvoie vers la connexion', async () => {
  await page.goto(`${base}/dashboard.html`);
  page.on('dialog', (d) => d.accept());
  await page.click('#whoBtn');
  await page.waitForURL(/\/$/, { timeout: 5000 });
  await page.goto(`${base}/groupes.html`);
  await page.waitForURL(/login\.html\?next=%2Fgroupes\.html/, { timeout: 5000 });
});

console.log(etapes.join('\n'));
console.log(erreurs.length === 0 ? '\nAucune erreur JavaScript.' : `\nErreurs JS :\n${erreurs.join('\n')}`);

await browser.close();
server.close();
process.exit(etapes.some((e) => e.startsWith('KO')) || erreurs.length > 0 ? 1 : 0);
