// Données de démonstration, uniquement hors de Tauri. Rien de tout ça
// n'existe dans l'app publiée.

const params = new URLSearchParams(location.search);
const etape = params.get('etape') ?? 'menus';

const compte = { puuid: 'demo', gameName: 'Kasai', tagLine: 'EUW', niveau: 312, icone: 5211 };
const rangs = [
  { file: 'RANKED_SOLO_5x5', tier: 'EMERALD', division: 'II', lp: 64, victoires: 58, defaites: 49 },
  { file: 'RANKED_FLEX_SR', tier: 'PLATINUM', division: 'I', lp: 12, victoires: 14, defaites: 9 },
];

// Une sélection classée plausible : toi au top, Darius et Viego en face.
const selectionDemo = {
  phase: 'BAN_PICK', tempsRestantMs: 27000, file: params.get('file') ? Number(params.get('file')) : 420,
  monPoste: 'TOP', monChampion: 875, verrouille: false,
  allies: [
    { champion: 64, intention: 0, poste: 'JUNGLE', moi: false },
    { champion: 0, intention: 61, poste: 'MIDDLE', moi: false },
    { champion: 875, intention: 875, poste: 'TOP', moi: true },
    { champion: 0, intention: 0, poste: 'BOTTOM', moi: false },
    { champion: 412, intention: 0, poste: 'UTILITY', moi: false },
  ],
  ennemis: [122, 234, 103], bans: [157, 238, 555, 17], banc: [222, 99, 12], sorts: [4, 14],
};

export const etatClient = async () =>
  etape === 'hors'
    ? { etape: 'hors', phase: '', compte: null, plateforme: null, rangs: [], selection: null }
    : { etape, phase: 'Lobby', compte, plateforme: 'euw1', rangs, selection: etape === 'selection' ? selectionDemo : null, partie: ['chargement', 'en_jeu'].includes(etape) ? 42 : null };

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
export const buildChampion = async (champion, role, file) => {
  await attendre(350);
  const aram = file === 450;
  return {
    championId: champion, role: aram ? 'ARAM' : role ?? 'TOP', queue: file ?? 420, patchs: ['16.19'], roles: { TOP: 0.86, MIDDLE: 0.14 },
    games: 4218, winrate: 0.5231, fiable: true,
    runes: { primaryStyleId: 8000, subStyleId: 8400, perks: [8010, 9111, 9104, 8299], subPerks: [8444, 8451], fragments: [5008, 5010, 5011], selectedPerkIds: [8010, 9111, 9104, 8299, 8444, 8451, 5008, 5010, 5011], games: 2911, winrate: 0.5302, pickrate: 0.69 },
    sorts: { ids: [4, 14], games: 2402, winrate: 0.5244 },
    depart: { ids: [1055, 2003], games: 3801, winrate: 0.5236 },
    bottes: { id: 3047, games: 2210, winrate: 0.5287 },
    coeur: { ids: [6692, 3071, 6333], games: 812, winrate: 0.5714 },
    situation: [3053, 3065, 6694, 3075, 3742, 6610].map((id, i) => ({ id, games: 900 - i * 110, winrate: 0.55 - i * 0.008, pickrate: 0.21 - i * 0.02 })),
    competences: { max: 'QEW', debut: 'QEW' },
    matchups: {
      favorables: [[85, 0.562], [133, 0.551], [150, 0.548]].map(([championId, winrate]) => ({ championId, winrate, games: 140, ecart: winrate - 0.5231 })),
      difficiles: [[122, 0.468], [516, 0.472], [86, 0.481]].map(([championId, winrate]) => ({ championId, winrate, games: 180, ecart: winrate - 0.5231 })),
    },
    augments: [],
  };
};
export const suggestions = async () => {
  await attendre(300);
  return {
    role: 'TOP', face: 122, postes: { 122: 'TOP', 234: 'JUNGLE', 103: 'MIDDLE' },
    suggestions: [
      { championId: 875, note: 82, winrate: 0.523, games: 4218, raisons: [{ type: 'perso', winrate: 0.61, games: 38 }, { type: 'maitrise', points: 187000 }] },
      { championId: 85, note: 74, winrate: 0.518, games: 2980, raisons: [{ type: 'contre', championId: 122, winrate: 0.562, games: 140 }] },
      { championId: 516, note: 61, winrate: 0.531, games: 3310, raisons: [{ type: 'meta', winrate: 0.531, games: 3310 }] },
    ],
  };
};
export const importer = async (parties) => { await attendre(500); return parties; };

