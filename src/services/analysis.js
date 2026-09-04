import { ecartDeRang, estClasse, nomDuRang } from './tiers.js';

/**
 * Barème du coach — choix des trois constats les plus durs.
 *
 * LE PROBLEME QUE CE FICHIER RESOUT
 *
 * "Un barème selon le rang" suppose de savoir ce que vaut un joueur de ce rang.
 * Cette donnee n'existe nulle part publiquement, et l'inventer serait pire que
 * de ne rien dire : ce serait un chiffre faux au fondement de tout le coach.
 *
 * La solution est dans les parties elles-memes. Chaque match contient les DIX
 * joueurs, avec leur rang et leurs statistiques, et les positions de tout le
 * monde a chaque kill. Sur une dizaine de parties, ca fait une centaine de
 * lignes de joueurs situes au meme niveau, dans les memes maps, la meme semaine.
 *
 * Le groupe de comparaison n'est donc pas une moyenne trouvee sur internet :
 * c'est l'adversaire d'hier soir. Rien n'est estime, tout est mesure.
 *
 * COMMENT UN CONSTAT DEVIENT "GRAVE"
 *
 *   position   ou se situe le joueur dans le groupe, oriente "mauvais"
 *              (0 = meilleur du groupe, 1 = pire). C'est un rang relatif, pas
 *              un ecart brut : robuste aux valeurs extremes.
 *   confiance  taille de l'echantillon rapportee au minimum exige. Un ecart
 *              enorme sur 4 evenements ne doit pas battre un ecart net sur 80.
 *   severite   position x confiance.
 *
 * Seuls les trois constats de plus forte severite sont montres. Un coach qui
 * sort dix reproches ne se lit pas, et noie le seul qui comptait.
 */

/** Ecart de divisions accepte dans le groupe de comparaison, du plus strict au plus large. */
const PALIERS_COMPARAISON = [2, 4, 8];

/** En dessous, une position dans le groupe ne veut rien dire. */
const POOL_MINIMUM = 20;

/**
 * Les axes d'analyse.
 *
 * `mauvais` dit de quel cote se trouve le probleme : 'haut' = plus c'est
 * grand, pire c'est. `minimum` est le nombre d'observations en dessous duquel
 * on se tait — calibre par axe, parce qu'un pourcentage sur les morts se
 * stabilise plus vite qu'un compte de rounds pistolet.
 */
export const AXES = [
  {
    cle: 'isolement',
    titre: 'Isolement',
    champ: 'tauxIsolement',
    mauvais: 'haut',
    minimum: 15,
    unite: '%',
    phrase: (v, ref, n) =>
      `${v} % de tes morts arrivent loin de l'équipe, contre ${ref} % pour les joueurs `
      + `de ton rang croisés dans tes parties (sur ${n} morts mesurables)`,
  },
  {
    cle: 'trade',
    titre: 'Morts non tradables',
    champ: 'tauxNonTradable',
    mauvais: 'haut',
    minimum: 15,
    unite: '%',
    phrase: (v, ref, n) =>
      `${v} % de tes morts n'étaient pas vengeables, aucun coéquipier assez près, `
      + `contre ${ref} % à ton rang (sur ${n} morts mesurables)`,
  },
  {
    cle: 'entree',
    titre: 'Morts en début de round',
    champ: 'tauxMortPrecoce',
    mauvais: 'haut',
    minimum: 15,
    unite: '%',
    phrase: (v, ref, n) =>
      `${v} % de tes morts tombent dans les 20 premières secondes du round, `
      + `contre ${ref} % à ton rang (sur ${n} morts)`,
  },
  {
    cle: 'ouverture',
    titre: 'Premier mort du round',
    champ: 'tauxPremierMort',
    mauvais: 'haut',
    minimum: 12,
    unite: '%',
    phrase: (v, ref, n) =>
      `tu es le premier mort dans ${v} % des rounds que tu joues, contre ${ref} % `
      + `à ton rang (sur ${n} rounds)`,
  },
  {
    cle: 'degats_recus',
    titre: 'Dégâts encaissés',
    champ: 'degatsRecusParRound',
    mauvais: 'haut',
    minimum: 8,
    unite: '',
    phrase: (v, ref, n) =>
      `tu encaisses ${v} dégâts par round, contre ${ref} à ton rang (sur ${n} rounds)`,
  },
  {
    cle: 'degats_infliges',
    titre: 'Dégâts infligés',
    champ: 'degatsInfligesParRound',
    mauvais: 'bas',
    minimum: 8,
    unite: '',
    phrase: (v, ref, n) =>
      `tu infliges ${v} dégâts par round, contre ${ref} à ton rang (sur ${n} rounds)`,
  },
  {
    cle: 'precision',
    titre: 'Tirs à la tête',
    champ: 'tauxHeadshot',
    mauvais: 'bas',
    minimum: 60,
    unite: '%',
    phrase: (v, ref, n) =>
      `${v} % de tes tirs touchent la tête, contre ${ref} % à ton rang (sur ${n} tirs)`,
  },
  {
    cle: 'apres_plant',
    titre: 'Après la pose',
    champ: 'tauxMortApresPlant',
    mauvais: 'haut',
    minimum: 12,
    unite: '%',
    phrase: (v, ref, n) =>
      `${v} % de tes morts arrivent après la pose du spike, contre ${ref} % `
      + `à ton rang (sur ${n} morts)`,
  },
];

