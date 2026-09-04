import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { aggregateDeaths, aggregateByMap, detectPatterns, THRESHOLDS } from './positional.js';
import { analyser, agreger } from './analysis.js';

/**
 * Etage 2 du coach — mise en mots.
 *
 * REGLE ABSOLUE : ce module ne recoit JAMAIS de coordonnees ni de JSON de match.
 * Il ne recoit que les faits deja calcules par positional.js (etage 1), sous
 * forme de phrases chiffrees. L'IA reformule, elle n'analyse pas.
 *
 * C'est la protection contre l'hallucination : une IA a qui on donne 150 kills
 * bruts en lui demandant de "trouver des patterns" inventera des distances et
 * des angles avec un aplomb total. Ici elle ne peut pas : les chiffres sont
 * deja dans son input, elle n'a qu'a les habiller.
 */

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

const SYSTEM_PROMPT = `Tu ecris le retour de coaching de "On lance ?", une app
qui analyse les parties Valorant d'un joueur a partir des donnees de position.

Ce que tu recois : des FAITS DEJA CALCULES (distances, pourcentages, nombre de
morts). Ce ne sont pas des estimations, ils viennent de la donnee serveur.

Style :
- francais parle, registre gaming, tutoiement
- 2 a 4 phrases, pas plus
- concret et actionnable : le joueur doit savoir quoi changer dans sa prochaine game
- ton d'un coach qui connait le jeu, pas d'un rapport d'analyse

Regles dures, non negociables :
- tu n'utilises QUE les chiffres fournis. Tu n'en inventes aucun, tu n'en
  arrondis aucun vers le haut, tu n'en extrapoles aucun.
- tu ne parles JAMAIS de visee, de crosshair placement, de temps de reaction ni
  d'aim : ces donnees ne sont pas dans ce que tu recois. Tu parles uniquement de
  placement, de distance a l'equipe, de prise d'espace et de timing.
- quand un fait precise sur combien de morts il porte, tu gardes cette nuance.
  Un pattern sur 9 morts ne se presente pas comme une verite absolue.
- tu ne conclus pas sur le niveau general du joueur, seulement sur ce que les
  faits montrent.
- quand un fait donne une valeur ET une reference ("38 % contre 25 % a ton
  rang"), c'est une comparaison a des joueurs du MEME niveau, pas a une moyenne
  generale. Tu peux t'appuyer dessus, mais tu ne dis jamais que le joueur est
  mauvais dans l'absolu : il est au-dessus ou en dessous de SON rang.
- tu reponds uniquement avec le texte du conseil, rien d'autre.`;

function buildCoachPrompt({ playerName, periodLabel, patterns, aggregate, byMap, rang = null }) {
  const factList = patterns.map((p, i) => `  ${i + 1}. [${p.severity}] ${p.fact}`).join('\n');

  const mapLines = byMap
    .filter((m) => m.positionalSample >= 5)
    .slice(0, 3)
    .map(
      (m) =>
        `  ${m.mapName} : ${m.deaths} morts, ${m.isolatedDeaths} isolees ` +
        `(distance mediane a l'equipe ${m.medianTeammateDistance?.toFixed(1) ?? '?'} m)`,
    )
    .join('\n');

  return `JOUEUR : ${playerName}${rang ? ` (rang ${rang})` : ''}
PERIODE : ${periodLabel}

FAITS CALCULES SUR SES MORTS (tout est mesure, rien n'est estime)
${factList || '  (aucun pattern net detecte sur cette periode)'}

CONTEXTE CHIFFRE
  morts analysees : ${aggregate.deaths}
  dont en dernier survivant (non comptees dans les ratios de placement) : ${aggregate.lastAliveDeaths}
  distance mediane des duels perdus : ${aggregate.medianDuelDistance?.toFixed(1) ?? '?'} m

${mapLines ? `PAR MAP\n${mapLines}\n` : ''}
DEFINITIONS (pour que tu emploies les mots justes)
  "isolee" = plus de ${THRESHOLDS.isolationMeters} m du coequipier le plus proche au moment de mourir
  "tradable" = un coequipier a moins de ${THRESHOLDS.tradeMeters} m, donc en mesure de venger la mort

Ecris le retour de coaching.`;
}

/**
 * Repli sans IA : les faits bruts, mis bout a bout.
 * Moins agreable a lire, mais strictement exact — ce qui est le plus important
 * pour du coaching.
 */
function fallbackCoachText(patterns) {
  if (patterns.length === 0) return 'Pas assez de matchs analyses pour sortir un pattern fiable.';
  return patterns.slice(0, 2).map((p) => p.fact.charAt(0).toUpperCase() + p.fact.slice(1)).join('. ') + '.';
}