// Écran de chargement : une classée plausible, qui se remplit par étapes
// comme avec le vrai serveur (rangs, maîtrises, duos, puis la forme joueur
// par joueur). `?lent` étire le tout pour travailler les états de chargement.
const J = (equipe, poste, championId, riotId, sorts, runes, rang, maitrise, forme, duo = null, moi = false) => ({ equipe, poste, championId, riotId, sorts, runes, rang, maitrise, forme, duo, moi });
const ECHELLE = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND'];
const R = (tier, division, lp, wins, losses, enFeu = false) => ({
  file: 'RANKED_SOLO_5x5', tier, division, lp, wins, losses, enFeu,
  ladder: ECHELLE.indexOf(tier) * 400 + ['IV', 'III', 'II', 'I'].indexOf(division) * 100 + lp,
});
const M = (niveau, points, place, part, jours = 2) => ({ niveau, points, place, part, otp: place === 1 && part >= 0.4 && points >= 50000, derniere: Date.now() - jours * 86400e3 });
const JOUEURS_DEMO = [
  J(100, 'TOP', 875, 'Kasai#EUW', [4, 14], [8010, 8000, 8400], R('EMERALD', 'II', 64, 58, 49), M(12, 187000, 1, 0.31, 0), 'VVDVV', null, true),
  J(100, 'JUNGLE', 64, 'Pingu#1312', [11, 4], [8010, 8000, 8100], R('EMERALD', 'I', 12, 88, 80, true), M(27, 410000, 1, 0.52, 0), 'VVVVD', 1),
  J(100, 'MIDDLE', 103, 'lune rousse#FR1', [4, 14], [8112, 8100, 8200], R('DIAMOND', 'IV', 3, 40, 36), M(9, 96000, 2, 0.18, 1), 'DDDVV', 1),
  J(100, 'BOTTOM', 222, 'Kiwi#GOAT', [4, 7], [8008, 8000, 8300], R('EMERALD', 'III', 47, 31, 33), M(6, 38000, 4, 0.09, 12), 'VDVDV'),
  J(100, 'UTILITY', 412, 'tchoupi#EUW', [4, 3], [8439, 8400, 8300], R('EMERALD', 'II', 12, 61, 57), M(1, 800, 42, 0.004, 300), 'VVDDV'),
  J(200, 'TOP', 122, 'RoiDuTop#EUW', [4, 12], [8010, 8000, 8400], R('DIAMOND', 'IV', 51, 112, 90, true), M(45, 812000, 1, 0.68, 0), 'VVVDV'),
  J(200, 'JUNGLE', 234, 'Nocturne Enjoyer#EUW', [11, 4], [8010, 8000, 8300], R('EMERALD', 'I', 70, 45, 47), M(8, 64000, 3, 0.12, 3), 'DVDVD'),
  J(200, 'MIDDLE', 134, 'Ksante main#EUW', [4, 12], [8112, 8100, 8300], R('EMERALD', 'II', 33, 20, 23), M(3, 12000, 11, 0.03, 40), 'DDVDV'),
  J(200, 'BOTTOM', 145, 'Mayhem#777', [4, 7], [9923, 8100, 8000], null, M(5, 44000, 5, 0.1, 6), 'VVDDD', 2),
  J(200, 'UTILITY', 111, 'Hook City#EUW', [4, 14], [8439, 8400, 8300], R('EMERALD', 'IV', 0, 70, 66), M(18, 240000, 1, 0.44, 1), 'DDVVV', 2),
];
let debutDemo = null;
export const partieEnCours = async () => {
  await attendre(120);
  debutDemo ??= Date.now();
  const x = params.has('lent') ? 6 : 1;
  const t = Date.now() - debutDemo;
  const etapes = { rangs: t > 700 * x, maitrises: t > 1300 * x, duos: t > 1700 * x, forme: t > (2000 + 10 * 180) * x };
  const joueurs = JOUEURS_DEMO.map((j, i) => {
    const v = { moi: j.moi, bot: false, riotId: j.riotId, championId: j.championId, equipe: j.equipe, poste: j.poste, sorts: j.sorts, runes: { cle: j.runes[0], style: j.runes[1], sousStyle: j.runes[2] } };
    if (etapes.rangs) v.rang = j.rang;
    if (etapes.maitrises) v.maitrise = j.maitrise;
    if (etapes.duos && j.duo) v.duo = { groupe: j.duo, ensemble: 9 + i };
    if (t > (2000 + (i + 1) * 180) * x) {
      const parties = [...j.forme].map((c, k) => ({ win: c === 'V', championId: k % 3 ? j.championId : 1, k: 4 + k, d: 3, a: 6 }));
      let n = 0;
      for (const p of parties) { if (p.win !== parties[0].win) break; n++; }
      v.forme = { parties, serie: { victoire: parties[0].win, n }, surChampion: parties.filter((p) => p.championId === j.championId).length };
    }
    return v;
  });
  const queue = params.get('file') ? Number(params.get('file')) : 420;
  if (queue === 450) for (const v of joueurs) v.poste = null;
  return { enCours: true, gameId: 42, queue, map: queue === 450 ? 12 : 11, mode: queue === 450 ? 'ARAM' : 'CLASSIC', etapes, complet: etapes.forme, duree: Math.min(t, 3800 * x), erreur: null, joueurs };
};

