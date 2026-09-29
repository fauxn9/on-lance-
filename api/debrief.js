// Le debrief d'après-partie (brique 7).
//
// Même méthode que le coach Valorant (docs/bareme-coach.md de l'ancien
// projet) : on ne juge jamais une valeur dans l'absolu, mais sa place parmi
// les joueurs du même rang au même poste. `position` : 0 = meilleur que tous,
// 1 = pire que tous. Un constat n'existe que si le groupe compte assez de
// pairs et si la position dépasse la médiane (être dans la moitié haute de
// son rang n'est pas un reproche). Les faits propres à la partie (fenêtre où
// tu perds des CS, mort juste avant un baron adverse) ont leur propre
// gravité. Les trois plus graves sortent, plus un point fort s'il y en a un.
//
// Les règles trouvent les faits ; l'IA ne fait que les mettre en mots, avec
// un quota. Sans quota ou sans clé, les phrases des règles restent.

import { query } from './db.js';
import { enregistrerMesures } from './coach.js';
import { ecrireConseils } from './ia.js';
import { MESURES, evenements, mesurer, monstreDe, mortsDe, palierDe, situer } from './stats/reperes.js';
import { nomsChampions, patchCourant } from './stats/items.js';

export const VERSION = 1;
const MIN_PAIRS = 200;

export const NOMS_PALIERS = {
  IRON: 'Fer', BRONZE: 'Bronze', SILVER: 'Argent', GOLD: 'Or', PLATINUM: 'Platine',
  EMERALD: 'Émeraude', DIAMOND: 'Diamant', 'MASTER+': 'Maître+', TOUS: 'tous rangs',
};
const NOMS_POSTES = { TOP: 'top', JUNGLE: 'junglers', MIDDLE: 'mid', BOTTOM: 'ADC', UTILITY: 'supports' };
const NOMS_MONSTRES = { dragon: 'un dragon', ancien: 'le dragon ancien', baron: 'le baron', heraut: 'le héraut', larves: 'les larves', atakhan: 'Atakhan', monstre: 'un monstre épique', tour: 'une tourelle' };

const mmss = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
const minute = (ms) => Math.round(ms / 60000);
const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const pct = (x) => `${Math.round(x * 100)} %`;

// Comment dire chaque mesure, pour le constat comme pour le point fort.
const FORMAT = {
  cs10: (v) => `${Math.round(v)} CS à 10 min`,
  csm: (v) => `${nf.format(v)} CS/min`,
  or15: (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v))} PO sur ton adversaire à 15 min`,
  morts: (v) => `${nf.format(v)} morts par 30 min`,
  kp: (v) => `${pct(v)} de participation aux kills`,
  vision: (v) => `${nf.format(v)} de vision par minute`,
  degats: (v) => `${pct(v)} des dégâts de ton équipe`,
  objectifs: (v) => `présent sur ${pct(v)} des objectifs de ton équipe`,
  isoles: (v) => `${pct(v)} de tes morts sans allié à portée`,
};

// La même valeur en version courte, pour citer la médiane du groupe.
const COURT = {
  cs10: (v) => `${Math.round(v)} CS`,
  csm: (v) => `${nf.format(v)} CS/min`,
  or15: (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v))} PO`,
  morts: (v) => nf.format(v),
  kp: pct, vision: (v) => nf.format(v), degats: pct, objectifs: pct, isoles: pct,
};
const majuscule = (t) => t[0].toUpperCase() + t.slice(1);

// ---------------------------------------------------------------- repères

async function patchs() {
  const p = await patchCourant();
  const [a, b] = p.split('.').map(Number);
  return [p, `${a}.${b - 1}`];
}

// Histogrammes des mesures pour un poste, dans un palier et dans « TOUS ».
export async function histogrammes(role, palier) {
  const kinds = Object.keys(MESURES).flatMap((m) => [`m:${m}:${palier}`, `m:${m}:TOUS`]);
  const { rows } = await query(
    `select kind, key, sum(games)::int as games from stats
      where patch = any($1) and queue = 420 and champion_id = 0 and role = $2 and kind = any($3)
      group by kind, key`,
    [await patchs(), role, kinds],
  );
  const h = {};
  for (const r of rows) (h[r.kind] ??= []).push({ tranche: Number(r.key), games: r.games });
  return h;
}

// Le palier du joueur : son rang en Solo/Duo, sinon en Flex, sinon aucun.
export async function palierDuJoueur(puuid) {
  const { rows } = await query(
    `select distinct on (queue) queue, tier from rank_snapshots where puuid = $1 order by queue, taken_at desc`,
    [puuid],
  );
  const solo = rows.find((r) => r.queue === 'RANKED_SOLO_5x5');
  const flex = rows.find((r) => r.queue === 'RANKED_FLEX_SR');
  return palierDe((solo ?? flex)?.tier) ?? null;
}

