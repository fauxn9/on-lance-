import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { intensityFromGap } from './ranking.js';

/**
 * Generation des messages de fin de match.
 *
 * Principe (le meme que pour le coach de la Brique 3) : l'IA ne fait PAS
 * l'analyse. Le classement, les ecarts et l'intensite sont calcules en amont
 * par du code deterministe (ranking.js). L'IA ne fait que mettre ces faits en
 * mots. C'est ce qui evite qu'elle invente des stats.
 */

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

/**
 * Angles stylistiques piochés au hasard à chaque generation.
 *
 * Sans ça, l'IA retombe naturellement sur les memes tournures ("bien joue",
 * "GG", "tu t'es fait distancer"...) des qu'on lui redonne un ton + des stats
 * dans un format similaire — meme a temperature 1. Forcer un angle different a
 * chaque appel garantit une vraie variete percue, pas juste esperee.
 */
const STYLE_ANGLES = [
  "une comparaison sportive inattendue, evite absolument foot/basket qui reviennent tout le temps",
  "une exageration comique volontairement absurde sur l'ecart de niveau",
  "un ton de commentateur esport qui commente l'action en direct",
  "une image tiree d'un objet ou d'un lieu du quotidien, sans nommer de marque",
  "un one-liner sec, presque une punchline de stand-up, pas de fioriture",
  "un ton de pote qui charrie dans le vocal juste apres la game",
  "une metaphore culinaire ou animaliere qui sort de l'ordinaire",
  // Cet angle a produit « les 34% de taux de clutch en 1v1 » dans un vrai
  // message : une statistique inventee, mais parfaitement credible, dans une app
  // dont tout l'argument est de ne rien inventer. La blague ne tient que si
  // personne ne peut la confondre avec une mesure — d'ou les interdits explicites.
  "une statistique inventee de toutes pieces mais IMPOSSIBLE a prendre au serieux : "
    + "elle doit porter sur quelque chose d'inmesurable et absurde, et JAMAIS "
    + "ressembler a une vraie metrique du jeu (interdits : ACS, clutch, headshot, "
    + "K/D, winrate, first blood, taux de quoi que ce soit de reel)",
  "un ton complice qui feint l'admiration avant de retourner la vanne",
  "une phrase construite comme un titre accrocheur de site sportif",
  "une reference au timing/rythme de la game plutot qu'aux chiffres bruts",
  "un ton faussement serieux, presque un rapport d'incident, pour l'effet comique",
];

function pickAngle(rand = Math.random) {
  return STYLE_ANGLES[Math.floor(rand() * STYLE_ANGLES.length)];
}

const TONE_BRIEFS = {
  hype: `Le joueur a fini PREMIER de son groupe sur ce match.
Ton : cool, valorisant, un peu fier. On lui dit en substance qu'il etait le
meilleur du groupe ce soir. Pas de lechage excessif non plus — une vanne
complice envers les autres passe bien.`,

  push: `Le joueur a fini au MILIEU du classement de son groupe.
Ton : motivant, un peu agacant volontairement. Le but est de lui mettre la
rage de passer devant : il n'est pas loin, il peut clairement faire mieux.
On pointe l'ecart avec le premier comme un objectif atteignable.`,

  roast: `Le joueur a fini DERNIER de son groupe sur ce match.
Ton : piquant, moqueur, franc. C'est de la frustration positive assumee : le
but est qu'il ait envie de relancer une game pour se rattraper, PAS qu'il se
sente nul ou qu'il lache le jeu.
Regles non negociables : on se moque de la PERFORMANCE sur ce match, jamais de
la personne. Aucune insulte, rien sur son niveau general, son intelligence ou
son physique. Pas de "t'es nul", plutot "cette game etait un cauchemar".
Ca doit rester le genre de vanne qu'un pote balance dans le vocal.`,

  // --- Brique 2 : notifs de fin de semaine ---------------------------------
  crown: `Le joueur remporte LA SEMAINE : c'est lui qui a pris le plus de RR
sur l'ensemble de la semaine, tous matchs confondus.
Ton : celebration, titre remporte, il tient la couronne jusqu'a lundi prochain.
C'est plus gros qu'un simple bon match — c'est une semaine entiere de domination.
Une pique amicale envers ceux qui ont fini derriere passe tres bien.`,

  recap: `Le joueur n'a PAS gagne la semaine. Il recoit le bilan hebdo.
Ton : bilan lucide et joueur, qui donne envie d'attaquer la semaine suivante.
On situe son ecart avec le vainqueur comme un objectif, pas comme une humiliation.
Si son total de RR est negatif, on peut le charrier franchement dessus.
Si l'ecart avec le premier est minuscule, on insiste sur le fait que ca s'est
joue a rien du tout.`,
};

