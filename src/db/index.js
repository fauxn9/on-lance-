import pg from 'pg';
import { config } from '../config.js';
// Seuils importes plutot que recopies : les valeurs stockees sont des mesures
// brutes (l'angle en degres), les booleens derives se recalculent a la lecture.
import { THRESHOLDS } from '../services/positional.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.databaseUrl,
  // Supabase impose TLS. En local sans SSL, mettre PGSSL=off dans le .env.
  ssl: process.env.PGSSL === 'off' ? false : { rejectUnauthorized: false },
  max: 4,
});

export function query(text, params) {
  return pool.query(text, params);
}

export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Charge tous les groupes avec leurs membres et comptes Riot lies.
 * Une seule requete plutot qu'une boucle N+1.
 */
export async function loadGroupsWithMembers() {
  const { rows } = await query(`
    SELECT
      g.id           AS group_id,
      g.name         AS group_name,
      u.id           AS user_id,
      u.display_name AS display_name,
      a.puuid        AS puuid,
      a.region       AS region
    FROM groups g
    JOIN memberships m ON m.group_id = g.id
    JOIN users u       ON u.id = m.user_id
    JOIN linked_riot_accounts a ON a.user_id = u.id
    ORDER BY g.id, u.id
  `);

  const groups = new Map();
  for (const r of rows) {
    if (!groups.has(r.group_id)) {
      groups.set(r.group_id, { id: r.group_id, name: r.group_name, members: [] });
    }
    groups.get(r.group_id).members.push({
      userId: r.user_id,
      displayName: r.display_name,
      puuid: r.puuid,
      region: r.region,
    });
  }
  return [...groups.values()];
}

/** match_id deja traites pour ce groupe (anti-doublon, premiere ligne de defense). */
export async function getProcessedMatchIds(groupId, sinceHours) {
  const { rows } = await query(
    `SELECT match_id FROM detected_matches
     WHERE group_id = $1 AND processed_at > now() - ($2 || ' hours')::interval`,
    [groupId, sinceHours],
  );
  return new Set(rows.map((r) => r.match_id));
}

/**
 * Enregistre un match detecte + les notifications associees, en transaction.
 *
 * L'anti-doublon repose sur la contrainte UNIQUE (group_id, match_id) :
 * ON CONFLICT DO NOTHING fait qu'un second cron qui traiterait le meme match en
 * parallele n'inserera rien et ne generera aucune notif en double.
 * Retourne null si le match etait deja enregistre.
 */
export async function saveDetection({ groupId, match, playersWithMessages }) {
  return withTransaction(async (client) => {
    const standings = playersWithMessages.map((p) => ({
      rank: p.rank,
      userId: p.userId,
      displayName: p.displayName,
      agent: p.agent,
      acs: p.acs,
      kills: p.kills,
      deaths: p.deaths,
      assists: p.assists,
      hsPercent: p.hsPercent,
      won: p.won,
      tone: p.tone,
    }));

    const inserted = await client.query(
      `INSERT INTO detected_matches (group_id, match_id, map_name, mode, started_at, standings)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (group_id, match_id) DO NOTHING
       RETURNING id`,
      [groupId, match.matchId, match.map, match.mode, match.startedAt, JSON.stringify(standings)],
    );

    if (inserted.rowCount === 0) return null; // deja traite par un autre passage

    const detectedMatchId = inserted.rows[0].id;

    for (const p of playersWithMessages) {
      await client.query(
        `INSERT INTO notifications (user_id, detected_match_id, tone, rank_in_group, body)
         VALUES ($1, $2, $3, $4, $5)`,
        [p.userId, detectedMatchId, p.tone, p.rank, p.message.body],
      );
    }

    return detectedMatchId;
  });
}

/**
 * Derniers messages envoyes a un joueur pour un ton donne (anti-repetition
 * cote generation IA — voir messages.js). Le plus recent en premier.
 */
export async function getRecentMessagesForTone(userId, tone, { limit = 3 } = {}) {
  const { rows } = await query(
    `SELECT body FROM notifications
     WHERE user_id = $1 AND tone = $2
     ORDER BY created_at DESC
     LIMIT $3`,
    [userId, tone, limit],
  );
  return rows.map((r) => r.body);
}

// ---------------------------------------------------------------------------
// Brique 2 — leaderboard hebdomadaire
// ---------------------------------------------------------------------------