// ---------------------------------------------------------------- la partie

// Écarts avec l'adversaire direct, minute par minute.
export function courbes(timeline, pid, face) {
  const frames = timeline?.info?.frames ?? [];
  const val = (f, id, k) => {
    const x = f.participantFrames?.[id];
    if (!x) return 0;
    return k === 'cs' ? (x.minionsKilled ?? 0) + (x.jungleMinionsKilled ?? 0) : k === 'or' ? x.totalGold ?? 0 : x.xp ?? 0;
  };
  const serie = (k) => frames.map((f) => val(f, pid, k) - (face ? val(f, face, k) : 0));
  const cs = frames.map((f) => val(f, pid, 'cs'));
  const csFace = face ? frames.map((f) => val(f, face, 'cs')) : null;
  return { or: serie('or'), xp: serie('xp'), cs: serie('cs'), csMoi: cs, csFace };
}

// La fenêtre (3 à 8 min) où tu perds le plus de CS sur ton adversaire direct.
export function fenetreCs(csMoi, csFace) {
  if (!csFace) return null;
  let pire = null;
  const fin = Math.min(csMoi.length - 1, 30);
  for (let a = 2; a < fin; a++) {
    for (let b = a + 3; b <= Math.min(fin, a + 8); b++) {
      const moi = csMoi[b] - csMoi[a];
      const lui = csFace[b] - csFace[a];
      const perdu = lui - moi;
      // À perte égale, la fenêtre la plus courte est la plus parlante.
      if (!pire || perdu > pire.perdu || (perdu === pire.perdu && b - a < pire.a - pire.de)) pire = { de: a, a: b, moi, lui, perdu };
    }
  }
  return pire && pire.perdu > 0 ? pire : null;
}

// Tous les constats possibles, chacun avec sa gravité. `ton` : r (à
// corriger) ou v (point fort).
export function constats({ role, situations, fenetre, morts, faceNom, palierNom }) {
  const out = [];
  const poste = NOMS_POSTES[role] ?? '';
  const groupe = palierNom === 'tous rangs' ? `${poste} tous rangs confondus` : `${palierNom} ${poste}`.trim();
  for (const [m, s] of Object.entries(situations)) {
    if (!s || s.n < MIN_PAIRS) continue;
    const texteVal = FORMAT[m](s.valeur);
    if (s.position > 0.5) {
      const med = s.mediane != null ? ` ; la médiane des ${groupe} est à ${COURT[m](s.mediane)}` : '';
      out.push({
        cle: m, ton: 'r', gravite: s.position,
        texte: `${majuscule(texteVal)}${med}.`,
        donnees: { mesure: m, valeur: s.valeur, mediane: s.mediane, mieuxQue: 1 - s.position },
      });
    } else if (s.position <= 0.2) {
      out.push({
        cle: m, ton: 'v', gravite: 1 - s.position,
        texte: `Point fort : ${texteVal}, mieux que ${pct(1 - s.position)} des ${groupe}.`,
        donnees: { mesure: m, valeur: s.valeur, mediane: s.mediane, mieuxQue: 1 - s.position },
      });
    }
  }
  if (fenetre && fenetre.perdu >= 10) {
    out.push({
      cle: 'fenetre_cs', ton: 'r', gravite: fenetre.perdu >= 20 ? 0.9 : 0.72,
      texte: `Tu perds ${fenetre.perdu} CS sur ${faceNom} entre ${fenetre.de} et ${fenetre.a} min (${fenetre.moi} contre ${fenetre.lui}).`,
      donnees: fenetre,
    });
  }
  const couteuse = morts.find((m) => m.apres && m.apres !== 'tour' && ['baron', 'ancien', 'dragon', 'heraut', 'atakhan'].includes(m.apres));
  if (couteuse) {
    out.push({
      cle: 'mort_objectif', ton: 'r', gravite: ['baron', 'ancien'].includes(couteuse.apres) ? 0.95 : 0.8,
      texte: `Ta mort à ${mmss(couteuse.t)} a ouvert ${NOMS_MONSTRES[couteuse.apres]} à l'équipe adverse.`,
      donnees: { t: couteuse.t, apres: couteuse.apres, isole: couteuse.isole },
    });
  }
  const isolees = morts.filter((m) => m.isole);
  if (isolees.length >= 2 && isolees.length / morts.length >= 0.5) {
    out.push({
      cle: 'morts_isolees', ton: 'r', gravite: isolees.length >= 3 ? 0.85 : 0.66,
      texte: `${isolees.length} de tes ${morts.length} morts sont arrivées sans allié à portée (${isolees.map((m) => mmss(m.t)).join(', ')}).`,
      donnees: { n: isolees.length, total: morts.length, temps: isolees.map((m) => m.t) },
    });
  }
  // Une même mesure ne sort qu'une fois (le constat de la partie prime).
  return out;
}

