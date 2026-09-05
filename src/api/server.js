import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import {
  query,
  loadGroupMembers,
  loadWeekRr,
  getWeeklyHistory,
  loadDeaths,
  loadPlayerMatches,
  saveRrEntries,
  findOrCreateDiscordUser,
  getSessionUser,
  claimRiotAccount,
  createGroup,
  groupByInviteToken,
  joinGroup,
  isGroupMember,
  listMyGroups,
  loadPeerMeasures,
  loadMatchScoreboard,
  getRiotAccount,
  creerCodeAppairage,
  lireCodeAppairage,
  appairerAppareil,
  appareilParJeton,
  toucherAppareil,
  listerAppareils,
  revoquerAppareil,
  marquerVerifie,
} from '../db/index.js';
import { config } from '../config.js';
import { resolveAccount, getRrHistory } from '../services/henrikdev.js';
import { getPublicKey, pushToUser } from '../services/notifications.js';
import { weekStartOf, weekLabel, weekBounds, buildLeaderboard } from '../services/leaderboard.js';
import { buildCoachReport } from '../services/coach.js';
import { askCoach, MAX_HISTORIQUE } from '../services/chat.js';
import { verifierQuota, consommerQuota } from '../services/quota.js';
import {
  genererCode, normaliserCode, genererJeton, empreinte, codeUtilisable,
  decisionVerification, MESSAGES_VERIFICATION, DUREE_CODE_MINUTES,
} from '../services/devices.js';
import { getCalibration } from '../services/maps.js';
import { getVisuels } from '../services/visuels.js';
import * as discord from '../services/discord.js';
import { safeNext } from '../services/urls.js';
import { wrap } from '../services/http.js';
import {
  createSession,
  readSession,
  readCookie,
  sessionCookie,
  clearCookie,
  randomToken,
} from '../services/session.js';

/**
 * API de "On lance ?".
 *
 * L'identite vient de Discord (Brique 4). Les groupes ne se rejoignent que par
 * lien d'invitation (Brique 6), et toute donnee de groupe exige d'en etre
 * membre.
 *
 * Ce qui n'est PAS encore garanti : qu'un Riot ID appartienne bien a celui qui
 * l'a saisi. Le champ `verified` reste a false partout, en attendant que l'app
 * desktop lise le lockfile du client Valorant (Brique 9).
 */

const app = express();
app.use(express.json());

// Render termine le TLS en amont : sans ce reglage, req.protocol vaudrait "http"
// et les URL de redirection OAuth seraient construites en clair.
app.set('trust proxy', 1);

// Fichiers statiques, dont le service worker. Il DOIT etre servi depuis la
// racine (/sw.js) : un service worker ne controle que les pages situees a son
// niveau ou en dessous.
const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, '../../public');

app.use(express.static(publicDir));
app.get('/', (_req, res) => res.sendFile(join(publicDir, 'landing.html')));

const shortCode = () => Math.random().toString(36).slice(2, 8).toUpperCase();


app.get('/health', (_req, res) => res.json({ ok: true }));

/**
 * Icônes d'agents et visuels de maps, pour l'habillage de l'historique.
 *
 * Publique et fortement cachee : ce sont des donnees Riot immuables, identiques
 * pour tout le monde, et le navigateur ne doit pas les redemander a chaque
 * navigation.
 */
app.get('/visuels', wrap(async (_req, res) => {
  res.set('Cache-Control', 'public, max-age=86400');
  res.json(await getVisuels());
}));

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/** Attache req.userId quand un cookie de session valide est present. */
app.use((req, _res, next) => {
  req.userId = readSession(readCookie(req.headers.cookie));
  next();
});

/** Barriere pour tout ce qui touche aux donnees d'une personne. */
const requireAuth = (req, res, next) => {
  if (!req.userId) return res.status(401).json({ error: 'Connexion requise' });
  next();
};

/**
 * Barriere de groupe : etre connecte ne suffit pas, il faut etre membre.
 * C'est ce qui empeche de lire le classement ou l'historique d'un groupe dont
 * on n'a pas recu le lien d'invitation.
 */
