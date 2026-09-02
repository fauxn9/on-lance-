#!/usr/bin/env node
/**
 * Diagnostic HenrikDev.
 *
 * A lancer EN PREMIER, avant toute detection :
 *   node scripts/verify-henrik.js TonPseudo EUW
 *
 * Ce script fait ce qu'aucun test unitaire ne peut faire — confronter le code a
 * la vraie reponse de l'API. Il :
 *   1. verifie que la cle fonctionne
 *   2. resout le Riot ID en puuid
 *   3. recupere un vrai match
 *   4. affiche la structure brute renvoyee par l'API
 *   5. passe ce match dans normalizeMatch() et signale chaque champ qui ne
 *      colle pas
 *
 * Si tout est vert, la detection peut tourner. Si un champ est signale, il n'y a
 * qu'un seul endroit a corriger : normalizeMatch() dans src/services/henrikdev.js
 */

import { config } from '../src/config.js';
import { normalizeMatch, normalizeRrEntry } from '../src/services/henrikdev.js';
import { rankGroupInMatch, assignTones } from '../src/services/ranking.js';
import { weekStartOf } from '../src/services/leaderboard.js';

const [, , name, tag, regionArg] = process.argv;
const region = regionArg ?? 'eu';

if (!name || !tag) {
  console.error('Usage : node scripts/verify-henrik.js <pseudo> <tag> [region]');
  console.error('Exemple : node scripts/verify-henrik.js Alex EUW eu');
  process.exit(1);
}

if (!config.henrik.apiKey) {
  console.error('HENRIK_API_KEY absente du .env');
  process.exit(1);
}

const BASE = config.henrik.baseUrl;
const HEADERS = { Authorization: config.henrik.apiKey, Accept: 'application/json' };

const ok = (m) => console.log(`  \x1b[32mOK\x1b[0m   ${m}`);
const ko = (m) => console.log(`  \x1b[31mKO\x1b[0m   ${m}`);
const warn = (m) => console.log(`  \x1b[33m!\x1b[0m    ${m}`);

async function get(path) {
  const res = await fetch(`${BASE}${path}`, { headers: HEADERS });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* reponse non-JSON */
  }
  return { status: res.status, json, text };
}

/** Affiche l'arborescence des cles d'un objet, sans dumper les valeurs. */
function shape(obj, depth = 0, maxDepth = 2) {
  if (depth > maxDepth || obj === null || typeof obj !== 'object') return;
  const pad = '    '.repeat(depth + 1);
  for (const [k, v] of Object.entries(obj)) {
    const type = Array.isArray(v) ? `array[${v.length}]` : v === null ? 'null' : typeof v;
    console.log(`${pad}${k} : ${type}`);
    if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object') {
      shape(v[0], depth + 1, maxDepth);
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      shape(v, depth + 1, maxDepth);
    }
  }
}

console.log('\n=== 1. Cle API ===');
const status = await get(`/valorant/v1/status/${region}`);
if (status.status === 200) {
  ok('cle valide, API joignable');
} else if (status.status === 401 || status.status === 403) {
  ko(`cle refusee (HTTP ${status.status}) — verifier HENRIK_API_KEY`);
  process.exit(1);
} else if (status.status === 429) {
  ko('rate limit atteint des le premier appel — attendre une minute');
  process.exit(1);
} else {
  warn(`HTTP ${status.status} — ${status.text.slice(0, 150)}`);
}

console.log('\n=== 2. Resolution du Riot ID ===');
const account = await get(
  `/valorant/v2/account/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`,
);
if (account.status !== 200 || !account.json?.data?.puuid) {
  ko(`compte ${name}#${tag} introuvable (HTTP ${account.status})`);
  console.log(`       ${account.text.slice(0, 200)}`);
  process.exit(1);
}
const puuid = account.json.data.puuid;
ok(`${name}#${tag} -> puuid ${puuid.slice(0, 8)}...`);
console.log('    Champs renvoyes par /account :');
shape(account.json.data, 0, 1);

console.log('\n=== 3. Recuperation des matchs ===');
const path = `/valorant/v4/by-puuid/matches/${region}/pc/${encodeURIComponent(puuid)}?mode=competitive&size=1`;
const matches = await get(path);

if (matches.status !== 200) {
  ko(`HTTP ${matches.status} sur ${path}`);
  console.log(`       ${matches.text.slice(0, 300)}`);
  console.log('\n    -> Si c est un 404, la version de l endpoint a change.');
  console.log('       Verifier la doc HenrikDev et corriger getRecentMatches().');
  process.exit(1);
}

const raw = matches.json?.data?.[0];
if (!raw) {
  warn('aucun match competitif recent trouve pour ce compte');
  console.log('    -> reessayer avec un compte qui a joue recemment, ou mode=unrated');
  process.exit(0);
}
ok('match recupere');

console.log('\n=== 4. Structure brute renvoyee par l API ===');
console.log('  metadata :');
shape(raw.metadata, 0, 1);
console.log('  players[0] :');
shape(raw.players?.[0], 0, 1);
console.log('  teams[0] :');
shape(raw.teams?.[0], 0, 1);

console.log('\n=== 5. Passage dans normalizeMatch() ===');
const m = normalizeMatch(raw);

if (!m) {
  ko('normalizeMatch a renvoye null — metadata absente ou renommee');
  process.exit(1);
}

