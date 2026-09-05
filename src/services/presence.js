/**
 * Lecture de la presence locale du client Riot — le coeur de la brique 9.
 *
 * Ce module ne parle a personne : il transforme une charge utile de presence
 * en instantane, puis une suite d'instantanes en EVENEMENTS. Tout ce qui est
 * reseau (lockfile, HTTP local, notifications) vit ailleurs, pour que la
 * partie difficile — decider qu'une partie vient de finir — soit testable
 * sans client Riot ni Valorant ouvert.
 *
 * Les regles ci-dessous ne sont pas theoriques : elles viennent d'un releve
 * complet fait le 4 septembre 2026, du groupe qui se forme jusqu'au retour au
 * menu (cf. docs/presence-locale.md et test/presence.test.js, qui rejoue ce
 * releve tel quel). Trois pieges s'y sont montres, et chacun aurait produit un
 * bug silencieux :
 *
 *   1. LE SCORE EST REMIS A ZERO AVANT LE RETOUR AU MENU. Huit secondes
 *      separent la fin des rounds du passage INGAME -> MENUS, et le score
 *      repasse a 0-0 DANS cet intervalle. Lire le score au moment du retour
 *      au menu, le geste le plus naturel du monde, donne 0-0 a chaque partie.
 *      On garde donc le dernier score connu, et on refuse toute BAISSE : un
 *      score de partie ne fait que monter, une baisse est une remise a zero.
 *
 *   2. PREGAME -> MENUS SANS PASSER PAR INGAME, C'EST UNE ESQUIVE. Quelqu'un
 *      a quitte la selection d'agents. Traiter tout retour au menu comme une
 *      fin de partie annoncerait une partie qui n'a jamais eu lieu.
 *
 *   3. LES CHAMPS `partyOwner*` DECRIVENT LE CHEF DE GROUPE, PAS SOI. Ils
 *      coincident tant qu'on est soi-meme chef, ce qui rend l'erreur
 *      invisible pendant les tests. L'etat personnel se lit dans
 *      `matchPresenceData`, jamais dans le miroir du chef.
 *
 * Enfin, on ne cherche l'etat de partie par AUCUN nom de champ : on le
 * reconnait a sa valeur (MENUS / PREGAME / INGAME). Deux versions de la sonde
 * ont echoue parce que Riot avait deplace `sessionLoopState` dans un
 * sous-objet — et ont echoue en silence, en renvoyant `undefined`. Reconnaitre
 * la valeur survit a un deplacement ; et quand plus rien ne correspond, on le
 * dit au lieu de faire comme si.
 */

export const ETATS = ['MENUS', 'PREGAME', 'INGAME'];

/** Aplatit les sous-objets : `matchPresenceData.sessionLoopState`, etc. */
export function aplatir(objet, prefixe = '', sortie = {}) {
  for (const [cle, val] of Object.entries(objet ?? {})) {
    const chemin = prefixe ? `${prefixe}.${cle}` : cle;
    if (val && typeof val === 'object' && !Array.isArray(val)) aplatir(val, chemin, sortie);
    else sortie[chemin] = val;
  }
  return sortie;
}

/**
 * Retrouve l'etat de partie par sa valeur, et pas par son nom.
 *
 * On ignore volontairement les champs `partyOwner*` : ils portent la meme
 * valeur, mais celle du chef de groupe. Les confondre marche tant qu'on est
 * chef et casse des qu'on ne l'est plus — le genre de bug qui ne se montre
 * jamais chez celui qui l'a ecrit.
 */
export function trouverEtat(plat) {
  for (const [cle, val] of Object.entries(plat ?? {})) {
    if (/partyOwner/i.test(cle)) continue;
    if (typeof val === 'string' && ETATS.includes(val.toUpperCase())) {
      return { champ: cle, etat: val.toUpperCase() };
    }
  }
  return null;
}

