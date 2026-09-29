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
    const v = { moi: j.moi, pote: { 1: 'pingu', 8: 'kiwi' }[i] ?? null, bot: false, riotId: j.riotId, championId: j.championId, equipe: j.equipe, poste: j.poste, sorts: j.sorts, runes: { cle: j.runes[0], style: j.runes[1], sousStyle: j.runes[2] } };
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

// Overlay en jeu (`?overlay`) : une partie qui avance de 20 s par seconde,
// Sett top contre Darius, un dragon pris par chaque équipe, un baron.
export const etatOverlay = async () => {
  const items = {};
  for (const [id, n, p, t] of [
    [3071, 'Couperet noir', 3000, ['Damage', 'Health', 'ArmorPenetration']], [6333, 'Danse de la mort', 3300, ['Damage', 'Armor']],
    [6692, 'Éclipse', 2800, ['Damage']], [3047, 'Coques en acier renforcé', 1200, ['Armor', 'Boots']], [3065, 'Visage spirituel', 2700, ['Health', 'SpellBlock']],
    [3053, "Force de Sterak", 3000, ['Damage', 'Health']], [6694, 'Rancune de Séryldä', 3200, ['Damage']], [3075, 'Cotte épineuse', 2450, ['Armor']],
    [3742, 'Plaque du mort', 2900, ['Armor', 'Health']], [6610, 'Lame sanguinaire', 3000, ['Damage']], [1055, "Lame de Doran", 450, ['Damage']],
  ]) items[id] = { n, p, t, d: 3 };
  return { edition: false, masque: false, pick: { championId: 875, poste: 'TOP', file: 420 }, catalogue: { version: null, items } };
};
if (params.has('overlay')) {
  const debut = Date.now();
  const P = (champion, equipe, poste, niveau, items, valeur, moi = false) => ({ champion, equipe, poste, niveau, items, valeur, moi });
  setInterval(() => {
    const temps = 780 + ((Date.now() - debut) / 1000) * 20;
    const niveau = Math.min(18, 9 + Math.floor((temps - 780) / 120));
    emettre('jeu', {
      temps, mode: params.has('aram') ? 'ARAM' : 'CLASSIC', or: 700 + (temps % 3000), niveau, competences: [5, 1, 3, 1],
      joueurs: [
        P('Sett', 'ORDER', 'TOP', niveau, [1055, 3071, 3047], 4650, true), P('LeeSin', 'ORDER', 'JUNGLE', 10, [], 5100), P('Ahri', 'ORDER', 'MIDDLE', 11, [], 5600),
        P('Jinx', 'ORDER', 'BOTTOM', 9, [], 4900), P('Thresh', 'ORDER', 'UTILITY', 8, [], 2400),
        P('Darius', 'CHAOS', 'TOP', 10, [], 5100), P('Viego', 'CHAOS', 'JUNGLE', 10, [], 5300), P('Syndra', 'CHAOS', 'MIDDLE', 10, [], 5000),
        P('Kaisa', 'CHAOS', 'BOTTOM', 9, [], 4400), P('Nautilus', 'CHAOS', 'UTILITY', 8, [], 2600),
      ],
      objectifs: [
        { genre: 'dragon', temps: 390, equipe: 'ORDER', element: 'Fire' },
        { genre: 'dragon', temps: 745, equipe: 'CHAOS', element: 'Hextech' },
        ...(temps > 1300 ? [{ genre: 'baron', temps: 1300, equipe: 'ORDER', element: null }] : []),
      ],
    });
  }, 1000);
  setTimeout(() => emettre('overlay-edition', params.has('edition')), 300);
}

