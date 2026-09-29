// Des compteurs → un build recommandé. Fonctions pures, testées.
//
// Choisir « le meilleur » n'est pas prendre le winrate le plus haut : sur 12
// parties, 70 % ne veut rien dire. On classe par la borne basse de Wilson —
// le winrate dont on est raisonnablement sûr vu le nombre de parties — et
// seulement parmi les options assez jouées pour compter.

export const SEUIL_FIABLE = 150; // parties sur ce champion et ce rôle avant de conclure

// Borne basse de l'intervalle de Wilson (confiance ~90 %).
export function wilson(wins, games, z = 1.64) {
  if (!games) return 0;
  const p = wins / games;
  const z2 = z * z;
  return (p + z2 / (2 * games) - z * Math.sqrt((p * (1 - p) + z2 / (4 * games)) / games)) / (1 + z2 / games);
}

const wr = (x) => (x.games ? x.wins / x.games : 0);

// Meilleure option d'une catégorie : jouée dans au moins `part` des parties
// (et `min` fois), puis la meilleure borne de Wilson. À défaut, la plus jouée.
export function choisir(options, total, { part = 0.05, min = 20 } = {}) {
  if (!options.length) return null;
  const seuil = Math.max(min, part * total);
  const eligibles = options.filter((o) => o.games >= seuil);
  const pool = eligibles.length ? eligibles : [...options].sort((a, b) => b.games - a.games).slice(0, 1);
  return pool.reduce((best, o) => (wilson(o.wins, o.games) > wilson(best.wins, best.games) ? o : best));
}

export function lireRunes(key) {
  const [prim, sec, frag] = String(key).split('|');
  const [ps, pp] = prim.split(':');
  const [ss, sp] = sec.split(':');
  const perks = pp.split(',').map(Number);
  const sous = sp.split(',').map(Number);
  const fragments = frag.split(',').map(Number);
  return {
    primaryStyleId: Number(ps), subStyleId: Number(ss), perks, subPerks: sous, fragments,
    // Ordre attendu par le client pour une page : clé de voûte, 3 principales,
    // 2 secondaires, 3 fragments.
    selectedPerkIds: [...perks, ...sous, ...fragments],
  };
}

const stat = (o, total) => ({ games: o.games, winrate: wr(o), pickrate: total ? o.games / total : 0 });

// rows : toutes les lignes (kind, key, games, wins) d'un champion sur un rôle.
export function construireBuild(rows) {
  const parType = {};
  for (const r of rows) (parType[r.kind] ??= []).push(r);
  const base = parType.champ?.[0] ?? { games: 0, wins: 0 };
  const n = base.games;
  const pick = (kind, opts) => {
    const o = choisir(parType[kind] ?? [], n, opts);
    return o ? { key: o.key, ...stat(o, n) } : null;
  };

  const runes = pick('runes', { part: 0.04, min: 15 });
  const sorts = pick('spells');
  const depart = pick('start');
  const bottes = pick('boots', { part: 0.08 });
  const coeur = pick('core', { part: 0.02, min: 10 });
  const skillmax = pick('skillmax');
  const skillstart = pick('skillstart');

  // Items de situation : les items complets populaires hors du cœur choisi.
  const dansCoeur = new Set(coeur ? coeur.key.split('>').map(Number) : []);
  const situation = (parType.item ?? [])
    .filter((o) => !dansCoeur.has(Number(o.key)) && o.games >= Math.max(10, 0.05 * n))
    .sort((a, b) => b.games - a.games)
    .slice(0, 6)
    .map((o) => ({ id: Number(o.key), ...stat(o, n) }));

  // Matchups : écart au winrate de base du champion, sur assez de parties.
  const m = (parType.matchup ?? [])
    .filter((o) => o.games >= 12)
    .map((o) => ({ championId: Number(o.key), games: o.games, winrate: wr(o), ecart: wr(o) - wr(base) }));
  const favorables = [...m].sort((a, b) => b.ecart - a.ecart).filter((x) => x.ecart > 0).slice(0, 5);
  const difficiles = [...m].sort((a, b) => a.ecart - b.ecart).filter((x) => x.ecart < 0).slice(0, 5);

  const augments = classerAugments(rows);

  return {
    games: n,
    winrate: wr(base),
    fiable: n >= SEUIL_FIABLE,
    runes: runes && { ...lireRunes(runes.key), games: runes.games, winrate: runes.winrate, pickrate: runes.pickrate },
    sorts: sorts && { ids: sorts.key.split(',').map(Number), games: sorts.games, winrate: sorts.winrate },
    depart: depart && { ids: depart.key.split(',').map(Number), games: depart.games, winrate: depart.winrate },
    bottes: bottes && { id: Number(bottes.key), games: bottes.games, winrate: bottes.winrate },
    coeur: coeur && { ids: coeur.key.split('>').map(Number), games: coeur.games, winrate: coeur.winrate },
    situation,
    competences: { max: skillmax?.key ?? null, debut: skillstart?.key ?? null },
    matchups: { favorables, difficiles },
    augments,
  };
}

// Augments d'ARAM Mayhem d'un champion, du meilleur au moins bon, avec une
// lettre S/A/B/C. Le winrate est lissé vers celui du champion (LISSAGE
// parties neutres) : un augment pris 3 fois à 100 % ne passe pas devant un
// augment pris 300 fois à 56 %.
const LISSAGE = 30;
export function classerAugments(rows) {
  const base = rows.find((r) => r.kind === 'champ') ?? { games: 0, wins: 0 };
  const moyen = base.games ? base.wins / base.games : 0.5;
  const liste = rows
    .filter((r) => r.kind === 'augment' && r.games >= 3)
    .map((o) => ({
      id: Number(o.key), games: o.games, winrate: wr(o), pickrate: base.games ? o.games / base.games : 0,
      score: (o.wins + LISSAGE * moyen) / (o.games + LISSAGE),
    }))
    .sort((a, b) => b.score - a.score || b.games - a.games);
  const lettre = (i) => {
    const q = i / liste.length;
    return q < 0.15 ? 'S' : q < 0.4 ? 'A' : q < 0.75 ? 'B' : 'C';
  };
  return liste.slice(0, 80).map((a, i) => ({ ...a, tier: lettre(i) }));
}

// Répartition des rôles d'un champion : { TOP: 0.82, MIDDLE: 0.18 }.
export function repartition(rowsChamp) {
  const total = rowsChamp.reduce((s, r) => s + r.games, 0);
  const out = {};
  for (const r of rowsChamp) out[r.role] = total ? r.games / total : 0;
  return out;
}

// Postes probables des adversaires : l'affectation qui maximise la
// vraisemblance totale (5! = 120 possibilités au plus, on les essaie toutes).
export function postesProbables(champions, roles) {
  const POSTES = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
  const ids = champions.slice(0, 5);
  let meilleur = { score: -Infinity, affectation: {} };
  const essayer = (i, pris, score, aff) => {
    if (i === ids.length) {
      if (score > meilleur.score) meilleur = { score, affectation: { ...aff } };
      return;
    }
    for (const poste of POSTES) {
      if (pris.has(poste)) continue;
      const p = roles[ids[i]]?.[poste] ?? 0;
      pris.add(poste);
      aff[ids[i]] = poste;
      essayer(i + 1, pris, score + Math.log(p + 0.01), aff);
      pris.delete(poste);
      delete aff[ids[i]];
    }
  };
  essayer(0, new Set(), 0, {});
  return meilleur.affectation;
}