const SYSTEM_PROMPT = `Tu ecris les notifications de fin de match de "On lance ?",
une app qui compare les perfs d'un groupe de potes sur Valorant.

Style :
- francais parle, registre gaming, tutoiement
- 1 a 2 phrases MAXIMUM, ca doit tenir dans une notification
- vocabulaire Valorant naturel (ACS, frag, clutch, carry, diff) sans en faire trop
- pas d'emoji sauf si ca sert vraiment la vanne, jamais plus d'un
- pas de guillemets autour du message, pas de preambule, pas d'explication

Originalite (regle importante) :
- ce joueur va recevoir des dizaines de ces messages au fil du temps. Un
  message qui ressemble a un template rempli avec des chiffres differents est
  un echec, meme s'il est correct sur le fond.
- applique l'angle stylistique impose plus bas : c'est lui qui doit faire
  varier la formulation d'un message a l'autre, pas juste les chiffres.
- si des messages recents envoyes a ce joueur sont fournis, ne reprends ni
  leur structure de phrase, ni leur vanne, ni leur accroche. Change d'angle
  d'attaque a chaque fois.
- evite les ouvertures passe-partout du genre "Bien joue", "GG", "Encore une
  fois" — trouve une entree en matiere propre a ce message.

Regles dures :
- tu n'utilises QUE les chiffres fournis dans les donnees. Tu n'en inventes
  aucun, tu n'en extrapoles aucun.
- tu ne mentionnes pas de chiffre dont tu n'es pas sur.
- tu ne compares pas a des joueurs absents des donnees.
- tu reponds uniquement avec le texte de la notification, rien d'autre.`;

function buildUserPrompt({ player, standings, match, recentMessages = [], angle, insight = null }) {
  const leader = standings[0];
  const intensity = intensityFromGap(player.gapToFirst);

  const scoreboard = standings
    .map(
      (s) =>
        `  ${s.rank}. ${s.displayName} (${s.agent ?? 'agent inconnu'}) — ` +
        `ACS ${s.acs}, ${s.kills}/${s.deaths}/${s.assists}, HS ${s.hsPercent}%`,
    )
    .join('\n');

  const historyBlock =
    recentMessages.length > 0
      ? `\nDERNIERS MESSAGES ENVOYES A CE JOUEUR SUR CE MEME TON (a ne surtout pas reproduire — change de structure, de vanne et d'accroche) :\n${recentMessages
          .map((m, i) => `  ${i + 1}. "${m}"`)
          .join('\n')}\n`
      : '';

  return `MATCH
  Map : ${match.map}
  Mode : ${match.mode}
  Resultat pour le joueur : ${player.won ? 'victoire' : 'defaite'}

CLASSEMENT DU GROUPE SUR CE MATCH
${scoreboard}

JOUEUR A QUI TU ECRIS
  Nom : ${player.displayName}
  Place : ${player.rank}e sur ${standings.length}
  ACS : ${player.acs}
  Ecart d'ACS avec le premier (${leader.displayName}) : ${player.gapToFirst}
  Ampleur de l'ecart : ${intensity}

CONSIGNE DE TON
${TONE_BRIEFS[player.tone]}

Note sur l'ampleur de l'ecart : "serre" = quasi ex aequo, dose ton message en
consequence (ne pas ecraser quelqu'un qui a fini a 5 points du premier).
"large" = l'ecart est enorme, tu peux y aller plus franchement.

ANGLE STYLISTIQUE IMPOSE POUR CE MESSAGE (source principale de variete d'un message a l'autre)
${angle}
${historyBlock}${
    insight
      ? `\nFAIT POSITIONNEL MESURE SUR CE MATCH (Brique 3 — deja calcule, a reprendre
tel quel, sans l'arrondir ni le romancer) :
  ${insight}
Glisse-le dans le message : c'est plus mordant qu'une vanne generique parce que
c'est vrai et precis. Une seule mention, sans transformer la notif en rapport.\n`
      : ''
  }
Ecris la notification.`;
}

/**
 * Message de secours si l'API Anthropic est indisponible.
 * Une notif un peu plate vaut mieux qu'une notif absente : la Brique 1 doit
 * continuer a tourner meme si la generation echoue.
 */
function fallbackMessage(player, standings) {
  const line = `${player.acs} ACS, ${player.kills}/${player.deaths}/${player.assists} sur ${standings.length} du groupe.`;
  switch (player.tone) {
    case 'hype':
      return `1er du groupe. ${line}`;
    case 'push':
      return `${player.rank}e du groupe, ${player.gapToFirst} d'ACS derriere ${standings[0].displayName}. ${line}`;
    default:
      return `Dernier du groupe. ${line}`;
  }
}

