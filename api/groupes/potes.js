// Entre potes (brique 8) : profils, groupes, classement de la semaine, fil
// des potes, chambrage de fin de partie et couronne du lundi.

import crypto from 'node:crypto';
import { query } from '../db.js';
import { ladder } from '../rangs.js';
import { infosChampions } from '../stats/items.js';
import { ecrireChambrage } from './chambrage.js';
import { posterDiscord } from './discord.js';
import { ieme } from './chambrage.js';
import { bornes, classer, debutDeSemaine, decalerSemaine, nomSemaine, vainqueur } from './semaine.js';

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const FILES_CLASSEES = { 420: 'RANKED_SOLO_5x5', 440: 'RANKED_FLEX_SR' };
const NOMS_FILES = { 420: 'Solo/Duo', 440: 'Flex' };
export const REACTIONS = ['gg', 'aie', 'cheh'];
const MAX_MEMBRES = 50;

// ---------------------------------------------------------------- profils

// Le profil d'un compte. `installation` : l'identifiant (secret) de
// l'installation de l'app ; tous les comptes reliés depuis la même
// installation rejoignent le même profil.
export async function assurerProfil(puuid, installation = null) {
  const h = installation ? sha256(installation) : null;
  const { rows: [a] } = await query('select profil_id, game_name from accounts where puuid = $1', [puuid]);
  if (!a) return null;
  let profil = a.profil_id == null ? null : Number(a.profil_id);
  if (!profil && h) profil = (await query('select id::int as id from profils where installation = $1', [h])).rows[0]?.id ?? null;
  if (!profil) profil = (await query('insert into profils (pseudo, installation) values ($1, $2) returning id::int as id', [a.game_name, h])).rows[0].id;
  await query('update accounts set profil_id = $2 where puuid = $1 and profil_id is distinct from $2', [puuid, profil]);
  if (h) await query('update profils set installation = $2 where id = $1 and installation is null and not exists (select 1 from profils where installation = $2)', [profil, h]);
  return profil;
}

export async function identite(profil) {
  const { rows: [p] } = await query('select id, pseudo from profils where id = $1', [profil]);
  const { rows: comptes } = await query('select game_name, tag_line, profile_icon_id from accounts where profil_id = $1 order by created_at', [profil]);
  return { id: Number(p.id), pseudo: p.pseudo, comptes: comptes.map((c) => ({ gameName: c.game_name, tagLine: c.tag_line, icone: c.profile_icon_id })) };
}

// ---------------------------------------------------------------- groupes

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans O/0, I/1
const nouveauCode = () => Array.from(crypto.randomBytes(6), (b) => ALPHABET[b % ALPHABET.length]).join('');

export async function creerGroupe(profil, nom) {
  for (let essai = 0; essai < 5; essai++) {
    const { rows } = await query(
      'insert into groupes (nom, code, createur) values ($1, $2, $3) on conflict (code) do nothing returning id',
      [nom, nouveauCode(), profil],
    );
    if (rows[0]) {
      await query('insert into groupe_membres (groupe_id, profil_id) values ($1, $2)', [rows[0].id, profil]);
      return Number(rows[0].id);
    }
  }
  throw new Error('code de groupe introuvable');
}

export async function rejoindre(profil, code) {
  const { rows: [g] } = await query(
    'select g.id, (select count(*)::int from groupe_membres where groupe_id = g.id) as n from groupes g where code = $1',
    [code.toUpperCase().replace(/[^A-Z0-9]/g, '')],
  );
  if (!g) return { erreur: 'Code inconnu.' };
  if (g.n >= MAX_MEMBRES) return { erreur: `Groupe complet (${MAX_MEMBRES} membres).` };
  await query('insert into groupe_membres (groupe_id, profil_id) values ($1, $2) on conflict do nothing', [g.id, profil]);
  return { id: Number(g.id) };
}

export async function quitter(profil, groupe) {
  await query('delete from groupe_membres where groupe_id = $1 and profil_id = $2', [groupe, profil]);
  await query('delete from groupes where id = $1 and not exists (select 1 from groupe_membres where groupe_id = $1)', [groupe]);
}

export async function estMembre(profil, groupe) {
  const { rows } = await query('select 1 from groupe_membres where groupe_id = $1 and profil_id = $2', [groupe, profil]);
  return Boolean(rows[0]);
}

