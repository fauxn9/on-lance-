/**
 * Etage 1 du coach — calcul deterministe des metriques positionnelles.
 *
 * AUCUNE IA ICI. Ce module ne fait que de la geometrie sur les donnees brutes
 * du match. C'est la moitie basse du mecanisme prevu par la spec : on calcule
 * des faits exacts et reproductibles, et l'etage 2 (coach.js) se contente de
 * les mettre en mots. Ne jamais inverser les deux : une IA a qui on donne des
 * coordonnees brutes invente des patterns.
 *
 * ---------------------------------------------------------------------------
 * CE QUE CONTIENT REELLEMENT UN EVENEMENT DE KILL (verifie sur l'API le 02/09/2026)
 * ---------------------------------------------------------------------------
 *   kill.location          position exacte de la VICTIME a sa mort
 *   kill.player_locations  position + view_radians de chaque joueur ENCORE EN VIE
 *   kill.killer / victim   identites
 *
 * Deux consequences majeures, qui dictent tout ce fichier :
 *
 * 1. Le tueur est TOUJOURS dans player_locations (151/151 sur le match test).
 *    Sa position et son regard sont donc exacts a l'instant du kill. Verifie :
 *    l'ecart entre le regard du tueur et la direction vers sa victime a une
 *    mediane de 0,4° — la donnee est fiable et synchronisee.
 *
 * 2. La victime n'est JAMAIS dans player_locations (0/151) : elle vient de
 *    mourir. On a donc sa position, mais PAS son angle de vue au moment de sa
 *    mort. C'est contraire a ce que supposait la spec, et ca change le produit.
 *
 *    On peut reconstituer son regard depuis un kill precedent du meme round
 *    (87% des morts), mais avec un ecart median de 3,4 s. En 3,4 s un joueur
 *    fait un 180° et traverse un site : affirmer "tu regardais le mauvais
 *    angle" sur cette base serait inventer un fait. La reconstitution n'est
 *    donc retenue que sous VIEW_MAX_GAP_MS, et jamais presentee comme certaine
 *    sur une mort isolee — uniquement en agregat, avec la taille d'echantillon.
 * ---------------------------------------------------------------------------
 */

// 1 metre = 100 unites Unreal. Verifie indirectement : la distance mediane des
// duels tombe a 17,6 m avec ce facteur, ce qui est l'ordre de grandeur attendu.
const UNITS_PER_METER = 100;

export const THRESHOLDS = {
  // Au-dela, on considere le joueur coupe de son equipe. Valeur reprise de
  // l'exemple de la spec ("isole de plus de 15m de l'equipe").
  isolationMeters: 15,
  // En dessous, un coequipier est assez proche pour trade la mort.
  tradeMeters: 8,
  // Le FOV de Valorant est de ~103°, soit ~51,5° de part et d'autre du regard.
  // Au-dela de 60°, la menace etait hors champ de facon certaine.
  outOfViewDegrees: 60,
  // Au-dela, elle venait franchement du dos.
  fromBehindDegrees: 135,
  // Ecart de temps maximum tolere pour reconstituer le regard d'une victime.
  // 2 s : au-dela, l'info n'est plus assez proche de l'instant de la mort.
  viewMaxGapMs: 2000,
};

// --- Geometrie de base ------------------------------------------------------

export function distanceMeters(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y) / UNITS_PER_METER;
}

/**
 * Direction du vecteur a -> b, dans le meme repere que view_radians.
 * Convention verifiee empiriquement contre le regard des tueurs : atan2(dy, dx).
 */
