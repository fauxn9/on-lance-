/**
 * Relance de la detection quand un PC annonce une fin de partie.
 *
 * POURQUOI CE MODULE EXISTE
 *
 * Jusqu'ici, une partie finie n'etait vue qu'au passage suivant du cron
 * GitHub — dix minutes d'attente en moyenne, parfois plus quand GitHub decale
 * ses executions planifiees. L'application PC, elle, sait a la seconde. Ce
 * module fait le pont : elle previent, on va chercher le match.
 *
 * LE SEUL VRAI PROBLEME : L'API N'EST PAS ENCORE AU COURANT
 *
 * Au moment ou le jeu revient au menu, HenrikDev n'a pas forcement publie le
 * match. Combien de temps ? Personne ne le sait, et deviner un delai fixe
 * serait le meilleur moyen de rater la moitie des parties : trop court, on ne
 * trouve rien ; trop long, on perd l'interet d'avoir su a la seconde.
 *
 * On reessaie donc, en espacant : 15 s, 30 s, 1 min, 2 min, 4 min. On s'arrete
 * des qu'un match est traite. Et on ECRIT dans le journal a quelle tentative ca
 * a marche — au bout de quelques soirees, on saura, et on pourra resserrer.
 *
 * CE QUI RESTE VRAI SI CE MODULE ECHOUE
 *
 * Rien de tout ca n'est indispensable : le cron des dix minutes tourne
 * toujours. Une relance ratee, un serveur redemarre au mauvais moment, une
 * minuterie perdue — la notification part juste plus tard, comme avant. C'est
 * une acceleration, pas une dependance.
 */

/** Espacement des tentatives, en millisecondes. */
export const DELAIS_MS = [15_000, 30_000, 60_000, 120_000, 240_000];

/** Types d'evenements acceptes de l'application PC. */
export const TYPES_CONNUS = [
  'groupe', 'file', 'selection', 'esquive', 'debut', 'fin', 'ferme',
];

/** Au-dela, c'est que quelque chose ne va pas : on ne traite pas le reste. */
export const MAX_EVENEMENTS = 20;

/**
 * Nettoie ce qu'un client envoie.
 *
 * Le jeton d'appareil identifie une personne, pas un programme de confiance :
 * il peut etre recopie, et rien ne garantit que ce qui arrive vient bien de
 * notre application. On ne garde donc que des types connus, en nombre borne, et
 * on ne lit aucun champ dont on n'a pas besoin.
 */
export function nettoyerEvenements(brut) {
  if (!Array.isArray(brut)) return [];
  const propres = [];
  for (const e of brut) {
    if (propres.length >= MAX_EVENEMENTS) break;
    const type = typeof e?.type === 'string' ? e.type.toLowerCase() : null;
    if (!type || !TYPES_CONNUS.includes(type)) continue;
    propres.push({ type });
  }
  return propres;
}

/** Une fin de partie s'est-elle produite dans ce lot ? */
export const contientUneFin = (evenements) =>
  nettoyerEvenements(evenements).some((e) => e.type === 'fin');

/**
 * Fabrique le relanceur.
 *
 * @param executer  async (userId) => nombre de matchs traites
 * @param attendre  async (ms) => void — injectable pour les tests
 * @param journal   objet a la console
 */
export function creerRelanceur({ executer, attendre = defautAttendre, journal = console }) {
  // Une relance en cours par personne. Sans ce garde-fou, un PC qui repete son
  // battement — ou deux PC appairés au meme compte — lanceraient deux series de
  // tentatives en parallele, et donc deux fois les appels a l'API.
  const enCours = new Set();

  async function serie(userId) {
    for (const [i, delai] of DELAIS_MS.entries()) {
      await attendre(delai);
      try {
        const traites = await executer(userId);
        if (traites > 0) {
          journal.log(
            `[relance] ${traites} match(s) traite(s) pour l'utilisateur ${userId} `
            + `a la tentative ${i + 1}/${DELAIS_MS.length} (+${delai / 1000}s)`,
          );
          return;
        }
      } catch (err) {
        // Une tentative qui echoue n'annule pas les suivantes : l'API peut
        // etre indisponible une minute et revenir.
        journal.error(`[relance] tentative ${i + 1} en echec : ${err.message}`);
      }
    }
    journal.log(
      `[relance] rien trouve pour l'utilisateur ${userId} apres `
      + `${DELAIS_MS.length} tentatives — le cron prendra le relais.`,
    );
  }

  return {
    /** Pour les tests et le journal : qui a une relance en cours. */
    enCours: () => new Set(enCours),

    /**
     * Lance une serie de tentatives. Ne bloque pas l'appelant : la reponse HTTP
     * a l'application PC part tout de suite, la recherche continue derriere.
     *
     * @returns true si une serie vient d'etre lancee, false si une tournait deja
     */
    declencher(userId) {
      if (userId == null || enCours.has(userId)) return false;
      enCours.add(userId);
      serie(userId).finally(() => enCours.delete(userId));
      return true;
    },
  };
}

function defautAttendre(ms) {
  return new Promise((r) => {
    // unref : une minuterie en attente ne doit pas empecher le processus de
    // s'arreter proprement lors d'un redeploiement.
    const t = setTimeout(r, ms);
    if (typeof t.unref === 'function') t.unref();
  });
}
