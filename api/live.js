// Écran de chargement (brique 5) : les 10 joueurs de la partie en cours.
//
// Pendant le chargement, l'app demande « ma partie » toutes les secondes et
// demie. Le premier appel trouve la partie (API spectateur) et lance l'analyse
// en fond ; les suivants renvoient où elle en est. Les infos arrivent par
// étapes, de la moins chère à la plus chère :
//   1. rang et maîtrises          2 appels par joueur
//   2. parties récentes           1 appel par joueur → duos repérés
//   3. forme (5 dernières)        50 appels au plus, partagés entre joueurs
// Avec une clé personnelle (100 appels / 2 min), les étapes 1 et 2 tombent en
// 2 à 3 s ; la forme arrive joueur par joueur, au rythme que Riot autorise.
// Une partie n'est analysée qu'une fois, même si plusieurs joueurs ont l'app,
// et un joueur vu il y a moins de 20 minutes n'est pas redemandé à Riot.

import { ladder } from './rangs.js';
import { postesProbables } from './stats/build.js';
import { roles as rolesDesChampions } from './stats/routes.js';
import { recleCompte } from './sync.js';

const SMITE = 11;
const POSTES = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
// Files où l'historique est filtré sur la file de la partie (sinon : tout).
// Riot n'indexe pas l'ARAM Mayhem (2400) : le filtre renverrait une liste vide.
const FILES_FILTREES = new Set([400, 420, 430, 440, 450, 490]);
const FORME = 5;
const TTL_PARTIE = 2 * 3600_000;
const TTL_JOUEUR = 20 * 60_000;
const TTL_ABSENT = 5_000;

const parties = new Map(); // `${plateforme}:${gameId}` → partie
const absents = new Map(); // puuid → dernier « pas en partie »
const joueurs = new Map(); // puuid → { at, rangs, maitrises, ids }
const resumes = new Map(); // matchId → résumé compact

function borner(map, max) {
  while (map.size > max) map.delete(map.keys().next().value);
}

// ---------------------------------------------------------------- calculs

// Le rang qui compte pour cette partie : la Flex en Flex, la Solo/Duo partout
// ailleurs, l'autre à défaut.
export function choisirRang(entrees, queue) {
  if (!Array.isArray(entrees)) return null;
  const voulu = queue === 440 ? 'RANKED_FLEX_SR' : 'RANKED_SOLO_5x5';
  const e = entrees.find((x) => x.queueType === voulu)
    ?? entrees.find((x) => x.queueType === 'RANKED_SOLO_5x5' || x.queueType === 'RANKED_FLEX_SR');
  if (!e) return null;
  return {
    file: e.queueType, tier: e.tier, division: e.rank ?? null, lp: e.leaguePoints ?? 0,
    wins: e.wins ?? 0, losses: e.losses ?? 0, enFeu: Boolean(e.hotStreak),
    ladder: ladder(e.tier, e.rank, e.leaguePoints ?? 0),
  };
}

// Expérience sur le champion joué. « OTP » : son champion n°1, qui pèse au
// moins 40 % de toute sa maîtrise.
export function resumeMaitrise(liste, championId) {
  if (!Array.isArray(liste)) return null;
  const tri = [...liste].sort((a, b) => (b.championPoints ?? 0) - (a.championPoints ?? 0));
  const total = tri.reduce((s, m) => s + (m.championPoints ?? 0), 0);
  const i = tri.findIndex((m) => m.championId === championId);
  const m = tri[i];
  const points = m?.championPoints ?? 0;
  const part = total ? points / total : 0;
  return {
    niveau: m?.championLevel ?? 0, points, derniere: m?.lastPlayTime ?? null,
    place: i >= 0 ? i + 1 : null, part: Math.round(part * 1000) / 1000,
    otp: i === 0 && part >= 0.4 && points >= 50_000,
  };
}

// Une partie réduite à ce qui sert ici : ~1 Ko au lieu de ~40.
export function resumeMatch(match) {
  const info = match?.info;
  if (!info) return null;
  const p = {};
  for (const x of info.participants ?? []) {
    if (!x.puuid) continue;
    p[x.puuid] = { c: x.championId, w: Boolean(x.win), k: x.kills ?? 0, d: x.deaths ?? 0, a: x.assists ?? 0, r: Boolean(x.gameEndedInEarlySurrender) };
  }
  return { p };
}

// Les dernières parties d'un joueur, de la plus récente à la plus ancienne.
// Une partie manquante coupe la liste (sinon la série serait fausse) ; les
// remakes ne comptent pas.
export function formeDe(puuid, ids, lire, championId) {
  const liste = [];
  for (const id of ids.slice(0, FORME)) {
    const x = lire(id)?.p?.[puuid];
    if (!x) break;
    if (x.r) continue;
    liste.push({ win: x.w, championId: x.c, k: x.k, d: x.d, a: x.a });
  }
  let n = 0;
  for (const x of liste) {
    if (x.win !== liste[0].win) break;
    n++;
  }
  return {
    parties: liste,
    serie: liste.length ? { victoire: liste[0].win, n } : null,
    surChampion: liste.filter((x) => x.championId === championId).length,
  };
}