export function bearing(a, b) {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/** Ecart minimal entre deux angles, toujours ramene dans [0, PI]. */
export function angleDelta(a, b) {
  const d = Math.abs(a - b) % (2 * Math.PI);
  return d > Math.PI ? 2 * Math.PI - d : d;
}

export const toDegrees = (rad) => (rad * 180) / Math.PI;

/**
 * Position jeu -> position sur l'image de minimap, en fraction [0, 1].
 *
 * Formule de la communaute dev Valorant, avec inversion des axes : la
 * coordonnee de jeu y alimente l'axe x de l'image. Verifiee sur 151 morts
 * reelles, toutes tombees dans [0, 1].
 */
export function toMinimap(location, calibration) {
  if (!calibration) return null;
  const { xMultiplier, yMultiplier, xScalarToAdd, yScalarToAdd } = calibration;
  return {
    x: location.y * xMultiplier + xScalarToAdd,
    y: location.x * yMultiplier + yScalarToAdd,
  };
}

// --- Analyse d'une mort -----------------------------------------------------

/**
 * @param kill        evenement brut de l'API
 * @param victimTeam  equipe de la victime ('Red' / 'Blue')
 * @param lastSeen    { location, view, timeMs } derniere observation connue de
 *                    la victime dans ce round, ou null
 * @param calibration donnees de minimap de la map, ou null
 */
export function analyzeDeath({ kill, victimTeam, lastSeen = null, calibration = null }) {
  const deathLocation = kill.location;
  if (!deathLocation) return null;

  const others = Array.isArray(kill.player_locations) ? kill.player_locations : [];
  const killerEntry = others.find((p) => p.player?.puuid === kill.killer?.puuid) ?? null;
  const killerLocation = killerEntry?.location ?? null;

  // Coequipiers encore en vie au moment de la mort.
  const mates = others.filter((p) => p.player?.team === victimTeam);
  const mateDistances = mates.map((p) => distanceMeters(deathLocation, p.location));
  const nearestTeammate = mateDistances.length > 0 ? Math.min(...mateDistances) : null;

  const duelDistance = killerLocation ? distanceMeters(deathLocation, killerLocation) : null;

  // --- Reconstitution du regard de la victime (voir l'avertissement en tete) ---
  let view = null;
  if (lastSeen && killerLocation) {
    const gapMs = kill.time_in_round_in_ms - lastSeen.timeMs;
    if (gapMs >= 0 && gapMs <= THRESHOLDS.viewMaxGapMs) {
      // On compare le regard connu a la direction vers le tueur, mesuree depuis
      // la position ou la victime se trouvait a cet instant-la (pas depuis sa
      // position de mort : melanger les deux instants fausserait l'angle).
      const deltaRad = angleDelta(lastSeen.view, bearing(lastSeen.location, killerLocation));
      const deltaDeg = toDegrees(deltaRad);
      view = {
        deltaRad,
        deltaDeg,
        gapMs,
        outOfView: deltaDeg > THRESHOLDS.outOfViewDegrees,
        fromBehind: deltaDeg > THRESHOLDS.fromBehindDegrees,
      };
    }
  }

  return {
    matchId: null, // rempli par analyzeMatch
    round: kill.round,
    timeInRoundMs: kill.time_in_round_in_ms,
    victimPuuid: kill.victim?.puuid ?? null,
    killerPuuid: kill.killer?.puuid ?? null,
    weapon: kill.weapon?.name ?? null,

    location: deathLocation,
    minimap: toMinimap(deathLocation, calibration),
    killerLocation,

    duelDistance,
    nearestTeammate,
    livingTeammates: mates.length,
    // Dernier en vie : ce n'est pas un trou de donnees, c'est une situation
    // reelle et differente. On ne veut surtout pas la compter comme un
    // positionnement isole que le joueur aurait pu eviter.
    lastAlive: mates.length === 0,
    isolated: nearestTeammate !== null && nearestTeammate > THRESHOLDS.isolationMeters,
    tradePossible: nearestTeammate !== null && nearestTeammate <= THRESHOLDS.tradeMeters,

    view,
  };
}

/**
 * Analyse toutes les morts des joueurs suivis dans un match.
 *
 * On ne traite QUE les puuids fournis (les membres du groupe). Un match genere
 * ~150 evenements de kill ; en se limitant aux joueurs suivis on descend a une
 * vingtaine de lignes par joueur et par match, ce qui rend le stockage trivial.
 *
 * @param rawMatch  reponse brute de l'API (pas le match normalise : on a besoin
 *                  de rawMatch.kills, absent du contrat de normalizeMatch)
 * @param puuids    Set|Array des puuids a analyser
 */
export function analyzeMatch({ rawMatch, puuids, calibration = null }) {
  const tracked = puuids instanceof Set ? puuids : new Set(puuids);
  const kills = Array.isArray(rawMatch?.kills) ? rawMatch.kills : [];
  if (kills.length === 0) return [];

  const teamByPuuid = new Map(
    (rawMatch.players ?? []).map((p) => [p.puuid, String(p.team_id ?? p.team ?? '')]),
  );
  const agentByPuuid = new Map(
    (rawMatch.players ?? []).map((p) => [p.puuid, p.agent?.name ?? null]),
  );

  const ordered = [...kills].sort(
    (a, b) => a.round - b.round || a.time_in_round_in_ms - b.time_in_round_in_ms,
  );

  // Derniere observation connue de chaque joueur, round par round. On la
  // reconstruit en avancant dans le temps : a chaque kill, tous les joueurs
  // encore en vie sont localises, ce qui alimente la table pour les morts
  // suivantes du meme round.
  const lastSeen = new Map(); // `${round}:${puuid}` -> { location, view, timeMs }
  const results = [];

  for (const kill of ordered) {
    const victimPuuid = kill.victim?.puuid;

    if (victimPuuid && tracked.has(victimPuuid)) {
      const death = analyzeDeath({
        kill,
        victimTeam: teamByPuuid.get(victimPuuid) ?? kill.victim?.team ?? '',
        lastSeen: lastSeen.get(`${kill.round}:${victimPuuid}`) ?? null,
        calibration,
      });
      if (death) {
        death.matchId = rawMatch.metadata?.match_id ?? null;
        death.mapName = rawMatch.metadata?.map?.name ?? null;
        death.agent = agentByPuuid.get(victimPuuid) ?? null;
        death.playedAt = rawMatch.metadata?.started_at
          ? new Date(rawMatch.metadata.started_at)
          : null;
        results.push(death);
      }
    }

    // Mise a jour APRES analyse : une observation issue du kill courant ne doit
    // pas servir a expliquer ce meme kill.
    for (const p of kill.player_locations ?? []) {
      const puuid = p.player?.puuid;
      if (!puuid || !tracked.has(puuid)) continue;
      lastSeen.set(`${kill.round}:${puuid}`, {
        location: p.location,
        view: p.view_radians,
        timeMs: kill.time_in_round_in_ms,
      });
    }
  }

  return results;
}

// --- Agregation -------------------------------------------------------------

/**
 * Resume un lot de morts en chiffres exploitables.
 *
 * Les morts en dernier survivant sont exclues des ratios de positionnement :
 * etre seul quand tout le monde est mort n'est pas une erreur de placement.
 */
export function aggregateDeaths(deaths) {
  const positional = deaths.filter((d) => !d.lastAlive && d.nearestTeammate !== null);
  const withView = deaths.filter((d) => d.view);

  const median = (list) => {
    if (list.length === 0) return null;
    const s = [...list].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };

  return {
    deaths: deaths.length,
    lastAliveDeaths: deaths.filter((d) => d.lastAlive).length,

    positionalSample: positional.length,
    isolatedDeaths: positional.filter((d) => d.isolated).length,
    tradeableDeaths: positional.filter((d) => d.tradePossible).length,
    medianTeammateDistance: median(positional.map((d) => d.nearestTeammate)),
    medianDuelDistance: median(deaths.filter((d) => d.duelDistance !== null).map((d) => d.duelDistance)),

    // Echantillon volontairement separe : il est plus petit et moins certain
    // que le reste (voir l'avertissement en tete de fichier).
    viewSample: withView.length,
    outOfViewDeaths: withView.filter((d) => d.view.outOfView).length,
    fromBehindDeaths: withView.filter((d) => d.view.fromBehind).length,
  };
}

/** Meme agregation, decoupee par map. */
export function aggregateByMap(deaths) {
  const byMap = new Map();
  for (const d of deaths) {
    const key = d.mapName ?? 'Inconnue';
    if (!byMap.has(key)) byMap.set(key, []);
    byMap.get(key).push(d);
  }
  return [...byMap.entries()]
    .map(([mapName, list]) => ({ mapName, ...aggregateDeaths(list) }))
    .sort((a, b) => b.deaths - a.deaths);
}

/**
 * Transforme les agregats en faits prets a etre mis en mots.
 *
 * C'est la frontiere entre les deux etages : tout ce qui sort d'ici est un fait
 * calcule, chiffre et sourcé. L'IA ne recevra jamais autre chose que ca.
 * Chaque fait porte sa taille d'echantillon — un pattern sur 3 morts n'a pas le
 * meme poids qu'un pattern sur 40, et le message doit pouvoir le refleter.
 */
export function detectPatterns(aggregate, { minSample = 8 } = {}) {
  const patterns = [];
  const pct = (n, total) => Math.round((100 * n) / total);

  if (aggregate.positionalSample >= minSample) {
    const isoRate = pct(aggregate.isolatedDeaths, aggregate.positionalSample);
    if (isoRate >= 40) {
      patterns.push({
        key: 'isolation',
        severity: isoRate >= 60 ? 'fort' : 'net',
        sample: aggregate.positionalSample,
        fact:
          `${aggregate.isolatedDeaths} morts sur ${aggregate.positionalSample} ` +
          `a plus de ${THRESHOLDS.isolationMeters} m du coequipier le plus proche (${isoRate}%)`,
      });
    }

    const tradeRate = pct(aggregate.tradeableDeaths, aggregate.positionalSample);
    if (tradeRate <= 35) {
      patterns.push({
        key: 'no_trade',
        severity: tradeRate <= 20 ? 'fort' : 'net',
        sample: aggregate.positionalSample,
        fact:
          `seulement ${aggregate.tradeableDeaths} morts sur ${aggregate.positionalSample} ` +
          `avec un coequipier a moins de ${THRESHOLDS.tradeMeters} m, donc tradables (${tradeRate}%)`,
      });
    }

    if (aggregate.medianTeammateDistance !== null) {
      patterns.push({
        key: 'spacing',
        severity: 'info',
        sample: aggregate.positionalSample,
        fact: `distance mediane au coequipier le plus proche au moment de mourir : ${aggregate.medianTeammateDistance.toFixed(1)} m`,
      });
    }
  }

  if (aggregate.viewSample >= minSample) {
    const behindRate = pct(aggregate.fromBehindDeaths, aggregate.viewSample);
    if (behindRate >= 30) {
      patterns.push({
        key: 'from_behind',
        severity: behindRate >= 50 ? 'fort' : 'net',
        sample: aggregate.viewSample,
        // La formulation dit explicitement "sur les X morts ou on sait ou tu
        // regardais" : l'echantillon est plus petit, le message ne doit pas
        // laisser croire que c'est sur toutes les morts.
        fact:
          `sur les ${aggregate.viewSample} morts ou la direction du regard est connue, ` +
          `${aggregate.fromBehindDeaths} avec la menace venant du dos (${behindRate}%)`,
      });
    }
  }

  if (aggregate.medianDuelDistance !== null && aggregate.deaths >= minSample) {
    if (aggregate.medianDuelDistance >= 25) {
      patterns.push({
        key: 'long_range',
        severity: 'info',
        sample: aggregate.deaths,
        fact: `distance mediane des duels perdus : ${aggregate.medianDuelDistance.toFixed(1)} m, donc plutot du combat longue distance`,
      });
    } else if (aggregate.medianDuelDistance <= 10) {
      patterns.push({
        key: 'close_range',
        severity: 'info',
        sample: aggregate.deaths,
        fact: `distance mediane des duels perdus : ${aggregate.medianDuelDistance.toFixed(1)} m, donc surtout des duels rapproches`,
      });
    }
  }

  const rank = { fort: 0, net: 1, info: 2 };
  return patterns.sort((a, b) => rank[a.severity] - rank[b.severity] || b.sample - a.sample);
}
