// Le coach sur plusieurs parties : le « focus du moment ».
//
// Le debrief juge UNE partie. Le coach cherche ce qui revient : sur tes
// dernières parties à ton poste, la mesure où tu es le plus souvent dans le
// bas de ton rang (mêmes définitions et mêmes repères que le debrief). Une
// mauvaise game isolée ne fait pas un focus ; une habitude, oui.
//
// Un seul focus à la fois, avec un objectif chiffré (la médiane des joueurs
// de ton rang à ton poste) et un conseil concret. Il reste le même tant qu'il
// n'est pas tenu : pas de valse d'une partie à l'autre. Quand la médiane de
// tes 5 dernières parties atteint l'objectif, il est validé et le suivant
// prend sa place.

import { query } from './db.js';
import { histogrammes, palierDuJoueur, NOMS_PALIERS } from './debrief.js';
import { MESURES, mesurer, situer } from './stats/reperes.js';

const FILES_SR = new Set([400, 420, 430, 440, 490]);
export const MIN_PARTIES = 6;
const FENETRE = 20;

// Ce qui compte le plus, à gravité égale.
const POIDS = { morts: 1.1, isoles: 1, cs10: 1, csm: 1, vision: 1, or15: 0.95, kp: 0.9, objectifs: 0.9, degats: 0.8 };

const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const pct = (x) => `${Math.round(x * 100)} %`;