const requireMember = wrap(async (req, res, next) => {
  if (!req.userId) return res.status(401).json({ error: 'Connexion requise' });
  if (!(await isGroupMember(req.params.id, req.userId))) {
    return res.status(403).json({ error: "Tu n'es pas membre de ce groupe" });
  }
  next();
});

// ---------------------------------------------------------------------------
// Brique 9 — appareils appairés
// ---------------------------------------------------------------------------

/**
 * Barriere pour l'application desktop.
 *
 * Elle ne presente pas un cookie de session mais un jeton d'appareil, dont seule
 * l'empreinte est en base. Un jeton inconnu est refuse sans distinguer "expire"
 * de "inexistant" : rien a apprendre pour qui essaierait au hasard.
 */
const requireDevice = wrap(async (req, res, next) => {
  const entete = req.headers.authorization ?? '';
  const jeton = entete.startsWith('Bearer ') ? entete.slice(7) : null;
  if (!jeton) return res.status(401).json({ error: 'Jeton d\'appareil requis' });

  const appareil = await appareilParJeton(empreinte(jeton));
  if (!appareil) return res.status(401).json({ error: 'Appareil inconnu ou révoqué' });

  req.appareil = appareil;
  next();
});

/** Un code a recopier dans l'application. Affiche sur le site, valable 10 min. */
app.post('/me/devices/code', requireAuth, wrap(async (req, res) => {
  const ligne = await creerCodeAppairage({
    userId: req.userId,
    code: genererCode(),
    dureeMinutes: DUREE_CODE_MINUTES,
  });
  res.json({ code: ligne.code, expiresAt: ligne.expires_at, dureeMinutes: DUREE_CODE_MINUTES });
}));

app.get('/me/devices', requireAuth, wrap(async (req, res) => {
  res.json({ appareils: await listerAppareils(req.userId) });
}));

app.delete('/me/devices/:id', requireAuth, wrap(async (req, res) => {
  const ok = await revoquerAppareil({ userId: req.userId, deviceId: req.params.id });
  if (!ok) return res.status(404).json({ error: 'Appareil introuvable' });
  res.json({ ok: true });
}));

/**
 * Appairage : l'application echange un code contre un jeton long.
 *
 * C'est aussi le moment ou le compte Valorant peut enfin etre VERIFIE. Le puuid
 * est lu dans le client Riot installe sur la machine : personne ne peut le
 * fabriquer sans y etre reellement connecte.
 *
 * Si ce puuid ne correspond pas au Riot ID declare sur le site, on ne rebranche
 * rien tout seul — on le signale. Rebasculer un compte en silence est
 * exactement le bug que la brique 4 a passe son temps a reparer.
 */
app.post('/devices/pair', wrap(async (req, res) => {
  const code = normaliserCode(req.body?.code);
  if (!code) return res.status(400).json({ error: 'Code d\'appairage requis' });

  const ligne = await lireCodeAppairage(code);
  if (!codeUtilisable(ligne)) {
    return res.status(404).json({ error: 'Code inconnu, déjà utilisé ou expiré' });
  }

  const puuidLocal = typeof req.body?.puuid === 'string' ? req.body.puuid : null;
  const jeton = genererJeton();

  const appareil = await appairerAppareil({
    code,
    userId: ligne.user_id,
    nom: String(req.body?.nom ?? 'PC').slice(0, 60),
    tokenHash: empreinte(jeton),
    puuidLocal,
    version: String(req.body?.version ?? '').slice(0, 20) || null,
  });
  // Consomme entre-temps par un autre appairage.
  if (!appareil) return res.status(409).json({ error: 'Code déjà utilisé' });

  const compte = await getRiotAccount(ligne.user_id);
  const decision = decisionVerification({ puuidLocal, puuidLie: compte?.puuid ?? null });
  if (decision === 'verifie') await marquerVerifie({ userId: ligne.user_id, puuid: puuidLocal });

  const moi = await getSessionUser(ligne.user_id);

  res.status(201).json({
    jeton,
    appareil: { id: appareil.id, nom: appareil.nom },
    utilisateur: { displayName: moi?.displayName ?? null, riotId: moi?.riotId ?? null },
    verification: decision,
    message: MESSAGES_VERIFICATION[decision],
  });
}));