const checks = [
  ['matchId', m.matchId, (v) => typeof v === 'string' && v.length > 0],
  ['map', m.map, (v) => v && v !== 'Inconnue'],
  ['mode', m.mode, (v) => v && v !== 'Inconnu'],
  ['startedAt', m.startedAt, (v) => v instanceof Date && !Number.isNaN(v.getTime())],
  ['roundsPlayed', m.roundsPlayed, (v) => Number.isInteger(v) && v > 1],
  ['players', m.players, (v) => Array.isArray(v) && v.length >= 2],
];

let problemes = 0;
for (const [label, value, valid] of checks) {
  if (valid(value)) ok(`${label} = ${value instanceof Date ? value.toISOString() : value}`);
  else {
    ko(`${label} = ${JSON.stringify(value)} — champ non reconnu`);
    problemes++;
  }
}

const p = m.players?.[0];
if (p) {
  console.log('\n  Premier joueur normalise :');
  const pChecks = [
    ['puuid', p.puuid, (v) => typeof v === 'string' && v.length > 0],
    ['score', p.score, (v) => typeof v === 'number' && v > 0],
    ['kills', p.kills, (v) => typeof v === 'number'],
    ['deaths', p.deaths, (v) => typeof v === 'number'],
    ['agent', p.agent, (v) => typeof v === 'string' && v.length > 0],
    ['damageDealt', p.damageDealt, (v) => typeof v === 'number' && v > 0],
  ];
  for (const [label, value, valid] of pChecks) {
    if (valid(value)) ok(`  ${label} = ${value}`);
    else {
      ko(`  ${label} = ${JSON.stringify(value)} — champ non reconnu`);
      problemes++;
    }
  }

  const gagnants = m.players.filter((x) => x.won).length;
  if (gagnants > 0 && gagnants < m.players.length) ok(`  won : ${gagnants} gagnants sur ${m.players.length}`);
  else {
    ko(`  won : ${gagnants} gagnants sur ${m.players.length} — detection d equipe cassee`);
    problemes++;
  }
}

console.log('\n=== 6. Simulation de classement ===');
console.log('  (on fait comme si les 3 premiers joueurs du match etaient ton groupe)');
const faux = new Map(
  m.players.slice(0, 3).map((pl, i) => [pl.puuid, { userId: i + 1, displayName: pl.name ?? `Joueur${i + 1}` }]),
);
const standings = assignTones(rankGroupInMatch(m, faux));
for (const s of standings) {
  console.log(
    `    ${s.rank}. ${s.displayName.padEnd(16)} ACS ${String(s.acs).padStart(3)}  ` +
      `${s.kills}/${s.deaths}/${s.assists}  HS ${s.hsPercent}%  -> ${s.tone}`,
  );
}

console.log('\n=== 7. Historique RR (Brique 2 — leaderboard hebdo) ===');
const rrPath = `/valorant/v2/by-puuid/mmr-history/${region}/pc/${encodeURIComponent(puuid)}`;
const rrRes = await get(rrPath);

if (rrRes.status !== 200) {
  ko(`HTTP ${rrRes.status} sur ${rrPath}`);
  console.log(`       ${rrRes.text.slice(0, 200)}`);
  console.log('    -> corriger getRrHistory() dans src/services/henrikdev.js');
  problemes++;
} else {
  const rawRr = rrRes.json?.data?.history?.[0];
  if (!rawRr) {
    warn('aucun historique RR (compte non classe cette saison ?)');
  } else {
    console.log('    Champs renvoyes par /mmr-history (history[0]) :');
    shape(rawRr, 0, 1);

    const e = normalizeRrEntry(rawRr);
    if (!e) {
      ko('normalizeRrEntry a renvoye null — last_change absent ou renomme');
      problemes++;
    } else {
      const rrChecks = [
        ['matchId', e.matchId, (v) => typeof v === 'string' && v.length > 0],
        ['rrChange', e.rrChange, (v) => typeof v === 'number' && Number.isFinite(v)],
        ['playedAt', e.playedAt, (v) => v instanceof Date && !Number.isNaN(v.getTime())],
        ['tier', e.tier, (v) => typeof v === 'string' && v.length > 0],
      ];
      for (const [label, value, valid] of rrChecks) {
        if (valid(value)) ok(`${label} = ${value instanceof Date ? value.toISOString() : value}`);
        else {
          ko(`${label} = ${JSON.stringify(value)} — champ non reconnu`);
          problemes++;
        }
      }

      const all = rrRes.json.data.history.map(normalizeRrEntry).filter(Boolean);
      const byWeek = new Map();
      for (const entry of all) {
        const w = weekStartOf(entry.playedAt);
        byWeek.set(w, (byWeek.get(w) ?? 0) + entry.rrChange);
      }
      console.log(`    RR par semaine sur les ${all.length} derniers matchs classes :`);
      for (const [w, total] of [...byWeek].sort()) {
        console.log(`      semaine du ${w} : ${total > 0 ? '+' : ''}${total} RR`);
      }
    }
  }
}

console.log('\n=== Verdict ===');
if (problemes === 0) {
  console.log('  \x1b[32mTout colle.\x1b[0m normalizeMatch() et normalizeRrEntry() correspondent');
  console.log('  a la vraie reponse de l API (Brique 1 et Brique 2).');
  console.log('  Prochaine etape : npm run detect:dry, puis npm run rr:sync:dry\n');
} else {
  console.log(`  \x1b[31m${problemes} champ(s) a corriger\x1b[0m dans la normalisation`);
  console.log('  -> src/services/henrikdev.js, section "Normalisation"');
  console.log('  -> comparer avec les structures brutes affichees en etapes 4 et 7\n');
  process.exit(1);
}
