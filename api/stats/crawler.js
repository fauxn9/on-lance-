// Le collecteur : parties classées Émeraude+ → compteurs dans `stats`.
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
import { itemsDuPatch, patchCourant } from './items.js';

const PALIERS = ['EMERALD', 'DIAMOND'];
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

// Remplit la liste des joueurs suivis à partir des classements.
export async function semer(riot, platform, { pages = 2 } = {}) {
  const liste = [];
  for (const ligue of APEX) {
    const l = await riot.apex(platform, ligue, LOW);
    for (const e of l?.entries ?? []) if (e.puuid) liste.push({ puuid: e.puuid, tier: l.tier });
  }
  for (const tier of PALIERS) {
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

// Écrit les compteurs d'une partie en un seul aller-retour.
export async function ecrire({ patch, queue, lignes }) {
  const toutes = regrouper([...lignes, { champion_id: 0, role: '*', kind: 'matches', key: '', games: 1, wins: 0 }]);
  for (let i = 0; i < toutes.length; i += 150) {
    const lot = toutes.slice(i, i + 150);
    const params = [];
    const valeurs = lot.map((l, k) => {
      params.push(patch, queue, l.champion_id, l.role, l.kind, l.key, l.games, l.wins);
      const b = 8 * k;
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8})`;
    });
    await query(
      `insert into stats (patch, queue, champion_id, role, kind, key, games, wins) values ${valeurs.join(', ')}
       on conflict (patch, queue, champion_id, role, kind, key)
       do update set games = stats.games + excluded.games, wins = stats.wins + excluded.wins`,
      params,
    );
  }
}

const marquer = (id, patch, queue) =>
  query('insert into crawl_matches (match_id, patch, queue) values ($1, $2, $3) on conflict do nothing', [id, patch, queue]);

// Une étape : un joueur, ses dernières parties, celles du patch en cours.
// Renvoie le nombre de parties analysées.
export async function etape(riot, platform, patch) {
  const { rows } = await query(
    'select puuid from crawl_players where platform = $1 order by last_crawled_at nulls first limit 1',
    [platform],
  );
  if (!rows[0]) {
    await semer(riot, platform);
    return 0;
  }
  const { puuid } = rows[0];
  await query('update crawl_players set last_crawled_at = now() where puuid = $1', [puuid]);

  // Surtout de la classée ; une fois sur cinq, de l'ARAM pour les builds ARAM.
  const queue = Math.random() < 0.2 ? 450 : 420;
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
    const res = tl && extraire(m, tl, await itemsDuPatch(p));
    if (res) {
      await ecrire(res);
      analysees++;
    }
    await marquer(id, p, m.info.queueId);
  }
  return analysees;
}

// On ne garde que le patch en cours et le précédent.
export async function purger(patch) {
  const [maj, min] = patch.split('.').map(Number);
  const precedent = `${maj}.${min - 1}`;
  await query('delete from stats where patch not in ($1, $2)', [patch, precedent]);
  await query("delete from crawl_matches where crawled_at < now() - interval '30 days'");
}

let enMarche = false;
export function lancerCollecte(riot, { platform = 'euw1', journal = console.log } = {}) {
  if (enMarche || !riot.configured) return;
  enMarche = true;
  (async () => {
    let patch = await patchCourant();
    await purger(patch);
    let total = 0, depuis = Date.now(), tours = 0;
    for (;;) {
      try {
        total += await etape(riot, platform, patch);
        // Toutes les 200 étapes : nouveau patch ? nouveaux joueurs ?
        if (++tours % 200 === 0) {
          const p = await patchCourant();
          if (p !== patch) { patch = p; await purger(patch); }
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
