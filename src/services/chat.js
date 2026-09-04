import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { THRESHOLDS } from './positional.js';
import { statistiqueInventee } from './messages.js';

/**
 * Brique 8 — la discussion avec le coach.
 *
 * LE RISQUE, ET COMMENT IL EST TENU
 *
 * Un chat casse par nature la regle qui tient tout le projet : "le code mesure,
 * l'IA raconte". On ne controle plus la question, donc la tentation est de
 * donner au modele un acces large aux donnees et de le laisser se debrouiller.
 * C'est exactement comme ca qu'on obtient des distances inventees enoncees avec
 * aplomb.
 *
 * Ici, le modele ne recoit JAMAIS de coordonnees ni de JSON de match. Il recoit
 * un contexte fige, entierement compose de faits deja calcules, construit par
 * buildContext() — une fonction pure, donc testable. Tout ce qui n'y figure pas
 * n'existe pas pour lui, et le prompt lui impose de le dire plutot que de
 * combler le vide.
 *
 * Deuxieme filet : la reponse repasse par statistiqueInventee(), le garde-fou
 * ecrit pour les notifications. Un chiffre colle a une vraie metrique du jeu et
 * absent du contexte fait rejeter la reponse.
 */

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

/** Au-dela, on ne renvoie plus l'historique complet : ca coute et ca n'aide plus. */
export const MAX_HISTORIQUE = 8;

const SYSTEM_PROMPT = `Tu es le coach de "On lance ?", une app qui analyse les
parties Valorant a partir des donnees de position du serveur.

Tu reponds aux questions d'un joueur sur SES parties.

Ce que tu recois : un contexte de FAITS DEJA CALCULES — pourcentages, distances
en metres, comparaisons a des joueurs du meme rang. Ce ne sont pas des
estimations, ils viennent de la donnee serveur.

Style :
- francais parle, registre gaming, tutoiement
- 2 a 5 phrases. Une reponse de coach, pas un rapport
- concret : le joueur doit savoir quoi changer

Regles dures, non negociables :
- tu n'utilises QUE les chiffres du contexte. Tu n'en inventes aucun, tu n'en
  extrapoles aucun, tu n'en arrondis aucun vers le haut.
- si la question porte sur quelque chose qui n'est PAS dans le contexte, tu le
  dis franchement et tu expliques ce que l'app mesure a la place. Tu ne devines
  jamais. Exemples de ce qu'on ne mesure pas : la visee, le crosshair placement,
  le temps de reaction, les utilitaires, la communication, l'economie detaillee.
- tu ne parles donc JAMAIS de visee ni de crosshair : ces donnees n'existent pas
  chez nous. Tu parles placement, distance a l'equipe, timing, prise d'espace.
- quand un fait precise sur combien de morts ou de rounds il porte, tu gardes
  cette nuance. Un chiffre sur 9 morts ne se presente pas comme une verite.
- les comparaisons sont RELATIVES au rang du joueur, jamais absolues. Tu ne dis
  pas qu'il est mauvais, tu dis ou il se situe par rapport a son propre niveau.
- tu reponds uniquement avec le texte de la reponse, sans preambule.`;

const m = (v) => (typeof v === 'number' ? `${v.toFixed(1).replace('.', ',')} m` : 'inconnue');
const pct = (v) => (typeof v === 'number' ? `${Math.round(v)} %` : '?');

/**
 * Decrit UNE mort, en clair.
 *
 * C'est le coeur du "pourquoi je suis mort la" : tout ce qui a ete mesure a cet
 * instant precis, et rien d'autre. Les seuils sont rappeles pour que le modele
 * n'ait pas a deviner ce que veut dire "isole".
 */
export function decrireMort(d) {
  if (!d) return null;

  const lignes = [
    `  Map : ${d.mapName ?? 'inconnue'}`,
    `  Round ${d.round}${d.agent ? `, en ${d.agent}` : ''}`,
    d.weapon ? `  Tue par : ${d.weapon}` : null,
    typeof d.timeInRoundMs === 'number'
      ? `  Moment : ${Math.round(d.timeInRoundMs / 1000)} s apres le debut du round`
      : null,
    `  Distance du tueur : ${m(d.duelDistance)}`,
  ];

  if (d.lastAlive) {
    lignes.push('  Dernier en vie : oui — il n\'y avait plus personne pour aider,');
    lignes.push('    ce n\'est donc pas une erreur de placement.');
  } else {
    lignes.push(`  Coequipier le plus proche : ${m(d.nearestTeammate)}`);
    lignes.push(`  Coequipiers encore en vie : ${d.livingTeammates}`);
    lignes.push(
      `  Isole : ${d.isolated ? 'oui' : 'non'} (seuil : plus de ${THRESHOLDS.isolationMeters} m)`,
    );
    lignes.push(
      `  Mort vengeable : ${d.tradePossible ? 'oui' : 'non'} `
      + `(un coequipier a moins de ${THRESHOLDS.tradeMeters} m aurait pu trade)`,
    );
  }

  if (d.view) {
    lignes.push(
      `  Orientation : le tueur etait a ${Math.round(d.view.deltaDeg)}° de son axe de regard`
      + `${d.view.fromBehind ? ' (donc dans le dos)' : d.view.outOfView ? ' (hors du champ de vision)' : ''}`,
    );
    lignes.push(
      `    — reconstitue depuis une observation datant de ${Math.round(d.view.gapMs / 1000)} s avant, `
      + 'a prendre avec prudence',
    );
  }

  return lignes.filter(Boolean).join('\n');
}

