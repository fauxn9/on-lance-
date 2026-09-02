import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import {
  query,
  loadGroupMembers,
  loadWeekRr,
  getWeeklyHistory,
  loadDeaths,
} from '../db/index.js';
import { resolveAccount } from '../services/henrikdev.js';
import { getPublicKey, pushToUser } from '../services/notifications.js';
import { weekStartOf, weekLabel, buildLeaderboard } from '../services/leaderboard.js';
import { buildCoachReport } from '../services/coach.js';
import { getCalibration } from '../services/maps.js';

/**
 * API minimale de la Brique 1.
 *
 * Volontairement reduite au strict necessaire pour que le groupe de potes
 * puisse s'inscrire et lier ses comptes. Pas d'auth pour l'instant : a ajouter
 * avant toute ouverture au-dela du cercle de test (voir README).
 */

const app = express();
app.use(express.json());

// Fichiers statiques : landing, dashboard coach, page d'abonnement, et surtout
// le service worker.
//
// Le service worker DOIT etre servi depuis la racine (/sw.js) : un service
// worker ne controle que les pages situees a son niveau ou en dessous. Servi
// depuis un sous-dossier, l'abonnement aux notifications ne fonctionnerait pas.
const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, '../../public');

app.use(express.static(publicDir));
app.get('/', (_req, res) => res.sendFile(join(publicDir, 'landing.html')));

const wrap = (fn) => (req, res) => fn(req, res).catch((e) => {
  console.error(e);
  res.status(500).json({ error: e.message });
});

function joinCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

app.get('/health', (_req, res) => res.json({ ok: true }));

// --- Users -----------------------------------------------------------------

app.post('/users', wrap(async (req, res) => {
  const { displayName } = req.body;
  if (!displayName) return res.status(400).json({ error: 'displayName requis' });

  const { rows } = await query(
    'INSERT INTO users (display_name) VALUES ($1) RETURNING id, display_name',
    [displayName],
  );
  res.status(201).json(rows[0]);
}));

// --- Groupes ---------------------------------------------------------------

app.post('/groups', wrap(async (req, res) => {
  const { name, userId } = req.body;
  if (!name || !userId) return res.status(400).json({ error: 'name et userId requis' });

  const { rows } = await query(
    'INSERT INTO groups (name, join_code) VALUES ($1, $2) RETURNING id, name, join_code',
    [name, joinCode()],
  );
  const group = rows[0];
  await query('INSERT INTO memberships (group_id, user_id) VALUES ($1, $2)', [group.id, userId]);
  res.status(201).json(group);
}));

app.post('/groups/join', wrap(async (req, res) => {
  const { joinCode: code, userId } = req.body;
  if (!code || !userId) return res.status(400).json({ error: 'joinCode et userId requis' });

  const { rows } = await query('SELECT id, name FROM groups WHERE join_code = $1', [code.toUpperCase()]);
  if (rows.length === 0) return res.status(404).json({ error: 'Groupe introuvable' });

  await query(
    'INSERT INTO memberships (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [rows[0].id, userId],
  );
  res.json(rows[0]);
}));

// --- Liaison du compte Riot ------------------------------------------------

/**
 * Verifie qu'un Riot ID existe, sans rien ecrire.
 *
 * Sert a valider la saisie AVANT de creer le compte : sans ca, un pseudo mal
 * tape laisserait derriere lui un utilisateur orphelin en base a chaque essai.
 */
app.get('/accounts/resolve', wrap(async (req, res) => {
  const { name, tag } = req.query;
  if (!name || !tag) return res.status(400).json({ error: 'name et tag requis' });

  const account = await resolveAccount(name, tag).catch(() => null);
  if (!account?.puuid) return res.status(404).json({ error: 'Compte Riot introuvable' });

  res.json({ name: account.name, tag: account.tag, region: account.region });
}));

app.post('/accounts/link', wrap(async (req, res) => {
  const { userId, riotName, riotTag } = req.body;
  if (!userId || !riotName || !riotTag) {
    return res.status(400).json({ error: 'userId, riotName et riotTag requis' });
  }

  // On resout le puuid une seule fois ici : c'est lui qui sert de cle de
  // jointure ensuite, car un name#tag peut changer.
  const account = await resolveAccount(riotName, riotTag);
  if (!account?.puuid) return res.status(404).json({ error: 'Compte Riot introuvable' });

  const { rows } = await query(
    `INSERT INTO linked_riot_accounts (user_id, puuid, riot_name, riot_tag, region)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (puuid) DO UPDATE SET user_id = EXCLUDED.user_id,
                                       riot_name = EXCLUDED.riot_name,
                                       riot_tag  = EXCLUDED.riot_tag
     RETURNING id, puuid, riot_name, riot_tag, region`,
    [userId, account.puuid, account.name, account.tag, account.region ?? 'eu'],
  );
  res.status(201).json(rows[0]);
}));

// --- Web Push --------------------------------------------------------------

app.get('/push/public-key', (_req, res) => res.json({ publicKey: getPublicKey() }));

