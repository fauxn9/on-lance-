import { config } from '../config.js';

/**
 * Moteur de detection.
 *
 * Volontairement sans I/O : on lui passe les matchs deja recuperes et les
 * match_id deja traites, il rend la liste des matchs a notifier. C'est ce qui
 * permet de tester toute la logique (fenetre de temps, delai de stabilisation,
 * anti-doublon, seuil de joueurs) sans base ni appel reseau.
 */

/**
 * @param members          [{ userId, displayName, puuid }]
 * @param matchesByPuuid   Map<puuid, Match[]> (matchs normalises)
 * @param processedIds     Set<string> des match_id deja traites pour ce groupe
 * @param now              Date (injectable pour les tests)
 * @returns [{ match, membersInMatch: [{userId, displayName, puuid}] }]
 */
export function findSharedMatches({ members, matchesByPuuid, processedIds, now = new Date() }) {
  const { lookbackHours, settleDelayMinutes, minPlayersInMatch } = config.detection;

  const lookbackFloor = new Date(now.getTime() - lookbackHours * 3600_000);
  const settleCeiling = new Date(now.getTime() - settleDelayMinutes * 60_000);

  // match_id -> { match, puuids: Set }
  const byMatch = new Map();

  for (const member of members) {
    const matches = matchesByPuuid.get(member.puuid) ?? [];
    for (const match of matches) {
      if (!match?.matchId) continue;

      // Deja notifie : on ne repasse jamais dessus.
      if (processedIds.has(match.matchId)) continue;

      // Hors fenetre : evite de notifier tout l'historique au premier lancement.
      if (match.startedAt < lookbackFloor) continue;

      // Trop recent : les stats ne sont pas forcement completes cote API.
      // On le laisse pour le prochain passage du cron.
      if (match.startedAt > settleCeiling) continue;

      if (!byMatch.has(match.matchId)) {
        byMatch.set(match.matchId, { match, puuids: new Set() });
      }
      byMatch.get(match.matchId).puuids.add(member.puuid);
    }
  }

  const byPuuid = new Map(members.map((m) => [m.puuid, m]));
  const result = [];

  for (const { match, puuids } of byMatch.values()) {
    if (puuids.size < minPlayersInMatch) continue;
    result.push({
      match,
      membersInMatch: [...puuids].map((p) => byPuuid.get(p)),
    });
  }

  // Du plus ancien au plus recent : les notifs arrivent dans l'ordre de jeu.
  result.sort((a, b) => a.match.startedAt - b.match.startedAt);
  return result;
}

/**
 * Construit la Map<puuid, {userId, displayName}> attendue par rankGroupInMatch.
 */
export function buildPuuidIndex(membersInMatch) {
  return new Map(
    membersInMatch.map((m) => [m.puuid, { userId: m.userId, displayName: m.displayName }]),
  );
}