/** Tous les comptes Riot lies, sans notion de groupe (source du sync RR). */
export async function loadLinkedAccounts() {
  const { rows } = await query(`
    SELECT a.puuid, a.region, a.riot_name, u.id AS user_id, u.display_name
    FROM linked_riot_accounts a
    JOIN users u ON u.id = a.user_id
    ORDER BY u.id
  `);
  return rows.map((r) => ({
    userId: r.user_id,
    displayName: r.display_name,
    puuid: r.puuid,
    region: r.region,
    riotName: r.riot_name,
  }));
}

/**
 * Enregistre les lignes de RR d'un joueur.
 *
 * ON CONFLICT DO NOTHING sur (puuid, match_id) : le cron repasse sur les memes
 * matchs a chaque execution, seule la premiere insertion compte. C'est ce qui
 * rend le job rejouable sans jamais gonfler le leaderboard.
 *
 * @param rows [{ userId, puuid, matchId, rrChange, rrAfter, tier, map, playedAt, weekStart }]
 * @returns nombre de lignes reellement inserees (donc nouvelles)
 */
export async function saveRrEntries(rows) {
  if (rows.length === 0) return 0;

  const values = [];
  const params = [];
  rows.forEach((r, i) => {
    const b = i * 9;
    values.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9})`);
    params.push(
      r.userId, r.puuid, r.matchId, r.rrChange, r.rrAfter,
      r.tier, r.map, r.playedAt, r.weekStart,
    );
  });

  const { rowCount } = await query(
    `INSERT INTO match_rr (user_id, puuid, match_id, rr_change, rr_after, tier, map_name, played_at, week_start)
     VALUES ${values.join(', ')}
     ON CONFLICT (puuid, match_id) DO NOTHING`,
    params,
  );
  return rowCount;
}

/** Lignes de RR d'une semaine pour les membres d'un groupe. */
export async function loadWeekRr(groupId, weekStart) {
  const { rows } = await query(
    `SELECT r.user_id, r.rr_change, r.match_id, r.map_name, r.played_at
     FROM match_rr r
     JOIN memberships m ON m.user_id = r.user_id AND m.group_id = $1
     WHERE r.week_start = $2
     ORDER BY r.played_at ASC`,
    [groupId, weekStart],
  );
  return rows.map((r) => ({
    userId: r.user_id,
    rrChange: r.rr_change,
    matchId: r.match_id,
    map: r.map_name,
    playedAt: r.played_at,
  }));
}

/** Semaines deja cloturees pour ce groupe (anti-double-cloture, premiere ligne). */
export async function getClosedWeeks(groupId) {
  const { rows } = await query(
    'SELECT week_start FROM weekly_winners WHERE group_id = $1',
    [groupId],
  );
  // week_start remonte en objet Date cote pg : on repasse en 'YYYY-MM-DD'.
  return new Set(rows.map((r) => new Date(r.week_start).toISOString().slice(0, 10)));
}

/**
 * Fige le classement d'une semaine et met les notifs en file, en transaction.
 * Retourne null si la semaine avait deja ete cloturee entre-temps.
 */
export async function closeWeek({ groupId, weekStart, standings, winner, playersWithMessages }) {
  return withTransaction(async (client) => {
    const inserted = await client.query(
      `INSERT INTO weekly_winners (group_id, week_start, winner_user_id, winner_name, winner_rr, standings)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (group_id, week_start) DO NOTHING
       RETURNING id`,
      [
        groupId,
        weekStart,
        winner?.userId ?? null,
        winner?.displayName ?? null,
        winner?.rrTotal ?? null,
        JSON.stringify(standings),
      ],
    );

    if (inserted.rowCount === 0) return null;

    for (const p of playersWithMessages) {
      await client.query(
        `INSERT INTO notifications (user_id, detected_match_id, kind, week_start, tone, rank_in_group, body)
         VALUES ($1, NULL, 'weekly', $2, $3, $4, $5)`,
        [p.userId, weekStart, p.tone, p.rank, p.message.body],
      );
    }

    return inserted.rows[0].id;
  });
}

/** Historique des vainqueurs, du plus recent au plus ancien. */
export async function getWeeklyHistory(groupId, { limit = 20 } = {}) {
  const { rows } = await query(
    `SELECT week_start, winner_user_id, winner_name, winner_rr, standings, closed_at
     FROM weekly_winners
     WHERE group_id = $1
     ORDER BY week_start DESC
     LIMIT $2`,
    [groupId, limit],
  );
  return rows;
}

/** Membres d'un groupe (avec compte Riot lie), pour construire un classement. */
export async function loadGroupMembers(groupId) {
  const { rows } = await query(
    `SELECT u.id AS user_id, u.display_name, a.puuid
     FROM memberships m
     JOIN users u ON u.id = m.user_id
     LEFT JOIN linked_riot_accounts a ON a.user_id = u.id
     WHERE m.group_id = $1
     ORDER BY u.id`,
    [groupId],
  );
  return rows.map((r) => ({
    userId: r.user_id,
    displayName: r.display_name,
    puuid: r.puuid,
  }));
}

// ---------------------------------------------------------------------------
// Brique 3 — coach positionnel
// ---------------------------------------------------------------------------

/** Matchs deja analyses pour ce joueur (evite de re-analyser a chaque passage). */
export async function getAnalyzedMatchIds(puuid, { sinceDays = 30 } = {}) {
  const { rows } = await query(
    `SELECT match_id FROM analyzed_matches
     WHERE puuid = $1 AND analyzed_at > now() - ($2 || ' days')::interval`,
    [puuid, sinceDays],
  );
  return new Set(rows.map((r) => r.match_id));
}

/**
 * Enregistre les morts analysees d'un match, et marque le match comme traite.
 *
 * En transaction : si l'insertion des morts echoue, le match ne doit pas etre
 * marque comme analyse, sinon on perdrait ses donnees pour toujours.
 * Un match sans mort du joueur suivi est quand meme marque (rien a re-analyser).
 */
export async function saveDeaths({ userId, puuid, matchId, deaths }) {
  return withTransaction(async (client) => {
    for (const d of deaths) {
      await client.query(
        `INSERT INTO player_deaths (
           user_id, puuid, match_id, round, played_at, map_name, agent, weapon,
           loc_x, loc_y, mini_x, mini_y,
           duel_distance_m, nearest_teammate_m, living_teammates,
           last_alive, isolated, trade_possible, view_delta_deg, view_gap_ms
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         ON CONFLICT (puuid, match_id, round) DO NOTHING`,
        [
          userId, puuid, matchId, d.round, d.playedAt, d.mapName, d.agent, d.weapon,
          d.location.x, d.location.y, d.minimap?.x ?? null, d.minimap?.y ?? null,
          d.duelDistance, d.nearestTeammate, d.livingTeammates,
          d.lastAlive, d.isolated, d.tradePossible,
          d.view?.deltaDeg ?? null, d.view?.gapMs ?? null,
        ],
      );
    }

    await client.query(
      `INSERT INTO analyzed_matches (puuid, match_id, deaths)
       VALUES ($1, $2, $3)
       ON CONFLICT (puuid, match_id) DO UPDATE SET deaths = EXCLUDED.deaths,
                                                   analyzed_at = now()`,
      [puuid, matchId, deaths.length],
    );

    return deaths.length;
  });
}

/**
 * Morts d'un joueur sur une periode, remises dans la forme rendue par
 * positional.js pour pouvoir reutiliser les memes fonctions d'agregation.
 */
export async function loadDeaths(userId, { sinceDays = 14, mapName = null } = {}) {
  const { rows } = await query(
    `SELECT * FROM player_deaths
     WHERE user_id = $1
       AND played_at > now() - ($2 || ' days')::interval
       AND ($3::text IS NULL OR map_name = $3)
     ORDER BY played_at DESC`,
    [userId, sinceDays, mapName],
  );

  return rows.map((r) => ({
    matchId: r.match_id,
    round: r.round,
    playedAt: r.played_at,
    mapName: r.map_name,
    agent: r.agent,
    weapon: r.weapon,
    location: { x: r.loc_x, y: r.loc_y },
    minimap: r.mini_x === null ? null : { x: r.mini_x, y: r.mini_y },
    duelDistance: r.duel_distance_m,
    nearestTeammate: r.nearest_teammate_m,
    livingTeammates: r.living_teammates,
    lastAlive: r.last_alive,
    isolated: r.isolated,
    tradePossible: r.trade_possible,
    view: r.view_delta_deg === null
      ? null
      : {
          deltaDeg: r.view_delta_deg,
          gapMs: r.view_gap_ms,
          outOfView: r.view_delta_deg > THRESHOLDS.outOfViewDegrees,
          fromBehind: r.view_delta_deg > THRESHOLDS.fromBehindDegrees,
        },
  }));
}

export async function closePool() {
  await pool.end();
}