/* --------------------------------------------------------------------------
   Statistique
   -------------------------------------------------------------------------- */

export function mediane(valeurs) {
  const v = valeurs.filter((x) => typeof x === 'number' && !Number.isNaN(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/**
 * Position du joueur dans le groupe, orientee "mauvais" : 0 = le meilleur,
 * 1 = le pire. Les egalites comptent pour moitie, sinon un joueur pile sur la
 * valeur commune serait declare pire que tous ceux qui la partagent.
 */
export function position(valeur, groupe, mauvais = 'haut') {
  const v = groupe.filter((x) => typeof x === 'number' && !Number.isNaN(x));
  if (v.length === 0 || typeof valeur !== 'number' || Number.isNaN(valeur)) return null;

  const pire = mauvais === 'haut'
    ? v.filter((x) => x < valeur).length
    : v.filter((x) => x > valeur).length;
  const egaux = v.filter((x) => x === valeur).length;

  return (pire + egaux / 2) / v.length;
}

/** Plafonnee a 1 : au-dela du minimum exige, un echantillon plus gros ne rend pas le constat plus grave. */
export const confiance = (n, minimum) => Math.min(1, n / minimum);

export function gravite(severite) {
  if (severite >= 0.8) return 'fort';
  if (severite >= 0.6) return 'net';
  return 'info';
}

/* --------------------------------------------------------------------------
   Groupe de comparaison
   -------------------------------------------------------------------------- */

/**
 * Constitue le groupe de comparaison autour du rang du joueur.
 *
 * On resserre d'abord (± 2 divisions), et on n'elargit que si le groupe est
 * trop maigre pour que la position veuille dire quelque chose. L'elargissement
 * est signale : un constat compare a "Or 1 à Diamant 2" n'a pas le meme poids
 * qu'un constat compare a son propre palier, et le texte doit pouvoir le dire.
 */
export function construireGroupe(mesures, { tierId, exclurePuuid }) {
  if (!estClasse(tierId)) return { pairs: [], ecart: null, suffisant: false };

  const candidats = mesures.filter(
    (m) => m.puuid !== exclurePuuid && estClasse(m.tierId),
  );

  for (const ecart of PALIERS_COMPARAISON) {
    const pairs = candidats.filter((m) => ecartDeRang(m.tierId, tierId) <= ecart);
    if (pairs.length >= POOL_MINIMUM) return { pairs, ecart, suffisant: true };
  }

  // Rien d'assez fourni : on rend le plus large, en disant qu'il ne suffit pas.
  return { pairs: candidats, ecart: null, suffisant: candidats.length >= POOL_MINIMUM };
}

/* --------------------------------------------------------------------------
   Analyse
   -------------------------------------------------------------------------- */

const arrondi = (v, unite) => (unite === '%' ? Math.round(v) : Math.round(v));

/**
 * Passe tous les axes en revue et renvoie les constats, du plus grave au moins.
 *
 * @param moi     mesures agregees du joueur
 * @param mesures mesures de TOUS les joueurs croises (le joueur inclus)
 * @param max     nombre de constats a garder
 */
export function analyser({ moi, mesures, max = 3 }) {
  const groupe = construireGroupe(mesures, { tierId: moi.tierId, exclurePuuid: moi.puuid });

  const constats = [];

  for (const axe of AXES) {
    const valeur = moi[axe.champ];
    const n = moi.echantillons?.[axe.cle] ?? 0;

    if (typeof valeur !== 'number' || Number.isNaN(valeur)) continue;
    if (n < axe.minimum * 0.6) continue; // trop peu pour meme envisager le sujet

    const valeursGroupe = groupe.pairs
      .filter((p) => (p.echantillons?.[axe.cle] ?? 0) >= axe.minimum * 0.6)
      .map((p) => p[axe.champ]);

    const pos = position(valeur, valeursGroupe, axe.mauvais);
    if (pos === null || !groupe.suffisant) continue;

    // Un joueur meilleur que la mediane de son rang sur cet axe n'a rien a se
    // reprocher : ce n'est pas un constat, c'est du bruit.
    if (pos <= 0.5) continue;

    const ref = mediane(valeursGroupe);
    const severite = pos * confiance(n, axe.minimum);

    constats.push({
      cle: axe.cle,
      titre: axe.titre,
      valeur: arrondi(valeur, axe.unite),
      reference: ref === null ? null : arrondi(ref, axe.unite),
      unite: axe.unite,
      echantillon: n,
      pairs: valeursGroupe.length,
      ecartDeRangCompare: groupe.ecart,
      position: Number(pos.toFixed(3)),
      severite: Number(severite.toFixed(3)),
      gravite: gravite(severite),
      fait: axe.phrase(arrondi(valeur, axe.unite), arrondi(ref, axe.unite), n),
    });
  }

  constats.sort((a, b) => b.severite - a.severite);

  return {
    rang: nomDuRang(moi.tierId),
    groupe: {
      taille: groupe.pairs.length,
      ecartDeRang: groupe.ecart,
      suffisant: groupe.suffisant,
    },
    constats: constats.slice(0, max),
    // Gardes pour le journal : savoir ce qui a ete calcule mais ecarte aide a
    // comprendre pourquoi le coach dit ce qu'il dit.
    ecartes: constats.slice(max).map((c) => ({ cle: c.cle, severite: c.severite })),
  };
}

/* --------------------------------------------------------------------------
   Extraction des mesures depuis un match brut
   -------------------------------------------------------------------------- */

/** Un round est "precoce" en dessous de ce delai. */
const DEBUT_DE_ROUND_MS = 20_000;

/**
 * Mesure les DIX joueurs d'un match.
 *
 * C'est ce qui rend le barème possible : les memes calculs sont appliques au
 * joueur suivi et a ses neuf adversaires et coequipiers. Le groupe de
 * comparaison n'existe que parce qu'on mesure tout le monde.
 *
 * @param morts  sortie de analyzeMatch() pour l'ensemble des puuids du match
 * @returns Map<puuid, mesures partielles d'un match>
 */
export function mesurerMatch(rawMatch, morts = []) {
  const rounds = rawMatch?.rounds?.length ?? 0;
  const joueurs = rawMatch?.players ?? [];
  const kills = Array.isArray(rawMatch?.kills) ? rawMatch.kills : [];
  if (rounds === 0 || joueurs.length === 0) return new Map();

  // Instant de la pose par round, pour distinguer avant / apres plant.
  const planteA = new Map();
  for (const r of rawMatch.rounds ?? []) {
    if (r?.plant?.round_time_in_ms != null) planteA.set(r.id, r.plant.round_time_in_ms);
  }

  // Premier mort de chaque round.
  const premierMort = new Map();
  for (const k of [...kills].sort((a, b) => a.round - b.round || a.time_in_round_in_ms - b.time_in_round_in_ms)) {
    if (!premierMort.has(k.round)) premierMort.set(k.round, k.victim?.puuid);
  }

  // analyzeMatch() nomme la victime `victimPuuid` : s'y tromper ne leve aucune
  // erreur, ca vide juste toutes les mesures positionnelles en silence.
  const mortsParPuuid = new Map();
  for (const d of morts) {
    const v = d.victimPuuid;
    if (!v) continue;
    if (!mortsParPuuid.has(v)) mortsParPuuid.set(v, []);
    mortsParPuuid.get(v).push(d);
  }

  const out = new Map();

  for (const p of joueurs) {
    const s = p.stats ?? {};
    const tirs = (s.headshots ?? 0) + (s.bodyshots ?? 0) + (s.legshots ?? 0);

    const sesKills = kills.filter((k) => k.victim?.puuid === p.puuid);
    const precoces = sesKills.filter((k) => k.time_in_round_in_ms <= DEBUT_DE_ROUND_MS).length;
    const apresPlant = sesKills.filter((k) => {
      const t = planteA.get(k.round);
      return t != null && k.time_in_round_in_ms > t;
    }).length;
    const ouvertures = [...premierMort.values()].filter((v) => v === p.puuid).length;

    const sesMorts = mortsParPuuid.get(p.puuid) ?? [];
    const positionnelles = sesMorts.filter((d) => !d.lastAlive && d.nearestTeammate !== null);

    out.set(p.puuid, {
      puuid: p.puuid,
      tierId: p.tier?.id ?? 0,
      rounds,
      // Numerateurs et denominateurs plutot que des taux : les taux se moyennent
      // mal d'un match a l'autre, les comptes s'additionnent.
      morts: sesKills.length,
      mortsPrecoces: precoces,
      mortsApresPlant: apresPlant,
      ouvertures,
      mortsPositionnelles: positionnelles.length,
      mortsIsolees: positionnelles.filter((d) => d.isolated).length,
      mortsNonTradables: positionnelles.filter((d) => !d.tradePossible).length,
      degatsInfliges: s.damage?.dealt ?? 0,
      degatsRecus: s.damage?.received ?? 0,
      tirs,
      headshots: s.headshots ?? 0,
    });
  }

  return out;
}

const taux = (n, d) => (d > 0 ? (100 * n) / d : null);

/**
 * Additionne les mesures d'un joueur sur plusieurs matchs, puis en tire les
 * taux. Le rang retenu est le plus recent connu — c'est celui auquel il joue
 * aujourd'hui.
 */
export function agreger(mesuresParMatch) {
  const t = { rounds: 0, morts: 0, mortsPrecoces: 0, mortsApresPlant: 0, ouvertures: 0,
    mortsPositionnelles: 0, mortsIsolees: 0, mortsNonTradables: 0,
    degatsInfliges: 0, degatsRecus: 0, tirs: 0, headshots: 0 };

  let tierId = 0;
  let puuid = null;

  for (const m of mesuresParMatch) {
    puuid ??= m.puuid;
    if (estClasse(m.tierId)) tierId = m.tierId;
    for (const k of Object.keys(t)) t[k] += m[k] ?? 0;
  }

  return {
    puuid, tierId, matchs: mesuresParMatch.length, ...t,

    tauxIsolement: taux(t.mortsIsolees, t.mortsPositionnelles),
    tauxNonTradable: taux(t.mortsNonTradables, t.mortsPositionnelles),
    tauxMortPrecoce: taux(t.mortsPrecoces, t.morts),
    tauxPremierMort: taux(t.ouvertures, t.rounds),
    tauxMortApresPlant: taux(t.mortsApresPlant, t.morts),
    tauxHeadshot: taux(t.headshots, t.tirs),
    degatsInfligesParRound: t.rounds ? t.degatsInfliges / t.rounds : null,
    degatsRecusParRound: t.rounds ? t.degatsRecus / t.rounds : null,

    echantillons: {
      isolement: t.mortsPositionnelles,
      trade: t.mortsPositionnelles,
      entree: t.morts,
      ouverture: t.rounds,
      apres_plant: t.morts,
      precision: t.tirs,
      degats_recus: t.rounds,
      degats_infliges: t.rounds,
    },
  };
}