// Un seul constat par thème : « 52 CS à 10 min » et « tu perds 24 CS entre
// 8 et 12 min » disent la même chose.
const THEMES = { cs10: 'cs', csm: 'cs', fenetre_cs: 'cs', isoles: 'isolement', morts_isolees: 'isolement' };
const FAITS_DE_PARTIE = new Set(['fenetre_cs', 'mort_objectif', 'morts_isolees']);

// Les trois à retenir : les deux plus graves à corriger, plus le meilleur
// point fort ; trois à corriger s'il n'y a pas de point fort. À gravité
// égale, le fait précis de la partie passe devant la statistique.
export function choisir(liste) {
  const ordre = (a, b) => b.gravite - a.gravite || FAITS_DE_PARTIE.has(b.cle) - FAITS_DE_PARTIE.has(a.cle);
  const vus = new Set();
  const unParTheme = (c) => {
    const t = `${c.ton}:${THEMES[c.cle] ?? c.cle}`;
    if (vus.has(t)) return false;
    vus.add(t);
    return true;
  };
  const aCorriger = liste.filter((c) => c.ton === 'r').sort(ordre).filter(unParTheme);
  const forts = liste.filter((c) => c.ton === 'v').sort(ordre).filter(unParTheme);
  if (forts.length && aCorriger.length >= 2) return [...aCorriger.slice(0, 2), forts[0]];
  return [...aCorriger, ...forts].slice(0, 3);
}

// ---------------------------------------------------------------- tout

export async function analyser({ match, timeline, puuid, palier, lireHisto = histogrammes, noms = {} }) {
  const info = match.info;
  const me = info.participants.find((p) => p.puuid === puuid);
  if (!me) return null;
  const pid = me.participantId;
  const role = me.teamPosition || null;
  const face = role ? info.participants.find((p) => p.teamId !== me.teamId && p.teamPosition === role) : null;
  const mes = mesurer(match, timeline).get(pid);
  const remake = Boolean(me.gameEndedInEarlySurrender);

  // Repères : le palier du joueur s'il a assez de pairs, sinon tous rangs.
  let situations = {};
  let groupe = null;
  if (role && mes && !remake && [420, 440, 400, 430, 490].includes(info.queueId)) {
    const h = await lireHisto(role, palier ?? 'TOUS');
    const nPalier = (m) => (h[`m:${m}:${palier}`] ?? []).reduce((s, x) => s + x.games, 0);
    const assez = palier && Object.keys(MESURES).some((m) => nPalier(m) >= MIN_PAIRS);
    groupe = assez ? palier : 'TOUS';
    for (const [m, v] of Object.entries(mes.valeurs)) {
      if (MESURES[m].postes && !MESURES[m].postes.includes(role)) continue;
      const s = situer(m, v, h[`m:${m}:${groupe}`] ?? []);
      if (s) situations[m] = { ...s, valeur: v };
    }
  }

  const c = courbes(timeline, pid, face?.participantId);
  const fenetre = role && !['JUNGLE', 'UTILITY'].includes(role) ? fenetreCs(c.csMoi, c.csFace) : null;
  const morts = mortsDe(match, timeline, pid);
  const ev = evenements(timeline);
  const epiques = ev.filter((e) => e.type === 'ELITE_MONSTER_KILL');
  const nosObjectifs = epiques.filter((e) => e.killerTeamId === me.teamId);

  const tous = remake ? [] : constats({
    role, situations, fenetre, morts, faceNom: face ? noms[face.championId] ?? face.championName : 'ton adversaire',
    palierNom: NOMS_PALIERS[groupe] ?? 'tous rangs',
  });
  const retenir = choisir(tous);
  const minutes = info.gameDuration / 60;
  const tuesEquipe = info.participants.filter((p) => p.teamId === me.teamId).reduce((s, p) => s + (p.kills ?? 0), 0);

  return {
    version: VERSION,
    matchId: match.metadata.matchId, queue: info.queueId, debut: info.gameStartTimestamp ?? info.gameCreation,
    duree: info.gameDuration, win: Boolean(me.win), remake,
    moi: {
      championId: me.championId, championName: noms[me.championId] ?? me.championName, role, niveau: me.champLevel,
      kills: me.kills, deaths: me.deaths, assists: me.assists,
      cs: (me.totalMinionsKilled ?? 0) + (me.neutralMinionsKilled ?? 0), csm: mes?.valeurs.csm ?? 0,
      degats: me.totalDamageDealtToChampions ?? 0, vision: me.visionScore ?? 0, or: me.goldEarned ?? 0,
      kp: me.challenges?.killParticipation ?? (tuesEquipe ? (me.kills + me.assists) / tuesEquipe : 0),
      items: [me.item0, me.item1, me.item2, me.item3, me.item4, me.item5, me.item6],
      sorts: [me.summoner1Id, me.summoner2Id], cle: me.perks?.styles?.[0]?.selections?.[0]?.perk ?? null,
    },
    face: face ? { championId: face.championId, championName: noms[face.championId] ?? face.championName, kills: face.kills, deaths: face.deaths, assists: face.assists } : null,
    groupe: groupe ? { palier: groupe, nom: NOMS_PALIERS[groupe], poste: role, propre: groupe === palier } : null,
    mesures: Object.entries(situations).map(([cle, s]) => ({ cle, valeur: s.valeur, mediane: s.mediane, mieuxQue: 1 - s.position, n: s.n })),
    courbes: { or: c.or, xp: c.xp, cs: c.cs },
    morts,
    objectifs: {
      equipe: nosObjectifs.length,
      moi: nosObjectifs.filter((e) => e.killerId === pid || e.assistingParticipantIds?.includes(pid)).length,
      liste: epiques.map((e) => ({ t: e.timestamp, genre: monstreDe(e), nous: e.killerTeamId === me.teamId })),
    },
    retenir: retenir.map((r) => ({ cle: r.cle, ton: r.ton, texte: r.texte })),
    faits: retenir,
    ia: false,
    minutes,
  };
}