// Duos (ou groupes en Flex) d'une équipe : deux joueurs qui partagent au
// moins 2 de leurs 20 dernières parties jouent ensemble. Renvoie, pour chaque
// joueur, l'indice de son groupe (ou null) et le nombre de parties communes.
export function reperesDuos(listesIds) {
  const n = listesIds.length;
  const parent = listesIds.map((_, i) => i);
  const racine = (i) => (parent[i] === i ? i : (parent[i] = racine(parent[i])));
  const ensemble = new Array(n).fill(0);
  const sets = listesIds.map((ids) => new Set(ids ?? []));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let communs = 0;
      for (const id of sets[i]) if (sets[j].has(id)) communs++;
      if (communs < 2) continue;
      parent[racine(i)] = racine(j);
      ensemble[i] = Math.max(ensemble[i], communs);
      ensemble[j] = Math.max(ensemble[j], communs);
    }
  }
  const tailles = new Map();
  for (let i = 0; i < n; i++) tailles.set(racine(i), (tailles.get(racine(i)) ?? 0) + 1);
  return listesIds.map((_, i) => (tailles.get(racine(i)) > 1 ? { groupe: racine(i), ensemble: ensemble[i] } : null));
}

// Range une équipe de la Faille dans l'ordre Top, Jungle, Mid, ADC, Support,
// d'après les postes joués par chaque champion ce patch. Le Châtiment ne
// trompe pas : c'est le jungler.
export function attribuerPostes(equipe, roles) {
  if (new Set(equipe.map((j) => j.championId)).size !== 5) return equipe;
  const r = {};
  for (const j of equipe) {
    const base = roles[j.championId] ?? {};
    r[j.championId] = j.sorts.includes(SMITE) ? { JUNGLE: 1 } : { ...base, JUNGLE: Math.min(base.JUNGLE ?? 0, 0.001) };
  }
  const aff = postesProbables(equipe.map((j) => j.championId), r);
  for (const j of equipe) j.poste = aff[j.championId] ?? null;
  return equipe.sort((a, b) => POSTES.indexOf(a.poste) - POSTES.indexOf(b.poste));
}

// ---------------------------------------------------------------- analyse

function creerPartie(jeu, platform) {
  return {
    gameId: jeu.gameId, platform, queue: jeu.gameQueueConfigId ?? null, map: jeu.mapId ?? null, mode: jeu.gameMode ?? null,
    creee: Date.now(), fin: null, erreur: null,
    etapes: { rangs: false, maitrises: false, duos: false, forme: false },
    joueurs: (jeu.participants ?? []).map((x) => ({
      puuid: x.puuid || null, bot: Boolean(x.bot) || !x.puuid,
      riotId: x.riotId ?? null, championId: x.championId, equipe: x.teamId,
      sorts: [x.spell1Id, x.spell2Id],
      runes: { cle: x.perks?.perkIds?.[0] ?? null, style: x.perks?.perkStyle ?? null, sousStyle: x.perks?.perkSubStyle ?? null },
    })),
  };
}

function equipesDe(p) {
  const parEquipe = new Map();
  for (const j of p.joueurs) parEquipe.set(j.equipe, [...(parEquipe.get(j.equipe) ?? []), j]);
  return [...parEquipe.values()];
}

// Les appels à Riot qui échouent donnent `null` : une info manquante ne doit
// pas bloquer les neuf autres joueurs.
const sur = (promesse) => promesse.catch(() => null);

function infos(puuid) {
  let c = joueurs.get(puuid);
  if (!c || Date.now() - c.at > TTL_JOUEUR) {
    c = { at: Date.now(), rangs: null, maitrises: null, ids: {} };
    joueurs.set(puuid, c);
    borner(joueurs, 5000);
  }
  return c;
}