/**
 * Battement de coeur de l'application.
 *
 * Sert a deux choses : savoir qu'un PC est encore appaire, et — quand la brique
 * sera complete — recevoir l'etat de partie en direct sans passer par HenrikDev.
 */
app.post('/devices/heartbeat', requireDevice, wrap(async (req, res) => {
  await toucherAppareil(req.appareil.id, { version: req.body?.version ?? null });
  res.json({
    ok: true,
    utilisateur: req.appareil.display_name,
    verifie: req.appareil.verified === true,
  });
}));

// ---------------------------------------------------------------------------
// Authentification Discord
// ---------------------------------------------------------------------------

const redirectUri = () => `${config.baseUrl}/auth/discord/callback`;

/**
 * Depart vers Discord.
 *
 * `state` est un jeton aleatoire depose dans un cookie court et revérifié au
 * retour : sans lui, un tiers pourrait declencher une connexion a l'insu de
 * l'utilisateur. `next` permet de revenir sur la page d'ou l'on venait — un
 * chemin interne uniquement, pour ne pas servir de tremplin vers un site tiers.
 */
app.get('/auth/discord', (req, res) => {
  if (!discord.isConfigured()) {
    return res.status(503).json({ error: 'Connexion Discord non configuree sur le serveur' });
  }

  const state = randomToken(16);
  const next = safeNext(req.query.next);

  res.setHeader('Set-Cookie', [
    `onlance_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${config.session.secureCookies ? '; Secure' : ''}`,
    `onlance_next=${encodeURIComponent(next)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${config.session.secureCookies ? '; Secure' : ''}`,
  ]);
  res.redirect(discord.authorizeUrl({ state, redirectUri: redirectUri() }));
});

app.get('/auth/discord/callback', wrap(async (req, res) => {
  const { code, state } = req.query;
  const expected = readCookie(req.headers.cookie, 'onlance_state');
  const next = safeNext(readCookie(req.headers.cookie, 'onlance_next'));

  if (!code || !state || !expected || state !== expected) {
    return res.redirect('/login.html?erreur=state');
  }

  let identity;
  try {
    identity = await discord.fetchIdentity(code, redirectUri());
  } catch (err) {
    console.error('[auth] Discord :', err.message);
    return res.redirect('/login.html?erreur=discord');
  }

  const user = await findOrCreateDiscordUser(identity);

  res.setHeader('Set-Cookie', [
    sessionCookie(createSession(Number(user.id))),
    'onlance_state=; Path=/; Max-Age=0',
    'onlance_next=; Path=/; Max-Age=0',
  ]);
  res.redirect(next);
}));

app.post('/auth/logout', (_req, res) => {
  res.setHeader('Set-Cookie', clearCookie());
  res.json({ ok: true });
});

/** Qui suis-je. Renvoie 200 avec user: null si personne n'est connecte. */
app.get('/auth/me', wrap(async (req, res) => {
  if (!req.userId) return res.json({ user: null, discordConfigured: discord.isConfigured() });
  res.json({
    user: await getSessionUser(req.userId),
    discordConfigured: discord.isConfigured(),
  });
}));

// ---------------------------------------------------------------------------
// Compte Riot
// ---------------------------------------------------------------------------

/** Verifie qu'un Riot ID existe, sans rien ecrire ni exiger de connexion. */
app.get('/accounts/resolve', wrap(async (req, res) => {
  const { name, tag } = req.query;
  if (!name || !tag) return res.status(400).json({ error: 'name et tag requis' });

  const account = await resolveAccount(name, tag).catch(() => null);
  if (!account?.puuid) return res.status(404).json({ error: 'Compte Riot introuvable' });

  res.json({ name: account.name, tag: account.tag, region: account.region });
}));