export async function mesGroupes(profil) {
  const { rows } = await query(
    `select g.id, g.nom, g.code, g.chambrage, g.discord_nom, (g.webhook is not null) as discord,
            (select count(*)::int from groupe_membres x where x.groupe_id = g.id) as membres
       from groupes g join groupe_membres m on m.groupe_id = g.id
      where m.profil_id = $1 order by m.joined_at`,
    [profil],
  );
  return rows.map((g) => ({ id: Number(g.id), nom: g.nom, code: g.code, membres: g.membres, chambrage: g.chambrage, discord: g.discord ? { nom: g.discord_nom } : null }));
}

async function membres(groupe) {
  const { rows } = await query(
    `select p.id::int as profil, p.pseudo,
            coalesce(array_agg(a.puuid) filter (where a.puuid is not null), '{}') as comptes,
            (array_agg(a.profile_icon_id order by a.created_at))[1] as icone
       from groupe_membres gm join profils p on p.id = gm.profil_id
       left join accounts a on a.profil_id = p.id
      where gm.groupe_id = $1 group by p.id, p.pseudo`,
    [groupe],
  );
  return rows;
}

// Classement d'une semaine (en cours ou terminée).
export async function classement(groupe, semaine, fuseau) {
  const liste = await membres(groupe);
  const puuids = liste.flatMap((m) => m.comptes);
  const { debut, fin } = bornes(semaine, fuseau);
  const avant = new Map(), pendant = new Map(), parties = new Map();
  if (puuids.length) {
    const [a, p, n] = await Promise.all([
      query(
        `select distinct on (puuid, queue) puuid, queue, tier, division, lp from rank_snapshots
          where puuid = any($1) and taken_at < $2 order by puuid, queue, taken_at desc`,
        [puuids, debut],
      ),
      query(
        `select puuid, queue, tier, division, lp from rank_snapshots
          where puuid = any($1) and taken_at >= $2 and taken_at < $3 order by taken_at`,
        [puuids, debut, fin],
      ),
      query(
        `select puuid, count(*)::int as parties, count(*) filter (where win)::int as victoires from player_matches
          where puuid = any($1) and queue_id in (420, 440) and not remake and game_start >= $2 and game_start < $3
          group by puuid`,
        [puuids, debut.getTime(), fin.getTime()],
      ),
    ]);
    for (const r of a.rows) avant.set(`${r.puuid}:${r.queue}`, r);
    for (const r of p.rows) { const k = `${r.puuid}:${r.queue}`; pendant.set(k, [...(pendant.get(k) ?? []), r]); }
    for (const r of n.rows) parties.set(r.puuid, r);
  }
  const icones = new Map(liste.map((m) => [m.profil, m.icone]));
  return classer(liste, { avant, pendant }, parties).map((l) => ({ ...l, icone: icones.get(l.profil) ?? null }));
}

async function groupe(id) {
  return (await query('select * from groupes where id = $1', [id])).rows[0] ?? null;
}

export async function detail(id, profil) {
  const g = await groupe(id);
  const semaine = debutDeSemaine(new Date(), g.fuseau);
  const [c, hist, f] = await Promise.all([
    classement(id, semaine, g.fuseau),
    query(
      `select s.semaine::text as semaine, s.classement, p.pseudo as gagnant from groupe_semaines s left join profils p on p.id = s.gagnant
        where s.groupe_id = $1 order by s.semaine desc limit 12`,
      [id],
    ),
    fil([id], profil, { limite: 40 }),
  ]);
  return {
    groupe: { id: Number(g.id), nom: g.nom, code: g.code, chambrage: g.chambrage, discord: g.webhook ? { nom: g.discord_nom } : null },
    semaine: { cle: semaine, nom: nomSemaine(semaine), fin: bornes(semaine, g.fuseau).fin.getTime() },
    classement: c,
    moi: Number(profil),
    historique: hist.rows.map((h) => ({ semaine: h.semaine, nom: nomSemaine(h.semaine), gagnant: h.gagnant, lp: h.classement?.[0]?.lp ?? 0 })),
    fil: f,
  };
}

// ---------------------------------------------------------------- fil

