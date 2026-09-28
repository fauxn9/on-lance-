// Routes publiques des statistiques : /api/stats/…
//
// Tout est agrégé et anonyme, donc lisible sans jeton. Seules les
// suggestions utilisent, si un jeton d'appareil est présent, l'historique du
// joueur lui-même (ses winrates par champion).

import crypto from 'node:crypto';
import express from 'express';
import { query } from '../db.js';
import { construireBuild, postesProbables, repartition, SEUIL_FIABLE, wilson } from './build.js';
import { patchCourant } from './items.js';
import { suggerer } from './suggestions.js';

const ROLES = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
const ARAM = new Set([450, 2400]);
const FILES_PERSO = { 420: [420, 440, 400, 430, 490], 440: [420, 440, 400, 430, 490], 450: [450], 2400: [2400, 450] };

const precedent = (p) => { const [a, b] = p.split('.').map(Number); return `${a}.${b - 1}`; };

// Petit cache mémoire : les agrégats ne bougent qu'au rythme de la collecte.
const cache = new Map();
async function enCache(cle, ms, fn) {
  const c = cache.get(cle);
  if (c && Date.now() - c.at < ms) return c.v;
  const v = await fn();
  cache.set(cle, { at: Date.now(), v });
  if (cache.size > 2000) cache.delete(cache.keys().next().value);
  return v;
}

// Patchs à lire : le courant, plus le précédent tant que le courant manque de parties.
async function patchs(queue) {
  return enCache(`patchs:${queue}`, 10 * 60_000, async () => {
    const p = await patchCourant();
    const { rows } = await query("select coalesce(sum(games), 0)::int as n from stats where patch = $1 and queue = $2 and kind = 'matches'", [p, queue]);
    return rows[0].n >= 2000 ? [p] : [p, precedent(p)];
  });
}

// Part de chaque poste pour chaque champion (sert aussi à l’écran de chargement).
export async function roles(queue) {
  return enCache(`roles:${queue}`, 10 * 60_000, async () => {
    const { rows } = await query(
      `select champion_id, role, sum(games)::int as games from stats
        where patch = any($1) and queue = $2 and kind = 'champ' group by champion_id, role`,
      [await patchs(queue), queue],
    );
    const parChamp = {};
    for (const r of rows) (parChamp[r.champion_id] ??= []).push(r);
    return Object.fromEntries(Object.entries(parChamp).map(([id, rs]) => [id, repartition(rs)]));
  });
}

