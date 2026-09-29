// Le chambrage de fin de partie (brique 8), et la couronne du lundi.
//
// Même principe que le projet Valorant : le code décide QUOI dire (place,
// dépassements, LP, potes dans la même game, ton), l'IA ne fait que le dire,
// dans la voix du créateur de l'app. Sans IA (quota, panne), des phrases de
// secours écrites dans la même voix prennent le relais.

import Anthropic from '@anthropic-ai/sdk';

const MODELE = process.env.CHAMBRAGE_MODELE || 'claude-sonnet-5-5';
let client = null;
const lireClient = () => (client ??= new Anthropic({ timeout: 20_000, maxRetries: 1 }));

// La voix : relevée dans les vrais messages de William (fauxn9), qui a créé
// l'app. C'est ce qui fait que ça sonne comme un pote et pas comme un bot.
const VOIX = `Écris EXACTEMENT comme parle le créateur de l'app. Son style, relevé dans ses vrais messages :
- tout en minuscules, peu de ponctuation, pas de point final la plupart du temps
- phrases courtes et directes, comme un message vocal ou un DM entre potes
- ses tics : « genre », « en mode », « t'es chaud ? », « t'as capté ? », « t'inquiete », « nan », « ok », « vas-y », « c'est cool ça », « flemme »
- ses abréviations : « tjr », « mtn », « jsp », « enft », « ptite », « bcp », « ducoup », « jtrouve »
- l'argot LoL qui vient tout seul : int, feed, carry, diff, gap, tilt, ff, LP, elo, hardstuck (un ou deux max, pas une liste)
- zéro emoji, zéro hashtag, pas de guillemets

Exemples de la voix (ne les recopie pas, c'est juste le ton) :
- 1er du groupe : ok +64 LP depuis lundi et 1er du groupe, les autres vous faites quoi là
- au milieu : 3e à 12 LP de pingu, t'es à une game de lui passer devant t'es chaud ?
- dernier : -38 LP cette semaine et dernier du groupe, enft cette semaine c'est pas la tienne
- doublé : kiwi vient de te passer devant au classement, tu vas vraiment laisser faire ça
- deux potes dans la même game : vous étiez 2 dans la game et c'est pingu qui a carry, toi t'étais où genre`;

const SYSTEME = `Tu écris les messages de chambrage de « On lance ? », une app League of Legends entre potes. Le message arrive dans le groupe (dans l'app et sur leur salon Discord) juste après la partie d'un des potes.

${VOIX}

Règles :
- 1 ou 2 phrases, 220 caractères maximum
- tu t'adresses au joueur qui vient de jouer, en le tutoyant ; tu peux citer les autres potes par leur pseudo
- on chambre la GAME, jamais la personne : pas d'insulte, rien sur son niveau général, son physique ou son intelligence. Ça reste une vanne qu'un pote balance dans le vocal, le but c'est qu'il ait envie de relancer
- tu n'utilises QUE les chiffres fournis, tu n'en inventes aucun (pas de fausse stat de KDA, de CS, de winrate ou de pourcentage)
- chaque message doit sonner différent des précédents : change d'accroche, de structure et de vanne`;

// Les tons, repris du projet Valorant et passés à LoL.
const TONS = {
  hype: `Il est PREMIER du groupe cette semaine. Ton : fier, un peu frimeur, une pique complice pour les autres passe bien.`,
  push: `Il est au MILIEU du classement. Ton : motivant et un peu agaçant exprès, l'écart avec celui de devant est un objectif atteignable.`,
  roast: `Il est DERNIER du groupe. Ton : piquant et franc, frustration positive : il doit avoir envie de relancer, pas de lâcher le jeu.`,
  couronne: `La semaine est finie et il la GAGNE : il a pris le plus de LP du groupe depuis lundi. Ton : célébration, il garde la couronne jusqu'à lundi prochain, une pique pour ceux de derrière.`,
};

// Angles tirés au hasard : sans ça, l'IA retombe toujours sur les mêmes
// tournures, même avec des chiffres différents.
const ANGLES = [
  'une comparaison sportive inattendue (évite foot et basket)',
  'une exagération complètement absurde sur ce qui vient de se passer',
  'un ton de caster qui commente l’action en direct',
  'un one-liner sec, une punchline',
  'le pote qui charrie dans le vocal juste après la game',
  'une image tirée d’un objet ou d’un lieu du quotidien, sans marque',
  'faussement admiratif avant de retourner la vanne',
  'un titre de site de sport accrocheur',
  'un ton faussement sérieux, genre rapport d’incident',
  'le timing de la game plutôt que les chiffres',
];

const SCHEMA = { type: 'object', properties: { message: { type: 'string' } }, required: ['message'], additionalProperties: false };

// Termes d'une vraie mesure du jeu : un nombre collé à l'un d'eux se lit
// comme une stat. On refuse un tel nombre s'il n'a pas été fourni (leçon du
// projet Valorant : « 34 % de clutch » inventé, mais parfaitement crédible).
const METRIQUES = /\b(kda|kills?|morts?|deaths?|assists?|cs|lp|pl|winrate|wr|dégâts|degats|vision|gold|golds|taux|elo|points?)\b|%/i;
export function statistiqueInventee(texte, connus) {
  const ok = new Set(connus.map((n) => Math.abs(Number(n))).filter(Number.isFinite));
  for (const m of texte.matchAll(/(\d+(?:[.,]\d+)?)/g)) {
    const v = Math.abs(Number(m[1].replace(',', '.')));
    if (ok.has(v)) continue;
    const autour = texte.slice(Math.max(0, m.index - 20), m.index + m[0].length + 20);
    if (METRIQUES.test(autour)) return m[1];
  }
  return null;
}

