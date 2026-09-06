/**
 * Ce que l'application PC affiche sur le statut Discord de la personne.
 *
 * POURQUOI CE N'EST PAS QU'UN LIBELLE
 *
 * Un statut qui dit « En partie — Ascent » est le statut d'un tracker. Celui-ci
 * doit dire ce que fait le projet : le groupe a vu ta game. On y met donc la
 * place dans le groupe sur la derniere partie, le classement de la semaine et
 * la serie en cours — c'est-a-dire les trois seules choses qui se commentent
 * toutes seules sur un vocal.
 *
 * Ce module est SANS I/O : il recoit des lignes deja chargees et rend des faits
 * compacts. La mise en forme finale se fait cote Rust, au plus pres de Discord,
 * et rien ici ne depend de Discord.
 */

/** Au-dessous de deux parties, ce n'est pas une serie, c'est un resultat. */
export const SERIE_MINIMUM = 2;

/**
 * Serie de victoires ou de defaites en cours.
 *
 * @param matchs  parties du plus RECENT au plus ancien, avec `won`
 * @returns { type: 'victoires' | 'defaites', n } ou null
 */
export function serieEnCours(matchs) {
  const joues = (matchs ?? []).filter((m) => m?.won === true || m?.won === false);
  if (joues.length === 0) return null;

  const gagne = joues[0].won;
  let n = 0;
  for (const m of joues) {
    if (m.won !== gagne) break;
    n += 1;
  }

  if (n < SERIE_MINIMUM) return null;
  return { type: gagne ? 'victoires' : 'defaites', n };
}

/**
 * Place de quelqu'un dans le classement d'une partie donnee.
 *
 * `standings` est le tableau enregistre au moment de la detection : c'est
 * exactement ce qui a ete notifie, donc ce qu'ont vu les autres. On ne le
 * recalcule pas — le statut doit dire la meme chose que la notification.
 */
export function placeDansLaPartie(standings, userId) {
  const liste = Array.isArray(standings) ? standings : [];
  const moi = liste.find((s) => Number(s?.userId) === Number(userId));
  if (!moi) return null;

  return {
    place: Number(moi.rank),
    sur: liste.length,
    kills: moi.kills ?? null,
    deaths: moi.deaths ?? null,
    assists: moi.assists ?? null,
    acs: moi.acs ?? null,
    gagnee: moi.won ?? null,
  };
}

/**
 * Place au classement hebdomadaire.
 *
 * @param standings  le classement construit par buildLeaderboard()
 */
export function placeDeLaSemaine(standings, userId) {
  const liste = Array.isArray(standings) ? standings : [];
  const moi = liste.find((s) => Number(s?.userId) === Number(userId));
  if (!moi) return null;
  return { place: Number(moi.rank), sur: liste.length, rr: Number(moi.rrTotal) };
}

/**
 * Le tout, sous la forme que lit l'application PC.
 *
 * Chaque bloc vaut `null` quand la donnee n'existe pas encore — un compte tout
 * neuf n'a ni classement, ni serie, ni derniere partie, et le statut doit
 * rester correct dans ce cas plutot que d'afficher des zeros.
 */
export function construireStatut({ userId, classementSemaine, matchsRecents, derniereDetection }) {
  return {
    semaine: placeDeLaSemaine(classementSemaine, userId),
    serie: serieEnCours(matchsRecents),
    derniere: derniereDetection
      ? {
        map: derniereDetection.map_name ?? null,
        quand: derniereDetection.started_at ?? null,
        ...(placeDansLaPartie(derniereDetection.standings, userId) ?? {}),
      }
      : null,
  };
}
