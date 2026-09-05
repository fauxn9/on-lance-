/**
 * La moisson : tout ce qu'on garde d'un match brut, une fois qu'on l'a en main.
 *
 * POURQUOI CE MODULE EXISTE
 *
 * L'historique des parties (`player_matches`) et la feuille des dix joueurs
 * (`match_players`) n'etaient ecrits que par le cron `pos:analyze`, planifie a
 * `25 * * * *`. Releve du 05/09/2026 sur les horodatages en base : ce cron a
 * ecrit a 14h30, 18h30, 21h35, 00h13, 12h52 puis 16h09 — jamais a la minute 25,
 * et jamais toutes les heures. GitHub decale et supprime les executions
 * planifiees quand le compte en a trop en file d'attente, et ce depot en
 * demande 144 par jour rien qu'avec la detection.
 *
 * Consequence vue par les potes : une partie finie a 20h05 n'apparaissait dans
 * l'historique qu'une a trois heures plus tard, et un compte lie a 20h11
 * n'avait AUCUNE donnee jusqu'au passage suivant.
 *
 * Or la detection, elle, tourne toutes les dix minutes ET a chaque fin de
 * partie annoncee par l'application PC — et elle telechargeait deja le match
 * brut complet (`getRawMatches`) pour en tirer une seule vanne, avant de jeter
 * le reste. Ecrire l'historique a ce moment-la ne coute donc AUCUNE requete
 * supplementaire a l'API : c'est la meme reponse, deja payee.
 *
 * Le cron reste en place et appelle ce meme module : il redevient ce qu'il
 * aurait toujours du etre, un filet, pas le seul chemin.
 */

import { normalizeMatch } from './henrikdev.js';
import { mesurerMatch } from './analysis.js';
import { analyzeMatch } from './positional.js';
import { acs, headshotPercent } from './ranking.js';
import { getCalibration } from './maps.js';
import { saveMatchSummary, saveMatchPlayers, matchsDejaDetailles } from '../db/index.js';

/**
 * Resume d'un match du point de vue d'un joueur : ce qui s'affiche dans son
 * historique.
 *
 * On repasse par normalizeMatch() plutot que de relire les champs bruts, pour
 * que l'historique casse au meme endroit que le reste si l'API change de forme.
 */
export function resumeDuJoueur(raw, puuid) {
  const match = normalizeMatch(raw);
  if (!match) return null;

  const player = match.players.find((p) => p.puuid === puuid);
  if (!player) return null;

  return {
    matchId: match.matchId,
    playedAt: match.startedAt,
    mapName: match.map,
    mode: match.mode,
    agent: player.agent,
    roundsPlayed: match.roundsPlayed,
    score: player.score,
    acs: Math.round(acs(player, match.roundsPlayed)),
    kills: player.kills,
    deaths: player.deaths,
    assists: player.assists,
    headshotPct: Math.round(headshotPercent(player)),
    damageDealt: player.damageDealt,
    won: player.won,
  };
}

/**
 * Les dix lignes joueur d'un match, pretes pour saveMatchPlayers().
 *
 * Fonction pure : elle ne touche ni a la base ni au reseau, ce qui la rend
 * testable sur une reponse d'API figee.
 */
export function lignesDesDix({ raw, matchId, mapName, morts = [] }) {
  const mesures = mesurerMatch(raw, morts);
  const playedAt = raw?.metadata?.started_at ?? new Date().toISOString();
  const equipes = new Map((raw?.teams ?? []).map((t) => [String(t.team_id), t.won]));

  return (raw?.players ?? []).map((p) => {
    const m = mesures.get(p.puuid) ?? {};
    const s = p.stats ?? {};
    return {
      matchId,
      puuid: p.puuid,
      name: p.name ?? null,
      tag: p.tag ?? null,
      team: String(p.team_id ?? ''),
      agent: p.agent?.name ?? null,
      tierId: p.tier?.id ?? 0,
      tierName: p.tier?.name ?? null,
      mapName,
      playedAt,
      rounds: m.rounds ?? 0,
      won: equipes.get(String(p.team_id ?? '')) ?? null,
      score: s.score ?? null,
      kills: s.kills ?? null,
      deaths: s.deaths ?? null,
      assists: s.assists ?? null,
      headshots: s.headshots ?? 0,
      bodyshots: s.bodyshots ?? 0,
      legshots: s.legshots ?? 0,
      degatsInfliges: s.damage?.dealt ?? 0,
      degatsRecus: s.damage?.received ?? 0,
      mortsPrecoces: m.mortsPrecoces ?? 0,
      mortsApresPlant: m.mortsApresPlant ?? 0,
      ouvertures: m.ouvertures ?? 0,
      mortsPositionnelles: m.mortsPositionnelles ?? 0,
      mortsIsolees: m.mortsIsolees ?? 0,
      mortsNonTradables: m.mortsNonTradables ?? 0,
    };
  });
}

