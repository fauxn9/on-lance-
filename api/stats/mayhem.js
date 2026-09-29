// ARAM Mayhem : Riot ne publie pas ces parties dans son API (403 sur
// match-v5, et absentes des historiques). Le client de chaque joueur, lui,
// les montre dans son historique avec les augments des 10 joueurs. L'app en
// envoie un résumé anonyme (champion, équipe, victoire, augments : aucun
// pseudo), et chaque partie n'est comptée qu'une fois, même si plusieurs
// joueurs de la partie utilisent l'app.

import { query } from '../db.js';
import { ecrire } from './crawler.js';
import { patchDe } from './extract.js';
import { patchsRecents } from './items.js';

export const FILE_MAYHEM = 2400;
const DUREE_MIN = 300; // en dessous, un remake : rien à en tirer
const MAX_PARTIES = 20;

const entier = (v, lo, hi) => Number.isSafeInteger(v) && v >= lo && v <= hi;

// Une partie reçue de l'app, vérifiée et normalisée ; `null` si elle ne tient pas debout.
export function valider(p) {
  if (!p || typeof p !== 'object') return null;
  if (!entier(p.gameId, 1, Number.MAX_SAFE_INTEGER)) return null;
  if (typeof p.plateforme !== 'string' || !/^[A-Z0-9_]{2,6}$/.test(p.plateforme)) return null;
  if (typeof p.version !== 'string' || !/^\d+\.\d+/.test(p.version)) return null;
  if (!entier(p.duree, DUREE_MIN, 7200)) return null;
  if (!Array.isArray(p.joueurs) || p.joueurs.length !== 10) return null;
  const joueurs = [];
  for (const j of p.joueurs) {
    if (!j || !entier(j.championId, 1, 9999) || ![100, 200].includes(j.equipe) || typeof j.victoire !== 'boolean') return null;
    if (!Array.isArray(j.augments) || j.augments.length > 6 || !j.augments.every((a) => entier(a, 1, 99999))) return null;
    joueurs.push({ championId: j.championId, equipe: j.equipe, victoire: j.victoire, augments: [...new Set(j.augments)] });
  }
  // Cinq contre cinq, une seule équipe gagnante.
  const bleus = joueurs.filter((j) => j.equipe === 100);
  if (bleus.length !== 5) return null;
  const gagnants = new Set(joueurs.filter((j) => j.victoire).map((j) => j.equipe));
  if (gagnants.size !== 1) return null;
  return { gameId: p.gameId, plateforme: p.plateforme, patch: patchDe(p.version), joueurs };
}

// Les lignes de stats d'une partie : le champion joué et chacun de ses augments.
export function lignesMayhem(partie) {
  const lignes = [];
  for (const j of partie.joueurs) {
    const base = { champion_id: j.championId, role: 'ARAM', games: 1, wins: j.victoire ? 1 : 0 };
    lignes.push({ ...base, kind: 'champ', key: '' });
    for (const a of j.augments) lignes.push({ ...base, kind: 'augment', key: String(a) });
  }
  return lignes;
}

// Reçoit un lot de parties de l'app : seules les nouvelles, des 3 derniers
// patchs, entrent dans les stats.
export async function recevoir(brutes) {
  const parties = (Array.isArray(brutes) ? brutes.slice(0, MAX_PARTIES) : []).map(valider).filter(Boolean);
  const recents = new Set(await patchsRecents(3));
  let nouvelles = 0;
  for (const p of parties) {
    if (!recents.has(p.patch)) continue;
    const { rowCount } = await query(
      'insert into mayhem_parties (platform, game_id, patch) values ($1, $2, $3) on conflict do nothing',
      [p.plateforme, p.gameId, p.patch],
    );
    if (!rowCount) continue;
    await ecrire({ patch: p.patch, queue: FILE_MAYHEM, lignes: lignesMayhem(p) });
    nouvelles++;
  }
  return { recues: parties.length, nouvelles };
}

// Le catalogue des augments (noms en français, rareté, icône), depuis
// CommunityDragon : les mêmes identifiants qu'en Arena et en Mayhem.
const CDRAGON = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global';
const RARETES = { kSilver: 'argent', kGold: 'or', kPrismatic: 'prisme' };
let catalogue = null;
export async function augments() {
  if (catalogue && Date.now() - catalogue.le < 6 * 3600e3) return catalogue.donnees;
  const r = await fetch(`${CDRAGON}/fr_fr/v1/cherry-augments.json`, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`CommunityDragon : ${r.status}`);
  const donnees = {};
  for (const a of await r.json()) {
    if (!a.id || !a.nameTRA) continue;
    const chemin = String(a.augmentSmallIconPath ?? '').replace(/^\/lol-game-data\/assets\//i, '').toLowerCase();
    donnees[a.id] = { n: a.nameTRA, r: RARETES[a.rarity] ?? 'argent', i: chemin ? `${CDRAGON}/default/${chemin}` : null };
  }
  catalogue = { le: Date.now(), donnees };
  return donnees;
}