// Les textes du coach, mesure par mesure : un titre, pourquoi ça compte, quoi
// faire concrètement, et l'objectif en clair.
export const FICHES = {
  cs10: {
    titre: 'Le farm en début de partie', unite: (v) => `${Math.round(v)} CS à 10 min`,
    conseil: 'Chaque vague vaut environ 7 CS : pendant les 10 premières minutes, les derniers coups passent avant les trades.',
  },
  csm: {
    titre: 'Le farm sur toute la partie', unite: (v) => `${nf.format(v)} CS par minute`,
    conseil: 'Entre deux combats, va reprendre les vagues sur les côtés : l’or des sbires ne se perd jamais.',
  },
  or15: {
    titre: 'Ta lane', unite: (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${new Intl.NumberFormat('fr-FR').format(Math.abs(Math.round(v)))} PO sur ton adversaire à 15 min`,
    conseil: 'Avant 15 min, évite les morts et les retours inutiles, et ne laisse pas des vagues entières mourir sous ta tour.',
  },
  morts: {
    titre: 'Tes morts', unite: (v) => `${nf.format(v)} morts par 30 min`,
    conseil: 'Avant de t’engager, compte les ennemis visibles sur la carte : s’il en manque, recule d’abord.',
  },
  isoles: {
    titre: 'Les morts sans allié', unite: (v) => `${pct(v)} de morts sans allié à portée`,
    conseil: 'Avant d’avancer dans le brouillard, regarde où sont tes alliés : si personne ne peut venir, pose une balise ou recule.',
  },
  kp: {
    titre: 'Ta présence dans les combats', unite: (v) => `${pct(v)} de participation aux kills`,
    conseil: 'Jette un œil à la carte toutes les quelques secondes et rejoins les combats de ton équipe avant qu’ils commencent.',
  },
  vision: {
    titre: 'Ta vision', unite: (v) => `${nf.format(v)} de vision par minute`,
    conseil: 'Achète une balise de contrôle à chaque retour, et pose tes balises avant les dragons et le baron, pas après.',
  },
  degats: {
    titre: 'Tes dégâts en combat', unite: (v) => `${pct(v)} des dégâts de ton équipe`,
    conseil: 'En combat, tape la cible la plus proche que tu peux atteindre sans t’exposer, plutôt que d’attendre l’ouverture parfaite.',
  },
  objectifs: {
    titre: 'Les objectifs', unite: (v) => `présent sur ${pct(v)} des objectifs de l’équipe`,
    conseil: 'Dès qu’un dragon ou le baron approche, pousse ta vague et rejoins ton équipe une minute avant.',
  },
};

export const tenu = (mesure, valeur, cible) => (MESURES[mesure].sens === 'haut' ? valeur >= cible : valeur <= cible);
const mediane = (l) => {
  const t = [...l].sort((a, b) => a - b);
  return t.length ? (t.length % 2 ? t[(t.length - 1) / 2] : (t[t.length / 2 - 1] + t[t.length / 2]) / 2) : null;
};

// ---------------------------------------------------------------- mesures

export async function enregistrerMesures(puuid, match, timeline) {
  const me = match?.info?.participants?.find((p) => p.puuid === puuid);
  if (!me || !FILES_SR.has(match.info.queueId) || me.gameEndedInEarlySurrender) return;
  const m = mesurer(match, timeline).get(me.participantId);
  if (!m?.role) return;
  await query(
    `insert into mesures_joueur (puuid, match_id, game_start, queue, role, win, valeurs) values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (puuid, match_id) do nothing`,
    [puuid, match.metadata.matchId, match.info.gameStartTimestamp ?? match.info.gameCreation, match.info.queueId, m.role, m.win, m.valeurs],
  );
}

// Mesure en fond (priorité basse) les dernières parties de la Faille qui ne
// le sont pas encore. Une seule tournée à la fois par compte.
const enCours = new Set();
export function completerMesures(riot, compte, { limite = FENETRE } = {}) {
  if (enCours.has(compte.puuid) || !riot.configured) return;
  enCours.add(compte.puuid);
  (async () => {
    const { rows } = await query(
      `select pm.match_id from player_matches pm
        where pm.puuid = $1 and pm.queue_id = any($2) and not pm.remake
          and not exists (select 1 from mesures_joueur m where m.puuid = pm.puuid and m.match_id = pm.match_id)
        order by pm.game_start desc limit $3`,
      [compte.puuid, [...FILES_SR], limite],
    );
    for (const { match_id } of rows) {
      const [match, timeline] = await Promise.all([
        riot.match(compte.platform, match_id, { priority: 'low' }),
        riot.timeline(compte.platform, match_id, { priority: 'low' }),
      ]);
      if (match && timeline) await enregistrerMesures(compte.puuid, match, timeline);
    }
  })()
    .catch((err) => console.error('coach, mesures :', err.message))
    .finally(() => enCours.delete(compte.puuid));
}

// ---------------------------------------------------------------- habitudes

// Pour chaque mesure : où tu te situes partie après partie (0 = mieux que
// tout ton rang, 1 = moins bien), et ta valeur habituelle. `parties` : de la
// plus récente à la plus ancienne, toutes au même poste.
export function habitudes(parties, histos, role) {
  const out = {};
  for (const [m, def] of Object.entries(MESURES)) {
    if (def.postes && !def.postes.includes(role)) continue;
    const histo = histos[m];
    if (!histo?.length) continue;
    const vals = parties.map((p) => p.valeurs[m]).filter((v) => v != null && Number.isFinite(v));
    if (vals.length < MIN_PARTIES) continue;
    const pos = vals.map((v) => situer(m, v, histo)).filter(Boolean);
    const n = pos[0]?.n ?? 0;
    if (n < 200) continue;
    out[m] = {
      parties: vals.length,
      position: mediane(pos.map((p) => p.position)),
      souvent: pos.filter((p) => p.position > 0.75).length, // parties dans le quart le plus bas
      valeur: mediane(vals),
      cible: pos[0].mediane,
    };
  }
  return out;
}

// Le focus à proposer : l'habitude la plus coûteuse (position × poids).
export function choisirFocus(h, exclure = []) {
  return Object.entries(h)
    .filter(([m, x]) => x.position >= 0.62 && !exclure.includes(m))
    .sort((a, b) => b[1].position * POIDS[b[0]] - a[1].position * POIDS[a[0]])[0]?.[0] ?? null;
}

// ---------------------------------------------------------------- le coach

export async function coach(riot, compte) {
  const { rows } = await query(
    'select match_id, game_start, queue, role, win, valeurs from mesures_joueur where puuid = $1 order by game_start desc limit 60',
    [compte.puuid],
  );
  if (rows.length < FENETRE) completerMesures(riot, compte);

  // Ton poste principal sur tes dernières parties : le coach juge celui-là.
  const compte_ = {};
  for (const r of rows.slice(0, FENETRE)) compte_[r.role] = (compte_[r.role] ?? 0) + 1;
  const role = Object.entries(compte_).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const parties = rows.filter((r) => r.role === role).slice(0, FENETRE);
  if (!role || parties.length < MIN_PARTIES) {
    return { pret: false, analysees: rows.length, besoin: MIN_PARTIES, role, parties: parties.length };
  }

  const palier = await palierDuJoueur(compte.puuid);
  const brut = await histogrammes(role, palier ?? 'TOUS');
  const nPalier = Object.keys(MESURES).reduce((s, m) => s + (brut[`m:${m}:${palier}`] ?? []).reduce((t, x) => t + x.games, 0), 0);
  const groupe = palier && nPalier >= 200 * 3 ? palier : 'TOUS';
  const histos = Object.fromEntries(Object.keys(MESURES).map((m) => [m, brut[`m:${m}:${groupe}`] ?? []]));
  const h = habitudes(parties, histos, role);

  // Le focus en cours reste tant qu'il n'est pas tenu.
  const { rows: [enregistre] } = await query('select * from coach_focus where puuid = $1', [compte.puuid]);
  let focus = enregistre && enregistre.role === role && h[enregistre.cle] ? enregistre : null;
  let valide = null;
  if (focus) {
    const cinq = parties.slice(0, 5).map((p) => p.valeurs[focus.cle]).filter((v) => v != null);
    const depuis = parties.filter((p) => p.game_start > new Date(focus.depuis).getTime()).length;
    if (depuis >= 3 && cinq.length >= 5 && tenu(focus.cle, mediane(cinq), focus.cible)) {
      valide = { cle: focus.cle, titre: FICHES[focus.cle].titre };
      const suivant = choisirFocus(h, [focus.cle]);
      const valides = [...(focus.valides ?? []), { cle: focus.cle, le: new Date().toISOString() }].slice(-20);
      if (suivant) {
        await query(
          'update coach_focus set cle = $2, cible = $3, depuis = now(), valides = $4 where puuid = $1',
          [compte.puuid, suivant, h[suivant].cible, JSON.stringify(valides)],
        );
        focus = { cle: suivant, cible: h[suivant].cible, depuis: new Date(), role };
      } else {
        await query('update coach_focus set valides = $2 where puuid = $1', [compte.puuid, JSON.stringify(valides)]);
        focus = null;
      }
    }
  } else {
    const cle = choisirFocus(h);
    if (cle) {
      await query(
        `insert into coach_focus (puuid, cle, role, cible) values ($1, $2, $3, $4)
         on conflict (puuid) do update set cle = $2, role = $3, cible = $4, depuis = now()`,
        [compte.puuid, cle, role, h[cle].cible],
      );
      focus = { cle, cible: h[cle].cible, depuis: new Date(), role };
    }
  }

  const f = focus && h[focus.cle] ? (() => {
    const cle = focus.cle;
    const cible = Number(focus.cible);
    const suivi = parties.filter((p) => p.valeurs[cle] != null).slice(0, 15).reverse()
      .map((p) => ({ matchId: p.match_id, t: Number(p.game_start), valeur: p.valeurs[cle], tenu: tenu(cle, p.valeurs[cle], cible), win: p.win }));
    let serie = 0;
    for (const s of [...suivi].reverse()) { if (!s.tenu) break; serie++; }
    return {
      cle, ...FICHES[cle], unite: undefined, sens: MESURES[cle].sens,
      objectif: FICHES[cle].unite(cible), cible, valeur: h[cle].valeur, valeurTexte: FICHES[cle].unite(h[cle].valeur),
      souvent: h[cle].souvent, parties: h[cle].parties, depuis: new Date(focus.depuis).getTime(), suivi, serie,
    };
  })() : null;

  const autres = Object.entries(h)
    .filter(([m, x]) => m !== f?.cle && x.position >= 0.55)
    .sort((a, b) => b[1].position - a[1].position).slice(0, 3)
    .map(([m, x]) => ({ cle: m, titre: FICHES[m].titre, valeur: FICHES[m].unite(x.valeur), cible: FICHES[m].unite(x.cible), mieuxQue: 1 - x.position }));
  const forts = Object.entries(h)
    .filter(([, x]) => x.position <= 0.3)
    .sort((a, b) => a[1].position - b[1].position).slice(0, 3)
    .map(([m, x]) => ({ cle: m, titre: FICHES[m].titre, valeur: FICHES[m].unite(x.valeur), mieuxQue: 1 - x.position }));

  return {
    pret: true, role, parties: parties.length, groupe: { palier: groupe, nom: NOMS_PALIERS[groupe] },
    focus: f, valide, autres, forts,
    parMatch: f ? Object.fromEntries(f.suivi.map((s) => [s.matchId, s.tenu])) : {},
  };
}