/**
 * Assemble le contexte envoye au modele.
 *
 * Pure et sans effet de bord : c'est elle qui definit la frontiere entre ce que
 * le coach sait et ce qu'il ignore, donc elle est testee.
 */
export function buildContext({ playerName, periodLabel, report, mortChoisie = null }) {
  const blocs = [`JOUEUR : ${playerName}${report?.rang ? ` (rang ${report.rang})` : ''}`];
  blocs.push(`PERIODE ANALYSEE : ${periodLabel}`);

  if (report?.groupe?.suffisant) {
    blocs.push(
      `GROUPE DE COMPARAISON : ${report.groupe.taille} joueurs a +/- `
      + `${report.groupe.ecartDeRang} divisions de son rang, croises dans ses propres parties. `
      + 'Toutes les references chiffrees ci-dessous viennent de ce groupe.',
    );
  } else {
    blocs.push(
      'GROUPE DE COMPARAISON : indisponible (pas assez de parties analysees). '
      + 'Les constats ci-dessous reposent sur des seuils fixes, pas sur une comparaison au rang.',
    );
  }

  const a = report?.aggregate;
  if (a) {
    blocs.push(
      `VUE D'ENSEMBLE\n`
      + `  Morts analysees : ${a.deaths}\n`
      + `  Dont mesurables pour le placement : ${a.positionalSample}\n`
      + `  Morts isolees : ${a.isolatedDeaths} (${pct((100 * a.isolatedDeaths) / (a.positionalSample || 1))})\n`
      + `  Morts vengeables : ${a.tradeableDeaths} (${pct((100 * a.tradeableDeaths) / (a.positionalSample || 1))})\n`
      + `  Distance mediane a l'equipe au moment de mourir : ${m(a.medianTeammateDistance)}\n`
      + `  Distance mediane des duels perdus : ${m(a.medianDuelDistance)}`,
    );
  }

  if (report?.patterns?.length) {
    blocs.push(
      'SES TROIS POINTS LES PLUS FAIBLES (mesures, classes du plus grave au moins)\n'
      + report.patterns.map((p, i) => `  ${i + 1}. [${p.severity}] ${p.fact}`).join('\n'),
    );
  }

  const parMap = (report?.byMap ?? []).filter((x) => x.positionalSample >= 8).slice(0, 4);
  if (parMap.length) {
    blocs.push(
      'PAR MAP (seulement celles avec assez de morts mesurables)\n'
      + parMap.map((x) =>
        `  ${x.mapName} : ${x.deaths} morts, ${x.isolatedDeaths} isolees, `
        + `distance mediane a l'equipe ${m(x.medianTeammateDistance)}`).join('\n'),
    );
  }

  if (mortChoisie) {
    blocs.push(`LA MORT SUR LAQUELLE IL T'INTERROGE\n${decrireMort(mortChoisie)}`);
  }

  blocs.push(
    'CE QUE L\'APP NE MESURE PAS, et que tu ne dois donc jamais commenter :\n'
    + '  visee, crosshair placement, temps de reaction, utilitaires lances,\n'
    + '  communication, economie detaillee, intentions des adversaires.',
  );

  return blocs.join('\n\n');
}

/** Tous les nombres du contexte : la reference du garde-fou anti-invention. */
function chiffresDuContexte(contexte) {
  return [...contexte.matchAll(/(\d+(?:[.,]\d+)?)/g)]
    .map((x) => Number(x[1].replace(',', '.')))
    .filter((n) => !Number.isNaN(n));
}

/**
 * Une reponse du coach.
 *
 * @param historique  [{ role: 'user'|'assistant', content }] — deja borne par l'appelant
 * @returns { reply, generated, refus } — refus = la question sortait du perimetre
 */
export async function askCoach({
  playerName, periodLabel, report, mortChoisie = null, question, historique = [],
}) {
  if (!config.anthropic.apiKey) {
    return {
      reply: "Le coach n'est pas disponible : la clé de génération manque côté serveur.",
      generated: false,
    };
  }

  const contexte = buildContext({ playerName, periodLabel, report, mortChoisie });
  const connus = chiffresDuContexte(contexte);

  const messages = [
    ...historique.slice(-MAX_HISTORIQUE).map((x) => ({
      role: x.role === 'assistant' ? 'assistant' : 'user',
      content: String(x.content ?? '').slice(0, 2000),
    })),
    { role: 'user', content: `${contexte}\n\nQUESTION DU JOUEUR :\n${question}` },
  ];

  for (let essai = 1; essai <= 2; essai += 1) {
    const res = await client.messages.create({
      model: config.anthropic.model,
      max_tokens: 500,
      temperature: 0.6, // on veut de la justesse, pas du style
      system: SYSTEM_PROMPT,
      messages,
    });

    const reply = res.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    if (!reply) break;

    const fautif = statistiqueInventee(reply, connus);
    if (fautif) {
      console.warn(`[chat] chiffre invente (${fautif}) pour ${playerName}, tentative ${essai}/2`);
      continue;
    }

    return { reply, generated: true };
  }

  // Deux tentatives, deux chiffres inventes : mieux vaut ne rien affirmer.
  return {
    reply: "Je n'arrive pas à répondre à ça sans avancer un chiffre que je n'ai pas mesuré. "
      + 'Reformule, ou demande-moi plutôt sur quoi porte une de tes morts.',
    generated: false,
    refus: true,
  };
}
