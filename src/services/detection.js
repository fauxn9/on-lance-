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
    // LA FEUILLE DU MATCH FAIT FOI, PAS LA MATCHLIST DE CHACUN.
    //
    // Plus haut, un membre n'entre dans `puuids` que si SA PROPRE matchlist
    // contenait ce match. C'est fragile pour deux raisons, toutes deux
    // constatees en production le 06/09/2026 :
    //
    //   - sa requete a l'API peut avoir echoue — un 429 suffit, et il arrive
    //     des que deux crons tombent dans la meme minute. Le catch de
    //     `fetchMatchesForMembers` lui attribue alors une liste vide, et il
    //     est traite comme absent d'une partie qu'il a pourtant jouee ;
    //   - on ne recupere que les `matchesPerPlayer` derniers matchs de chacun :
    //     celui qui a enchaine depuis voit la partie commune sortir de sa
    //     fenetre avant celle des autres.
    //
    // Dans les deux cas la personne etait bel et bien dans la game et
    // disparaissait du classement sans un mot : pas de place, pas de
    // notification. Constate sur deux parties du 05/09 ou quatre membres
    // etaient classes alors que cinq avaient joue — et c'etait a chaque fois
    // le dernier inscrit, donc le plus susceptible d'en conclure que ca ne
    // marche pas.
    //
    // Or le match telecharge porte LES DIX JOUEURS. L'information etait deja
    // la, on ne la regardait pas. Une seule requete reussie, celle de
    // n'importe lequel des membres, suffit desormais a tous les retrouver.
    for (const membre of members) {
      if (match.players?.some((p) => p.puuid === membre.puuid)) puuids.add(membre.puuid);
    }

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
