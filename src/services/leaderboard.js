/**
 * Leaderboard hebdomadaire (Brique 2).
 *
 * Meme principe que ranking.js : fonctions pures, aucune I/O. Toute la logique
 * de semaine et d'agregation est testable sans base ni appel reseau.
 *
 * Metrique : somme du RR gagne/perdu sur la semaine (champ `last_change` de
 * l'API, deja normalise en `rrChange`). Pas de moyenne, pas de ponderation :
 * c'est la regle la plus lisible pour un groupe de potes, et celle retenue
 * dans la spec.
 */

// La semaine se remet a zero le lundi, dans le fuseau du groupe (et pas en UTC,
// sinon les games du dimanche soir 23h tomberaient dans la semaine suivante).
export const DEFAULT_TZ = process.env.LEADERBOARD_TZ ?? 'Europe/Paris';

const DAY_MS = 86_400_000;

/**
 * Date civile (annee/mois/jour tels qu'affiches par une horloge locale) d'un
 * instant donne, dans un fuseau donne.
 */
function civilPartsIn(date, timeZone) {
  // 'en-CA' donne directement le format YYYY-MM-DD, pas de parsing fragile.
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(date)
    .split('-')
    .map(Number);
  return { y, m, d };
}

/**
 * Lundi de la semaine contenant `date`, au format 'YYYY-MM-DD'.
 *
 * Pourquoi une date de lundi plutot qu'un numero de semaine ISO ("2026-W36") :
 * pas de piege de bascule d'annee, tri chronologique naturel en base, et
 * lisible tel quel par un humain qui regarde la table.
 */
export function weekStartOf(date, timeZone = DEFAULT_TZ) {
  const { y, m, d } = civilPartsIn(date, timeZone);
  const civil = Date.UTC(y, m - 1, d);
  const dow = new Date(civil).getUTCDay(); // 0 = dimanche, 1 = lundi
  const shiftToMonday = (dow + 6) % 7; // lundi -> 0, dimanche -> 6
  return new Date(civil - shiftToMonday * DAY_MS).toISOString().slice(0, 10);
}

/** Decale une cle de semaine de N semaines (negatif = vers le passe). */
export function shiftWeek(weekStart, weeks) {
  return new Date(Date.parse(`${weekStart}T00:00:00Z`) + weeks * 7 * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

export const previousWeek = (weekStart) => shiftWeek(weekStart, -1);

/**
 * Decalage d'un fuseau par rapport a UTC, a un instant donne, en millisecondes.
 *
 * On lit l'heure civile du fuseau champ par champ (`formatToParts`) et on la
 * relit comme si elle etait en UTC : la difference EST le decalage. Aucune
 * chaine de date n'est reparsee au passage, et c'est tout l'enjeu — voir la
 * fonction suivante.
 */
function decalageMs(instant, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );

  // Minuit se lit "24" et non "00" selon les versions d'ICU : sans ce modulo,
  // une nuit sur deux serait decalee de vingt-quatre heures.
  const heure = Number(parts.hour) % 24;
  const civil = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    heure, Number(parts.minute), Number(parts.second),
  );
  return civil - instant.getTime();
}

/**
 * Instant UTC correspondant a minuit local d'une date donnee, dans le fuseau
 * du groupe. Sert a savoir quand la semaine se termine reellement.
 *
 * POURQUOI CE N'EST PAS ECRIT PLUS SIMPLEMENT
 *
 * La version precedente faisait `new Date(instant.toLocaleString('en-US', {
 * timeZone }))` : elle formatait dans le bon fuseau, puis REPARSAIT le
 * resultat — et une date sans fuseau explicite est interpretee dans le fuseau
 * de LA MACHINE. Sur un serveur en UTC (Render, GitHub Actions) le calcul
 * tombait juste ; sur un PC regle sur Paris, le decalage se soustrayait
 * lui-meme et la fonction rendait minuit UTC. Le meme code, deux resultats,
 * selon l'horloge de qui l'execute. Les tests le disaient d'ailleurs : ils
 * passaient sur le serveur et echouaient sur un PC francais.
 *
 * Deux passes : le decalage se lit a un instant donne, et cet instant est
 * justement ce qu'on cherche. La premiere l'approche, la seconde le corrige —
 * le cas qui l'exige est le week-end du changement d'heure. Une troisieme
 * n'apporterait rien : aucun fuseau ne bascule a minuit.
 */
