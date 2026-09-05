/**
 * La chaine de detection, extraite du cron.
 *
 * Elle vivait dans `src/jobs/detect-matches.js`, appelee uniquement par GitHub
 * Actions toutes les dix minutes. Depuis que l'application PC sait annoncer une
 * fin de partie a la seconde, il faut pouvoir la declencher depuis le serveur
 * web aussi — d'ou ce module, appele par les deux.
 *
 * Le cron reste en place et ne change pas de comportement : c'est le filet.
 * Si l'application PC est fermee, si le serveur redemarre au mauvais moment, si
 * la relance ne trouve rien, la notification part au passage suivant comme
 * avant.
 */

import { config } from '../config.js';
import { getRecentMatches, getRawMatches } from './henrikdev.js';
import { findSharedMatches, buildPuuidIndex } from './detection.js';
import { rankGroupInMatch, assignTones } from './ranking.js';
import { generateAllMessages } from './messages.js';
import { analyzeMatch } from './positional.js';
import { matchInsight } from './coach.js';
import { getCalibration } from './maps.js';
import { drainPending } from './notifications.js';
import {
  loadGroupsWithMembers,
  getProcessedMatchIds,
  getRecentMessagesForTone,
  saveDetection,
} from '../db/index.js';

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
 * plutot qu'une vanne generique. Silencieux en cas d'echec — un coach
 * indisponible ne doit jamais empecher une notif de partir.
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

/** Traite un groupe. Renvoie le nombre de matchs nouvellement enregistres. */
export async function traiterGroupe(group) {
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
      `[detect]   ${match.map} — ${membersInMatch.length} du groupe : `
        + standings.map((s) => `${s.rank}. ${s.displayName} (${s.acs} ACS, ${s.tone})`).join(' | '),
    );

    // Anti-repetition : on donne a l'IA les derniers messages deja recus par
    // chaque joueur sur le meme ton, pour qu'elle change d'angle a chaque fois.
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

/** Traite tous les groupes. C'est ce que fait le cron. */
export async function detecterPourTous() {
  const groups = await loadGroupsWithMembers();
  if (groups.length === 0) {
    console.log('[detect] Aucun groupe avec des comptes Riot lies.');
    return 0;
  }

  let total = 0;
  for (const group of groups) total += await traiterGroupe(group);
  if (!config.dryRun) await drainPending();
  return total;
}

/**
 * Traite uniquement les groupes dont cette personne fait partie.
 *
 * C'est le chemin emprunte quand un PC annonce une fin de partie. On restreint
 * aux groupes concernes pour ne pas interroger l'API pour des gens qui ne
 * jouaient pas — le quota HenrikDev n'est pas infini, et une relance doit
 * rester bien plus legere qu'un passage de cron.
 */
export async function detecterPourUtilisateur(userId) {
  const groups = (await loadGroupsWithMembers())
    .filter((g) => g.members.some((m) => m.userId === userId));

  if (groups.length === 0) return 0;

  let total = 0;
  for (const group of groups) total += await traiterGroupe(group);
  if (total > 0 && !config.dryRun) await drainPending();
  return total;
}