async function analyser(riot, p, lireRoles) {
  const P = p.platform;
  const humains = p.joueurs.filter((j) => !j.bot);

  // Postes : aucune requête Riot, seulement nos statistiques.
  if (p.map === 11) {
    const roles = await lireRoles(p.queue === 440 ? 440 : 420).catch(() => ({}));
    const ordre = equipesDe(p).map((e) => attribuerPostes(e, roles)).flat();
    p.joueurs = ordre;
  }

  // 1. Rangs et maîtrises, en parallèle.
  const rangs = Promise.all(humains.map(async (j) => {
    const c = infos(j.puuid);
    c.rangs ??= await sur(riot.leagues(P, j.puuid));
    if (c.rangs) j.rang = choisirRang(c.rangs, p.queue);
  })).then(() => (p.etapes.rangs = true));
  const maitrises = Promise.all(humains.map(async (j) => {
    const c = infos(j.puuid);
    c.maitrises ??= await sur(riot.masteries(P, j.puuid));
    if (c.maitrises) j.maitrise = resumeMaitrise(c.maitrises, j.championId);
  })).then(() => (p.etapes.maitrises = true));
  await Promise.all([rangs, maitrises]);

  // 2. Parties récentes de chacun, puis les duos.
  // Rien dans cette file (un joueur de Solo/Duo en Normale, par exemple) :
  // on prend tout son historique.
  const filtre = FILES_FILTREES.has(p.queue) ? p.queue : undefined;
  const historique = async (c, puuid, queue) => {
    const cle = String(queue ?? 'toutes');
    c.ids[cle] ??= await sur(riot.matchIds(P, puuid, { count: 20, queue }));
    return c.ids[cle];
  };
  const ids = new Map();
  await Promise.all(humains.map(async (j) => {
    const c = infos(j.puuid);
    let liste = await historique(c, j.puuid, filtre);
    if (filtre && liste && !liste.length) liste = await historique(c, j.puuid, undefined);
    ids.set(j, liste ?? []);
  }));
  let numero = 0;
  for (const equipe of equipesDe(p)) {
    const h = equipe.filter((j) => !j.bot);
    const groupes = new Map();
    reperesDuos(h.map((j) => ids.get(j))).forEach((d, i) => {
      if (!d) return;
      if (!groupes.has(d.groupe)) groupes.set(d.groupe, ++numero);
      h[i].duo = { groupe: groupes.get(d.groupe), ensemble: d.ensemble };
    });
  }
  p.etapes.duos = true;

  // 3. Forme. Joueur par joueur (ses 5 parties, puis le suivant) : chaque
  // fiche se complète dès que les siennes sont là, sans attendre les autres.
  const aCharger = new Set();
  for (const j of humains) for (const id of ids.get(j).slice(0, FORME)) if (!resumes.has(id)) aCharger.add(id);
  const reglees = new Set();
  const lire = (id) => resumes.get(id);
  const aJour = () => {
    for (const j of humains) {
      if (j.forme) continue;
      const siennes = ids.get(j).slice(0, FORME);
      if (siennes.every((id) => resumes.has(id) || reglees.has(id))) j.forme = formeDe(j.puuid, siennes, lire, j.championId);
    }
  };
  aJour();
  await Promise.all([...aCharger].map(async (id) => {
    const m = await sur(riot.match(P, id));
    const r = m && resumeMatch(m);
    if (r) {
      resumes.set(id, r);
      borner(resumes, 4000);
    }
    reglees.add(id);
    aJour();
  }));
  aJour();
  p.etapes.forme = true;
}

// Ce que l'app reçoit : jamais les puuid des autres joueurs.
function vue(p, puuid) {
  return {
    enCours: true, gameId: p.gameId, queue: p.queue, map: p.map, mode: p.mode,
    etapes: p.etapes, complet: Boolean(p.fin), duree: p.fin ? p.fin - p.creee : Date.now() - p.creee,
    erreur: p.erreur,
    joueurs: p.joueurs.map((j) => ({
      moi: j.puuid === puuid, bot: j.bot, riotId: j.riotId, championId: j.championId, equipe: j.equipe,
      poste: j.poste ?? null, sorts: j.sorts, runes: j.runes,
      rang: j.rang, maitrise: j.maitrise, forme: j.forme, duo: j.duo,
    })),
  };
}

export async function partieEnCours(riot, compte, { gameId = null, lireRoles = rolesDesChampions } = {}) {
  const now = Date.now();
  for (const [k, p] of parties) if (now - p.creee > TTL_PARTIE) parties.delete(k);
  const { platform } = compte;
  let puuid = compte.puuid;

  // L'app connaît l'identifiant de sa partie (lu sur le client) : si elle est
  // déjà analysée, pas besoin de redemander à Riot.
  if (gameId) {
    const p = parties.get(`${platform}:${gameId}`);
    if (p) return vue(p, puuid);
  }
  if (now - (absents.get(puuid) ?? 0) < TTL_ABSENT) return { enCours: false };

  let jeu;
  try {
    jeu = await riot.activeGame(platform, puuid);
  } catch (err) {
    // 400 : puuid chiffré par une ancienne clé Riot (voir sync.js).
    if (err.status !== 400) throw err;
    const nouveau = await recleCompte(riot, puuid);
    if (!nouveau) throw err;
    puuid = nouveau;
    jeu = await riot.activeGame(platform, puuid);
  }
  if (!jeu) {
    absents.set(puuid, now);
    borner(absents, 5000);
    return { enCours: false };
  }
  absents.delete(puuid);

  const cle = `${platform}:${jeu.gameId}`;
  let p = parties.get(cle);
  if (!p) {
    p = creerPartie(jeu, platform);
    parties.set(cle, p);
    analyser(riot, p, lireRoles)
      .catch((err) => {
        console.error('écran de chargement :', err.message);
        p.erreur = 'Analyse interrompue.';
      })
      .finally(() => (p.fin = Date.now()));
  }
  return vue(p, puuid);
}

// Pour les tests.
export function oublierTout() {
  parties.clear();
  absents.clear();
  joueurs.clear();
  resumes.clear();
}
