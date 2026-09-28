// Synchronisation de l'historique d'un compte.
//
// Deux mouvements :
// - `syncRecent` va chercher ce qui a été joué depuis la dernière fois. C'est
//   ce que l'app déclenche à l'ouverture et à chaque fin de partie : priorité
//   haute, il faut que ça arrive vite à l'écran.
// - `backfillStep` remonte le temps, page par page, en fond et en priorité
//   basse, jusqu'au bout de ce que Riot conserve. C'est ce qui rend
//   l'historique « complet » sans faire attendre personne.

import { query } from './db.js';

const RANKED = new Set(['RANKED_SOLO_5x5', 'RANKED_FLEX_SR']);

// Une partie telle que Riot la renvoie → la ligne qu'on garde pour CE joueur.
export function matchRow(match, puuid) {
  const info = match?.info;
  const p = info?.participants?.find((x) => x.puuid === puuid);
  if (!p) return null;
  const styles = p.perks?.styles ?? [];
  return {
    match_id: match.metadata.matchId,
    puuid,
    queue_id: info.queueId,
    game_start: info.gameStartTimestamp ?? info.gameCreation,
    // Avant le patch 11.20, gameDuration était en millisecondes ; depuis,
    // en secondes, et gameEndTimestamp est présent.
    duration_s: info.gameEndTimestamp ? info.gameDuration : Math.round(info.gameDuration / 1000),
    game_version: info.gameVersion ?? null,
    remake: Boolean(p.gameEndedInEarlySurrender),
    champion_id: p.championId,
    champion_name: p.championName,
    team_position: p.teamPosition || p.individualPosition || null,
    win: Boolean(p.win),
    kills: p.kills ?? 0,
    deaths: p.deaths ?? 0,
    assists: p.assists ?? 0,
    cs: (p.totalMinionsKilled ?? 0) + (p.neutralMinionsKilled ?? 0),
    gold: p.goldEarned ?? 0,
    damage: p.totalDamageDealtToChampions ?? 0,
    vision: p.visionScore ?? 0,
    champ_level: p.champLevel ?? null,
    items: [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5, p.item6].map((i) => i ?? 0),
    spells: [p.summoner1Id, p.summoner2Id].map((s) => s ?? 0),
    keystone: styles[0]?.selections?.[0]?.perk ?? null,
    secondary_style: styles[1]?.style ?? null,
  };
}

const COLS = [
  'match_id', 'puuid', 'queue_id', 'game_start', 'duration_s', 'game_version', 'remake',
  'champion_id', 'champion_name', 'team_position', 'win', 'kills', 'deaths', 'assists',
  'cs', 'gold', 'damage', 'vision', 'champ_level', 'items', 'spells', 'keystone', 'secondary_style',
];

async function insertRow(row) {
  const params = COLS.map((c) => row[c]);
  const ph = COLS.map((_, i) => `$${i + 1}`).join(', ');
  await query(`insert into player_matches (${COLS.join(', ')}) values (${ph}) on conflict do nothing`, params);
}

async function knownIds(puuid, ids) {
  if (!ids.length) return new Set();
  const { rows } = await query('select match_id from player_matches where puuid = $1 and match_id = any($2)', [puuid, ids]);
  return new Set(rows.map((r) => r.match_id));
}

// Télécharge les parties manquantes d'une liste d'identifiants.
async function fetchMissing(riot, account, ids, priority) {
  const known = await knownIds(account.puuid, ids);
  let added = 0, newest = null, oldest = null;
  for (const id of ids) {
    if (known.has(id)) continue;
    const m = await riot.match(account.platform, id, { priority });
    const row = m && matchRow(m, account.puuid);
    if (!row) continue;
    await insertRow(row);
    added++;
    newest = Math.max(newest ?? 0, row.game_start);
    oldest = Math.min(oldest ?? Infinity, row.game_start);
  }
  return { added, newest, oldest };
}

// Photo du rang, seulement si quelque chose a changé depuis la dernière.
export async function snapshotRanks(riot, account, opts) {
  const entries = await riot.leagues(account.platform, account.puuid, opts);
  if (!entries) return;
  for (const e of entries) {
    if (!RANKED.has(e.queueType)) continue;
    const { rows } = await query(
      'select tier, division, lp, wins, losses from rank_snapshots where puuid = $1 and queue = $2 order by taken_at desc limit 1',
      [account.puuid, e.queueType],
    );
    const last = rows[0];
    const same = last && last.tier === e.tier && last.division === e.rank && last.lp === e.leaguePoints
      && last.wins === e.wins && last.losses === e.losses;
    if (same) continue;
    await query(
      'insert into rank_snapshots (puuid, queue, tier, division, lp, wins, losses) values ($1, $2, $3, $4, $5, $6, $7)',
      [account.puuid, e.queueType, e.tier, e.rank ?? null, e.leaguePoints, e.wins, e.losses],
    );
  }
}

