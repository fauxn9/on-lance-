// Routes utilisées par l'app PC. Tout est sous /api/app.
//
// L'app s'enregistre une fois par compte et reçoit un jeton d'appareil. Le
// serveur n'en garde que l'empreinte : une fuite de la base ne donne accès à
// rien.
//
// Limite connue, assumée pour la bêta fermée : le puuid vient du client LoL de
// l'utilisateur, lu en local par l'app. Le serveur vérifie que le compte
// existe, pas qu'il appartient à celui qui l'envoie. Les données exposées ici
// (historique, rang) sont de toute façon publiques chez Riot ; la vraie preuve
// de propriété (Riot Sign-On) viendra avec la clé de production, avant les
// classements entre potes (brique 8).

import crypto from 'node:crypto';
import express from 'express';
import { query } from './db.js';
import { coach } from './coach.js';
import { debrief } from './debrief.js';
import { verifierWebhook } from './groupes/discord.js';
import * as potes from './groupes/potes.js';
import { partieEnCours } from './live.js';
import { DIVS, ladder, TIERS } from './rangs.js';
import { isPlatform, RiotApi } from './riot.js';
import { startBackfill, syncRecent } from './sync.js';

const PUUID = /^[A-Za-z0-9_-]{60,90}$/;
const MATCH_ID = /^[A-Z0-9]{2,5}_\d{5,15}$/;
const QUEUES = {
  solo: [420],
  flex: [440],
  normales: [400, 430, 490],
  aram: [450, 2400],
};
const KNOWN_QUEUES = Object.values(QUEUES).flat();

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export { ladder };

// Fenêtre glissante très simple, en mémoire : suffisant pour un seul serveur.
function rateLimit({ max, windowMs }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const list = (hits.get(req.ip) ?? []).filter((t) => t > now - windowMs);
    if (list.length >= max) return res.status(429).json({ erreur: 'Trop de demandes, réessaie dans un moment.' });
    list.push(now);
    hits.set(req.ip, list);
    next();
  };
}

