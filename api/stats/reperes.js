// Repères par rang (brique 7).
//
// Pour juger une partie, il faut savoir ce que font les autres joueurs du même
// rang au même poste. Cette donnée n'existe nulle part : on la construit. La
// collecte mesure chacun des 10 joueurs de chaque partie qu'elle lit, et range
// les mesures en histogrammes dans la table `stats` :
//   kind = « m:<mesure>:<palier> », champion_id = 0, role = poste,
//   key = numéro de la tranche, games = joueurs, wins = victoires.
// Le palier d'une partie est celui du joueur par qui la collecte l'a trouvée
// (le matchmaking réunit des joueurs de niveau proche).
//
// Les mêmes calculs servent au debrief du joueur : il est jugé exactement
// comme ses pairs, sur les mêmes définitions.

// Sens : « haut » = plus c'est haut, mieux c'est.
export const MESURES = {
  cs10: { pas: 5, sens: 'haut', postes: ['TOP', 'MIDDLE', 'BOTTOM'] },
  csm: { pas: 0.5, sens: 'haut', postes: ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM'] },
  or15: { pas: 250, sens: 'haut' },
  morts: { pas: 1, sens: 'bas' },
  kp: { pas: 0.05, sens: 'haut' },
  vision: { pas: 0.1, sens: 'haut' },
  degats: { pas: 0.025, sens: 'haut', postes: ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM'] },
  objectifs: { pas: 0.1, sens: 'haut' },
  isoles: { pas: 0.1, sens: 'bas' },
};

// Paliers des repères : les trois ligues « apex » n'en font qu'un.
export const PALIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER+'];
export const palierDe = (tier) => (['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(tier) ? 'MASTER+' : PALIERS.includes(tier) ? tier : null);

// Au-delà de 2 000 unités (un peu plus qu'une portée de sort longue), aucun
// allié ne peut aider : la mort est « isolée ».
const ISOLEMENT = 2000;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Les frames de la chronologie sont prises toutes les minutes : la position
// d'un allié au moment d'une mort est celle de la frame la plus proche.
function frameProche(timeline, t) {
  const frames = timeline?.info?.frames ?? [];
  if (!frames.length) return null;
  const i = Math.min(frames.length - 1, Math.max(0, Math.round(t / 60000)));
  return frames[i];
}

export function evenements(timeline) {
  return (timeline?.info?.frames ?? []).flatMap((f) => f.events ?? []);
}

// Les morts d'un joueur, avec ce qu'il faut pour les juger.
export function mortsDe(match, timeline, pid) {
  const parts = match.info.participants;
  const moi = parts.find((p) => p.participantId === pid);
  const allies = parts.filter((p) => p.teamId === moi.teamId && p.participantId !== pid).map((p) => p.participantId);
  const ev = evenements(timeline);
  return ev
    .filter((e) => e.type === 'CHAMPION_KILL' && e.victimId === pid && e.position)
    .map((e) => {
      const f = frameProche(timeline, e.timestamp);
      const proches = allies
        .map((a) => f?.participantFrames?.[a]?.position)
        .filter(Boolean)
        .map((pos) => distance(pos, e.position));
      const plusProche = proches.length ? Math.min(...proches) : Infinity;
      // Ce que l'équipe adverse a pris dans les 90 s qui suivent.
      const suite = ev.filter((x) => x.timestamp > e.timestamp && x.timestamp <= e.timestamp + 90_000);
      const monstre = suite.find((x) => x.type === 'ELITE_MONSTER_KILL' && x.killerTeamId && x.killerTeamId !== moi.teamId);
      const tour = suite.find((x) => x.type === 'BUILDING_KILL' && x.teamId === moi.teamId);
      return {
        t: e.timestamp, x: e.position.x, y: e.position.y,
        isole: plusProche > ISOLEMENT,
        tueur: parts.find((p) => p.participantId === e.killerId)?.championId ?? null,
        attaquants: 1 + (e.assistingParticipantIds?.length ?? 0),
        apres: monstre ? monstreDe(monstre) : tour ? 'tour' : null,
      };
    });
}

export function monstreDe(e) {
  if (e.monsterType === 'DRAGON') return e.monsterSubType === 'ELDER_DRAGON' ? 'ancien' : 'dragon';
  return { BARON_NASHOR: 'baron', RIFTHERALD: 'heraut', HORDE: 'larves', ATAKHAN: 'atakhan' }[e.monsterType] ?? 'monstre';
}

// Toutes les mesures des 10 joueurs d'une partie. Renvoie une Map
// participantId → { puuid, role, win, championId, valeurs }.
export function mesurer(match, timeline) {
  const info = match?.info;
  const parts = info?.participants ?? [];
  if (parts.length !== 10) return new Map();
  const minutes = info.gameDuration / 60;
  const frames = timeline?.info?.frames ?? [];
  const pf = (i, pid) => frames[i]?.participantFrames?.[pid];
  const ev = evenements(timeline);
  const epiques = ev.filter((e) => e.type === 'ELITE_MONSTER_KILL');
  const tuesParEquipe = {};
  for (const p of parts) tuesParEquipe[p.teamId] = (tuesParEquipe[p.teamId] ?? 0) + (p.kills ?? 0);

  const out = new Map();
  for (const p of parts) {
    const pid = p.participantId;
    const role = p.teamPosition || null;
    const face = role ? parts.find((x) => x.teamId !== p.teamId && x.teamPosition === role) : null;
    const v = {};

    if (frames.length > 10) v.cs10 = (pf(10, pid)?.minionsKilled ?? 0) + (pf(10, pid)?.jungleMinionsKilled ?? 0);
    v.csm = ((p.totalMinionsKilled ?? 0) + (p.neutralMinionsKilled ?? 0)) / minutes;
    if (face && frames.length > 15) v.or15 = (pf(15, pid)?.totalGold ?? 0) - (pf(15, face.participantId)?.totalGold ?? 0);
    v.morts = ((p.deaths ?? 0) * 30) / minutes;
    const kills = tuesParEquipe[p.teamId];
    v.kp = p.challenges?.killParticipation ?? (kills ? ((p.kills ?? 0) + (p.assists ?? 0)) / kills : 0);
    v.vision = (p.visionScore ?? 0) / minutes;
    if (p.challenges?.teamDamagePercentage != null) v.degats = p.challenges.teamDamagePercentage;

    const lesNotres = epiques.filter((e) => e.killerTeamId === p.teamId);
    if (lesNotres.length) {
      const miens = lesNotres.filter((e) => e.killerId === pid || e.assistingParticipantIds?.includes(pid)).length;
      v.objectifs = miens / lesNotres.length;
    }
    if (timeline && (p.deaths ?? 0) > 0) {
      const morts = mortsDe(match, timeline, pid);
      if (morts.length) v.isoles = morts.filter((m) => m.isole).length / morts.length;
    }
    out.set(pid, { puuid: p.puuid, role, win: Boolean(p.win), championId: p.championId, valeurs: v });
  }
  return out;
}

export const tranche = (mesure, v) => Math.max(-60, Math.min(200, Math.floor(v / MESURES[mesure].pas + 1e-9)));

// Les lignes à ajouter dans `stats` pour une partie : chaque mesure de chaque
// joueur, dans son palier et dans « TOUS ».
export function lignesReperes(mesures, palier) {
  const lignes = [];
  for (const { role, win, valeurs } of mesures.values()) {
    if (!role) continue;
    for (const [m, v] of Object.entries(valeurs)) {
      if (v == null || !Number.isFinite(v)) continue;
      const postes = MESURES[m].postes;
      if (postes && !postes.includes(role)) continue;
      for (const p of [palier, 'TOUS']) {
        if (!p) continue;
        lignes.push({ champion_id: 0, role, kind: `m:${m}:${p}`, key: String(tranche(m, v)), games: 1, wins: win ? 1 : 0 });
      }
    }
  }
  return lignes;
}

// Où se situe une valeur dans un histogramme ? `position` : 0 = meilleur que
// tout le monde, 1 = pire que tout le monde (les égalités comptent pour
// moitié), orientée selon le sens de la mesure. Et la médiane du groupe.
export function situer(mesure, valeur, histo) {
  const { pas, sens } = MESURES[mesure];
  const n = histo.reduce((s, h) => s + h.games, 0);
  if (!n) return null;
  const t = tranche(mesure, valeur);
  let dessous = 0, egal = 0;
  for (const h of histo) {
    if (h.tranche < t) dessous += h.games;
    else if (h.tranche === t) egal += h.games;
  }
  const rangBas = (dessous + egal / 2) / n; // part des pairs sous cette valeur
  const tri = [...histo].sort((a, b) => a.tranche - b.tranche);
  let cumul = 0, mediane = null;
  for (const h of tri) {
    cumul += h.games;
    if (cumul >= n / 2) { mediane = (h.tranche + 0.5) * pas; break; }
  }
  return { n, position: sens === 'haut' ? 1 - rangBas : rangBas, mediane };
}
