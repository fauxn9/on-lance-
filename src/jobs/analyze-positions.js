#!/usr/bin/env node
import { config } from '../config.js';
import { getRawMatches } from '../services/henrikdev.js';
import { analyzeMatch, aggregateDeaths, detectPatterns } from '../services/positional.js';
import { getCalibration } from '../services/maps.js';
import {
  loadLinkedAccounts,
  getAnalyzedMatchIds,
  saveDeaths,
  closePool,
} from '../db/index.js';

/**
 * Analyse positionnelle des matchs recents (Brique 3, etage 1).
 *
 * Cron separe, peu frequent (~30 min) : ces donnees alimentent un dashboard et
 * des tendances, rien qui doive etre a jour a la minute.
 *
 * Le job ne fait AUCUN appel a l'IA. Il ne fait que de la geometrie et du
 * stockage. La mise en mots arrive plus tard, a la demande (coach.js).
 *
 * Rejouable : un match deja analyse est saute, et l'unicite
 * (puuid, match_id, round) protege de toute facon contre les doublons.
 */

async function analyzeAccount(account) {
  let matches;
  try {
    matches = await getRawMatches(account.puuid, { region: account.region ?? 'eu' });
  } catch (err) {
    console.error(`[pos] recuperation KO pour ${account.displayName}: ${err.message}`);
    return 0;
  }

  const alreadyDone = config.dryRun ? new Set() : await getAnalyzedMatchIds(account.puuid);
  let stored = 0;

  for (const raw of matches) {
    const matchId = raw?.metadata?.match_id;
    if (!matchId || alreadyDone.has(matchId)) continue;

    const mapName = raw.metadata?.map?.name ?? null;
    const calibration = await getCalibration(mapName);
    if (mapName && !calibration) {
      // Pas bloquant : les morts sont stockees sans coordonnees minimap, et la
      // conversion reste possible plus tard depuis les coordonnees de jeu.
      console.warn(`[pos]   calibration absente pour ${mapName}, heatmap indisponible sur ce match`);
    }

    const deaths = analyzeMatch({ rawMatch: raw, puuids: [account.puuid], calibration });

    if (config.dryRun) {
      const agg = aggregateDeaths(deaths);
      console.log(
        `[pos]   ${account.displayName} — ${mapName} : ${agg.deaths} morts, ` +
          `${agg.isolatedDeaths} isolees, distance mediane a l'equipe ` +
          `${agg.medianTeammateDistance?.toFixed(1) ?? '?'} m (DRY RUN)`,
      );
      stored += deaths.length;
      continue;
    }

    await saveDeaths({
      userId: account.userId,
      puuid: account.puuid,
      matchId,
      deaths,
    });
    stored += deaths.length;
  }

  return stored;
}

async function main() {
  console.log(`[pos] Analyse positionnelle${config.dryRun ? ' (DRY RUN — aucune ecriture)' : ''}`);

  if (!config.henrik.apiKey) {
    console.error('[pos] HENRIK_API_KEY manquante.');
    process.exit(1);
  }

  try {
    const accounts = await loadLinkedAccounts();
    if (accounts.length === 0) {
      console.log('[pos] Aucun compte Riot lie.');
      return;
    }

    let total = 0;
    for (const account of accounts) {
      const n = await analyzeAccount(account);
      total += n;
      console.log(`[pos] ${account.displayName} : ${n} mort(s) analysee(s)`);
    }

    console.log(`\n[pos] Termine — ${total} mort(s) au total.`);
  } finally {
    if (!config.dryRun) await closePool().catch(() => {});
  }
}

main().catch((err) => {
  console.error('[pos] Erreur fatale :', err);
  process.exit(1);
});
