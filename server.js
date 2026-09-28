// On lance ? — serveur du site et de l'API de l'app.
//
// Render lance `npm run api` : on garde ce nom de script pour ne rien avoir à
// toucher dans le dashboard. Le site est statique ; /api/discord relaie le
// nombre de membres du serveur (en cache) ; /api/app sert l'app PC.

import express from 'express';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// En local, les secrets viennent de .env ; sur Render, du dashboard.
if (existsSync(new URL('./.env', import.meta.url))) process.loadEnvFile(fileURLToPath(new URL('./.env', import.meta.url)));

const { appRouter } = await import('./api/routes.js');
const { statsRouter } = await import('./api/stats/routes.js');

const PORT = process.env.PORT || 3000;
const INVITE = 'BA6JcwFP8a';
const PUBLIC = fileURLToPath(new URL('./public', import.meta.url));

const app = express();
app.disable('x-powered-by');
// Render passe par un proxy : sans ça, toutes les requêtes auraient la même IP
// et la limite d'enregistrements par IP bloquerait tout le monde d'un coup.
app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': [
      "default-src 'self'",
      "img-src 'self' data:",
      "style-src 'self'",
      "font-src 'self'",
      "script-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  });
  next();
});

app.get('/health', (req, res) => res.type('text').send('ok'));

app.use('/api/app', appRouter());
app.use('/api/stats', statsRouter());

// Collecte des statistiques en fond, si demandée (COLLECTE=on).
if (process.env.COLLECTE === 'on') {
  const [{ RiotApi }, { lancerCollecte }] = await Promise.all([import('./api/riot.js'), import('./api/stats/crawler.js')]);
  lancerCollecte(new RiotApi(), { platform: process.env.COLLECTE_PLATFORM || 'euw1' });
}

let discordCache = { at: 0, data: null };
app.get('/api/discord', async (req, res) => {
  const fresh = Date.now() - discordCache.at < 10 * 60 * 1000;
  if (!fresh) {
    try {
      const r = await fetch(`https://discord.com/api/v10/invites/${INVITE}?with_counts=true`, {
        signal: AbortSignal.timeout(4000),
      });
      if (r.ok) {
        const j = await r.json();
        discordCache = {
          at: Date.now(),
          data: { members: j.approximate_member_count ?? null, online: j.approximate_presence_count ?? null },
        };
      }
    } catch {
      // Discord injoignable : on garde l'ancienne valeur, la page sait s'en passer.
    }
  }
  res.set('Cache-Control', 'public, max-age=300');
  res.json(discordCache.data ?? { members: null, online: null });
});

app.use(
  express.static(PUBLIC, {
    extensions: ['html'],
    setHeaders(res, path) {
      // Les polices et images ne changent jamais de nom sans changer de contenu
      // ici : cache long. Le HTML, le CSS et le JS restent revalidés.
      if (/\.(woff2|webp|png|svg)$/.test(path)) res.set('Cache-Control', 'public, max-age=604800');
      else res.set('Cache-Control', 'public, max-age=0, must-revalidate');
    },
  }),
);

// Les anciens liens du tracker Valorant (tableau de bord, coach, invitations…)
// renvoient vers l'accueil plutôt que vers une erreur.
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ erreur: 'Introuvable' });
  if (req.method === 'GET' && req.accepts('html')) return res.redirect(302, '/');
  res.status(404).type('text').send('Introuvable');
});

app.listen(PORT, () => console.log(`On lance ? sur http://localhost:${PORT}`));