export async function fil(groupes, profil, { depuis = 0, limite = 30 } = {}) {
  if (!groupes.length) return [];
  const { rows } = await query(
    `select e.id, e.groupe_id, e.type, e.texte, e.data, e.created_at, e.profil_id, p.pseudo, g.nom as groupe,
            coalesce((select jsonb_object_agg(type, n) from (select type, count(*)::int as n from reactions r where r.evenement_id = e.id group by type) t), '{}') as reactions,
            (select type from reactions r where r.evenement_id = e.id and r.profil_id = $2) as ma_reaction
       from evenements e join groupes g on g.id = e.groupe_id left join profils p on p.id = e.profil_id
      where e.groupe_id = any($1) and e.id > $3 order by e.id desc limit $4`,
    [groupes, profil, depuis, limite],
  );
  return rows.map((e) => ({
    id: Number(e.id), groupeId: Number(e.groupe_id), groupe: e.groupe, type: e.type, texte: e.texte, data: e.data,
    t: new Date(e.created_at).getTime(), pseudo: e.pseudo, profil: Number(e.profil_id), moi: Number(e.profil_id) === Number(profil),
    reactions: e.reactions, maReaction: e.ma_reaction,
  }));
}

export async function reagir(profil, evenement, type) {
  const { rows: [e] } = await query(
    'select e.id from evenements e join groupe_membres m on m.groupe_id = e.groupe_id and m.profil_id = $2 where e.id = $1',
    [evenement, profil],
  );
  if (!e) return false;
  if (type) {
    await query(
      'insert into reactions (evenement_id, profil_id, type) values ($1, $2, $3) on conflict (evenement_id, profil_id) do update set type = $3',
      [evenement, profil, type],
    );
  } else {
    await query('delete from reactions where evenement_id = $1 and profil_id = $2', [evenement, profil]);
  }
  return true;
}

// ---------------------------------------------------------------- chambrage

async function quotaIa() {
  const max = Number(process.env.CHAMBRAGE_IA_JOUR) || 400;
  const { rows } = await query("select count(*)::int as n from evenements where ia and created_at > now() - interval '1 day'");
  return rows[0].n < max;
}

const kdaDe = (p) => `${p.kills}/${p.deaths}/${p.assists}`;

// LP de cette partie : la variation mesurée par l'app si elle existe, sinon
// l'écart entre les deux dernières photos du rang (prises juste avant et
// juste après la synchro qui a trouvé la partie).
async function lpDeLaPartie(puuid, matchId, queue) {
  const { rows: [lc] } = await query('select delta from lp_changes where puuid = $1 and match_id = $2', [puuid, matchId]);
  if (lc) return lc.delta;
  const file = FILES_CLASSEES[queue];
  if (!file) return null;
  const { rows } = await query(
    `select tier, division, lp, taken_at from rank_snapshots where puuid = $1 and queue = $2 order by taken_at desc limit 2`,
    [puuid, file],
  );
  if (rows.length < 2 || Date.now() - new Date(rows[0].taken_at).getTime() > 15 * 60_000) return null;
  const d = ladder(rows[0].tier, rows[0].division, rows[0].lp) - ladder(rows[1].tier, rows[1].division, rows[1].lp);
  return Math.abs(d) <= 100 ? d : null;
}