const inflight = new Map();

// Une seule synchro à la fois par compte : un double clic ne double pas la
// facture auprès de Riot.
export function syncRecent(riot, puuid) {
  if (!inflight.has(puuid)) {
    inflight.set(puuid, doSyncRecent(riot, puuid).finally(() => inflight.delete(puuid)));
  }
  return inflight.get(puuid);
}

async function doSyncRecent(riot, puuid) {
  const { rows } = await query('select * from accounts where puuid = $1', [puuid]);
  const account = rows[0];
  if (!account) return { added: 0 };

  let ids = [];
  const first = account.newest_game_start == null;
  if (first) {
    // Première fois : les 20 dernières tout de suite, le rattrapage fera le reste.
    ids = (await riot.matchIds(account.platform, puuid, { count: 20 })) ?? [];
  } else {
    const startTime = Math.floor(Number(account.newest_game_start) / 1000) + 1;
    for (let start = 0; start < 300; start += 100) {
      const page = (await riot.matchIds(account.platform, puuid, { start, count: 100, startTime })) ?? [];
      ids.push(...page);
      if (page.length < 100) break;
    }
  }

  const { added, newest, oldest } = await fetchMissing(riot, account, ids, 'high');
  await query(
    `update accounts set
       newest_game_start = greatest(coalesce(newest_game_start, 0), coalesce($2::bigint, 0)),
       backfill_before   = coalesce(backfill_before, $3::bigint),
       backfill_done     = backfill_done or ($4 and $5),
       last_sync_at      = now(),
       updated_at        = now()
     where puuid = $1`,
    [puuid, newest, oldest, first, ids.length < 20],
  );
  // Un compte sans aucune partie : rien à rattraper.
  if (first && ids.length === 0) await query('update accounts set backfill_done = true where puuid = $1', [puuid]);

  await snapshotRanks(riot, account);
  return { added };
}

// Une page de rattrapage (20 parties au plus) pour le compte dont le curseur
// est le plus récent : chaque nouveau venu obtient d'abord ses parties
// récentes, avant qu'on creuse loin dans le passé de quelqu'un d'autre.
export async function backfillStep(riot) {
  const { rows } = await query(
    `select * from accounts
      where not backfill_done and backfill_before is not null
      order by backfill_before desc limit 1`,
  );
  const account = rows[0];
  if (!account) return false;

  const endTime = Math.floor(Number(account.backfill_before) / 1000) - 1;
  const ids = (await riot.matchIds(account.platform, account.puuid, { count: 20, endTime }, { priority: 'low' })) ?? [];
  if (!ids.length) {
    await query('update accounts set backfill_done = true where puuid = $1', [account.puuid]);
    return true;
  }

  const { oldest } = await fetchMissing(riot, account, ids, 'low');
  // Le curseur recule jusqu'à la plus ancienne partie de la page, qu'on vienne
  // de la télécharger ou qu'on l'ait déjà.
  const { rows: r2 } = await query(
    'select min(game_start) as m from player_matches where puuid = $1 and match_id = any($2)',
    [account.puuid, ids],
  );
  const cursor = Math.min(oldest ?? Infinity, Number(r2[0]?.m ?? Infinity));
  if (!Number.isFinite(cursor) || cursor >= Number(account.backfill_before)) {
    // Rien de plus ancien exploitable : on s'arrête plutôt que de boucler.
    await query('update accounts set backfill_done = true where puuid = $1', [account.puuid]);
  } else {
    await query('update accounts set backfill_before = $2 where puuid = $1', [account.puuid, cursor]);
  }
  return true;
}

// Boucle de fond. Elle s'arrête d'elle-même quand il n'y a rien à rattraper
// et repart à la prochaine synchro.
let running = false;
export function startBackfill(riot) {
  if (running || !riot.configured) return;
  running = true;
  (async () => {
    try {
      for (;;) {
        const worked = await backfillStep(riot);
        if (!worked) break;
      }
    } catch (err) {
      console.error('rattrapage interrompu :', err.message);
    } finally {
      running = false;
    }
  })();
}