export function appRouter({ riot = new RiotApi() } = {}) {
  const r = express.Router();
  r.use(express.json({ limit: '8kb' }));

  const needRiot = (req, res, next) =>
    riot.configured ? next() : res.status(503).json({ erreur: "La clé de l'API Riot n'est pas configurée sur le serveur." });

  r.get('/status', (req, res) => res.json({ riot: riot.configured }));

  // --- Enregistrement d'un compte sur cet appareil
  // needRiot passe avant la limite : un serveur sans clé ne doit pas épuiser
  // le quota d'enregistrements de ceux qui réessaient.
  r.post('/register', needRiot, rateLimit({ max: 10, windowMs: 60 * 60 * 1000 }), async (req, res, next) => {
    try {
      const { puuid: puuidClient, platform, gameName, tagLine, appVersion } = req.body ?? {};
      if (!isPlatform(platform)) return res.status(400).json({ erreur: 'Plateforme invalide.' });
      const riotIdOk = typeof gameName === 'string' && typeof tagLine === 'string'
        && /^[^/#?]{1,32}$/u.test(gameName) && /^[^/#?]{1,8}$/u.test(tagLine);

      // Le client League donne le puuid en clair (un UUID) ; l'API Riot attend
      // sa version chiffrée, propre à notre clé. On la retrouve par le Riot ID.
      let acc = PUUID.test(puuidClient ?? '') ? await riot.account(platform, puuidClient) : null;
      if (!acc && riotIdOk) acc = await riot.accountByRiotId(platform, gameName, tagLine);
      if (!acc) return res.status(404).json({ erreur: 'Compte Riot introuvable.' });
      const puuid = acc.puuid;
      const sum = await riot.summoner(platform, puuid);
      if (!sum) return res.status(404).json({ erreur: "Pas de compte League of Legends sur ce serveur." });

      await query(
        `insert into accounts (puuid, platform, game_name, tag_line, profile_icon_id, summoner_level)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (puuid) do update set platform = $2, game_name = $3, tag_line = $4,
           profile_icon_id = $5, summoner_level = $6, updated_at = now()`,
        [puuid, platform, acc.gameName, acc.tagLine, sum.profileIconId ?? null, sum.summonerLevel ?? null],
      );
      const token = crypto.randomBytes(32).toString('base64url');
      await query('insert into devices (token_hash, puuid, app_version) values ($1, $2, $3)', [
        sha256(token), puuid, String(appVersion ?? '').slice(0, 32) || null,
      ]);
      res.status(201).json({ token });
    } catch (err) {
      next(err);
    }
  });

  // --- Tout ce qui suit exige un jeton d'appareil
  r.use(async (req, res, next) => {
    try {
      const token = /^Bearer (.+)$/.exec(req.get('authorization') ?? '')?.[1];
      if (!token) return res.status(401).json({ erreur: 'Jeton manquant.' });
      const { rows } = await query(
        `update devices set last_seen_at = now() where token_hash = $1
         returning puuid, (select platform from accounts a where a.puuid = devices.puuid) as platform`,
        [sha256(token)],
      );
      if (!rows[0]) return res.status(401).json({ erreur: 'Jeton inconnu.' });
      req.account = rows[0];
      next();
    } catch (err) {
      next(err);
    }
  });

  r.get('/profile', async (req, res, next) => {
    try {
      const { puuid } = req.account;
      const [acc, ranks, lpRows, count] = await Promise.all([
        query('select * from accounts where puuid = $1', [puuid]),
        query(
          `select distinct on (queue) queue, tier, division, lp, wins, losses, taken_at
             from rank_snapshots where puuid = $1 order by queue, taken_at desc`,
          [puuid],
        ),
        query(
          `select * from (
             select tier, division, lp, taken_at as t from rank_snapshots where puuid = $1 and queue = 'RANKED_SOLO_5x5'
             union all
             select tier_after, division_after, lp_after, created_at from lp_changes
              where puuid = $1 and queue = 'RANKED_SOLO_5x5' and lp_after is not null
           ) pts order by t desc limit 60`,
          [puuid],
        ),
        query('select count(*)::int as n from player_matches where puuid = $1', [puuid]),
      ]);
      const a = acc.rows[0];
      res.json({
        account: {
          puuid, platform: a.platform, gameName: a.game_name, tagLine: a.tag_line,
          profileIconId: a.profile_icon_id, summonerLevel: a.summoner_level,
        },
        ranks: ranks.rows.map((x) => ({ queue: x.queue, tier: x.tier, division: x.division, lp: x.lp, wins: x.wins, losses: x.losses })),
        lpHistory: lpRows.rows
          .map((x) => ({ t: new Date(x.t).getTime(), tier: x.tier, division: x.division, lp: x.lp, ladder: ladder(x.tier, x.division, x.lp) }))
          .reverse(),
        history: { count: count.rows[0].n, backfillDone: a.backfill_done, lastSyncAt: a.last_sync_at },
      });
    } catch (err) {
      next(err);
    }
  });

  r.get('/matches', async (req, res, next) => {
    try {
      const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
      const before = Number(req.query.before) || Number.MAX_SAFE_INTEGER;
      const filter = String(req.query.file ?? 'toutes');
      const params = [req.account.puuid, before, limit + 1];
      let where = '';
      if (QUEUES[filter]) {
        params.push(QUEUES[filter]);
        where = 'and pm.queue_id = any($4)';
      } else if (filter === 'autres') {
        params.push(KNOWN_QUEUES);
        where = 'and not (pm.queue_id = any($4))';
      }
      const { rows } = await query(
        `select pm.*, lc.delta as lp_delta
           from player_matches pm
           left join lp_changes lc on lc.puuid = pm.puuid and lc.match_id = pm.match_id
          where pm.puuid = $1 and pm.game_start < $2 ${where}
          order by pm.game_start desc limit $3`,
        params,
      );
      const more = rows.length > limit;
      const page = rows.slice(0, limit).map((x) => ({
        matchId: x.match_id, queueId: x.queue_id, gameStart: Number(x.game_start), durationS: x.duration_s,
        remake: x.remake, championId: x.champion_id, championName: x.champion_name, position: x.team_position,
        win: x.win, kills: x.kills, deaths: x.deaths, assists: x.assists, cs: x.cs, gold: x.gold,
        damage: x.damage, vision: x.vision, champLevel: x.champ_level, items: x.items, spells: x.spells,
        keystone: x.keystone, secondaryStyle: x.secondary_style, lpDelta: x.lp_delta,
      }));
      res.json({ matches: page, next: more ? page[page.length - 1].gameStart : null });
    } catch (err) {
      next(err);
    }
  });

  r.post('/sync', needRiot, async (req, res, next) => {
    try {
      const out = await syncRecent(riot, req.account.puuid);
      startBackfill(riot);
      res.json(out);
    } catch (err) {
      next(err);
    }
  });

  // Écran de chargement : la partie en cours et ses 10 joueurs, qui se
  // remplissent au fil des appels (l'app repasse toutes les 1,5 s).
  r.get('/live', needRiot, rateLimit({ max: 120, windowMs: 60_000 }), async (req, res, next) => {
    try {
      const gameId = /^d{1,15}$/.test(String(req.query.gameId ?? '')) ? Number(req.query.gameId) : null;
      res.json(await partieEnCours(riot, req.account, { gameId }));
    } catch (err) {
      next(err);
    }
  });

  // Debrief d'après-partie (brique 7) : calculé une fois, puis en cache.
  r.get('/debrief/:matchId', needRiot, rateLimit({ max: 30, windowMs: 60_000 }), async (req, res, next) => {
    try {
      const { matchId } = req.params;
      if (!MATCH_ID.test(matchId)) return res.status(400).json({ erreur: 'Partie invalide.' });
      const d = await debrief(riot, req.account, matchId);
      if (!d) return res.status(404).json({ erreur: "Partie introuvable, ou tu n'y as pas joué." });
      res.json(d);
    } catch (err) {
      next(err);
    }
  });

  // --- Entre potes (brique 8)
  const profilDe = async (req) => (req.profil ??= await potes.assurerProfil(req.account.puuid));
  const membre = async (req, res, next) => {
    try {
      const id = /^\d{1,12}$/.test(req.params.id) ? Number(req.params.id) : null;
      if (!id || !(await potes.estMembre(await profilDe(req), id))) return res.status(404).json({ erreur: 'Groupe introuvable.' });
      req.groupe = id;
      next();
    } catch (err) {
      next(err);
    }
  };
  const texte = (v, min, max) => (typeof v === 'string' && v.trim().length >= min && v.trim().length <= max ? v.trim() : null);
  const route = (fn) => async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (err) {
      next(err);
    }
  };

  // Relie ce compte au profil de l'installation (tous les comptes d'un même PC
  // forment une seule personne). `pseudo` : renommer son profil.
  r.post('/identite', route(async (req, res) => {
    const installation = /^[\w-]{16,80}$/.test(req.body?.installation ?? '') ? req.body.installation : null;
    const profil = await potes.assurerProfil(req.account.puuid, installation);
    const pseudo = texte(req.body?.pseudo, 2, 20);
    if (pseudo) await query('update profils set pseudo = $2 where id = $1', [profil, pseudo]);
    res.json(await potes.identite(profil));
  }));

  r.get('/groupes', route(async (req, res) => {
    res.json({ groupes: await potes.mesGroupes(await profilDe(req)) });
  }));

  r.post('/groupes', rateLimit({ max: 10, windowMs: 60 * 60 * 1000 }), route(async (req, res) => {
    const nom = texte(req.body?.nom, 2, 32);
    if (!nom) return res.status(400).json({ erreur: 'Un nom de 2 à 32 caractères.' });
    res.status(201).json({ id: await potes.creerGroupe(await profilDe(req), nom) });
  }));

  r.post('/groupes/rejoindre', rateLimit({ max: 20, windowMs: 60 * 60 * 1000 }), route(async (req, res) => {
    const out = await potes.rejoindre(await profilDe(req), String(req.body?.code ?? '').slice(0, 12));
    res.status(out.erreur ? 404 : 200).json(out);
  }));

  r.get('/groupes/:id', membre, route(async (req, res) => {
    res.json(await potes.detail(req.groupe, await profilDe(req)));
  }));

  r.post('/groupes/:id/quitter', membre, route(async (req, res) => {
    await potes.quitter(await profilDe(req), req.groupe);
    res.status(204).end();
  }));

  r.post('/groupes/:id/reglages', membre, route(async (req, res) => {
    if (typeof req.body?.chambrage === 'boolean') await query('update groupes set chambrage = $2 where id = $1', [req.groupe, req.body.chambrage]);
    res.status(204).end();
  }));

  r.post('/groupes/:id/apercu', membre, rateLimit({ max: 6, windowMs: 60 * 60 * 1000 }), route(async (req, res) => {
    res.json(await potes.apercu(req.groupe, await profilDe(req)));
  }));

  // Lier le salon Discord du groupe (URL de webhook, vérifiée auprès de Discord).
  r.post('/groupes/:id/discord', membre, rateLimit({ max: 10, windowMs: 60 * 60 * 1000 }), route(async (req, res) => {
    const w = await verifierWebhook(req.body?.webhook);
    if (w.erreur) return res.status(400).json(w);
    await query('update groupes set webhook = $2, discord_guild = $3, discord_salon = $4, discord_nom = $5 where id = $1', [req.groupe, w.url, w.guild, w.salon, w.nom]);
    res.json({ nom: w.nom });
  }));

  r.delete('/groupes/:id/discord', membre, route(async (req, res) => {
    await query('update groupes set webhook = null, discord_guild = null, discord_salon = null, discord_nom = null where id = $1', [req.groupe]);
    res.status(204).end();
  }));

  // Le fil de tous mes groupes depuis un événement (l'app repasse toutes les minutes).
  r.get('/fil', route(async (req, res) => {
    const profil = await profilDe(req);
    const ids = (await potes.mesGroupes(profil)).map((g) => g.id);
    const depuis = Number(req.query.depuis) || 0;
    res.json({ fil: await potes.fil(ids, profil, { depuis, limite: depuis ? 20 : 1 }) });
  }));

  r.post('/fil/:id/reaction', route(async (req, res) => {
    const type = req.body?.type ?? null;
    if (type !== null && !potes.REACTIONS.includes(type)) return res.status(400).json({ erreur: 'Réaction inconnue.' });
    const id = /^\d{1,15}$/.test(req.params.id) ? Number(req.params.id) : 0;
    res.status((await potes.reagir(await profilDe(req), id, type)) ? 204 : 404).end();
  }));

  // Coach : le focus du moment, sur les dernières parties à ton poste.
  r.get('/coach', needRiot, rateLimit({ max: 60, windowMs: 60_000 }), async (req, res, next) => {
    try {
      res.json(await coach(riot, req.account));
    } catch (err) {
      next(err);
    }
  });

  // Variation de PL mesurée par l'app sur le client, à la fin d'une partie.
  r.post('/lp', async (req, res, next) => {
    try {
      const { matchId, queue, delta, lpAfter, tierAfter, divisionAfter } = req.body ?? {};
      const okInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
      if (!MATCH_ID.test(matchId ?? '') || !['RANKED_SOLO_5x5', 'RANKED_FLEX_SR'].includes(queue) || !okInt(delta, -100, 100)) {
        return res.status(400).json({ erreur: 'Variation de PL invalide.' });
      }
      await query(
        `insert into lp_changes (puuid, match_id, queue, delta, lp_after, tier_after, division_after)
         values ($1, $2, $3, $4, $5, $6, $7) on conflict (puuid, match_id) do nothing`,
        [
          req.account.puuid, matchId, queue, delta,
          okInt(lpAfter, 0, 5000) ? lpAfter : null,
          TIERS.includes(tierAfter) ? tierAfter : null,
          Object.hasOwn(DIVS, divisionAfter ?? '') ? divisionAfter : null,
        ],
      );
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  r.use((err, req, res, next) => {
    console.error('api/app :', err.message);
    const status = err.status === 403 || err.status === 401 ? 502 : 500;
    res.status(status).json({ erreur: status === 502 ? "L'API Riot refuse la clé du serveur (expirée ?)." : 'Erreur serveur.' });
  });

  return r;
}