// Appelé après une synchro qui a trouvé de nouvelles parties : un message par
// groupe pour la plus récente (pas de rafale au premier rattrapage).
export async function apresParties(puuid, nouvelles) {
  const recentes = nouvelles.filter((n) => Date.now() - n.row.game_start < 6 * 3600_000 && !n.row.remake);
  if (!recentes.length) return;
  const { match, row } = recentes.sort((a, b) => b.row.game_start - a.row.game_start)[0];
  const { rows: groupes } = await query(
    `select g.* from groupes g join groupe_membres gm on gm.groupe_id = g.id join accounts a on a.profil_id = gm.profil_id
      where a.puuid = $1`,
    [puuid],
  );
  if (!groupes.length) return;
  const { parCle } = await infosChampions();
  const nom = (id) => parCle[id]?.nom ?? '?';
  const lpPartie = await lpDeLaPartie(puuid, row.match_id, row.queue_id);

  for (const g of groupes) {
    try {
      const liste = await membres(g.id);
      const moi = liste.find((m) => m.comptes.includes(puuid));
      if (!moi) continue;
      // Les potes du groupe dans la même partie.
      const moiP = match.info.participants.find((p) => p.puuid === puuid);
      const potes = [];
      for (const m of liste) {
        if (m.profil === moi.profil) continue;
        const p = match.info.participants.find((x) => m.comptes.includes(x.puuid));
        if (p) potes.push({ pseudo: m.pseudo, champion: nom(p.championId), kda: kdaDe(p), memeEquipe: p.teamId === moiP.teamId, victoire: p.win });
      }
      const classee = Boolean(FILES_CLASSEES[row.queue_id]);
      if (!classee && !potes.length) continue;

      const semaine = debutDeSemaine(new Date(row.game_start), g.fuseau);
      const apres = await classement(g.id, semaine, g.fuseau);
      // Le classement d'avant la partie : les LP de cette partie en moins.
      const avant = apres
        .map((l) => (l.profil === moi.profil ? { ...l, lp: l.lp - (lpPartie ?? 0) } : l))
        .sort((a, b) => b.lp - a.lp || a.parties - b.parties || a.pseudo.localeCompare(b.pseudo, 'fr'))
        .map((l, i) => ({ ...l, place: i + 1 }));
      const ligne = apres.find((l) => l.profil === moi.profil);
      const avantMoi = avant.find((l) => l.profil === moi.profil).place;
      const placeAvant = new Map(avant.map((l) => [l.profil, l.place]));
      const depasses = apres.filter((l) => l.profil !== moi.profil && placeAvant.get(l.profil) < avantMoi && l.place > ligne.place).map((l) => l.pseudo);
      const depassePar = apres.filter((l) => l.profil !== moi.profil && placeAvant.get(l.profil) > avantMoi && l.place < ligne.place).map((l) => l.pseudo);
      const devantL = apres.find((l) => l.place === ligne.place - 1);
      const total = apres.length;

      const f = {
        type: 'partie', pseudo: moi.pseudo, champion: nom(row.champion_id), championId: row.champion_id,
        victoire: row.win, kda: `${row.kills}/${row.deaths}/${row.assists}`, lpPartie, file: NOMS_FILES[row.queue_id] ?? 'partie normale',
        place: ligne.place, total, lpSemaine: ligne.lp, depasses, depassePar, potes,
        devant: devantL ? { pseudo: devantL.pseudo, ecart: devantL.lp - ligne.lp } : null,
        ton: total < 2 ? 'push' : ligne.place === 1 ? 'hype' : ligne.place === total ? 'roast' : 'push',
      };
      const recents = (await query('select texte from evenements where groupe_id = $1 order by id desc limit 6', [g.id])).rows.map((r) => r.texte);
      const { texte, ia } = await ecrireChambrage(f, { recents, ia: await quotaIa() });
      const data = {
        matchId: row.match_id, championId: row.champion_id, victoire: row.win, kda: f.kda, lpPartie, file: f.file,
        avant: avantMoi, place: ligne.place, total, lpSemaine: ligne.lp, depasses, depassePar, potes,
        classement: apres.map((l) => ({ profil: l.profil, pseudo: l.pseudo, lp: l.lp, place: l.place, avant: placeAvant.get(l.profil), icone: l.icone })),
      };
      const { rows: [e] } = await query(
        `insert into evenements (groupe_id, profil_id, type, cle, texte, data, ia) values ($1, $2, 'partie', $3, $4, $5, $6)
         on conflict (groupe_id, cle) do nothing returning id`,
        [g.id, moi.profil, `partie:${row.match_id}`, texte, data, ia],
      );
      if (e && g.chambrage && g.webhook) {
        const icone = parCle[row.champion_id]?.icone;
        await posterDiscord(g, {
          embeds: [{
            author: { name: `${moi.pseudo} · ${f.champion} · ${row.win ? 'victoire' : 'défaite'}${lpPartie != null ? ` ${lpPartie > 0 ? '+' : ''}${lpPartie} LP` : ''}`, ...(icone ? { icon_url: icone } : {}) },
            description: texte,
            color: row.win ? 0xd6ff3f : 0xff4d6a,
            footer: { text: `${ieme(ligne.place)} sur ${total} du groupe · ${ligne.lp > 0 ? '+' : ''}${ligne.lp} LP cette semaine` },
          }],
        });
      }
    } catch (err) {
      console.error(`chambrage (groupe ${g.id}) :`, err.message);
    }
  }
}

// ---------------------------------------------------------------- semaines

