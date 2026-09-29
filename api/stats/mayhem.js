// ARAM Mayhem : Riot ne publie pas ces parties dans son API (403 sur
// match-v5, et absentes des historiques). Le client de chaque joueur, lui,
// les montre dans son historique avec les augments des 10 joueurs. L'app en
// envoie un résumé anonyme (champion, équipe, victoire, augments, objets
// finaux, sorts : aucun pseudo), et chaque partie n'est comptée qu'une fois, même si plusieurs
// joueurs de la partie utilisent l'app.

import { query } from '../db.js';
import { ecrire } from './crawler.js';
import { patchDe } from './extract.js';
import { itemsDuPatch, patchsRecents } from './items.js';

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
    // Objets et sorts : facultatifs (les apps 0.3.1 ne les envoient pas).
    const items = Array.isArray(j.items) && j.items.length <= 7 && j.items.every((i) => entier(i, 1, 999999)) ? j.items : [];
    const sorts = Array.isArray(j.sorts) && j.sorts.length === 2 && j.sorts.every((x) => entier(x, 1, 99)) ? j.sorts : null;
    joueurs.push({ championId: j.championId, equipe: j.equipe, victoire: j.victoire, augments: [...new Set(j.augments)], items, sorts });
  }
  // Cinq contre cinq, une seule équipe gagnante.
  const bleus = joueurs.filter((j) => j.equipe === 100);
  if (bleus.length !== 5) return null;
  const gagnants = new Set(joueurs.filter((j) => j.victoire).map((j) => j.equipe));
  if (gagnants.size !== 1) return null;
  return { gameId: p.gameId, plateforme: p.plateforme, patch: patchDe(p.version), joueurs };
}

// Les lignes de stats d'une partie : le champion joué, ses augments, et si
// l'app les envoie, ses sorts et ses objets finaux. « objets » : les objets
// complets et les bottes du patch (items.js). L'ordre des emplacements sert
// d'ordre d'achat : un objet va dans la première case libre.
export function lignesMayhem(partie, objets = { complets: new Set(), bottes: new Set() }) {
  const lignes = [];
  for (const j of partie.joueurs) {
    const base = { champion_id: j.championId, role: 'ARAM', games: 1, wins: j.victoire ? 1 : 0 };
    const ajout = (kind, key) => lignes.push({ ...base, kind, key: String(key) });
    ajout('champ', '');
    for (const a of j.augments) ajout('augment', a);
    if (j.sorts) ajout('spells', [...j.sorts].sort((a, b) => a - b).join(','));
    const complets = [...new Set(j.items.filter((i) => objets.complets.has(i)))];
    for (const i of complets) ajout('item', i);
    if (complets.length >= 3) ajout('core', complets.slice(0, 3).join('>'));
    const bottes = j.items.find((i) => objets.bottes.has(i));
    if (bottes) ajout('boots', bottes);
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
    await ecrire({ patch: p.patch, queue: FILE_MAYHEM, lignes: lignesMayhem(p, await itemsDuPatch(p.patch)) });
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
