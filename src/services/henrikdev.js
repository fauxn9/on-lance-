import { config } from '../config.js';

/**
 * Client HenrikDev (API communautaire Valorant non-officielle).
 *
 * ⚠️ POINT D'ADAPTATION UNIQUE DU PROJET
 * Toute la connaissance de la forme des reponses de l'API est concentree ici,
 * dans `normalizeMatch()`. Si HenrikDev change son schema (ca arrive), c'est le
 * SEUL fichier a corriger : le reste du code ne manipule que des objets
 * normalises (voir le "contrat" plus bas).
 *
 * Contrat de sortie de normalizeMatch() :
 * {
 *   matchId: string,
 *   map: string,
 *   mode: string,
 *   startedAt: Date,
 *   roundsPlayed: number,
 *   players: [{
 *     puuid, name, tag, teamId, agent,
 *     score, kills, deaths, assists,
 *     headshots, bodyshots, legshots,
 *     damageDealt,
 *     won: boolean
 *   }]
 * }
 *
 * Contrat de sortie de normalizeRrEntry() (Brique 2 — leaderboard hebdo) :
 * {
 *   matchId: string,
 *   rrChange: number,     // RR gagne (+) ou perdu (-) sur ce match
 *   rrAfter: number|null, // RR restant apres le match
 *   tier: string|null,    // ex. "Platinum 1"
 *   map: string|null,
 *   playedAt: Date,
 *   refundedRr: number,
 *   derankProtected: boolean
 * }
 */

// ---------------------------------------------------------------------------
// Rate limiter (token bucket simple, en memoire)
// ---------------------------------------------------------------------------
// Les cles gratuites HenrikDev sont serrees. Plutot que de se prendre des 429
// en pleine detection, on espace nous-memes les requetes.

class RateLimiter {
  constructor(requestsPerMinute) {
    this.intervalMs = Math.ceil(60_000 / requestsPerMinute);
    this.lastCall = 0;
  }

  async wait() {
    const now = Date.now();
    const elapsed = now - this.lastCall;
    if (elapsed < this.intervalMs) {
      await new Promise((r) => setTimeout(r, this.intervalMs - elapsed));
    }
    this.lastCall = Date.now();
  }
}

const limiter = new RateLimiter(config.henrik.requestsPerMinute);

// ---------------------------------------------------------------------------
// Cache memoire court
// ---------------------------------------------------------------------------
// Le meme match apparait dans la matchlist de plusieurs membres du groupe.
// Sans cache, on paierait N appels pour la meme donnee a chaque passage du cron.

const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value) {
  cache.set(key, { value, at: Date.now() });
}

// ---------------------------------------------------------------------------
// Appel HTTP
// ---------------------------------------------------------------------------

async function request(path, { retries = 2 } = {}) {
  const cached = cacheGet(path);
  if (cached) return cached;

  await limiter.wait();

  const res = await fetch(`${config.henrik.baseUrl}${path}`, {
    headers: {
      Authorization: config.henrik.apiKey,
      Accept: 'application/json',
    },
  });

  if (res.status === 429 && retries > 0) {
    // Backoff : on respecte Retry-After si l'API le fournit, sinon 5s.
    const retryAfter = Number(res.headers.get('retry-after')) || 5;
    console.warn(`[henrik] 429 rate limit, pause ${retryAfter}s...`);
    await new Promise((r) => setTimeout(r, retryAfter * 1000));
    return request(path, { retries: retries - 1 });
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`[henrik] ${res.status} sur ${path} — ${body.slice(0, 200)}`);
  }

  const json = await res.json();
  cacheSet(path, json);
  return json;
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

/**
 * Resout un Riot ID (name#tag) en puuid.
 * Appele une seule fois, au moment ou un user lie son compte : le puuid est
 * ensuite stocke en base, car le name#tag peut changer mais pas le puuid.
 */
export async function resolveAccount(name, tag) {
  const json = await request(
    `/valorant/v2/account/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`,
  );
  const d = json.data ?? {};
  return {
    puuid: d.puuid,
    name: d.name,
    tag: d.tag,
    region: d.region,
  };
}

/**
 * Recupere les N derniers matchs d'un joueur, DEJA normalises.
 *
 * Note d'archi importante : cet endpoint renvoie le match complet, avec le
 * scoreboard de TOUS les joueurs. On n'a donc PAS besoin d'un second appel par
 * membre du groupe pour reconstituer le classement — un seul appel suffit et on
 * y retrouve tout le monde. C'est ce qui rend la detection peu couteuse en quota.
 */
export async function getRecentMatches(puuid, { region = 'eu', platform = 'pc', mode = 'competitive' } = {}) {
  const size = config.henrik.matchesPerPlayer;
  const json = await request(
    `/valorant/v4/by-puuid/matches/${region}/${platform}/${encodeURIComponent(puuid)}` +
      `?mode=${mode}&size=${size}`,
  );
  const matches = Array.isArray(json.data) ? json.data : [];
  return matches.map(normalizeMatch).filter(Boolean);
}