async function base(queue, role) {
  return enCache(`base:${queue}:${role}`, 10 * 60_000, async () => {
    const { rows } = await query(
      `select champion_id, sum(games)::int as games, sum(wins)::int as wins from stats
        where patch = any($1) and queue = $2 and role = $3 and kind = 'champ' group by champion_id`,
      [await patchs(queue), queue, role],
    );
    const r = await roles(queue);
    return Object.fromEntries(rows.map((x) => [x.champion_id, { games: x.games, wins: x.wins, part: r[x.champion_id]?.[role] ?? 1 }]));
  });
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
async function puuidDuJeton(req) {
  const token = /^Bearer (.+)$/.exec(req.get('authorization') ?? '')?.[1];
  if (!token) return null;
  const { rows } = await query('select puuid from devices where token_hash = $1', [sha256(token)]);
  return rows[0]?.puuid ?? null;
}

function limite({ max, fenetre }) {
  const vus = new Map();
  return (req, res, next) => {
    const t = Date.now();
    const l = (vus.get(req.ip) ?? []).filter((x) => x > t - fenetre);
    if (l.length >= max) return res.status(429).json({ erreur: 'Trop de demandes, réessaie dans un moment.' });
    l.push(t);
    vus.set(req.ip, l);
    next();
  };
}

const entier = (v) => (Number.isInteger(Number(v)) ? Number(v) : null);
const liste = (v) => (Array.isArray(v) ? v.map(Number).filter((x) => Number.isInteger(x) && x > 0).slice(0, 20) : []);

export function statsRouter() {
  const r = express.Router();
  r.use(express.json({ limit: '16kb' }));
  r.use(limite({ max: 240, fenetre: 60_000 }));

  r.get('/meta', async (req, res, next) => {
    try {
      const patch = await patchCourant();
      const { rows } = await query(
        "select patch, queue, sum(games)::int as parties from stats where kind = 'matches' group by patch, queue order by patch desc, queue",
      );
      res.json({ patch, parties: rows });
    } catch (e) { next(e); }
  });

  // Build d'un champion. ?role=TOP&queue=420 (rôle par défaut : son plus joué).
  r.get('/champion/:id', async (req, res, next) => {
    try {
      const id = entier(req.params.id);
      const queue = entier(req.query.queue) ?? 420;
      if (!id) return res.status(400).json({ erreur: 'Champion invalide.' });
      let role = ARAM.has(queue) ? 'ARAM' : String(req.query.role ?? '').toUpperCase();
      const repart = (await roles(queue))[id] ?? {};
      if (!ARAM.has(queue) && !ROLES.includes(role)) {
        role = Object.entries(repart).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'TOP';
      }
      const out = await enCache(`build:${queue}:${id}:${role}`, 10 * 60_000, async () => {
        const ps = await patchs(queue);
        // Le patch courant seul s'il suffit, sinon on y ajoute le précédent.
        let { rows } = await query(
          `select kind, key, sum(games)::int as games, sum(wins)::int as wins from stats
            where patch = $1 and queue = $2 and champion_id = $3 and role = $4 group by kind, key`,
          [ps[0], queue, id, role],
        );
        const n = rows.find((x) => x.kind === 'champ')?.games ?? 0;
        if (n < SEUIL_FIABLE && ps.length > 1) {
          ({ rows } = await query(
            `select kind, key, sum(games)::int as games, sum(wins)::int as wins from stats
              where patch = any($1) and queue = $2 and champion_id = $3 and role = $4 group by kind, key`,
            [ps, queue, id, role],
          ));
        }
        return { championId: id, role, queue, patchs: ps, roles: repart, ...construireBuild(rows) };
      });
      res.json(out);
    } catch (e) { next(e); }
  });

  // Répartition des rôles de chaque champion (pour deviner les postes adverses).
  r.get('/roles', async (req, res, next) => {
    try {
      res.json(await roles(entier(req.query.queue) ?? 420));
    } catch (e) { next(e); }
  });

  // Tier list d'un poste.
  r.get('/tierlist', async (req, res, next) => {
    try {
      const queue = entier(req.query.queue) ?? 420;
      const role = ARAM.has(queue) ? 'ARAM' : String(req.query.role ?? 'TOP').toUpperCase();
      const out = await enCache(`tier:${queue}:${role}`, 10 * 60_000, async () => {
        const ps = await patchs(queue);
        const b = await base(queue, role);
        const { rows } = await query(
          "select coalesce(sum(games), 0)::int as n from stats where patch = any($1) and queue = $2 and kind = 'matches'",
          [ps, queue],
        );
        const parPartie = ARAM.has(queue) ? 1 : 2; // un champion par équipe et par poste
        const liste = Object.entries(b)
          .map(([id, x]) => ({ championId: Number(id), games: x.games, winrate: x.wins / x.games, pickrate: rows[0].n ? x.games / (parPartie * rows[0].n) : 0, score: wilson(x.wins, x.games) }))
          .filter((x) => x.games >= 50 && x.pickrate >= 0.005)
          .sort((a, b) => b.score - a.score);
        const tier = (i) => { const q = i / Math.max(1, liste.length); return q < 0.1 ? 'S' : q < 0.3 ? 'A' : q < 0.7 ? 'B' : 'C'; };
        return { role, queue, patchs: ps, parties: rows[0].n, champions: liste.map((x, i) => ({ ...x, tier: tier(i) })) };
      });
      res.json(out);
    } catch (e) { next(e); }
  });

  // Suggestions en sélection des champions.
  r.post('/suggestions', async (req, res, next) => {
    try {
      const b = req.body ?? {};
      const queue = entier(b.queue) ?? 420;
      const aram = ARAM.has(queue);
      const statsQueue = aram ? 450 : 420;
      const role = aram ? 'ARAM' : String(b.role ?? '').toUpperCase();
      if (!aram && !ROLES.includes(role)) return res.status(400).json({ erreur: 'Poste inconnu.' });

      const ennemis = liste(b.ennemis);
      const rolesChamps = aram ? {} : await roles(statsQueue);
      // Un adversaire n'est placé à un poste que si les données le soutiennent :
      // sans stats, on ne devine pas au hasard.
      const postes = Object.fromEntries(
        Object.entries(aram ? {} : postesProbables(ennemis, rolesChamps)).filter(([id, p]) => (rolesChamps[id]?.[p] ?? 0) >= 0.15),
      );
      const face = aram ? null : Number(Object.entries(postes).find(([, p]) => p === role)?.[0]) || null;

      const baseRole = await base(statsQueue, role);
      let duels = {};
      if (face) {
        const { rows } = await query(
          `select champion_id, sum(games)::int as games, sum(wins)::int as wins from stats
            where patch = any($1) and queue = 420 and role = $2 and kind = 'matchup' and key = $3 group by champion_id`,
          [await patchs(420), role, String(face)],
        );
        duels = Object.fromEntries(rows.map((x) => [x.champion_id, x]));
      }

      let perso = {};
      const puuid = await puuidDuJeton(req);
      if (puuid) {
        const { rows } = await query(
          `select champion_id, count(*)::int as games, sum(win::int)::int as wins from player_matches
            where puuid = $1 and queue_id = any($2) and not remake group by champion_id`,
          [puuid, FILES_PERSO[queue] ?? [queue]],
        );
        perso = Object.fromEntries(rows.map((x) => [x.champion_id, x]));
      }

      const pool = Array.isArray(b.pool)
        ? b.pool.slice(0, 250).map((p) => ({ championId: Number(p.championId), points: Number(p.points) || 0 })).filter((p) => p.championId > 0)
        : [];
      const suggestions = suggerer({
        role, face, pool, base: baseRole, duels, perso,
        exclus: [...liste(b.allies), ...ennemis, ...liste(b.bans)],
        banc: aram ? liste(b.banc) : null,
      });
      res.json({ role, face, postes, suggestions });
    } catch (e) { next(e); }
  });

  r.use((err, req, res, next) => {
    console.error('api/stats :', err.message);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  });
  return r;
}