// Debrief d'une partie de démo : Sett top contre Darius, en retard de 9 à
// 13 min après une mort seul, puis qui reprend la main.
export const debrief = async (matchId) => {
  await attendre(params.has('lent') ? 3000 : 600);
  const m = toutes.find((x) => x.matchId === matchId) ?? toutes[0];
  const n = Math.max(16, Math.round(m.durationS / 60)) + 1;
  const courbe = (amp, k) => Array.from({ length: n }, (_, i) => Math.round(amp * (Math.sin(i / 3.2) * 0.4 + (i < 9 ? i / 18 : i < 14 ? -(i - 9) / 5 + 0.5 : (i - 14) / 6 - 0.5)) * k));
  const aram = m.queueId === 450;
  return {
    version: 1, matchId: m.matchId, queue: m.queueId, debut: m.gameStart, duree: m.durationS, win: m.win, remake: m.remake,
    lp: m.lpDelta,
    moi: { championId: m.championId, championName: dd_nom(m.championId), role: m.position, niveau: m.champLevel, kills: m.kills, deaths: m.deaths, assists: m.assists,
      cs: m.cs, csm: m.cs / (m.durationS / 60), degats: m.damage, vision: m.vision, or: m.gold, kp: 0.58, items: m.items, sorts: m.spells, cle: m.keystone },
    face: aram ? null : { championId: 122, championName: 'Darius', kills: 5, deaths: 6, assists: 4 },
    groupe: aram ? null : { palier: 'EMERALD', nom: 'Émeraude', poste: m.position, propre: true },
    mesures: aram ? [] : [
      { cle: 'cs10', valeur: 71, mediane: 66, mieuxQue: 0.64, n: 4200 }, { cle: 'csm', valeur: m.cs / (m.durationS / 60), mediane: 7.1, mieuxQue: 0.58, n: 4200 },
      { cle: 'or15', valeur: -420, mediane: 0, mieuxQue: 0.31, n: 4200 }, { cle: 'kp', valeur: 0.58, mediane: 0.48, mieuxQue: 0.77, n: 4200 },
      { cle: 'vision', valeur: 0.62, mediane: 0.71, mieuxQue: 0.36, n: 4200 }, { cle: 'degats', valeur: 0.27, mediane: 0.23, mieuxQue: 0.71, n: 4200 },
      { cle: 'objectifs', valeur: 0.4, mediane: 0.5, mieuxQue: 0.33, n: 4200 }, { cle: 'isoles', valeur: 0.5, mediane: 0.33, mieuxQue: 0.22, n: 4200 },
    ],
    courbes: { or: courbe(2400, 1), xp: courbe(1500, 1), cs: courbe(22, 1) },
    morts: [
      { t: 9 * 60000 + 12000, x: 4100, y: 9800, isole: true, tueur: 64, attaquants: 2, apres: 'heraut' },
      { t: 14 * 60000 + 40000, x: 2500, y: 12600, isole: true, tueur: 122, attaquants: 1, apres: 'tour' },
      { t: 26 * 60000 + 5000, x: 9800, y: 4300, isole: false, tueur: 234, attaquants: 3, apres: null },
    ].slice(0, Math.max(1, Math.min(3, m.deaths))),
    objectifs: { equipe: 5, moi: 2, liste: [[330000, 'larves', true], [600000, 'dragon', false], [575000, 'heraut', false], [990000, 'dragon', true], [1320000, 'dragon', true], [1560000, 'baron', true]].map(([t, genre, nous]) => ({ t, genre, nous })) },
    retenir: aram ? [
      { cle: 'kp', ton: 'v', texte: 'Tu participes à 71 % des kills de ton équipe : continue à rester groupé.' },
    ] : [
      { cle: 'mort_objectif', ton: 'r', texte: 'Ta mort à 9:12, seul en rivière, a offert le héraut : attends ton jungler avant de pousser quand leur jungle est invisible.' },
      { cle: 'fenetre_cs', ton: 'r', texte: 'Tu perds 18 CS sur Darius entre 14 et 20 min : pense à tes vagues avant de rejoindre un combat.' },
      { cle: 'kp', ton: 'v', texte: 'Point fort : 58 % de participation aux kills, mieux que 77 % des Émeraude top. Tes TP paient, continue.' },
    ],
    ia: true, minutes: m.durationS / 60,
  };
};
const dd_nom = (id) => ({ 875: 'Sett', 85: 'Kennen', 133: 'Quinn', 122: 'Darius', 64: 'Lee Sin' })[id] ?? 'Champion';