/** Premiere valeur non vide parmi plusieurs chemins possibles. */
const premier = (plat, ...chemins) => {
  for (const c of chemins) {
    const v = plat[c];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
};

const entier = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * Transforme la charge utile decodee en instantane exploitable.
 *
 * `mapCode` reste le nom interne (Triad, Juliett...). La traduction en nom
 * affichable appartient a maps.js, qui la tient de valorant-api.com : aucune
 * table de correspondance ecrite a la main ici, elle serait fausse a la
 * prochaine map.
 */
export function lireInstantane(prive) {
  if (!prive || typeof prive !== 'object') return null;
  const plat = aplatir(prive);
  const trouve = trouverEtat(plat);

  return {
    etat: trouve?.etat ?? null,
    champEtat: trouve?.champ ?? null,
    mapCode: premier(plat, 'matchPresenceData.matchMap', 'matchMap'),
    queue: premier(plat, 'matchPresenceData.queueId', 'queueId'),
    flux: premier(plat, 'matchPresenceData.provisioningFlow', 'provisioningFlow'),
    partyState: premier(plat, 'partyPresenceData.partyState', 'partyState'),
    partySize: entier(premier(plat, 'partyPresenceData.partySize', 'partySize')),
    partyId: premier(plat, 'partyPresenceData.partyId', 'partyId'),
    tier: entier(premier(plat, 'playerPresenceData.competitiveTier', 'competitiveTier')),
    score: {
      nous: entier(premier(plat, 'partyPresenceData.partyOwnerMatchScoreAllyTeam', 'partyOwnerMatchScoreAllyTeam')),
      eux: entier(premier(plat, 'partyPresenceData.partyOwnerMatchScoreEnemyTeam', 'partyOwnerMatchScoreEnemyTeam')),
    },
  };
}

const scoreValide = (s) => Number.isFinite(s?.nous) && Number.isFinite(s?.eux);

/**
 * Le score a-t-il BAISSE ? Alors c'est une remise a zero, pas un round perdu.
 *
 * C'est toute la parade au piege n°1. Tester « non nul » ne suffirait pas :
 * une defaite 0-13 laisse legitimement notre score a zero du debut a la fin.
 */
const aBaisse = (avant, apres) =>
  scoreValide(avant) && scoreValide(apres)
  && (apres.nous < avant.nous || apres.eux < avant.eux);

/**
 * Machine a etats : on lui donne les instantanes au fil de l'eau, elle rend
 * les evenements qui viennent de se produire.
 *
 * Types d'evenements :
 *   groupe    le groupe grandit — c'est le « on lance ? » du nom du site
 *   file      le groupe part en recherche de partie
 *   selection une partie est trouvee, selection d'agents
 *   esquive   quelqu'un a quitte la selection
 *   debut     la partie commence pour de bon
 *   fin       retour au menu depuis INGAME : la seule vraie fin de partie
 *   ferme     le jeu n'est plus la
 */
export function creerMachine({ horloge = () => Date.now() } = {}) {
  let precedent = null;      // dernier instantane vu
  let scoreGele = null;      // dernier score credible de la partie en cours
  let debutPartie = null;    // horodatage du passage a INGAME

  return {
    /** Pour inspection dans les tests et les journaux. */
    get etat() { return precedent?.etat ?? null; },
    get score() { return scoreGele; },

    avancer(instantane) {
      const evs = [];
      const t = horloge();

      if (!instantane) {
        if (precedent) evs.push({ type: 'ferme', a: t });
        precedent = null; scoreGele = null; debutPartie = null;
        return evs;
      }

      const av = precedent;

      // --- Le score ------------------------------------------------------
      // On ne retient un score que pendant la partie, et jamais s'il baisse.
      if (instantane.etat === 'INGAME' && scoreValide(instantane.score)
          && !aBaisse(scoreGele, instantane.score)) {
        scoreGele = { ...instantane.score };
      }

      // --- Le cycle de partie --------------------------------------------
      const avant = av?.etat ?? null;
      const apres = instantane.etat;

      if (avant !== apres) {
        if (apres === 'PREGAME') {
          evs.push({ type: 'selection', mapCode: instantane.mapCode, a: t });
        } else if (apres === 'INGAME') {
          debutPartie = t;
          scoreGele = scoreValide(instantane.score) ? { ...instantane.score } : null;
          evs.push({ type: 'debut', mapCode: instantane.mapCode, a: t });
        } else if (apres === 'MENUS' && avant === 'PREGAME') {
          // Piege n°2 : personne n'a joue.
          evs.push({ type: 'esquive', mapCode: av?.mapCode ?? null, a: t });
        } else if (apres === 'MENUS' && avant === 'INGAME') {
          // Piege n°1 : le score courant vaut deja 0-0, on rend celui d'avant.
          // Et la map aussi est deja effacee : c'est celle de l'instantane
          // precedent qui vaut.
          evs.push({
            type: 'fin',
            mapCode: av?.mapCode ?? null,
            queue: av?.queue ?? null,
            score: scoreGele,
            dureeMs: debutPartie ? t - debutPartie : null,
            a: t,
          });
          scoreGele = null; debutPartie = null;
        }
      }

      // --- Le groupe -----------------------------------------------------
      // Volontairement APRES le cycle de partie. Les deux se produisent dans
      // le meme battement lors d'une esquive : le joueur quitte la selection
      // (esquive) ET le groupe repart en recherche (file). Raconte dans cet
      // ordre, l'enchainement se lit tout seul ; dans l'autre, la file precede
      // sa propre cause.
      if (av && instantane.partySize > (av.partySize ?? 0) && instantane.partySize >= 2) {
        evs.push({ type: 'groupe', taille: instantane.partySize, a: t });
      }
      if (av && av.partyState !== 'MATCHMAKING' && instantane.partyState === 'MATCHMAKING') {
        evs.push({ type: 'file', taille: instantane.partySize, a: t });
      }

      precedent = instantane;
      return evs;
    },
  };
}
