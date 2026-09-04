/**
 * Quota de questions au coach.
 *
 * Chaque question coute un appel facture sur la cle Anthropic du projet, qui est
 * une cle perso. Sans limite, un onglet laisse ouvert ou un pote curieux peut
 * vider le credit en une soiree.
 *
 * Fenetre glissante plutot que compteur remis a zero a heure fixe : trois
 * questions puis trente minutes d'attente, ou que l'on tombe dans l'heure. Un
 * compteur horaire laisserait poser six questions d'affilee a cheval sur deux
 * heures.
 *
 * En memoire, donc remis a zero au redemarrage du serveur. Assume : la limite
 * protege d'un usage distrait, pas d'un attaquant, et l'instance gratuite de
 * Render se rendort de toute facon.
 */

/** userId -> horodatages des questions retenues */
const journal = new Map();

/**
 * @returns { autorise, restantes, reprendDansMs }
 */
export function verifierQuota(userId, { max, fenetreMs, maintenant = Date.now() }) {
  const recentes = (journal.get(userId) ?? []).filter((t) => maintenant - t < fenetreMs);

  if (recentes.length > 0) journal.set(userId, recentes);
  else journal.delete(userId); // rien de recent : on ne garde pas l'entree

  if (recentes.length >= max) {
    // La plus ancienne des questions retenues est celle qui liberera une place.
    const reprendDansMs = fenetreMs - (maintenant - Math.min(...recentes));
    return { autorise: false, restantes: 0, reprendDansMs };
  }

  return { autorise: true, restantes: max - recentes.length, reprendDansMs: 0 };
}

/**
 * Enregistre une question consommee.
 *
 * Appele APRES avoir decide d'appeler le modele : une question qui n'a rien
 * coute — periode sans donnees, question vide — ne doit pas entamer le quota.
 */
export function consommerQuota(userId, { maintenant = Date.now() } = {}) {
  const recentes = journal.get(userId) ?? [];
  recentes.push(maintenant);
  journal.set(userId, recentes);
}

/** Pour les tests. */
export function viderQuota() {
  journal.clear();
}