function zonedMidnight(dateStr, timeZone) {
  const minuitUtc = Date.parse(`${dateStr}T00:00:00Z`);
  const premiere = minuitUtc - decalageMs(new Date(minuitUtc), timeZone);
  return new Date(minuitUtc - decalageMs(new Date(premiere), timeZone));
}

/**
 * Debut et fin d'une semaine, en instants precis.
 * La semaine se termine au moment ou commence la suivante : une game lancee
 * une minute avant compte encore.
 */
export function weekBounds(weekStart, timeZone = DEFAULT_TZ) {
  return {
    startsAt: zonedMidnight(weekStart, timeZone),
    endsAt: zonedMidnight(shiftWeek(weekStart, 1), timeZone),
  };
}

/** Libelle lisible : "semaine du 31 aout". */
export function weekLabel(weekStart, locale = 'fr-FR') {
  return `semaine du ${new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${weekStart}T00:00:00Z`))}`;
}

/**
 * Construit le classement de la semaine.
 *
 * @param members [{ userId, displayName }]  tous les membres du groupe
 * @param rrRows  [{ userId, rrChange }]     lignes de RR de la semaine
 *
 * Les membres qui n'ont pas joue apparaissent quand meme, a 0 RR et 0 match :
 * un leaderboard ou les absents disparaissent donne l'impression d'un bug, et
 * voir "0 match" pousse justement a lancer une game.
 */
export function buildLeaderboard({ members, rrRows }) {
  const byUser = new Map(
    members.map((m) => [
      m.userId,
      {
        userId: m.userId,
        displayName: m.displayName,
        rrTotal: 0,
        matches: 0,
        bestGain: null,
        worstLoss: null,
      },
    ]),
  );

  for (const row of rrRows) {
    const entry = byUser.get(row.userId);
    if (!entry) continue; // RR d'un ancien membre : ignore
    const change = Number(row.rrChange);
    if (!Number.isFinite(change)) continue;

    entry.rrTotal += change;
    entry.matches += 1;
    if (entry.bestGain === null || change > entry.bestGain) entry.bestGain = change;
    if (entry.worstLoss === null || change < entry.worstLoss) entry.worstLoss = change;
  }

  // Tri : RR total, puis moins de matchs joues (meme RR en moins de games = plus
  // efficace), puis le nom pour que l'ordre reste stable d'un affichage a l'autre.
  const sorted = [...byUser.values()].sort(
    (a, b) =>
      b.rrTotal - a.rrTotal ||
      a.matches - b.matches ||
      String(a.displayName).localeCompare(String(b.displayName), 'fr'),
  );

  return sorted.map((entry, i) => ({ ...entry, rank: i + 1 }));
}

/** Personne n'a joue de match classe cette semaine : rien a cloturer. */
export function hasActivity(standings) {
  return standings.some((s) => s.matches > 0);
}

/**
 * Vainqueur de la semaine, ou null si la semaine est vide.
 * `tied` signale une egalite parfaite en tete (meme RR ET meme nombre de
 * matchs) — le message de cloture peut alors le mentionner au lieu de
 * designer un vainqueur qui n'en est pas vraiment un.
 */
export function weeklyWinner(standings) {
  if (!hasActivity(standings)) return null;
  const [first, second] = standings;
  if (!first) return null;
  return {
    ...first,
    tied: Boolean(second && second.rrTotal === first.rrTotal && second.matches === first.matches),
  };
}