// Une série de parties plausible, générée une fois.
const CHAMPS = [[875, 'Sett', 'TOP'], [85, 'Kennen', 'TOP'], [133, 'Quinn', 'TOP'], [122, 'Darius', 'TOP'], [875, 'Sett', 'TOP'], [64, 'LeeSin', 'JUNGLE']];
const BUILDS = [[3071, 3053, 6333, 3047, 3065, 0, 3364], [3078, 3053, 3071, 3111, 0, 0, 3340], [6692, 3071, 3047, 6333, 0, 0, 3363]];
let graine = 7;
const alea = () => ((graine = (graine * 16807) % 2147483647) / 2147483647);
const toutes = Array.from({ length: 140 }, (_, i) => {
  const [championId, championName, position] = CHAMPS[i % CHAMPS.length];
  const queueId = [420, 420, 420, 450, 420, 440, 490][i % 7];
  const win = alea() > 0.44;
  const d = 1500 + Math.floor(alea() * 900);
  const k = Math.floor(alea() * 12), m = Math.floor(alea() * 8), a = Math.floor(alea() * 12);
  return {
    matchId: `EUW1_${7200000000 - i}`, queueId, gameStart: Date.now() - (i * 5.3 + 0.4) * 3600e3, durationS: d,
    remake: i === 9, championId, championName, position: queueId === 450 ? null : position, win,
    kills: k, deaths: m, assists: a, cs: Math.round((d / 60) * (6 + alea() * 2.5)), gold: 11000 + Math.floor(alea() * 5000),
    damage: 15000 + Math.floor(alea() * 20000), vision: 12 + Math.floor(alea() * 20), champLevel: 14 + Math.floor(alea() * 4),
    items: BUILDS[i % BUILDS.length], spells: [4, 12], keystone: 8010, secondaryStyle: 8400,
    lpDelta: queueId === 420 && i !== 9 ? (win ? 18 + Math.floor(alea() * 6) : -(15 + Math.floor(alea() * 5))) : null,
  };
});

export const profil = async () => {
  let ladder = 2264 - 120;
  const lpHistory = Array.from({ length: 30 }, (_, i) => {
    ladder += Math.round((alea() - 0.4) * 40);
    return { t: Date.now() - (30 - i) * 86400e3 / 2, ladder };
  });
  return {
    account: { gameName: 'Kasai', tagLine: 'EUW', profileIconId: 5211, summonerLevel: 312, platform: 'euw1' },
    ranks: rangs.map((r) => ({ queue: r.file, tier: r.tier, division: r.division, lp: r.lp, wins: r.victoires, losses: r.defaites })),
    lpHistory,
    history: { count: toutes.length, backfillDone: false, lastSyncAt: new Date(Date.now() - 4 * 60e3).toISOString() },
  };
};

const FILTRES = { solo: [420], flex: [440], normales: [400, 430, 490], aram: [450, 2400] };
export const parties = async (avant, file = 'toutes') => {
  await new Promise((r) => setTimeout(r, 250));
  const liste = toutes
    .filter((m) => !avant || m.gameStart < avant)
    .filter((m) => file === 'toutes' || (FILTRES[file] ? FILTRES[file].includes(m.queueId) : !Object.values(FILTRES).flat().includes(m.queueId)));
  const page = liste.slice(0, 20);
  return { matches: page, next: liste.length > 20 ? page.at(-1).gameStart : null };
};

export const synchroniser = async () => {
  await new Promise((r) => setTimeout(r, 900));
  return { added: 0 };
};

// `?cycle` : une game complète en accéléré, de la file à l'écran de fin.
const ecouteurs = {};
export const ecouter = (nom, fn) => {
  (ecouteurs[nom] ??= []).push(fn);
  return () => { ecouteurs[nom] = ecouteurs[nom].filter((f) => f !== fn); };
};
const emettre = (nom, v) => (ecouteurs[nom] ?? []).forEach((f) => f(v));

if (params.has('cycle')) {
  const suite = ['menus', 'file', 'selection', 'chargement', 'en_jeu', 'fin', 'menus'];
  let i = 0;
  setInterval(() => {
    i = (i + 1) % suite.length;
    const e = suite[i];
    const rs = e === 'menus' && i > 0 ? rangs.map((r) => (r.file === 'RANKED_SOLO_5x5' ? { ...r, lp: r.lp + 21, victoires: r.victoires + 1 } : r)) : rangs;
    emettre('client', { etape: e, phase: e, compte, plateforme: 'euw1', rangs: rs, partie: ['chargement', 'en_jeu'].includes(e) ? 42 : null });
    if (e === 'fin') {
      setTimeout(() => emettre('fin-de-partie', {
        puuid: 'demo', matchId: 'EUW1_1', file: 'RANKED_SOLO_5x5', variation: 21,
        rangApres: { file: 'RANKED_SOLO_5x5', tier: 'EMERALD', division: 'II', lp: 85, victoires: 59, defaites: 49 },
      }), 800);
    }
  }, 2600);
}
