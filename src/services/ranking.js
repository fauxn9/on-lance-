/**
 * Classement des membres du groupe sur un match donne, et attribution du ton
 * de la notif.
 *
 * Fonctions pures, sans I/O : c'est le coeur metier, il doit rester testable
 * sans base de donnees ni API.
 */

/**
 * ACS (Average Combat Score) = score total / nombre de rounds.
 *
 * Pourquoi l'ACS plutot qu'un K/D brut : le K/D favorise mecaniquement les
 * duelists agressifs et penalise les sentinelles/controleurs qui jouent
 * l'utilitaire. L'ACS est la metrique que Riot utilise lui-meme pour designer
 * le MVP d'une partie et equilibre nettement mieux les roles.
 */
export function acs(player, roundsPlayed) {
  if (!roundsPlayed || roundsPlayed <= 0) return 0;
  return player.score / roundsPlayed;
}

export function kd(player) {
  return player.deaths === 0 ? player.kills : player.kills / player.deaths;
}

export function headshotPercent(player) {
  const shots = player.headshots + player.bodyshots + player.legshots;
  return shots === 0 ? 0 : (player.headshots / shots) * 100;
}

/**
 * Classe les membres du groupe presents dans un match.
 *
 * @param match       objet normalise (voir henrikdev.js)
 * @param puuidToUser Map<puuid, {userId, displayName}>
 * @returns [{ rank, userId, displayName, puuid, agent, acs, kills, deaths,
 *             assists, kd, hsPercent, won, gapToFirst }]
 *          trie du meilleur au moins bon.
 */
export function rankGroupInMatch(match, puuidToUser) {
  const members = match.players
    .filter((p) => puuidToUser.has(p.puuid))
    .map((p) => {
      const u = puuidToUser.get(p.puuid);
      return {
        userId: u.userId,
        displayName: u.displayName,
        puuid: p.puuid,
        agent: p.agent,
        acs: Math.round(acs(p, match.roundsPlayed)),
        kills: p.kills,
        deaths: p.deaths,
        assists: p.assists,
        kd: Number(kd(p).toFixed(2)),
        hsPercent: Math.round(headshotPercent(p)),
        damageDealt: p.damageDealt,
        won: p.won,
      };
    });

  // Tri principal : ACS. Departages successifs pour eviter tout hasard sur une
  // egalite parfaite (rare mais possible sur des petits scores).
  members.sort((a, b) => b.acs - a.acs || b.kills - a.kills || a.deaths - b.deaths);

  const topAcs = members[0]?.acs ?? 0;

  return members.map((m, i) => ({
    ...m,
    rank: i + 1,
    gapToFirst: topAcs - m.acs,
  }));
}

/**
 * Attribue un ton a chaque joueur selon sa place dans le groupe.
 *
 *   1er            -> 'hype'  : message valorisant
 *   milieu         -> 'push'  : message motivant, qui met un peu la rage
 *   dernier        -> 'roast' : message piquant (frustration positive)
 *
 * Cas a 2 joueurs : le 2e EST le dernier. Par defaut il recoit 'roast', parce
 * que c'est bien lui qui s'est fait distancer. Si ca s'avere trop dur a l'usage
 * avec le groupe, basculer `twoPlayerSecondTone` sur 'push' — c'est le seul
 * reglage a changer, rien d'autre ne bouge.
 */
export function assignTones(standings, { twoPlayerSecondTone = 'roast' } = {}) {
  const n = standings.length;

  return standings.map((s) => {
    let tone;
    if (n === 1) {
      tone = 'hype';
    } else if (n === 2) {
      tone = s.rank === 1 ? 'hype' : twoPlayerSecondTone;
    } else if (s.rank === 1) {
      tone = 'hype';
    } else if (s.rank === n) {
      tone = 'roast';
    } else {
      tone = 'push';
    }
    return { ...s, tone };
  });
}

/**
 * Intensite du roast/hype, calibree sur l'ecart reel.
 *
 * Sans ca, un dernier a 3 points d'ACS du premier se prend le meme message
 * cinglant qu'un dernier a 120 points — ce qui sonne faux et devient injuste.
 * L'IA recoit cette intensite en entree pour doser son message.
 */
export function intensityFromGap(gapToFirst) {
  if (gapToFirst <= 15) return 'serre';   // quasi ex aequo
  if (gapToFirst <= 60) return 'net';     // ecart clair
  return 'large';                          // s'est fait marcher dessus
}
