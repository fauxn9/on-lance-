// Le collecteur : parties classées Émeraude+ → compteurs dans `stats`.
//
// Il mesure aussi les 10 joueurs de chaque partie classée pour les repères
// par rang du debrief (brique 7, `reperes.js`). Pour que ces repères couvrent
// tous les rangs, une étape sur quatre part d'un joueur Fer à Platine : ces
// parties-là ne servent qu'aux repères, jamais aux builds (qui restent
// Émeraude+).
//
// Il tourne en fond, en priorité basse sur le limiteur de l'API Riot : les
// demandes des utilisateurs passent toujours devant. Une partie = 2 appels
// (partie + chronologie). Avec une clé personnelle (100 appels / 2 min), ça
// fait ~25 000 parties par jour ; avec une clé de production, bien plus, sans
// rien changer ici.
//
//   npm run collecte          # en local, jusqu'à Ctrl+C
//   COLLECTE=on npm run api   # dans le serveur, en fond

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from '../db.js';
import { extraire, patchDe, regrouper } from './extract.js';
import { itemsDuPatch, patchCourant, patchsRecents } from './items.js';
import { lignesReperes, mesurer, palierDe } from './reperes.js';

const PALIERS = ['EMERALD', 'DIAMOND'];
const PALIERS_BAS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM'];
const PART_BAS = 0.25;

// D'où partir : un palier tiré au sort (avec ces poids), puis un joueur de ce
// palier. Sans ça, la collecte épuise les joueurs dans l'ordre où ils ont été
// ajoutés (10 000 Maîtres avant le premier Émeraude, tous les Fer avant le
// premier Bronze), et les repères comme les builds penchent d'un côté.
const POIDS_HAUT = { EMERALD: 0.35, DIAMOND: 0.35, MASTER: 0.15, GRANDMASTER: 0.08, CHALLENGER: 0.07 };
const POIDS_BAS = { IRON: 0.2, BRONZE: 0.2, SILVER: 0.2, GOLD: 0.2, PLATINUM: 0.2 };
export function tirerPalier(poids, alea = Math.random()) {
  let cumul = 0;
  for (const [tier, p] of Object.entries(poids)) {
    cumul += p;
    if (alea < cumul) return tier;
  }
  return Object.keys(poids).at(-1);
}
const DIVISIONS = ['I', 'II', 'III', 'IV'];
const APEX = ['challengerleagues', 'grandmasterleagues', 'masterleagues'];
const LOW = { priority: 'low' };

async function ajouterJoueurs(platform, liste) {
  for (let i = 0; i < liste.length; i += 500) {
    const lot = liste.slice(i, i + 500);
    const params = [];
    const valeurs = lot.map((j, k) => {
      params.push(j.puuid, platform, j.tier);
      return `($${3 * k + 1}, $${3 * k + 2}, $${3 * k + 3})`;
    });
    await query(`insert into crawl_players (puuid, platform, tier) values ${valeurs.join(', ')} on conflict (puuid) do nothing`, params);
  }
}

// Remplit la liste des joueurs suivis à partir des classements. `bas` :
// les paliers Fer à Platine (une page par division suffit aux repères).
export async function semer(riot, platform, { pages = 2, bas = false } = {}) {
  const liste = [];
  if (bas) pages = 1;
  for (const ligue of bas ? [] : APEX) {
    const l = await riot.apex(platform, ligue, LOW);
    for (const e of l?.entries ?? []) if (e.puuid) liste.push({ puuid: e.puuid, tier: l.tier });
  }
  for (const tier of bas ? PALIERS_BAS : PALIERS) {
    for (const div of DIVISIONS) {
      for (let page = 1; page <= pages; page++) {
        const entrees = (await riot.division(platform, tier, div, page, LOW)) ?? [];
        for (const e of entrees) if (e.puuid) liste.push({ puuid: e.puuid, tier });
        if (entrees.length < 200) break;
      }
    }
  }
  await ajouterJoueurs(platform, liste);
  return liste.length;
}

// Écrit les compteurs d'une partie en un seul aller-retour. `compter` : la
// partie entre dans le total des parties analysées pour les builds.
export async function ecrire({ patch, queue, lignes }, { compter = true } = {}) {
  const extra = compter ? [{ champion_id: 0, role: '*', kind: 'matches', key: '', games: 1, wins: 0 }] : [];
  const toutes = regrouper([...lignes, ...extra]);
  for (let i = 0; i < toutes.length; i += 150) {
    const lot = toutes.slice(i, i + 150);
    const params = [];
    const valeurs = lot.map((l, k) => {
      params.push(patch, queue, l.champion_id, l.role, l.kind, l.key, l.games, l.wins, Math.round(l.somme ?? 0));
      const b = 9 * k;
      return `(${b + 1}, ${b + 2}, ${b + 3}, ${b + 4}, ${b + 5}, ${b + 6}, ${b + 7}, ${b + 8}, ${b + 9})`;
    });
    await query(
      `insert into stats (patch, queue, champion_id, role, kind, key, games, wins, somme) values ${valeurs.join(', ')}
       on conflict (patch, queue, champion_id, role, kind, key)
       do update set games = stats.games + excluded.games, wins = stats.wins + excluded.wins, somme = stats.somme + excluded.somme`,
      params,
    );
  }
}