/**
 * Rattache un Riot ID au compte connecte.
 *
 * Le cas interessant est l'adoption : un profil cree avant l'authentification
 * detient peut-etre ce Riot ID avec tout son historique. Personne ne le
 * possedant vraiment, on le recupere. Voir claimRiotAccount().
 */
app.post('/accounts/link', requireAuth, wrap(async (req, res) => {
  const { riotName, riotTag } = req.body;
  if (!riotName || !riotTag) return res.status(400).json({ error: 'riotName et riotTag requis' });

  const account = await resolveAccount(riotName, riotTag).catch(() => null);
  if (!account?.puuid) return res.status(404).json({ error: 'Compte Riot introuvable' });

  const result = await claimRiotAccount({
    userId: req.userId,
    puuid: account.puuid,
    riotName: account.name,
    riotTag: account.tag,
    region: account.region ?? 'eu',
  });

  if (result.status === 'taken') {
    return res.status(409).json({
      error: `Ce compte Valorant est déjà rattaché au profil de ${result.heldBy}.`,
      code: 'deja_pris',
    });
  }

  if (result.status === 'has_other') {
    return res.status(409).json({
      error: `Ton profil est déjà rattaché à ${result.current}. Un profil ne peut suivre qu'un seul compte Valorant.`,
      code: 'deja_un_compte',
    });
  }

  // Le pseudo affiche suit le Riot ID : c'est sous ce nom que les potes le
  // reconnaissent dans le classement, pas sous son pseudo Discord.
  await query('UPDATE users SET display_name = $1 WHERE id = $2', [account.name, req.userId]);

  res.json({
    status: result.status,
    riotId: `${account.name}#${account.tag}`,
    recupere: result.adopted ?? 0,
  });
}));

// ---------------------------------------------------------------------------
// Groupes (Brique 6)
// ---------------------------------------------------------------------------

app.get('/me/groups', requireAuth, wrap(async (req, res) => {
  res.json({ groups: await listMyGroups(req.userId) });
}));

app.post('/groups', requireAuth, wrap(async (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name) return res.status(400).json({ error: 'Donne un nom au groupe' });
  if (name.length > 40) return res.status(400).json({ error: 'Nom trop long (40 caractères max)' });

  const group = await createGroup({
    name,
    ownerUserId: req.userId,
    joinCode: shortCode(),
    inviteToken: randomToken(16),
  });

  res.status(201).json({
    ...group,
    inviteUrl: `${config.baseUrl}/rejoindre.html?i=${group.invite_token}`,
  });
}));

/**
 * Apercu d'une invitation, accessible sans etre connecte : l'invite doit savoir
 * ou il met les pieds avant de s'authentifier. On ne divulgue que le nom du
 * groupe, son proprietaire et le nombre de membres — jamais la liste ni les
 * donnees de jeu.
 */
app.get('/invite/:token', wrap(async (req, res) => {
  const group = await groupByInviteToken(req.params.token);
  if (!group) return res.status(404).json({ error: 'Invitation invalide ou expirée' });

  res.json({
    name: group.name,
    owner: group.owner,
    members: Number(group.members),
    alreadyMember: req.userId ? await isGroupMember(group.id, req.userId) : false,
  });
}));

app.post('/invite/:token/accept', requireAuth, wrap(async (req, res) => {
  const group = await groupByInviteToken(req.params.token);
  if (!group) return res.status(404).json({ error: 'Invitation invalide ou expirée' });

  const joined = await joinGroup({ groupId: group.id, userId: req.userId });
  res.json({ groupId: group.id, name: group.name, nouveau: joined });
}));

// ---------------------------------------------------------------------------
// Web Push
// ---------------------------------------------------------------------------

app.get('/push/public-key', (_req, res) => res.json({ publicKey: getPublicKey() }));

app.post('/push/subscribe', requireAuth, wrap(async (req, res) => {
  const { subscription } = req.body;
  if (!subscription?.endpoint || !subscription?.keys) {
    return res.status(400).json({ error: 'subscription requis' });
  }

  await query(
    `INSERT INTO push_subscriptions (user_id, endpoint, keys)
     VALUES ($1, $2, $3)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id,
                                          keys    = EXCLUDED.keys`,
    [req.userId, subscription.endpoint, JSON.stringify(subscription.keys)],
  );
  res.status(201).json({ ok: true });
}));