// Entre potes (brique 8) : « les bouffons », 5 potes, une semaine en cours.
const heure = 3600e3;
const MEMBRES = [
  { profil: 1, pseudo: 'kasai', icone: 5211, lp: 45, parties: 9, victoires: 6, avant: 3 },
  { profil: 2, pseudo: 'pingu', icone: 4568, lp: 61, parties: 7, victoires: 5, avant: 1 },
  { profil: 3, pseudo: 'lune rousse', icone: 5367, lp: 40, parties: 11, victoires: 6, avant: 2 },
  { profil: 4, pseudo: 'kiwi', icone: 6013, lp: -12, parties: 5, victoires: 2, avant: 4 },
  { profil: 5, pseudo: 'tchoupi', icone: 4895, lp: -38, parties: 8, victoires: 2, avant: 5 },
].sort((a, b) => b.lp - a.lp).map((m, i) => ({ ...m, place: i + 1 }));
let filDemo = [
  { id: 14, type: 'partie', pseudo: 'kasai', profil: 1, groupe: 'les bouffons', moi: true, texte: "tu passes devant lune rousse et t'es 2e mtn, pingu t'es à 16 LP t'es chaud ?", data: { championId: 875, victoire: true, kda: '8/3/6', lpPartie: 21, place: 2, avant: 3, total: 5, classement: MEMBRES }, reactions: { gg: 2 }, maReaction: null, t: Date.now() - 0.3 * heure },
  { id: 13, type: 'partie', pseudo: 'tchoupi', profil: 5, groupe: 'les bouffons', moi: false, texte: "-38 LP depuis lundi et dernier du groupe, enft cette semaine c'est pas la tienne", data: { championId: 412, victoire: false, kda: '1/9/4', lpPartie: -19, place: 5, avant: 5, total: 5 }, reactions: { cheh: 3, aie: 1 }, maReaction: 'cheh', t: Date.now() - 2.5 * heure },
  { id: 12, type: 'partie', pseudo: 'pingu', moi: false, texte: "vous étiez 2 dans la game et c'est pingu qui a carry, kiwi t'étais où genre", data: { championId: 64, victoire: true, kda: '12/2/9', lpPartie: 23, place: 1, avant: 1, total: 5, potes: [{ pseudo: 'kiwi', champion: 'Jinx', kda: '3/6/5', memeEquipe: true }] }, reactions: { gg: 3, cheh: 1 }, maReaction: 'gg', t: Date.now() - 20 * heure },
  { id: 9, type: 'couronne', pseudo: 'lune rousse', moi: false, texte: "semaine pliée, lune rousse finit 1er avec +88 LP, les autres on se retrouve lundi", data: {}, reactions: { gg: 4 }, maReaction: 'gg', t: Date.now() - 50 * heure },
];
export const identite = async (pseudo) => ({ id: 1, pseudo: pseudo ?? 'kasai', comptes: [{ gameName: 'Kasai', tagLine: 'EUW', icone: 5211 }] });
let groupesDemo = params.has('seul') ? [] : [{ id: 1, nom: 'les bouffons', code: 'K7QX2M', membres: 5, chambrage: true, discord: { nom: 'On lance ?' } }];
export const potes = async (methode, chemin, corps) => {
  await attendre(250);
  if (chemin === '/groupes' && methode === 'GET') return { groupes: groupesDemo };
  if (chemin === '/groupes' && methode === 'POST') { groupesDemo = [{ id: 1, nom: corps.nom, code: 'K7QX2M', membres: 1, chambrage: true, discord: null }]; return { id: 1 }; }
  if (chemin === '/groupes/rejoindre') { groupesDemo = [{ id: 1, nom: 'les bouffons', code: 'K7QX2M', membres: 5, chambrage: true, discord: null }]; return { id: 1 }; }
  // Fil : au premier passage le dernier événement connu, puis (avec ?verdict)
  // ta partie qui vient de finir, pour voir le verdict.
  if (chemin.startsWith('/fil?')) {
    const depuis = Number(new URLSearchParams(chemin.split('?')[1]).get('depuis')) || 0;
    if (!depuis) return { fil: [filDemo[1]] };
    if (params.has('verdict') && depuis < 14) return { fil: [filDemo[0]] };
    return { fil: [] };
  }
  if (chemin.startsWith('/fil/')) {
    const e = filDemo.find((x) => x.id === Number(chemin.split('/')[2]));
    if (e) {
      if (e.maReaction) e.reactions[e.maReaction]--;
      e.maReaction = corps.type;
      if (corps.type) e.reactions[corps.type] = (e.reactions[corps.type] ?? 0) + 1;
    }
    return null;
  }
  if (chemin.endsWith('/apercu')) { await attendre(1200); return { texte: "2e du groupe à 27 LP de pingu, une game et t'es devant, flemme ou t'es chaud ?", ia: true }; }
  if (chemin.endsWith('/discord') && methode === 'POST') return { nom: 'On lance ?' };
  if (chemin.startsWith('/groupes/')) {
    const g = groupesDemo[0];
    return {
      groupe: g, moi: 1,
      semaine: { cle: '2026-09-28', nom: 'semaine du 28 septembre', fin: Date.now() + 4.3 * 24 * heure },
      classement: MEMBRES,
      historique: [
        { semaine: '2026-09-21', nom: 'semaine du 21 septembre', gagnant: 'lune rousse', lp: 88 },
        { semaine: '2026-09-14', nom: 'semaine du 14 septembre', gagnant: 'pingu', lp: 71 },
        { semaine: '2026-09-07', nom: 'semaine du 7 septembre', gagnant: 'kasai', lp: 54 },
      ],
      fil: filDemo.map((e) => ({ ...e, reactions: { ...e.reactions } })),
    };
  }
  return null;
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