app.post('/push/subscribe', wrap(async (req, res) => {
  const { userId, subscription } = req.body;
  if (!userId || !subscription?.endpoint || !subscription?.keys) {
    return res.status(400).json({ error: 'userId et subscription requis' });
  }

  await query(
    `INSERT INTO push_subscriptions (user_id, endpoint, keys)
     VALUES ($1, $2, $3)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id,
                                          keys    = EXCLUDED.keys`,
    [userId, subscription.endpoint, JSON.stringify(subscription.keys)],
  );
  res.status(201).json({ ok: true });
}));

// Envoie une notif de test a un user, sans passer par la detection.
// Pratique pour verifier que le navigateur recoit bien avant de jouer.
app.post('/push/test', wrap(async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId requis' });

  const result = await pushToUser(userId, {
    title: 'On lance ?',
    body: 'Si tu vois ce message, les notifs marchent.',
    tone: 'hype',
  });
  res.json(result);
}));

// --- Historique et notifications ------------------------------------------

app.get('/groups/:id/matches', wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT match_id, map_name, mode, started_at, standings, processed_at
     FROM detected_matches WHERE group_id = $1
     ORDER BY processed_at DESC LIMIT 50`,
    [req.params.id],
  );
  res.json(rows);
}));

app.get('/users/:id/notifications', wrap(async (req, res) => {
  // LEFT JOIN : les notifs hebdo n'ont pas de match rattache (voir notifications.js).
  const { rows } = await query(
    `SELECT n.id, n.tone, n.kind, n.week_start, n.rank_in_group, n.body,
            n.status, n.created_at, d.map_name, d.match_id
     FROM notifications n
     LEFT JOIN detected_matches d ON d.id = n.detected_match_id
     WHERE n.user_id = $1
     ORDER BY n.created_at DESC LIMIT 50`,
    [req.params.id],
  );
  res.json(rows);
}));

// --- Leaderboard hebdomadaire (Brique 2) -----------------------------------

/**
 * Classement de la semaine en cours (calcule a la volee), ou d'une semaine
 * passee via ?week=YYYY-MM-DD.
 *
 * Note : pour une semaine deja cloturee, c'est /leaderboard/history qui fait
 * foi — ce classement-ci est recalcule a partir des membres actuels du groupe.
 */
app.get('/groups/:id/leaderboard', wrap(async (req, res) => {
  const week = req.query.week ?? weekStartOf(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) {
    return res.status(400).json({ error: 'week attendu au format YYYY-MM-DD' });
  }

  const members = (await loadGroupMembers(req.params.id)).filter((m) => m.puuid);
  if (members.length === 0) return res.status(404).json({ error: 'Groupe introuvable ou sans compte lie' });

  const rrRows = await loadWeekRr(req.params.id, week);
  res.json({
    weekStart: week,
    label: weekLabel(week),
    standings: buildLeaderboard({ members, rrRows }),
  });
}));

/** Historique des vainqueurs des semaines passees (classements figes). */
app.get('/groups/:id/leaderboard/history', wrap(async (req, res) => {
  res.json(await getWeeklyHistory(req.params.id));
}));

// --- Coach positionnel (Brique 3) ------------------------------------------

/**
 * Rapport de coaching : les faits calcules (etage 1) ET leur mise en mots
 * (etage 2). Le dashboard peut afficher les deux — les chiffres restent
 * verifiables meme si la generation IA echoue.
 */
app.get('/users/:id/coach', wrap(async (req, res) => {
  const days = Number(req.query.days ?? 14);
  const { rows } = await query('SELECT display_name FROM users WHERE id = $1', [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'Utilisateur introuvable' });

  const deaths = await loadDeaths(req.params.id, { sinceDays: days });
  if (deaths.length === 0) {
    return res.json({
      periodLabel: `les ${days} derniers jours`,
      deaths: 0,
      message: "Aucune mort analysee sur la periode. Lancer npm run pos:analyze apres quelques matchs.",
    });
  }

  res.json(
    await buildCoachReport({
      playerName: rows[0].display_name,
      deaths,
      periodLabel: `les ${days} derniers jours`,
    }),
  );
}));

/**
 * Points de heatmap pour une map donnee.
 *
 * Les coordonnees sont deja en fraction [0, 1] de l'image de minimap : le front
 * n'a qu'a les multiplier par la taille d'affichage, aucune calibration cote
 * client.
 */
app.get('/users/:id/heatmap', wrap(async (req, res) => {
  const mapName = req.query.map;
  if (!mapName) return res.status(400).json({ error: 'parametre map requis' });

  const deaths = await loadDeaths(req.params.id, {
    sinceDays: Number(req.query.days ?? 30),
    mapName,
  });

  const calibration = await getCalibration(mapName);

  res.json({
    map: mapName,
    minimapUrl: calibration?.minimapUrl ?? null,
    points: deaths
      .filter((d) => d.minimap)
      .map((d) => ({
        x: d.minimap.x,
        y: d.minimap.y,
        isolated: d.isolated,
        lastAlive: d.lastAlive,
        nearestTeammate: d.nearestTeammate,
        duelDistance: d.duelDistance,
        round: d.round,
        matchId: d.matchId,
        playedAt: d.playedAt,
      })),
  });
}));

const port = process.env.PORT ?? 3000;
app.listen(port, () => console.log(`[api] http://localhost:${port}`));
