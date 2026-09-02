#!/usr/bin/env node
import { config } from '../config.js';
import { getRrHistory } from '../services/henrikdev.js';
import { weekStartOf } from '../services/leaderboard.js';
import { loadLinkedAccounts, saveRrEntries, closePool } from '../db/index.js';

/**
 * Synchronisation du RR (Brique 2).
 *
 * Cron separe de la detection de matchs, et volontairement moins frequent
 * (~1x/heure suffit) : le leaderboard est hebdomadaire, il n'a aucun besoin
 * d'etre a jour a la minute, et chaque passage coute un appel API par joueur.
 *
 * Rejouable sans risque : l'unicite (puuid, match_id) en base fait que
 * repasser sur les memes matchs n'ajoute rien.
 */

async function syncAccount(account) {
  const floor = Date.now() - config.leaderboard.lookbackDays * 86_400_000;

  let entries;
  try {
    entries = await getRrHistory(account.puuid, { region: account.region ?? 'eu' });
  } catch (err) {
    // Un joueur qui echoue ne doit pas casser la synchro des autres.
    console.error(`[rr] recuperation KO pour ${account.displayName}: ${err.message}`);
    return { fetched: 0, inserted: 0 };
  }

  const rows = entries
    .filter((e) => e.playedAt.getTime() >= floor)
    .map((e) => ({
      userId: account.userId,
      puuid: account.puuid,
      matchId: e.matchId,
      rrChange: e.rrChange,
      rrAfter: e.rrAfter,
      tier: e.tier,
      map: e.map,
      playedAt: e.playedAt,
      weekStart: weekStartOf(e.playedAt),
    }));

  if (config.dryRun) {
    const total = rows.reduce((sum, r) => sum + r.rrChange, 0);
    console.log(
      `[rr]   ${account.displayName} : ${rows.length} match(s) dans la fenetre, ` +
        `${total > 0 ? '+' : ''}${total} RR cumule (DRY RUN, rien ecrit)`,
    );
    return { fetched: rows.length, inserted: 0 };
  }

  const inserted = await saveRrEntries(rows);
  console.log(
    `[rr]   ${account.displayName} : ${rows.length} match(s) vus, ${inserted} nouveau(x)`,
  );
  return { fetched: rows.length, inserted };
}

async function main() {
  console.log(`[rr] Synchronisation du RR${config.dryRun ? ' (DRY RUN)' : ''}`);

  if (!config.henrik.apiKey) {
    console.error('[rr] HENRIK_API_KEY manquante.');
    process.exit(1);
  }

  try {
    const accounts = await loadLinkedAccounts();
    if (accounts.length === 0) {
      console.log('[rr] Aucun compte Riot lie.');
      return;
    }

    let inserted = 0;
    // Sequentiel : le rate limiter de henrikdev.js espace deja les appels.
    for (const account of accounts) {
      inserted += (await syncAccount(account)).inserted;
    }

    console.log(`[rr] Termine — ${inserted} ligne(s) de RR ajoutee(s).`);
  } finally {
    await closePool().catch(() => {});
  }
}

main().catch((err) => {
  console.error('[rr] Erreur fatale :', err);
  process.exit(1);
});