/**
 * Ecrit la feuille des dix joueurs d'un match.
 *
 * Un echec ici ne doit jamais empecher la suite : c'est un bonus (le barème du
 * coach et le tableau des scores), pas le coeur de la detection.
 */
export async function ecrireLaFeuille({ raw, matchId, mapName, morts, prefixe = '[moisson]' }) {
  try {
    const lignes = lignesDesDix({ raw, matchId, mapName, morts });
    if (lignes.length === 0) return 0;
    return await saveMatchPlayers(lignes);
  } catch (err) {
    console.error(`${prefixe} feuille de match non enregistree (${matchId}) : ${err.message}`);
    return 0;
  }
}

/**
 * Moissonne les matchs bruts d'UN joueur : historique + feuille des dix.
 *
 * Appele par la detection, donc potentiellement toutes les dix minutes sur les
 * memes matchs. Deux garde-fous pour que ce soit gratuit en regime etabli :
 *
 *   - `saveMatchSummary` est un ON CONFLICT DO NOTHING : rejouer n'ecrit rien.
 *   - la feuille des dix, elle, coute une analyse positionnelle complete (de la
 *     geometrie sur tous les kills du match). On demande donc d'abord a la base
 *     quels matchs sont DEJA detailles, et on ne recalcule que les autres.
 *
 * @param membre  { userId, puuid, displayName }
 * @param raws    matchs bruts tels que renvoyes par getRawMatches()
 * @param avecLaFeuille  false pour n'ecrire que l'historique (plus rapide)
 * @returns { resumes, feuilles }
 */
export async function moissonner({ membre, raws, avecLaFeuille = true, prefixe = '[moisson]' }) {
  if (!membre?.puuid || !Array.isArray(raws) || raws.length === 0) {
    return { resumes: 0, feuilles: 0 };
  }

  const ids = raws.map((r) => r?.metadata?.match_id).filter(Boolean);
  let resumes = 0;
  let feuilles = 0;

  // Un seul aller-retour en base pour savoir ce qui est deja detaille, plutot
  // qu'une requete par match.
  const dejaDetailles = avecLaFeuille ? await matchsDejaDetailles(ids) : new Set(ids);

  for (const raw of raws) {
    const matchId = raw?.metadata?.match_id;
    if (!matchId) continue;

    try {
      const resume = resumeDuJoueur(raw, membre.puuid);
      if (resume) resumes += await saveMatchSummary({ userId: membre.userId, puuid: membre.puuid, summary: resume });
    } catch (err) {
      console.error(`${prefixe} resume non enregistre (${matchId}) : ${err.message}`);
    }

    if (dejaDetailles.has(matchId)) continue;

    const mapName = raw?.metadata?.map?.name ?? null;
    let morts = [];
    try {
      const calibration = await getCalibration(mapName);
      morts = analyzeMatch({
        rawMatch: raw,
        puuids: (raw.players ?? []).map((p) => p.puuid),
        calibration,
      });
    } catch (err) {
      // Sans calibration ni geometrie, la feuille reste ecrite : les colonnes
      // positionnelles valent zero, le scoreboard est complet. Mieux vaut un
      // debrief avec la feuille et sans les morts isolees que pas de debrief.
      console.error(`${prefixe} geometrie indisponible (${matchId}) : ${err.message}`);
    }

    feuilles += await ecrireLaFeuille({ raw, matchId, mapName, morts, prefixe });
  }

  return { resumes, feuilles };
}