/**
 * Termes qui designent une VRAIE mesure du jeu. Un chiffre colle a l'un d'eux
 * se lit comme une statistique, pas comme une vanne.
 */
const METRIQUES = /\b(acs|clutch|headshots?|hs|k\/?d|kda|kills?|frags?|deaths?|morts?|assists?|winrate|first ?bloods?|aces?|rr|elo|precision|taux)\b/i;

/**
 * Detecte une statistique inventee dans un message genere.
 *
 * Le probleme reel : l'angle "fausse statistique" a produit « les 34% de taux de
 * clutch en 1v1 », un chiffre credible et totalement invente, dans une app dont
 * l'argument central est que rien n'est estime. Une consigne de prompt ne suffit
 * pas — le modele l'avait deja, et l'a contournee.
 *
 * La regle appliquee ici est volontairement etroite pour ne pas tuer l'humour :
 * on ne refuse un chiffre QUE s'il touche a une metrique reelle du jeu ET qu'il
 * ne figure pas dans les donnees fournies. Une blague sur « 12 kg de patience »
 * passe donc sans probleme, « 34% de clutch » non.
 *
 * @param texte    le message genere
 * @param chiffres les nombres reellement fournis au modele
 * @returns le chiffre fautif, ou null si le message est propre
 */
export function statistiqueInventee(texte, chiffres) {
  const connus = new Set(chiffres.map(Number).filter((n) => !Number.isNaN(n)));

  // Chaque nombre du message, avec les ~25 caracteres qui l'entourent.
  for (const m of texte.matchAll(/(\d+(?:[.,]\d+)?)\s*%?/g)) {
    const valeur = Number(m[1].replace(',', '.'));
    if (connus.has(valeur)) continue;

    const autour = texte.slice(Math.max(0, m.index - 25), m.index + m[0].length + 25);
    if (METRIQUES.test(autour)) return m[1];
  }
  return null;
}

/** Tous les nombres qu'on a reellement donnes au modele pour ce match. */
function chiffresFournis({ player, standings }) {
  const n = [player.rank, player.acs, player.gapToFirst, standings.length];
  for (const s of standings) {
    n.push(s.rank, s.acs, s.kills, s.deaths, s.assists, s.hsPercent);
  }
  return n.filter((v) => v !== null && v !== undefined);
}

export async function generateMessage({ player, standings, match, recentMessages = [], insight = null }) {
  if (!config.anthropic.apiKey) {
    return { body: fallbackMessage(player, standings), generated: false };
  }

  const connus = chiffresFournis({ player, standings });

  // Deux tentatives : une statistique inventee est un accident de generation,
  // pas un defaut systematique. Si la seconde derape aussi, on prefere le
  // message ecrit en dur, correct par construction, a un chiffre invente.
  for (let essai = 1; essai <= 2; essai += 1) {
    try {
      const angle = pickAngle();
      const res = await client.messages.create({
        model: config.anthropic.model,
        max_tokens: 200,
        temperature: 1,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: buildUserPrompt({ player, standings, match, recentMessages, angle, insight }),
          },
        ],
      });

      const text = res.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim()
        .replace(/^["«]|["»]$/g, '');

      if (!text) return { body: fallbackMessage(player, standings), generated: false };

      const fautif = statistiqueInventee(text, connus);
      if (fautif) {
        console.warn(
          `[messages] statistique inventee (${fautif}) pour ${player.displayName}, `
          + `tentative ${essai}/2 : "${text}"`,
        );
        continue;
      }

      return { body: text, generated: true };
    } catch (err) {
      console.error(`[messages] generation echouee pour ${player.displayName}:`, err.message);
      return { body: fallbackMessage(player, standings), generated: false };
    }
  }

  return { body: fallbackMessage(player, standings), generated: false };
}

/**
 * Genere les messages de tous les membres d'un match, en parallele.
 *
 * @param history  Map<userId, string[]> — derniers messages envoyes a ce joueur
 *                 pour le ton qu'il recoit sur ce match (anti-repetition).
 *                 Optionnel : vide en dry-run ou si la base n'est pas jointe.
 * @param insights Map<userId, string> — fait positionnel mesure sur ce match
 *                 (Brique 3). Seul le ton 'roast' l'utilise : c'est la ou la
 *                 spec veut un insight concret plutot qu'une vanne generique.
 */