const marquer = (id, patch, queue) =>
  query('insert into crawl_matches (match_id, patch, queue) values ($1, $2, $3) on conflict do nothing', [id, patch, queue]);

// Une étape : un joueur, ses dernières parties, celles du patch en cours.
// Renvoie le nombre de parties analysées.
export async function etape(riot, platform, patch, { bas = Math.random() < PART_BAS } = {}) {
  const tirage = tirerPalier(bas ? POIDS_BAS : POIDS_HAUT);
  let { rows } = await query(
    'select puuid, tier from crawl_players where platform = $1 and tier = $2 order by last_crawled_at nulls first, random() limit 1',
    [platform, tirage],
  );
  if (!rows[0]) {
    // Palier pas encore semé : n'importe quel joueur du même côté de l'échelle.
    ({ rows } = await query(
      `select puuid, tier from crawl_players where platform = $1 and (tier = any($2)) = $3
        order by last_crawled_at nulls first, random() limit 1`,
      [platform, PALIERS_BAS, bas],
    ));
  }
  if (!rows[0]) {
    await semer(riot, platform, { bas });
    return 0;
  }
  const { puuid, tier } = rows[0];
  const palier = palierDe(tier);
  await query('update crawl_players set last_crawled_at = now() where puuid = $1', [puuid]);

  // Surtout de la classée ; une fois sur cinq, de l'ARAM pour les builds ARAM
  // (jamais en bas de l'échelle : ces parties-là ne servent qu'aux repères).
  const queue = !bas && Math.random() < 0.2 ? 450 : 420;
  let ids;
  try {
    ids = (await riot.matchIds(platform, puuid, { count: 10, queue }, LOW)) ?? [];
  } catch (err) {
    // 400 : identifiant chiffré avec une autre clé Riot (ils changent à chaque
    // clé). Le joueur est oublié ; la liste se reconstruit au prochain semis.
    if (err.status === 400) {
      await query('delete from crawl_players where puuid = $1', [puuid]);
      return 0;
    }
    throw err;
  }
  if (!ids.length) return 0;
  const { rows: deja } = await query('select match_id from crawl_matches where match_id = any($1)', [ids]);
  const vus = new Set(deja.map((r) => r.match_id));

  let analysees = 0;
  for (const id of ids) {
    if (vus.has(id)) continue;
    const m = await riot.match(platform, id, LOW);
    const p = patchDe(m?.info?.gameVersion);
    // Parties d'un ancien patch : on les note pour ne plus les demander, et on
    // passe au joueur suivant (les suivantes sont encore plus vieilles).
    if (!m || p !== patch) {
      await marquer(id, p || null, m?.info?.queueId ?? null);
      if (m && p !== patch) break;
      continue;
    }
    const tl = await riot.timeline(platform, id, LOW);
    if (tl) {
      const reperes = m.info.queueId === 420 ? lignesReperes(mesurer(m, tl), palier) : [];
      const res = bas ? null : extraire(m, tl, await itemsDuPatch(p));
      if (res) {
        await ecrire({ ...res, lignes: [...res.lignes, ...reperes] });
        analysees++;
      } else if (reperes.length) {
        await ecrire({ patch: p, queue: 420, lignes: reperes }, { compter: false });
      }
    }
    await marquer(id, p, m.info.queueId);
  }
  return analysees;
}

// On garde les 3 derniers patchs (l'app propose « patch actuel » ou « 3 derniers »).
export async function purger() {
  await query('delete from stats where patch <> all($1)', [await patchsRecents(3)]);
  await query("delete from crawl_matches where crawled_at < now() - interval '30 days'");
}

let enMarche = false;
export function lancerCollecte(riot, { platform = 'euw1', journal = console.log } = {}) {
  if (enMarche || !riot.configured) return;
  enMarche = true;
  (async () => {
    let patch = await patchCourant();
    await purger();
    let total = 0, depuis = Date.now(), tours = 0;
    for (;;) {
      try {
        total += await etape(riot, platform, patch);
        // Toutes les 200 étapes : nouveau patch ? nouveaux joueurs ?
        if (++tours % 200 === 0) {
          const p = await patchCourant();
          if (p !== patch) { patch = p; await purger(); }
          const { rows } = await query(
            "select count(*)::int as n from crawl_players where platform = $1 and (last_crawled_at is null or last_crawled_at < now() - interval '6 hours')",
            [platform],
          );
          if (rows[0].n === 0) await semer(riot, platform);
        }
        if (Date.now() - depuis > 60_000) {
          journal(`collecte ${platform} ${patch} : ${total} parties analysées`);
          depuis = Date.now();
        }
      } catch (err) {
        journal(`collecte : ${err.message} — nouvel essai dans 30 s`);
        await new Promise((r) => setTimeout(r, 30_000));
      }
    }
  })();
}

// Lancement en ligne de commande : `npm run collecte`.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const env = fileURLToPath(new URL('../../.env', import.meta.url));
  if (existsSync(env)) process.loadEnvFile(env);
  const { RiotApi } = await import('../riot.js');
  const riot = new RiotApi();
  if (!riot.configured) {
    console.error('RIOT_API_KEY manquant dans .env');
    process.exit(1);
  }
  console.log('Collecte lancée (Ctrl+C pour arrêter)…');
  lancerCollecte(riot, { platform: process.env.COLLECTE_PLATFORM || 'euw1' });
}
