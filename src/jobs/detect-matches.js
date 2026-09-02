#!/usr/bin/env node
import { config } from '../config.js';
import { getRecentMatches, getRawMatches } from '../services/henrikdev.js';
import { findSharedMatches, buildPuuidIndex } from '../services/detection.js';
import { rankGroupInMatch, assignTones } from '../services/ranking.js';
import { generateAllMessages } from '../services/messages.js';
import { analyzeMatch } from '../services/positional.js';
import { matchInsight } from '../services/coach.js';
import { getCalibration } from '../services/maps.js';
import { drainPending } from '../services/notifications.js';
import {
  loadGroupsWithMembers,
  getProcessedMatchIds,
  getRecentMessagesForTone,
  saveDetection,
  closePool,
} from '../db/index.js';

/**
 * Point d'entree du cron (toutes les 5-10 min).
 *
 * IMPORTANT pour l'hebergement : ce script s'execute puis se termine. C'est un
 * vrai Cron Job, pas un serveur qui tourne en continu — c'est ce qui permet de
 * rester dans le tier gratuit de Render sans se faire endormir apres 15 min
 * d'inactivite.
 */

async function fetchMatchesForMembers(members) {
  const byPuuid = new Map();
  const rawByMatchId = new Map();

  // Sequentiel volontaire : le rate limiter de henrikdev.js espace deja les
  // appels, mais lancer tout en parallele ferait exploser la file d'attente.
  for (const m of members) {
    const opts = { region: m.region ?? 'eu' };
    try {
      byPuuid.set(m.puuid, await getRecentMatches(m.puuid, opts));
      // Meme URL que l'appel precedent, donc servi par le cache : les matchs
      // bruts (avec les positions) ne coutent aucune requete supplementaire.
      for (const raw of await getRawMatches(m.puuid, opts)) {
        const id = raw?.metadata?.match_id;
        if (id) rawByMatchId.set(id, raw);
      }
    } catch (err) {
      // Un joueur qui echoue ne doit pas casser la detection du groupe entier.
      console.error(`[detect] recuperation KO pour ${m.displayName}: ${err.message}`);
      byPuuid.set(m.puuid, []);
    }
  }
  return { byPuuid, rawByMatchId };
}

/**
 * Fait positionnel a glisser dans la notif du dernier du groupe (Brique 3).
 *
 * Uniquement pour le ton 'roast' : c'est la que la spec veut un insight concret
 * plutot qu'une vanne generique. Les autres tons restent purement lies au match.
 * Silencieux en cas d'echec — un coach indisponible ne doit jamais empecher une
 * notif de partir.
 */
async function buildInsights({ standings, match, rawByMatchId }) {
  const insights = new Map();
  const roasted = standings.find((s) => s.tone === 'roast');
  const raw = rawByMatchId.get(match.matchId);
  if (!roasted || !raw) return insights;

  try {
    const deaths = analyzeMatch({
      rawMatch: raw,
      puuids: [roasted.puuid],
      calibration: await getCalibration(match.map),
    });
    const insight = matchInsight(deaths);
    if (insight) insights.set(roasted.userId, insight);
  } catch (err) {
    console.error(`[detect]   insight positionnel indisponible : ${err.message}`);
  }

  return insights;
}

async function processGroup(group) {
  console.log(`\n[detect] Groupe "${group.name}" (${group.members.length} membres lies)`);

  if (group.members.length < config.detection.minPlayersInMatch) {
    console.log('[detect]   pas assez de comptes lies, on passe');
    return 0;
  }

  const { byPuuid: matchesByPuuid, rawByMatchId } = await fetchMatchesForMembers(group.members);
  const processedIds = config.dryRun
    ? new Set()
    : await getProcessedMatchIds(group.id, config.detection.lookbackHours * 2);

  const shared = findSharedMatches({
    members: group.members,
    matchesByPuuid,
    processedIds,
  });

  if (shared.length === 0) {
    console.log('[detect]   aucun nouveau match joue ensemble');
    return 0;
  }

  let count = 0;

  for (const { match, membersInMatch } of shared) {
    const standings = assignTones(rankGroupInMatch(match, buildPuuidIndex(membersInMatch)));

    console.log(
      `[detect]   ${match.map} — ${membersInMatch.length} du groupe : ` +
        standings.map((s) => `${s.rank}. ${s.displayName} (${s.acs} ACS, ${s.tone})`).join(' | '),
    );

    // Anti-repetition : on donne a l'IA les derniers messages deja recus par
    // chaque joueur sur le meme ton, pour qu'elle change d'angle a chaque fois
    // (voir messages.js). Saute en dry-run : pas de base garantie a ce stade.
    const history = new Map();
    if (!config.dryRun) {
      await Promise.all(
        standings.map(async (s) => {
          try {
            history.set(s.userId, await getRecentMessagesForTone(s.userId, s.tone));
          } catch (err) {
            console.error(`[detect] historique messages KO pour ${s.displayName}: ${err.message}`);
          }
        }),
      );
    }

    const insights = await buildInsights({ standings, match, rawByMatchId });
    for (const [userId, insight] of insights) {
      const who = standings.find((s) => s.userId === userId);
      console.log(`[detect]   insight positionnel (${who?.displayName}) : ${insight}`);
    }

    const withMessages = await generateAllMessages({ standings, match, history, insights });

    for (const p of withMessages) {
      console.log(`[detect]     -> ${p.displayName} [${p.tone}] : ${p.message.body}`);
    }

    if (config.dryRun) {
      count++;
      continue;
    }

    const id = await saveDetection({ groupId: group.id, match, playersWithMessages: withMessages });
    if (id === null) {
      console.log('[detect]     (deja enregistre entre-temps, notifs ignorees)');
    } else {
      count++;
    }
  }

  return count;
}

async function main() {
  const started = Date.now();
  console.log(`[detect] Demarrage${config.dryRun ? ' (DRY RUN — aucune ecriture)' : ''}`);

  if (!config.henrik.apiKey) {
    console.error('[detect] HENRIK_API_KEY manquante — impossible de recuperer les matchs.');
    process.exit(1);
  }

  let total = 0;
  try {
    const groups = await loadGroupsWithMembers();
    if (groups.length === 0) {
      console.log('[detect] Aucun groupe avec des comptes Riot lies.');
      return;
    }
    for (const group of groups) {
      total += await processGroup(group);
    }

    // Vide la file d'attente : les notifs de ce passage, plus celles qui
    // avaient echoue aux passages precedents.
    if (!config.dryRun) await drainPending();
  } finally {
    if (!config.dryRun) await closePool().catch(() => {});
  }

  console.log(
    `\n[detect] Termine — ${total} match(s) traite(s) en ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
}

main().catch((err) => {
  console.error('[detect] Erreur fatale :', err);
  process.exit(1);
});