// Les faits, en clair, pour le modèle comme pour les phrases de secours.
export function faitsDe(f) {
  const lignes = [];
  if (f.type === 'couronne') {
    lignes.push(`Semaine terminée (${f.semaine}). ${f.pseudo} la gagne avec ${signe(f.lp)} LP en ${f.parties} parties.`);
    lignes.push(`Classement final : ${f.classement.map((l) => `${l.place}. ${l.pseudo} ${signe(l.lp)} LP`).join(', ')}.`);
    return lignes;
  }
  lignes.push(`Joueur : ${f.pseudo}. Partie : ${f.victoire ? 'victoire' : 'défaite'} avec ${f.champion}, ${f.kda}${f.lpPartie != null ? `, ${signe(f.lpPartie)} LP` : ''} (${f.file}).`);
  lignes.push(`Classement du groupe cette semaine : ${ieme(f.place)} sur ${f.total}, ${signe(f.lpSemaine)} LP depuis lundi.`);
  if (f.devant) lignes.push(`Juste devant lui : ${f.devant.pseudo} à ${f.devant.ecart} LP.`);
  if (f.depasses.length) lignes.push(`Avec cette partie il vient de passer devant : ${f.depasses.join(', ')}.`);
  if (f.depassePar.length) lignes.push(`Avec cette partie il s'est fait passer devant par : ${f.depassePar.join(', ')}.`);
  for (const p of f.potes) lignes.push(`Pote du groupe dans la même partie : ${p.pseudo} (${p.champion}, ${p.kda}, ${p.memeEquipe ? 'dans son équipe' : 'EN FACE'}).`);
  return lignes;
}

const signe = (n) => (n > 0 ? `+${n}` : String(n));
export const ieme = (n) => (n === 1 ? '1er' : `${n}e`);

// Nombres autorisés dans le message : tout ce qui est dans les faits.
function nombresConnus(f) {
  return faitsDe(f).join(' ').match(/\d+/g)?.map(Number) ?? [];
}

// Phrases de secours, dans la même voix.
const pioche = (l) => l[Math.floor(Math.random() * l.length)];
export function secours(f) {
  if (f.type === 'couronne') {
    return pioche([
      `${f.pseudo} gagne la semaine avec ${signe(f.lp)} LP, la couronne c'est pour lui jusqu'à lundi prochain`,
      `semaine pliée, ${f.pseudo} finit 1er avec ${signe(f.lp)} LP, les autres on se retrouve lundi`,
    ]);
  }
  if (f.depassePar.length) return `${f.depassePar[0]} vient de te passer devant au classement, tu vas vraiment laisser faire ça`;
  if (f.potes.some((p) => !p.memeEquipe)) {
    const p = f.potes.find((x) => !x.memeEquipe);
    return f.victoire ? `t'as gagné contre ${p.pseudo} en face, il va pas aimer celle-là` : `${p.pseudo} était en face et c'est lui qui gagne, ça va parler dans le vocal`;
  }
  if (f.depasses.length) return `tu passes devant ${f.depasses.join(' et ')}, ${f.place === 1 ? 'et t\'es 1er du groupe mtn' : `t'es ${ieme(f.place)} mtn`}`;
  if (f.ton === 'hype') return pioche([`1er du groupe avec ${signe(f.lpSemaine)} LP depuis lundi, les autres vous faites quoi là`, `tjr 1er du groupe, ${signe(f.lpSemaine)} LP cette semaine, tranquille`]);
  if (f.ton === 'roast') return pioche([`dernier du groupe avec ${signe(f.lpSemaine)} LP, enft cette semaine c'est pas la tienne`, `${f.victoire ? 'une win ok' : 'encore une loose'} mais tjr dernier du groupe, faut relancer là`]);
  return f.devant
    ? `${ieme(f.place)} à ${f.devant.ecart} LP de ${f.devant.pseudo}, t'es chaud pour lui passer devant ?`
    : `${ieme(f.place)} du groupe avec ${signe(f.lpSemaine)} LP, vas-y relance`;
}

// Le message : l'IA si possible, sinon les phrases de secours.
export async function ecrireChambrage(f, { recents = [], ia = true } = {}) {
  if (!ia || !process.env.ANTHROPIC_API_KEY) return { texte: secours(f), ia: false };
  const ton = TONS[f.type === 'couronne' ? 'couronne' : f.ton];
  const consigne = [
    'FAITS (les seuls chiffres que tu as le droit d’utiliser) :',
    ...faitsDe(f),
    '',
    `TON : ${ton}`,
    `ANGLE IMPOSÉ POUR CE MESSAGE : ${pioche(ANGLES)}`,
    recents.length ? `\nMESSAGES RÉCENTS DU GROUPE (ne reprends ni leur accroche, ni leur structure, ni leur vanne) :\n${recents.map((r) => `- ${r}`).join('\n')}` : '',
    '\nÉcris le message.',
  ].join('\n');
  try {
    const rep = await lireClient().beta.messages.create({
      model: MODELE,
      max_tokens: 2000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEME,
      messages: [{ role: 'user', content: consigne }],
    });
    if (rep.stop_reason === 'refusal' || rep.stop_reason === 'max_tokens') throw new Error(rep.stop_reason);
    const texte = JSON.parse(rep.content.find((b) => b.type === 'text')?.text ?? '{}').message?.trim();
    if (!texte || texte.length > 300) throw new Error('message vide ou trop long');
    const faux = statistiqueInventee(texte, nombresConnus(f));
    if (faux) throw new Error(`chiffre inventé : ${faux}`);
    return { texte, ia: true };
  } catch (err) {
    console.error('chambrage :', err.message);
    return { texte: secours(f), ia: false };
  }
}
