// Données de démonstration, uniquement hors de Tauri. Rien de tout ça
// n'existe dans l'app publiée.

const params = new URLSearchParams(location.search);
const etape = params.get('etape') ?? 'menus';

const compte = { puuid: 'demo', gameName: 'Kasai', tagLine: 'EUW', niveau: 312, icone: 5211 };
const rangs = [
  { file: 'RANKED_SOLO_5x5', tier: 'EMERALD', division: 'II', lp: 64, victoires: 58, defaites: 49 },
  { file: 'RANKED_FLEX_SR', tier: 'PLATINUM', division: 'I', lp: 12, victoires: 14, defaites: 9 },
];

export const etatClient = async () =>
  etape === 'hors'
    ? { etape: 'hors', phase: '', compte: null, plateforme: null, rangs: [] }
    : { etape, phase: 'Lobby', compte, plateforme: 'euw1', rangs };

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
    emettre('client', { etape: e, phase: e, compte, plateforme: 'euw1', rangs: rs });
    if (e === 'fin') {
      setTimeout(() => emettre('fin-de-partie', {
        puuid: 'demo', matchId: 'EUW1_1', file: 'RANKED_SOLO_5x5', variation: 21,
        rangApres: { file: 'RANKED_SOLO_5x5', tier: 'EMERALD', division: 'II', lp: 85, victoires: 59, defaites: 49 },
      }), 800);
    }
  }, 2600);
}
