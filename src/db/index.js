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

    let notified = 0;
    for (const p of playersWithMessages) {
      // Une personne peut appartenir a plusieurs groupes, et la meme partie est
      // alors detectee une fois par groupe. Le classement, lui, a bien un sens
      // par groupe — on garde donc les deux detections. Mais la notification,
      // non : recevoir deux fois le resume de la meme game est juste penible.
      // Un joueur n'est prevenu que pour la premiere detection de ce match.
      const { rowCount } = await client.query(
        `INSERT INTO notifications (user_id, detected_match_id, tone, rank_in_group, body)
         SELECT $1, $2, $3, $4, $5
         WHERE NOT EXISTS (
           SELECT 1 FROM notifications n
           JOIN detected_matches d ON d.id = n.detected_match_id
           WHERE n.user_id = $1 AND d.match_id = $6
         )`,
        [p.userId, detectedMatchId, p.tone, p.rank, p.message.body, match.matchId],
      );
      notified += rowCount;
    }

    if (notified < playersWithMessages.length) {
      console.log(
        `[detect]   ${playersWithMessages.length - notified} notif(s) evitee(s) : `
        + 'ces joueurs ont deja ete prevenus pour ce match via un autre groupe',
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

/**
 * Enregistre le resume d'un match du point de vue d'un joueur.
 * Idempotent : rejouer le job ne cree jamais de doublon.
 */
export async function saveMatchSummary({ userId, puuid, summary }) {
  const { rowCount } = await query(
    `INSERT INTO player_matches (
       user_id, puuid, match_id, played_at, map_name, mode, agent, rounds_played,
       score, acs, kills, deaths, assists, headshot_pct, damage_dealt, won
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (puuid, match_id) DO NOTHING`,
    [
      userId, puuid, summary.matchId, summary.playedAt, summary.mapName, summary.mode,
      summary.agent, summary.roundsPlayed, summary.score, summary.acs,
      summary.kills, summary.deaths, summary.assists, summary.headshotPct,
      summary.damageDealt, summary.won,
    ],
  );
  return rowCount;
}

/**
 * Historique des parties d'un joueur, pagine.
 *
 * Le RR vient de match_rr par jointure : les deux tables sont alimentees par
 * des jobs differents, et une partie peut donc apparaitre dans l'historique
 * avant que son RR soit connu (ou l'inverse). La jointure externe evite qu'une
 * partie disparaisse pour cette raison.
 *
 * On demande une ligne de plus que `limit` pour savoir s'il reste des pages,
 * sans avoir a faire un COUNT sur toute la table.
 */
export async function loadPlayerMatches(userId, { limit = 10, offset = 0 } = {}) {
  const { rows } = await query(
    `SELECT m.match_id, m.played_at, m.map_name, m.mode, m.agent, m.rounds_played,
            m.acs, m.kills, m.deaths, m.assists, m.headshot_pct, m.won,
            r.rr_change, r.tier,
            d.id IS NOT NULL AS avec_le_groupe
     FROM player_matches m
     LEFT JOIN match_rr r ON r.puuid = m.puuid AND r.match_id = m.match_id
     LEFT JOIN detected_matches d ON d.match_id = m.match_id
     WHERE m.user_id = $1
     ORDER BY m.played_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit + 1, offset],
  );

  const hasMore = rows.length > limit;
  return {
    matches: rows.slice(0, limit).map((r) => ({
      matchId: r.match_id,
      playedAt: r.played_at,
      map: r.map_name,
      mode: r.mode,
      agent: r.agent,
      roundsPlayed: r.rounds_played,
      acs: r.acs,
      kills: r.kills,
      deaths: r.deaths,
      assists: r.assists,
      headshotPct: r.headshot_pct,
      won: r.won,
      rrChange: r.rr_change,
      tier: r.tier,
      withGroup: r.avec_le_groupe,
    })),
    hasMore,
  };
}

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
           last_alive, isolated, trade_possible, view_delta_deg, view_gap_ms,
           time_in_round_ms
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
         ON CONFLICT (puuid, match_id, round) DO NOTHING`,
        [
          userId, puuid, matchId, d.round, d.playedAt, d.mapName, d.agent, d.weapon,
          d.location.x, d.location.y, d.minimap?.x ?? null, d.minimap?.y ?? null,
          d.duelDistance, d.nearestTeammate, d.livingTeammates,
          d.lastAlive, d.isolated, d.tradePossible,
          d.view?.deltaDeg ?? null, d.view?.gapMs ?? null,
          d.timeInRoundMs ?? null,
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
    // NULL sur les morts enregistrees avant l'ajout de la colonne : la
    // description de la mort omet alors simplement le moment.
    timeInRoundMs: r.time_in_round_ms,
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

// ---------------------------------------------------------------------------
// Brique 4 — identite Discord
// ---------------------------------------------------------------------------

/** Retrouve ou cree le profil correspondant a un compte Discord. */
export async function findOrCreateDiscordUser({ discordId, username, avatarUrl }) {
  const { rows } = await query(
    `INSERT INTO users (display_name, discord_id, discord_username, avatar_url, last_seen_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (discord_id) DO UPDATE
       SET discord_username = EXCLUDED.discord_username,
           avatar_url       = EXCLUDED.avatar_url,
           last_seen_at     = now()
     RETURNING id, display_name, discord_id, discord_username, avatar_url`,
    [username, discordId, username, avatarUrl],
  );
  return rows[0];
}

/** Profil complet de l'utilisateur connecte, avec son compte Riot s'il en a un. */
export async function getSessionUser(userId) {
  const { rows } = await query(
    `SELECT u.id, u.display_name, u.discord_username, u.avatar_url,
            a.riot_name, a.riot_tag, a.region, a.verified,
            (SELECT tier FROM match_rr r WHERE r.user_id = u.id
              ORDER BY r.played_at DESC LIMIT 1) AS tier
     FROM users u
     LEFT JOIN linked_riot_accounts a ON a.user_id = u.id
     WHERE u.id = $1`,
    [userId],
  );
  if (rows.length === 0) return null;

  const r = rows[0];
  return {
    id: r.id,
    displayName: r.display_name,
    discordUsername: r.discord_username,
    avatarUrl: r.avatar_url,
    riotId: r.riot_name ? `${r.riot_name}#${r.riot_tag}` : null,
    riotVerified: r.verified ?? false,
    tier: r.tier,
  };
}

/**
 * Rattache un compte Riot au profil connecte.
 *
 * Trois situations, et c'est la regle la plus importante de la brique :
 *
 *   libre       — personne ne l'a, on le lie.
 *   deja a moi  — on rafraichit juste le pseudo, qui peut avoir change.
 *   orphelin    — un profil cree avant l'authentification le detient. Personne
 *                 ne le possede vraiment, donc on ADOPTE : tout son historique
 *                 est transfere sur le profil connecte, puis l'orphelin est
 *                 supprime. C'est ce qui recupere les donnees eparpillees par
 *                 l'absence d'authentification.
 *   pris        — un profil AVEC compte Discord le detient : on refuse. Sans
 *                 cette barriere, n'importe qui pourrait taper le Riot ID d'un
 *                 autre et absorber ses donnees — le bug qu'on vient de subir.
 *   deja un      — le profil connecte a DEJA un autre compte Riot : on refuse
 *                 aussi. Rien dans le schema n'interdit deux comptes pour un
 *                 meme profil, et getSessionUser() en prendrait un au hasard :
 *                 le classement et le coach porteraient alors sur un compte
 *                 different d'un chargement a l'autre.
 *
 * La verification reelle de propriete viendra de l'app desktop (Brique 9) :
 * c'est elle qui pourra passer `verified` a true, et donc autoriser un
 * transfert legitime entre deux comptes Discord.
 */
export async function claimRiotAccount({ userId, puuid, riotName, riotTag, region = 'eu' }) {
  return withTransaction(async (client) => {
    const { rows: mine } = await client.query(
      'SELECT riot_name, riot_tag FROM linked_riot_accounts WHERE user_id = $1 AND puuid <> $2',
      [userId, puuid],
    );
    if (mine.length > 0) {
      return {
        status: 'has_other',
        adopted: 0,
        current: `${mine[0].riot_name}#${mine[0].riot_tag}`,
      };
    }

    const { rows: existing } = await client.query(
      `SELECT a.id, a.user_id, u.discord_id, u.display_name
       FROM linked_riot_accounts a
       JOIN users u ON u.id = a.user_id
       WHERE a.puuid = $1
       FOR UPDATE OF a`,
      [puuid],
    );

    // --- libre ---
    if (existing.length === 0) {
      await client.query(
        `INSERT INTO linked_riot_accounts (user_id, puuid, riot_name, riot_tag, region)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, puuid, riotName, riotTag, region],
      );
      return { status: 'linked', adopted: 0 };
    }

    const holder = existing[0];

    // --- deja a moi ---
    if (Number(holder.user_id) === Number(userId)) {
      await client.query(
        'UPDATE linked_riot_accounts SET riot_name = $1, riot_tag = $2 WHERE id = $3',
        [riotName, riotTag, holder.id],
      );
      return { status: 'already_mine', adopted: 0 };
    }

    // --- pris par un compte authentifie ---
    if (holder.discord_id) {
      return { status: 'taken', heldBy: holder.display_name, adopted: 0 };
    }

    // --- orphelin : adoption ---
    const orphan = Number(holder.user_id);

    // On deplace l'historique vers le profil connecte. Les cles d'unicite de
    // ces tables portent sur (puuid, match_id), jamais sur user_id : changer le
    // rattachement ne peut donc creer aucun doublon.
    let moved = 0;
    for (const table of ['match_rr', 'player_matches', 'player_deaths', 'notifications', 'push_subscriptions']) {
      const res = await client.query(
        `UPDATE ${table} SET user_id = $1 WHERE user_id = $2`,
        [userId, orphan],
      );
      moved += res.rowCount;
    }

    // Les appartenances aux groupes se deplacent seulement si le profil connecte
    // n'est pas deja membre du meme groupe, sinon la cle primaire refuserait.
    await client.query(
      `UPDATE memberships SET user_id = $1
       WHERE user_id = $2
         AND group_id NOT IN (SELECT group_id FROM memberships WHERE user_id = $1)`,
      [userId, orphan],
    );
    await client.query('DELETE FROM memberships WHERE user_id = $1', [orphan]);

    // Le groupe dont l'orphelin etait proprietaire revient au profil connecte.
    await client.query(
      'UPDATE groups SET owner_user_id = $1 WHERE owner_user_id = $2',
      [userId, orphan],
    );

    await client.query(
      'UPDATE linked_riot_accounts SET user_id = $1, riot_name = $2, riot_tag = $3 WHERE id = $4',
      [userId, riotName, riotTag, holder.id],
    );

    await client.query('DELETE FROM users WHERE id = $1', [orphan]);

    return { status: 'adopted', adopted: moved, from: holder.display_name };
  });
}

// ---------------------------------------------------------------------------
// Brique 6 — groupes et invitations
// ---------------------------------------------------------------------------

export async function createGroup({ name, ownerUserId, joinCode, inviteToken }) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO groups (name, join_code, invite_token, owner_user_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, join_code, invite_token`,
      [name, joinCode, inviteToken, ownerUserId],
    );
    const group = rows[0];

    await client.query(
      `INSERT INTO memberships (group_id, user_id, role) VALUES ($1, $2, 'owner')
       ON CONFLICT DO NOTHING`,
      [group.id, ownerUserId],
    );
    return group;
  });
}

/** Groupe designe par un jeton d'invitation, avec de quoi afficher un apercu. */
export async function groupByInviteToken(token) {
  const { rows } = await query(
    `SELECT g.id, g.name, g.join_code, g.invite_token,
            (SELECT count(*) FROM memberships m WHERE m.group_id = g.id) AS members,
            (SELECT u.display_name FROM users u WHERE u.id = g.owner_user_id) AS owner
     FROM groups g WHERE g.invite_token = $1`,
    [token],
  );
  return rows[0] ?? null;
}

export async function joinGroup({ groupId, userId }) {
  const { rowCount } = await query(
    `INSERT INTO memberships (group_id, user_id, role) VALUES ($1, $2, 'member')
     ON CONFLICT DO NOTHING`,
    [groupId, userId],
  );
  return rowCount > 0; // false = deja membre, ce qui n'est pas une erreur
}

/** Un utilisateur ne voit que les donnees des groupes dont il est membre. */
export async function isGroupMember(groupId, userId) {
  const { rows } = await query(
    'SELECT 1 FROM memberships WHERE group_id = $1 AND user_id = $2',
    [groupId, userId],
  );
  return rows.length > 0;
}

export async function listMyGroups(userId) {
  const { rows } = await query(
    `SELECT g.id, g.name, g.join_code, g.invite_token, m.role,
            (SELECT count(*) FROM memberships x WHERE x.group_id = g.id) AS members
     FROM memberships m
     JOIN groups g ON g.id = m.group_id
     WHERE m.user_id = $1
     ORDER BY g.created_at`,
    [userId],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    joinCode: r.join_code,
    inviteToken: r.invite_token,
    role: r.role,
    members: Number(r.members),
  }));
}

export async function closePool() {
  await pool.end();
}

// ---------------------------------------------------------------------------
// Barème du coach — les dix joueurs de chaque match
// ---------------------------------------------------------------------------

/**
 * Enregistre les mesures des dix joueurs d'un match.
 *
 * ON CONFLICT DO UPDATE plutot que DO NOTHING : une re-analyse doit pouvoir
 * corriger des mesures, par exemple apres l'ajout d'un axe au barème.
 */
export async function saveMatchPlayers(lignes) {
  if (lignes.length === 0) return 0;

  return withTransaction(async (client) => {
    let n = 0;
    for (const l of lignes) {
      const { rowCount } = await client.query(
        `INSERT INTO match_players (
           match_id, puuid, name, tag, team, agent, tier_id, tier_name,
           map_name, played_at, rounds, won,
           score, kills, deaths, assists, headshots, bodyshots, legshots,
           damage_dealt, damage_received,
           early_deaths, post_plant_deaths, opening_deaths,
           positional_deaths, isolated_deaths, untradeable_deaths
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
                   $19,$20,$21,$22,$23,$24,$25,$26,$27)
         ON CONFLICT (match_id, puuid) DO UPDATE SET
           tier_id = EXCLUDED.tier_id, tier_name = EXCLUDED.tier_name,
           agent = EXCLUDED.agent, won = EXCLUDED.won,
           score = EXCLUDED.score, kills = EXCLUDED.kills, deaths = EXCLUDED.deaths,
           assists = EXCLUDED.assists, headshots = EXCLUDED.headshots,
           bodyshots = EXCLUDED.bodyshots, legshots = EXCLUDED.legshots,
           damage_dealt = EXCLUDED.damage_dealt, damage_received = EXCLUDED.damage_received,
           early_deaths = EXCLUDED.early_deaths, post_plant_deaths = EXCLUDED.post_plant_deaths,
           opening_deaths = EXCLUDED.opening_deaths, positional_deaths = EXCLUDED.positional_deaths,
           isolated_deaths = EXCLUDED.isolated_deaths, untradeable_deaths = EXCLUDED.untradeable_deaths`,
        [
          l.matchId, l.puuid, l.name, l.tag, l.team, l.agent, l.tierId, l.tierName,
          l.mapName, l.playedAt, l.rounds, l.won,
          l.score, l.kills, l.deaths, l.assists, l.headshots, l.bodyshots, l.legshots,
          l.degatsInfliges, l.degatsRecus,
          l.mortsPrecoces, l.mortsApresPlant, l.ouvertures,
          l.mortsPositionnelles, l.mortsIsolees, l.mortsNonTradables,
        ],
      );
      n += rowCount;
    }
    return n;
  });
}

const versMesures = (r) => ({
  puuid: r.puuid,
  tierId: r.tier_id,
  rounds: Number(r.rounds),
  morts: Number(r.deaths ?? 0),
  mortsPrecoces: Number(r.early_deaths),
  mortsApresPlant: Number(r.post_plant_deaths),
  ouvertures: Number(r.opening_deaths),
  mortsPositionnelles: Number(r.positional_deaths),
  mortsIsolees: Number(r.isolated_deaths),
  mortsNonTradables: Number(r.untradeable_deaths),
  degatsInfliges: Number(r.damage_dealt ?? 0),
  degatsRecus: Number(r.damage_received ?? 0),
  tirs: Number(r.headshots ?? 0) + Number(r.bodyshots ?? 0) + Number(r.legshots ?? 0),
  headshots: Number(r.headshots ?? 0),
});

/**
 * Toutes les lignes joueur des matchs OU LE JOUEUR ETAIT PRESENT.
 *
 * C'est la restriction qui donne son sens au groupe de comparaison : on ne
 * compare pas a l'ensemble de la base, mais aux gens croises dans ses propres
 * parties, sur les memes maps, la meme semaine.
 */
export async function loadPeerMeasures(puuid, { sinceDays = 14 } = {}) {
  const { rows } = await query(
    `SELECT p.* FROM match_players p
     WHERE p.match_id IN (
       SELECT match_id FROM match_players
       WHERE puuid = $1 AND played_at > now() - ($2 || ' days')::interval
     )
     AND p.played_at > now() - ($2 || ' days')::interval`,
    [puuid, sinceDays],
  );
  return rows.map(versMesures);
}

/** Feuille de match complete, pour le panneau deroulant du dashboard. */
export async function loadMatchScoreboard(matchId) {
  const { rows } = await query(
    `SELECT puuid, name, tag, team, agent, tier_name, won, rounds,
            score, kills, deaths, assists, headshots, bodyshots, legshots,
            damage_dealt
     FROM match_players WHERE match_id = $1
     ORDER BY score DESC NULLS LAST`,
    [matchId],
  );

  return rows.map((r) => {
    const tirs = Number(r.headshots ?? 0) + Number(r.bodyshots ?? 0) + Number(r.legshots ?? 0);
    return {
      puuid: r.puuid,
      name: r.name, tag: r.tag, team: r.team,
      agent: r.agent, tier: r.tier_name, won: r.won,
      acs: r.rounds > 0 ? Math.round(Number(r.score) / Number(r.rounds)) : null,
      kills: r.kills, deaths: r.deaths, assists: r.assists,
      headshotPct: tirs > 0 ? Math.round((100 * Number(r.headshots)) / tirs) : null,
      damage: r.damage_dealt,
    };
  });
}

/** Compte Riot rattache a un profil, ou null. */
export async function getRiotAccount(userId) {
  const { rows } = await query(
    'SELECT puuid, riot_name, riot_tag, region FROM linked_riot_accounts WHERE user_id = $1 LIMIT 1',
    [userId],
  );
  return rows[0] ?? null;
}