app.post('/push/test', requireAuth, wrap(async (req, res) => {
  res.json(await pushToUser(req.userId, {
    title: 'On lance ?',
    body: 'Si tu vois ce message, les notifs marchent.',
    tone: 'hype',
  }));
}));

// ---------------------------------------------------------------------------
// Donnees de groupe — reservees aux membres
// ---------------------------------------------------------------------------

app.get('/groups/:id/matches', requireMember, wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT match_id, map_name, mode, started_at, standings, processed_at
     FROM detected_matches WHERE group_id = $1
     ORDER BY processed_at DESC LIMIT 50`,
    [req.params.id],
  );
  res.json(rows);
}));

app.get('/groups/:id/leaderboard', requireMember, wrap(async (req, res) => {
  const week = req.query.week ?? weekStartOf(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) {
    return res.status(400).json({ error: 'week attendu au format YYYY-MM-DD' });
  }

  const members = (await loadGroupMembers(req.params.id)).filter((m) => m.puuid);
  const rrRows = await loadWeekRr(req.params.id, week);

  res.json({
    weekStart: week,
    label: weekLabel(week),
    endsAt: weekBounds(week).endsAt,
    isCurrentWeek: week === weekStartOf(new Date()),
    standings: buildLeaderboard({ members, rrRows }),
  });
}));

/**
 * Rafraichit le RR du groupe depuis l'API, puis renvoie le classement a jour.
 *
 * Le cron horaire suffit a la mecanique interne, pas a quelqu'un qui vient de
 * gagner trois games et veut voir son classement bouger.
 *
 * Un seul rafraichissement par minute et par groupe : sans ce garde-fou, un
 * onglet laisse ouvert viderait le quota de l'API HenrikDev.
 */
const lastRefresh = new Map();
const REFRESH_COOLDOWN_MS = 60_000;

app.post('/groups/:id/leaderboard/refresh', requireMember, wrap(async (req, res) => {
  const groupId = req.params.id;
  const week = weekStartOf(new Date());
  const members = (await loadGroupMembers(groupId)).filter((m) => m.puuid);

  const since = Date.now() - (lastRefresh.get(groupId) ?? 0);
  let refreshed = false;

  if (since >= REFRESH_COOLDOWN_MS) {
    lastRefresh.set(groupId, Date.now());
    refreshed = true;

    const floor = Date.now() - config.leaderboard.lookbackDays * 86_400_000;

    for (const m of members) {
      try {
        const entries = await getRrHistory(m.puuid, { region: 'eu' });
        const rows = entries
          .filter((e) => e.playedAt.getTime() >= floor)
          .map((e) => ({
            userId: m.userId, puuid: m.puuid, matchId: e.matchId,
            rrChange: e.rrChange, rrAfter: e.rrAfter, tier: e.tier, map: e.map,
            playedAt: e.playedAt, weekStart: weekStartOf(e.playedAt),
          }));
        if (rows.length > 0) await saveRrEntries(rows);
      } catch (err) {
        console.error(`[api] rafraichissement RR KO pour ${m.displayName}: ${err.message}`);
      }
    }
  }

  const rrRows = await loadWeekRr(groupId, week);
  res.json({
    weekStart: week,
    label: weekLabel(week),
    endsAt: weekBounds(week).endsAt,
    isCurrentWeek: true,
    refreshed,
    standings: buildLeaderboard({ members, rrRows }),
  });
}));

app.get('/groups/:id/leaderboard/history', requireMember, wrap(async (req, res) => {
  res.json(await getWeeklyHistory(req.params.id));
}));

// ---------------------------------------------------------------------------
// Donnees personnelles — toujours celles de l'utilisateur connecte
// ---------------------------------------------------------------------------

app.get('/me/notifications', requireAuth, wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT n.id, n.tone, n.kind, n.week_start, n.rank_in_group, n.body,
            n.status, n.created_at, d.map_name, d.match_id
     FROM notifications n
     LEFT JOIN detected_matches d ON d.id = n.detected_match_id
     WHERE n.user_id = $1
     ORDER BY n.created_at DESC LIMIT 50`,
    [req.userId],
  );
  res.json(rows);
}));