/**
 * Le barème relatif au rang, quand les mesures des pairs sont disponibles.
 *
 * Renvoie null plutot que de lever : une base sans `match_players` (avant le
 * premier passage du job) doit simplement retomber sur les seuils fixes, pas
 * priver le joueur de son coach.
 */
function analyseRelative({ peerMeasures, puuid }) {
  if (!Array.isArray(peerMeasures) || peerMeasures.length === 0 || !puuid) return null;

  try {
    // Une ligne par joueur ET par match : on regroupe avant d'agreger.
    const parJoueur = new Map();
    for (const m of peerMeasures) {
      if (!parJoueur.has(m.puuid)) parJoueur.set(m.puuid, []);
      parJoueur.get(m.puuid).push(m);
    }

    const mesures = [...parJoueur.values()].map(agreger);
    const moi = mesures.find((m) => m.puuid === puuid);
    if (!moi) return null;

    return analyser({ moi, mesures });
  } catch (err) {
    console.error(`[coach] barème relatif indisponible : ${err.message}`);
    return null;
  }
}

/** Met un constat du barème a la forme attendue par le dashboard et le prompt. */
const versPattern = (c) => ({
  key: c.cle,
  severity: c.gravite,
  sample: c.echantillon,
  fact: c.fait,
  valeur: c.valeur,
  reference: c.reference,
  unite: c.unite,
  pairs: c.pairs,
});

/**
 * Analyse complete d'un joueur sur une periode.
 * Renvoie a la fois les faits (affichables tels quels dans le dashboard) et
 * leur mise en mots.
 */
export async function buildCoachReport({
  playerName,
  deaths,
  periodLabel = 'les 14 derniers jours',
  // Mesures des DIX joueurs de chaque partie (table match_players). C'est ce
  // qui permet le barème relatif au rang. Sans elles, on retombe sur les seuils
  // fixes de detectPatterns() — moins bon, mais jamais bloquant.
  peerMeasures = null,
  puuid = null,
  // false = on ne renvoie que les faits calcules (gratuit, instantane).
  // L'appel a l'IA n'a lieu que si l'appelant le demande explicitement.
  generate = true,
}) {
  const aggregate = aggregateDeaths(deaths);
  const byMap = aggregateByMap(deaths);

  const relatif = analyseRelative({ peerMeasures, puuid });
  // Les constats relatifs au rang priment : ils comparent a de vrais joueurs du
  // meme niveau plutot qu'a un seuil decide a l'avance.
  const patterns = relatif?.constats.length ? relatif.constats.map(versPattern) : detectPatterns(aggregate);

  const report = {
    periodLabel, aggregate, byMap, patterns,
    rang: relatif?.rang ?? null,
    groupe: relatif?.groupe ?? null,
    relatif: Boolean(relatif?.constats.length),
    text: null, generated: false,
  };

  if (!generate) return report;

  if (patterns.length === 0 || !config.anthropic.apiKey) {
    report.text = fallbackCoachText(patterns);
    return report;
  }

  try {
    const res = await client.messages.create({
      model: config.anthropic.model,
      max_tokens: 400,
      temperature: 0.7, // plus bas que les notifs : ici on veut de la justesse, pas du style
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: buildCoachPrompt({
            playerName, periodLabel, patterns, aggregate, byMap, rang: report.rang,
          }),
        },
      ],
    });

    const text = res.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    report.text = text || fallbackCoachText(patterns);
    report.generated = Boolean(text);
  } catch (err) {
    console.error(`[coach] generation echouee pour ${playerName}: ${err.message}`);
    report.text = fallbackCoachText(patterns);
  }

  return report;
}

/**
 * Fait le plus marquant d'un match, pour enrichir la notif de fin de partie
 * (la spec prevoit que le ton "dernier" integre un insight concret plutot
 * qu'une vanne generique).
 *
 * Renvoie une phrase courte ou null. Volontairement severe sur le seuil : sur
 * un seul match l'echantillon est minuscule, et une notif qui affirme un
 * pattern inexistant decredibilise tout le coach.
 */
export function matchInsight(deaths) {
  const positional = deaths.filter((d) => !d.lastAlive && d.nearestTeammate !== null);
  if (positional.length < 4) return null;

  const isolated = positional.filter((d) => d.isolated);
  if (isolated.length >= 3 && isolated.length / positional.length >= 0.5) {
    const avg = isolated.reduce((s, d) => s + d.nearestTeammate, 0) / isolated.length;
    return `${isolated.length} de ses ${positional.length} morts a plus de ${THRESHOLDS.isolationMeters} m de l'equipe (${avg.toFixed(0)} m en moyenne)`;
  }

  const notTradeable = positional.filter((d) => !d.tradePossible);
  if (notTradeable.length >= 4 && notTradeable.length / positional.length >= 0.75) {
    return `${notTradeable.length} de ses ${positional.length} morts sans personne assez pres pour le trade`;
  }

  return null;
}
