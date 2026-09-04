#!/usr/bin/env node
import { getRawMatches } from '../src/services/henrikdev.js';
import { analyzeMatch } from '../src/services/positional.js';
import { mesurerMatch } from '../src/services/analysis.js';
import { loadLinkedAccounts, saveMatchPlayers, closePool } from '../src/db/index.js';

/**
 * Rattrapage de `match_players` sur l'historique deja analyse.
 *
 * Le job d'analyse saute les matchs qu'il a deja traites : sans ce script, les
 * parties d'avant l'ajout du barème n'auraient jamais de feuille de match, et
 * le groupe de comparaison mettrait des jours a se remplir.
 *
 * Portee volontairement limitee a ce que l'API sert encore (les dernieres
 * parties par joueur) : rien de plus n'est recuperable de toute facon.
 *
 * Rejouable sans risque : saveMatchPlayers fait un upsert.
 *
 *   node scripts/backfill-match-players.js
 */
async function main() {
  console.log('[backfill] Rattrapage des feuilles de match');

  const comptes = await loadLinkedAccounts();
  if (comptes.length === 0) {
    console.log('[backfill] Aucun compte Riot lie.');
    return;
  }

  const vus = new Set();
  let lignes = 0;

  for (const c of comptes) {
    let matches;
    try {
      matches = await getRawMatches(c.puuid, { region: c.region ?? 'eu' });
    } catch (err) {
      console.error(`[backfill] ${c.displayName} : recuperation KO — ${err.message}`);
      continue;
    }

    for (const raw of matches) {
      const matchId = raw?.metadata?.match_id;
      // Deux joueurs suivis dans la meme partie : elle est deja traitee.
      if (!matchId || vus.has(matchId)) continue;
      vus.add(matchId);

      const mapName = raw.metadata?.map?.name ?? null;
      const playedAt = raw.metadata?.started_at ?? new Date().toISOString();
      const equipes = new Map((raw.teams ?? []).map((t) => [String(t.team_id), t.won]));

      // Sans calibration : les coordonnees minimap ne servent pas ici, seules
      // comptent les distances, qui sont en unites de jeu.
      const morts = analyzeMatch({ rawMatch: raw, puuids: (raw.players ?? []).map((p) => p.puuid) });
      const mesures = mesurerMatch(raw, morts);

      const rows = (raw.players ?? []).map((p) => {
        const m = mesures.get(p.puuid) ?? {};
        const s = p.stats ?? {};
        return {
          matchId, puuid: p.puuid,
          name: p.name ?? null, tag: p.tag ?? null,
          team: String(p.team_id ?? ''),
          agent: p.agent?.name ?? null,
          tierId: p.tier?.id ?? 0, tierName: p.tier?.name ?? null,
          mapName, playedAt,
          rounds: m.rounds ?? 0,
          won: equipes.get(String(p.team_id ?? '')) ?? null,
          score: s.score ?? null, kills: s.kills ?? null, deaths: s.deaths ?? null,
          assists: s.assists ?? null, headshots: s.headshots ?? 0,
          bodyshots: s.bodyshots ?? 0, legshots: s.legshots ?? 0,
          degatsInfliges: s.damage?.dealt ?? 0, degatsRecus: s.damage?.received ?? 0,
          mortsPrecoces: m.mortsPrecoces ?? 0, mortsApresPlant: m.mortsApresPlant ?? 0,
          ouvertures: m.ouvertures ?? 0, mortsPositionnelles: m.mortsPositionnelles ?? 0,
          mortsIsolees: m.mortsIsolees ?? 0, mortsNonTradables: m.mortsNonTradables ?? 0,
        };
      });

      await saveMatchPlayers(rows);
      lignes += rows.length;
      console.log(`[backfill]   ${matchId.slice(0, 8)} ${mapName ?? '?'} — ${rows.length} joueurs`);
    }
  }

  console.log(`\n[backfill] ${vus.size} matchs, ${lignes} lignes joueur.`);
}

main()
  .catch((err) => { console.error('[backfill] Echec :', err); process.exitCode = 1; })
  .finally(closePool);