app.get('/me/matches', requireAuth, wrap(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit ?? 10), 1), 50);
  const offset = Math.max(Number(req.query.offset ?? 0), 0);
  res.json(await loadPlayerMatches(req.userId, { limit, offset }));
}));

app.get('/me/coach', requireAuth, wrap(async (req, res) => {
  const days = Number(req.query.days ?? 14);
  const me = await getSessionUser(req.userId);

  // Les mesures des dix joueurs de chacune de ses parties : c'est le groupe de
  // comparaison du barème. Absentes tant que le job d'analyse n'est pas passe,
  // auquel cas le coach retombe sur ses seuils fixes.
  const compte = await getRiotAccount(req.userId);
  const peerMeasures = compte ? await loadPeerMeasures(compte.puuid, { sinceDays: days }) : [];

  const deaths = await loadDeaths(req.userId, { sinceDays: days });
  if (deaths.length === 0) {
    return res.json({
      periodLabel: `les ${days} derniers jours`,
      deaths: 0,
      message: "Aucune mort analysee sur la periode. Le job d'analyse tourne toutes les heures.",
    });
  }

  // L'IA n'est appelee que sur demande explicite : sans ce garde-fou, chaque
  // affichage du dashboard declencherait un appel facture pour un texte qui ne
  // change quasiment pas d'une heure a l'autre.
  res.json(
    await buildCoachReport({
      playerName: me?.displayName ?? 'toi',
      deaths,
      periodLabel: `les ${days} derniers jours`,
      peerMeasures,
      puuid: compte?.puuid ?? null,
      generate: req.query.generate === '1',
    }),
  );
}));

/**
 * Feuille de match complete, pour le panneau deroulant de l'historique.
 *
 * Reservee aux parties que le demandeur a lui-meme jouees : sans ce filtre,
 * n'importe qui pourrait lire le tableau de n'importe quel match en devinant
 * un identifiant.
 */
app.get('/me/matches/:matchId/scoreboard', requireAuth, wrap(async (req, res) => {
  const compte = await getRiotAccount(req.userId);
  if (!compte) return res.status(404).json({ error: 'Aucun compte Valorant rattaché' });

  const joueurs = await loadMatchScoreboard(req.params.matchId);
  if (joueurs.length === 0) {
    return res.status(404).json({
      error: "Feuille de match indisponible : cette partie a été analysée avant l'ajout de cette fonctionnalité.",
      code: 'pas_de_feuille',
    });
  }

  if (!joueurs.some((j) => j.puuid === compte.puuid)) {
    return res.status(403).json({ error: "Tu n'as pas joué cette partie" });
  }

  // Le puuid n'a rien a faire dans une reponse publique.
  res.json({
    matchId: req.params.matchId,
    moi: compte.puuid,
    joueurs: joueurs.map(({ puuid, ...reste }) => ({ ...reste, moi: puuid === compte.puuid })),
  });
}));

/**
 * Brique 8 — poser une question au coach.
 *
 * La conversation n'est pas stockee : l'historique fait l'aller-retour depuis le
 * navigateur, borne cote serveur. Rien a purger, rien a fuiter, et une question
 * sur ses propres morts n'a pas vocation a survivre a la fermeture de l'onglet.
 *
 * Le contexte envoye au modele est reconstruit a chaque appel a partir de la
 * base : impossible pour le client d'injecter des faits.
 */
const QUOTA_EPUISE = "Désolé ! L'accès à l'IA n'est pas encore autorisé en illimité, "
  + 'faute de fonds. Dès que le projet prendra plus d\'ampleur, les chats deviendront illimités !';