/**
 * Memes matchs, mais bruts (Brique 3).
 *
 * `normalizeMatch()` ne garde volontairement que le scoreboard : les evenements
 * de kill, avec leurs positions, n'y figurent pas. Le coach positionnel a besoin
 * de la reponse complete.
 *
 * A noter : cet appel passe par le meme cache que getRecentMatches (meme URL),
 * donc appeler les deux a la suite ne coute qu'une seule requete a l'API.
 */
export async function getRawMatches(puuid, { region = 'eu', platform = 'pc', mode = 'competitive' } = {}) {
  const size = config.henrik.matchesPerPlayer;
  const json = await request(
    `/valorant/v4/by-puuid/matches/${region}/${platform}/${encodeURIComponent(puuid)}` +
      `?mode=${mode}&size=${size}`,
  );
  return Array.isArray(json.data) ? json.data : [];
}

/**
 * Historique RR d'un joueur — source du leaderboard hebdo (Brique 2).
 *
 * L'API renvoie une entree par match classe, avec `last_change` : le RR gagne
 * ou perdu sur ce match precis. C'est exactement la metrique du leaderboard,
 * donc aucun calcul de difference a faire nous-memes (et donc aucun risque de
 * se tromper si le joueur change de palier entre deux passages du cron).
 *
 * Verifie en reel le 02/09/2026 sur /valorant/v2/by-puuid/mmr-history —
 * 20 entrees renvoyees, voir scripts/verify-henrik.js pour re-verifier.
 */
export async function getRrHistory(puuid, { region = 'eu', platform = 'pc' } = {}) {
  const json = await request(
    `/valorant/v2/by-puuid/mmr-history/${region}/${platform}/${encodeURIComponent(puuid)}`,
  );
  const history = Array.isArray(json.data?.history) ? json.data.history : [];
  return history.map(normalizeRrEntry).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Normalisation — LE point a verifier contre une vraie reponse d'API
// ---------------------------------------------------------------------------

export function normalizeMatch(raw) {
  const meta = raw?.metadata;
  if (!meta) return null;

  const rawPlayers = Array.isArray(raw.players) ? raw.players : [];
  const teams = Array.isArray(raw.teams) ? raw.teams : [];

  // Rounds joues : sert a calculer l'ACS (score moyen par round). On tente
  // plusieurs sources car le champ a change de nom entre les versions d'API.
  const roundsPlayed =
    meta.rounds_played ??
    (Array.isArray(raw.rounds) ? raw.rounds.length : null) ??
    teams.reduce((sum, t) => sum + (t.rounds?.won ?? 0) + (t.rounds?.lost ?? 0), 0) / 2 ??
    0;

  const winningTeamIds = new Set(
    teams.filter((t) => t.won === true).map((t) => String(t.team_id ?? t.id).toLowerCase()),
  );

  const players = rawPlayers.map((p) => {
    const s = p.stats ?? {};
    const teamId = String(p.team_id ?? p.team ?? '').toLowerCase();
    return {
      puuid: p.puuid,
      name: p.name,
      tag: p.tag,
      teamId,
      agent: p.agent?.name ?? p.character ?? null,
      score: s.score ?? 0,
      kills: s.kills ?? 0,
      deaths: s.deaths ?? 0,
      assists: s.assists ?? 0,
      headshots: s.headshots ?? 0,
      bodyshots: s.bodyshots ?? 0,
      legshots: s.legshots ?? 0,
      damageDealt: s.damage?.dealt ?? s.damage_made ?? 0,
      won: winningTeamIds.has(teamId),
    };
  });

  return {
    matchId: meta.match_id,
    map: meta.map?.name ?? meta.map ?? 'Inconnue',
    mode: meta.queue?.name ?? meta.queue ?? meta.mode ?? 'Inconnu',
    startedAt: meta.started_at ? new Date(meta.started_at) : new Date(),
    roundsPlayed: Math.max(1, Math.round(roundsPlayed) || 1),
    players,
  };
}

/**
 * Normalise une entree d'historique RR.
 *
 * Une entree sans `last_change` exploitable est ignoree plutot que comptee a 0 :
 * un 0 fictif fausserait le leaderboard (match compte mais RR neutre), alors
 * qu'une entree ecartee sera simplement re-synchronisee au passage suivant.
 */
export function normalizeRrEntry(raw) {
  if (!raw?.match_id) return null;

  const rrChange = raw.last_change ?? raw.mmr_change_to_last_game;
  if (typeof rrChange !== 'number' || Number.isNaN(rrChange)) return null;

  return {
    matchId: raw.match_id,
    rrChange,
    rrAfter: typeof raw.rr === 'number' ? raw.rr : (raw.ranking_in_tier ?? null),
    tier: raw.tier?.name ?? raw.currenttierpatched ?? null,
    map: raw.map?.name ?? null,
    playedAt: raw.date ? new Date(raw.date) : new Date(),
    refundedRr: raw.refunded_rr ?? 0,
    derankProtected: raw.was_derank_protected === true,
  };
}
