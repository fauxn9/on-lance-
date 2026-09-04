#!/usr/bin/env node
import { config } from '../config.js';
import { getRawMatches, normalizeMatch } from '../services/henrikdev.js';
import { analyzeMatch, aggregateDeaths } from '../services/positional.js';
import { mesurerMatch } from '../services/analysis.js';
import { acs, headshotPercent } from '../services/ranking.js';
import { getCalibration } from '../services/maps.js';
import {
  loadLinkedAccounts,
  getAnalyzedMatchIds,
  saveDeaths,
  saveMatchSummary,
  saveMatchPlayers,
  closePool,
} from '../db/index.js';

/**
 * Resume d'un match du point de vue d'un joueur : ce qui s'affiche dans son
 * historique. On reutilise normalizeMatch() plutot que de relire les champs
 * bruts, pour que l'historique casse au meme endroit que le reste si l'API
 * change de forme.
 */
function summarize(raw, puuid) {
  const match = normalizeMatch(raw);
  if (!match) return null;

  const player = match.players.find((p) => p.puuid === puuid);
  if (!player) return null;

  return {
    matchId: match.matchId,
    playedAt: match.startedAt,
    mapName: match.map,
    mode: match.mode,
    agent: player.agent,
    roundsPlayed: match.roundsPlayed,
    score: player.score,
    acs: Math.round(acs(player, match.roundsPlayed)),
    kills: player.kills,
    deaths: player.deaths,
    assists: player.assists,
    headshotPct: Math.round(headshotPercent(player)),
    damageDealt: player.damageDealt,
    won: player.won,
  };
}

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


/**
 * Ecrit les mesures des dix joueurs du match.
 *
 * Alimente deux choses d'un coup : le groupe de comparaison du barème du coach,
 * et le tableau des scores affiche au clic sur une partie. Un echec ici ne doit
 * jamais empecher l'analyse du joueur suivi de s'enregistrer — c'est un bonus,
 * pas le coeur du job.
 */
async function enregistrerLesDix({ raw, matchId, mapName, toutesLesMorts }) {
  try {
    const mesures = mesurerMatch(raw, toutesLesMorts);
    const playedAt = raw.metadata?.started_at ?? new Date().toISOString();
    const equipes = new Map((raw.teams ?? []).map((t) => [String(t.team_id), t.won]));

    const lignes = (raw.players ?? []).map((p) => {
      const m = mesures.get(p.puuid) ?? {};
      const s = p.stats ?? {};
      return {
        matchId, puuid: p.puuid,
        name: p.name ?? null, tag: p.tag ?? null,
        team: String(p.team_id ?? ''),
        agent: p.agent?.name ?? null,
        tierId: p.tier?.id ?? 0, tierName: p.tier?.name ?? null,
        mapName, playedAt,
        rounds: m.rounds ?? 0,
        won: equipes.get(String(p.team_id ?? '')) ?? null,
        score: s.score ?? null, kills: s.kills ?? null, deaths: s.deaths ?? null,
        assists: s.assists ?? null, headshots: s.headshots ?? 0,
        bodyshots: s.bodyshots ?? 0, legshots: s.legshots ?? 0,
        degatsInfliges: s.damage?.dealt ?? 0, degatsRecus: s.damage?.received ?? 0,
        mortsPrecoces: m.mortsPrecoces ?? 0, mortsApresPlant: m.mortsApresPlant ?? 0,
        ouvertures: m.ouvertures ?? 0, mortsPositionnelles: m.mortsPositionnelles ?? 0,
        mortsIsolees: m.mortsIsolees ?? 0, mortsNonTradables: m.mortsNonTradables ?? 0,
      };
    });

    await saveMatchPlayers(lignes);
  } catch (err) {
    console.error(`[pos]   feuille de match non enregistree (${matchId}) : ${err.message}`);
  }
}

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
    if (!matchId) continue;

    // Le resume alimente l'historique du dashboard : on l'ecrit pour TOUTES les
    // parties recuperees, y compris celles dont les morts ont deja ete
    // analysees. Les deux donnees ont des cycles de vie differents.
    const summary = summarize(raw, account.puuid);
    if (summary && !config.dryRun) {
      await saveMatchSummary({ userId: account.userId, puuid: account.puuid, summary });
    }

    if (alreadyDone.has(matchId)) continue;

    const mapName = raw.metadata?.map?.name ?? null;
    const calibration = await getCalibration(mapName);
    if (mapName && !calibration) {
      // Pas bloquant : les morts sont stockees sans coordonnees minimap, et la
      // conversion reste possible plus tard depuis les coordonnees de jeu.
      console.warn(`[pos]   calibration absente pour ${mapName}, heatmap indisponible sur ce match`);
    }

    // On analyse les DIX joueurs, pas seulement le compte suivi.
    //
    // Le surcout est nul cote API — le match est deja telecharge — et c'est ce
    // qui rend le barème possible : sans mesurer les neuf autres, "selon le
    // rang" n'aurait aucune reference mesuree a laquelle se comparer.
    const tousLesPuuids = (raw.players ?? []).map((p) => p.puuid);
    const toutesLesMorts = analyzeMatch({ rawMatch: raw, puuids: tousLesPuuids, calibration });
    const deaths = toutesLesMorts.filter((d) => d.victimPuuid === account.puuid);

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

    await enregistrerLesDix({ raw, matchId, mapName, toutesLesMorts });

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