app.post('/me/coach/chat', requireAuth, wrap(async (req, res) => {
  const question = String(req.body?.question ?? '').trim();
  if (!question) return res.status(400).json({ error: 'Pose une question' });
  if (question.length > 500) {
    return res.status(400).json({ error: 'Question trop longue (500 caractères max)' });
  }

  const fenetreMs = config.chat.fenetreMinutes * 60_000;
  const quota = verifierQuota(req.userId, { max: config.chat.max, fenetreMs });
  if (!quota.autorise) {
    return res.status(429).json({
      error: QUOTA_EPUISE,
      code: 'quota',
      reprendDansSecondes: Math.ceil(quota.reprendDansMs / 1000),
    });
  }

  const days = Math.min(Math.max(Number(req.body?.days ?? 14), 1), 60);
  const me = await getSessionUser(req.userId);
  const compte = await getRiotAccount(req.userId);

  const deaths = await loadDeaths(req.userId, { sinceDays: days });
  if (deaths.length === 0) {
    return res.json({
      reply: "Je n'ai encore aucune mort analysée sur cette période, donc rien à te dire "
        + "qui vaille quelque chose. Le job d'analyse tourne toutes les heures.",
      generated: false,
    });
  }

  // A partir d'ici on va appeler le modele : la question est comptee. Une
  // periode sans donnees, elle, n'entame pas le quota.
  consommerQuota(req.userId);

  const peerMeasures = compte ? await loadPeerMeasures(compte.puuid, { sinceDays: days }) : [];

  const report = await buildCoachReport({
    playerName: me?.displayName ?? 'toi',
    deaths,
    periodLabel: `les ${days} derniers jours`,
    peerMeasures,
    puuid: compte?.puuid ?? null,
    generate: false, // on ne veut que les faits : c'est le chat qui parle
  });

  // Une mort precise, designee par le match et le round. On la retrouve dans ce
  // qu'on vient de charger plutot que de faire confiance au client.
  let mortChoisie = null;
  const { matchId, round } = req.body ?? {};
  if (matchId && round !== undefined) {
    mortChoisie = deaths.find((d) => d.matchId === matchId && d.round === Number(round)) ?? null;
  }

  const historique = Array.isArray(req.body?.historique)
    ? req.body.historique.slice(-MAX_HISTORIQUE)
    : [];

  const out = await askCoach({
    playerName: me?.displayName ?? 'toi',
    periodLabel: `les ${days} derniers jours`,
    report, mortChoisie, question, historique,
  });

  res.json({
    ...out,
    mortTrouvee: Boolean(mortChoisie),
    // Le nombre restant s'affiche a cote du champ : mieux vaut le savoir avant
    // de taper que de se le voir refuser apres.
    restantes: quota.restantes - 1,
  });
}));

app.get('/me/heatmap', requireAuth, wrap(async (req, res) => {
  const mapName = req.query.map;
  if (!mapName) return res.status(400).json({ error: 'parametre map requis' });

  const deaths = await loadDeaths(req.userId, {
    sinceDays: Number(req.query.days ?? 30),
    mapName,
  });
  const calibration = await getCalibration(mapName);

  res.json({
    map: mapName,
    minimapUrl: calibration?.minimapUrl ?? null,
    points: deaths.filter((d) => d.minimap).map((d) => ({
      x: d.minimap.x,
      y: d.minimap.y,
      isolated: d.isolated,
      lastAlive: d.lastAlive,
      nearestTeammate: d.nearestTeammate,
      duelDistance: d.duelDistance,
      round: d.round,
      matchId: d.matchId,
      playedAt: d.playedAt,
      weapon: d.weapon,
      timeInRoundMs: d.timeInRoundMs,
      tradePossible: d.tradePossible,
    })),
  });
}));

const port = process.env.PORT ?? 3000;
app.listen(port, () => {
  console.log(`[api] ${config.baseUrl} (port ${port})`);
  if (!discord.isConfigured()) console.warn('[api] DISCORD_CLIENT_ID/SECRET absents : connexion impossible');
  if (!config.session.secret) console.warn('[api] SESSION_SECRET absent : les sessions ne sont pas signees');
});