// Debrief d'une partie pour un compte : en cache s'il existe, sinon calculé
// (2 appels Riot), mis en mots par l'IA si le quota le permet, et gardé. Un
// debrief fait avant que les repères de son rang existent est refait au bout
// de 6 h : la comparaison a pu apparaître entre-temps.
export async function debrief(riot, compte, matchId) {
  const { rows } = await query(
    `select data, created_at < now() - interval '6 hours' as ancien from debriefs
      where match_id = $1 and puuid = $2 and version = $3`,
    [matchId, compte.puuid, VERSION],
  );
  const c = rows[0];
  if (c && !(c.ancien && c.data.groupe && !c.data.mesures?.length)) return c.data;

  const [match, timeline] = await Promise.all([riot.match(compte.platform, matchId), riot.timeline(compte.platform, matchId)]);
  if (!match || !timeline) return null;
  const palier = await palierDuJoueur(compte.puuid);
  const d = await analyser({ match, timeline, puuid: compte.puuid, palier, noms: await nomsChampions() });
  if (!d) return null;
  // Les mesures de la partie servent aussi au coach (habitudes sur 20 parties) :
  // enregistrées avant de répondre, pour que le coach relu juste après les voie.
  await enregistrerMesures(compte.puuid, match, timeline).catch((err) => console.error('coach :', err.message));

  const { rows: lp } = await query('select delta from lp_changes where puuid = $1 and match_id = $2', [compte.puuid, matchId]);
  d.lp = lp[0]?.delta ?? null;

  if (d.faits.length && (await quotaIa(compte.puuid))) {
    const textes = await ecrireConseils(d).catch((err) => {
      console.error('debrief, mise en mots :', err.message);
      return null;
    });
    if (textes?.length === d.retenir.length) {
      d.retenir = d.retenir.map((r, i) => ({ ...r, texte: textes[i] }));
      d.ia = true;
    }
  }
  delete d.faits;

  await query(
    `insert into debriefs (match_id, puuid, version, ia, data) values ($1, $2, $3, $4, $5)
     on conflict (match_id, puuid) do update set version = $3, ia = $4, data = $5, created_at = now()`,
    [matchId, compte.puuid, VERSION, d.ia, d],
  );
  return d;
}

// Quota de mise en mots : par compte et pour tout le serveur, par 24 h.
async function quotaIa(puuid) {
  if (!process.env.ANTHROPIC_API_KEY) return false;
  const parJour = Number(process.env.DEBRIEF_IA_JOUR) || 200;
  const parCompte = Number(process.env.DEBRIEF_IA_COMPTE) || 15;
  const { rows } = await query(
    `select count(*)::int as tous, count(*) filter (where puuid = $1)::int as moi
       from debriefs where ia and created_at > now() - interval '1 day'`,
    [puuid],
  );
  return rows[0].tous < parJour && rows[0].moi < parCompte;
}