export async function generateAllMessages({ standings, match, history = new Map(), insights = new Map() }) {
  return Promise.all(
    standings.map(async (player) => ({
      ...player,
      message: await generateMessage({
        player,
        standings,
        match,
        recentMessages: history.get(player.userId) ?? [],
        insight: player.tone === 'roast' ? insights.get(player.userId) ?? null : null,
      }),
    })),
  );
}

// ---------------------------------------------------------------------------
// Brique 2 — messages de fin de semaine (leaderboard hebdo)
// ---------------------------------------------------------------------------

function buildWeeklyPrompt({ player, standings, weekLabel, recentMessages = [], angle }) {
  const leader = standings[0];
  const board = standings
    .map(
      (s) =>
        `  ${s.rank}. ${s.displayName} — ${s.rrTotal > 0 ? '+' : ''}${s.rrTotal} RR ` +
        `sur ${s.matches} match${s.matches > 1 ? 's' : ''}`,
    )
    .join('\n');

  const historyBlock =
    recentMessages.length > 0
      ? `\nDERNIERS MESSAGES HEBDO ENVOYES A CE JOUEUR (a ne surtout pas reproduire — change de structure, de vanne et d'accroche) :\n${recentMessages
          .map((m, i) => `  ${i + 1}. "${m}"`)
          .join('\n')}\n`
      : '';

  return `BILAN DE LA SEMAINE (${weekLabel})
Le leaderboard se remet a zero chaque lundi. Il classe les joueurs sur le RR
total gagne ou perdu sur la semaine.

CLASSEMENT FINAL DU GROUPE
${board}

JOUEUR A QUI TU ECRIS
  Nom : ${player.displayName}
  Place : ${player.rank}e sur ${standings.length}
  Total RR de la semaine : ${player.rrTotal > 0 ? '+' : ''}${player.rrTotal}
  Matchs joues : ${player.matches}
  Vainqueur de la semaine : ${leader.displayName} (${leader.rrTotal > 0 ? '+' : ''}${leader.rrTotal} RR)
  Ecart avec le vainqueur : ${leader.rrTotal - player.rrTotal} RR

CONSIGNE DE TON
${TONE_BRIEFS[player.tone]}

ANGLE STYLISTIQUE IMPOSE POUR CE MESSAGE (source principale de variete d'un message a l'autre)
${angle}
${historyBlock}
Ecris la notification.`;
}

function fallbackWeeklyMessage(player, standings, weekLabel) {
  const sign = player.rrTotal > 0 ? '+' : '';
  if (player.tone === 'crown') {
    return `Vainqueur de la ${weekLabel} : ${sign}${player.rrTotal} RR sur ${player.matches} match(s).`;
  }
  const leader = standings[0];
  return `${player.rank}e de la ${weekLabel} avec ${sign}${player.rrTotal} RR. ${leader.displayName} finit a ${leader.rrTotal > 0 ? '+' : ''}${leader.rrTotal}.`;
}

export async function generateWeeklyMessage({ player, standings, weekLabel, recentMessages = [] }) {
  if (!config.anthropic.apiKey) {
    return { body: fallbackWeeklyMessage(player, standings, weekLabel), generated: false };
  }

  try {
    const angle = pickAngle();
    const res = await client.messages.create({
      model: config.anthropic.model,
      max_tokens: 200,
      temperature: 1,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: buildWeeklyPrompt({ player, standings, weekLabel, recentMessages, angle }),
        },
      ],
    });

    const text = res.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()
      .replace(/^["«]|["»]$/g, '');

    if (!text) return { body: fallbackWeeklyMessage(player, standings, weekLabel), generated: false };
    return { body: text, generated: true };
  } catch (err) {
    console.error(`[messages] generation hebdo echouee pour ${player.displayName}:`, err.message);
    return { body: fallbackWeeklyMessage(player, standings, weekLabel), generated: false };
  }
}

/** Messages de fin de semaine pour tout le groupe, en parallele. */
export async function generateAllWeeklyMessages({ standings, weekLabel, history = new Map() }) {
  return Promise.all(
    standings.map(async (player) => ({
      ...player,
      message: await generateWeeklyMessage({
        player,
        standings,
        weekLabel,
        recentMessages: history.get(player.userId) ?? [],
      }),
    })),
  );
}

export {
  buildUserPrompt,
  buildWeeklyPrompt,
  fallbackMessage,
  fallbackWeeklyMessage,
  pickAngle,
  STYLE_ANGLES,
};
