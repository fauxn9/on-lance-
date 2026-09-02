#!/usr/bin/env node
import { config } from '../config.js';
import {
  weekStartOf,
  previousWeek,
  weekLabel,
  buildLeaderboard,
  hasActivity,
  weeklyWinner,
} from '../services/leaderboard.js';
import { generateAllWeeklyMessages } from '../services/messages.js';
import { drainPending } from '../services/notifications.js';
import {
  loadGroupsWithMembers,
  loadWeekRr,
  getClosedWeeks,
  getRecentMessagesForTone,
  closeWeek,
  closePool,
} from '../db/index.js';

/**
 * Cloture de la semaine (Brique 2).
 *
 * A lancer chaque lundi (cron hebdo, ex. 04:00 Europe/Paris). Le job :
 *   1. calcule le classement de la semaine ecoulee pour chaque groupe
 *   2. le fige en base (historique des vainqueurs, jamais recalcule ensuite)
 *   3. met en file une notif par membre : 'crown' pour le vainqueur, 'recap'
 *      pour les autres
 *
 * Rejouable : l'unicite (group_id, week_start) garantit qu'une semaine deja
 * cloturee ne l'est pas une seconde fois, donc pas de notif en double meme si
 * le cron est relance a la main.
 *
 * Usage : node src/jobs/close-week.js [YYYY-MM-DD]
 *   sans argument, cloture la semaine precedente.
 */

const [, , weekArg] = process.argv;
const targetWeek = weekArg ?? previousWeek(weekStartOf(new Date()));

if (!/^\d{4}-\d{2}-\d{2}$/.test(targetWeek)) {
  console.error(`Semaine invalide : ${targetWeek} (format attendu : YYYY-MM-DD, un lundi)`);
  process.exit(1);
}

function assignWeeklyTones(standings) {
  return standings.map((s) => ({ ...s, tone: s.rank === 1 ? 'crown' : 'recap' }));
}

async function processGroup(group) {
  console.log(`\n[week] Groupe "${group.name}"`);

  if (!config.dryRun) {
    const closed = await getClosedWeeks(group.id);
    if (closed.has(targetWeek)) {
      console.log('[week]   semaine deja cloturee, on passe');
      return 0;
    }
  }

  const rrRows = await loadWeekRr(group.id, targetWeek);
  const standings = assignWeeklyTones(
    buildLeaderboard({ members: group.members, rrRows }),
  );

  if (!hasActivity(standings)) {
    console.log('[week]   aucun match classe cette semaine, rien a cloturer');
    return 0;
  }

  const winner = weeklyWinner(standings);
  const label = weekLabel(targetWeek);

  console.log(
    `[week]   ${label} : ` +
      standings
        .map((s) => `${s.rank}. ${s.displayName} (${s.rrTotal > 0 ? '+' : ''}${s.rrTotal} RR)`)
        .join(' | '),
  );
  if (winner?.tied) console.log('[week]   (egalite parfaite en tete)');

  // Anti-repetition : meme mecanique que les notifs de fin de match.
  const history = new Map();
  if (!config.dryRun) {
    await Promise.all(
      standings.map(async (s) => {
        try {
          history.set(s.userId, await getRecentMessagesForTone(s.userId, s.tone));
        } catch (err) {
          console.error(`[week]   historique KO pour ${s.displayName}: ${err.message}`);
        }
      }),
    );
  }

  const withMessages = await generateAllWeeklyMessages({ standings, weekLabel: label, history });
  for (const p of withMessages) {
    console.log(`[week]     -> ${p.displayName} [${p.tone}] : ${p.message.body}`);
  }

  if (config.dryRun) return 1;

  const id = await closeWeek({
    groupId: group.id,
    weekStart: targetWeek,
    standings: withMessages.map((p) => ({
      rank: p.rank,
      userId: p.userId,
      displayName: p.displayName,
      rrTotal: p.rrTotal,
      matches: p.matches,
      bestGain: p.bestGain,
      worstLoss: p.worstLoss,
      tone: p.tone,
    })),
    winner,
    playersWithMessages: withMessages,
  });

  if (id === null) {
    console.log('[week]   (cloturee entre-temps par un autre passage, notifs ignorees)');
    return 0;
  }
  return 1;
}

async function main() {
  console.log(
    `[week] Cloture de la semaine du ${targetWeek}${config.dryRun ? ' (DRY RUN — aucune ecriture)' : ''}`,
  );

  let closed = 0;
  try {
    const groups = await loadGroupsWithMembers();
    if (groups.length === 0) {
      console.log('[week] Aucun groupe avec des comptes Riot lies.');
      return;
    }

    for (const group of groups) {
      closed += await processGroup(group);
    }

    if (!config.dryRun) await drainPending();
  } finally {
    await closePool().catch(() => {});
  }

  console.log(`\n[week] Termine — ${closed} semaine(s) cloturee(s).`);
}

main().catch((err) => {
  console.error('[week] Erreur fatale :', err);
  process.exit(1);
});