// Clôture des semaines terminées : classement final, couronne dans le fil et
// sur Discord. Rejouable sans risque (une semaine n'est close qu'une fois).
export async function cloturerSemaines() {
  const { rows: groupes } = await query('select * from groupes');
  for (const g of groupes) {
    try {
      const semaine = decalerSemaine(debutDeSemaine(new Date(), g.fuseau), -1);
      if (bornes(semaine, g.fuseau).fin < new Date(g.created_at)) continue;
      const { rows: deja } = await query('select 1 from groupe_semaines where groupe_id = $1 and semaine = $2', [g.id, semaine]);
      if (deja[0]) continue;
      const c = await classement(g.id, semaine, g.fuseau);
      const v = vainqueur(c);
      const final = c.map(({ profil, pseudo, lp, parties, victoires, place }) => ({ profil, pseudo, lp, parties, victoires, place }));
      const { rows: [ok] } = await query(
        'insert into groupe_semaines (groupe_id, semaine, gagnant, classement) values ($1, $2, $3, $4) on conflict do nothing returning semaine',
        [g.id, semaine, v?.profil ?? null, JSON.stringify(final)],
      );
      if (!ok || !v) continue;
      const f = { type: 'couronne', pseudo: v.pseudo, lp: v.lp, parties: v.parties, semaine: nomSemaine(semaine), classement: final.slice(0, 8) };
      const { texte, ia } = await ecrireChambrage(f, { ia: await quotaIa() });
      await query(
        `insert into evenements (groupe_id, profil_id, type, cle, texte, data, ia) values ($1, $2, 'couronne', $3, $4, $5, $6)
         on conflict (groupe_id, cle) do nothing`,
        [g.id, v.profil, `semaine:${semaine}`, texte, { semaine, classement: final }, ia],
      );
      if (g.webhook) {
        await posterDiscord(g, {
          embeds: [{
            title: `${v.pseudo} gagne la ${nomSemaine(semaine)}`,
            description: `${texte}\n\n${final.map((l) => `**${l.place}.** ${l.pseudo} · ${l.lp > 0 ? '+' : ''}${l.lp} LP · ${l.victoires}V ${l.parties - l.victoires}D`).join('\n')}`,
            color: 0xffc857,
            footer: { text: 'On lance ? · nouvelle semaine, compteurs à zéro' },
          }],
        });
      }
    } catch (err) {
      console.error(`clôture (groupe ${g.id}) :`, err.message);
    }
  }
}

// ---------------------------------------------------------------- écran de chargement

// Pseudos des potes (tous groupes confondus) par puuid, pour signaler un pote
// dans la même partie.
export async function potesDe(puuid) {
  const { rows } = await query(
    `select distinct a2.puuid, p.pseudo from accounts a
       join groupe_membres gm on gm.profil_id = a.profil_id
       join groupe_membres gm2 on gm2.groupe_id = gm.groupe_id and gm2.profil_id <> a.profil_id
       join profils p on p.id = gm2.profil_id
       join accounts a2 on a2.profil_id = gm2.profil_id
      where a.puuid = $1`,
    [puuid],
  );
  return new Map(rows.map((r) => [r.puuid, r.pseudo]));
}

// Aperçu du chambrage sur ta dernière partie, avec le vrai classement, sans
// rien publier : pour voir le ton avant de lier le salon Discord.
export async function apercu(groupeId, profil) {
  const g = await groupe(groupeId);
  const { rows: [row] } = await query(
    `select pm.* from player_matches pm join accounts a on a.puuid = pm.puuid
      where a.profil_id = $1 and not pm.remake order by pm.game_start desc limit 1`,
    [profil],
  );
  if (!row) return { texte: "joue une game d'abord, là y a rien à chambrer", ia: false };
  const { parCle } = await infosChampions();
  const c = await classement(groupeId, debutDeSemaine(new Date(), g.fuseau), g.fuseau);
  const ligne = c.find((l) => l.profil === profil);
  const devantL = c.find((l) => l.place === ligne.place - 1);
  const f = {
    type: 'partie', pseudo: ligne.pseudo, champion: parCle[row.champion_id]?.nom ?? row.champion_name, victoire: row.win,
    kda: `${row.kills}/${row.deaths}/${row.assists}`, lpPartie: null, file: NOMS_FILES[row.queue_id] ?? 'partie normale',
    place: ligne.place, total: c.length, lpSemaine: ligne.lp, depasses: [], depassePar: [], potes: [],
    devant: devantL ? { pseudo: devantL.pseudo, ecart: devantL.lp - ligne.lp } : null,
    ton: c.length < 2 ? 'push' : ligne.place === 1 ? 'hype' : ligne.place === c.length ? 'roast' : 'push',
  };
  return ecrireChambrage(f, { ia: await quotaIa() });
}
