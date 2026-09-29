// Mise en mots des « 3 choses à retenir » du debrief par Claude.
//
// Les faits sont trouvés et chiffrés par les règles (debrief.js). Le modèle ne
// fait que les reformuler en conseils courts et concrets : il ne voit que ces
// faits, il n'en invente pas d'autres. En cas d'échec, de refus ou de
// dépassement du temps, le debrief garde les phrases des règles.

import Anthropic from '@anthropic-ai/sdk';

const MODELE = process.env.DEBRIEF_MODELE || 'claude-sonnet-5-5';

let client = null;
const lireClient = () => (client ??= new Anthropic({ timeout: 25_000, maxRetries: 1 }));

const SYSTEME = `Tu es le coach de l'app « On lance ? », un tracker League of Legends français.
On te donne les constats d'une partie, déjà vérifiés et chiffrés. Pour chacun, écris un conseil :
- une ou deux phrases, 170 caractères au plus, en français, en tutoyant ;
- garde les chiffres exacts du constat (tu peux en omettre, jamais en inventer) ;
- pour un constat à corriger, termine par une action concrète à faire la prochaine partie ;
- pour un point fort, dis-le simplement et encourage à continuer ;
- pas d'emoji, pas de jargon anglais inutile, ton direct et bienveillant, jamais moqueur.
N'ajoute aucun constat qui n'est pas dans la liste. Réponds dans l'ordre des constats.`;

const SCHEMA = {
  type: 'object',
  properties: { conseils: { type: 'array', items: { type: 'string' } } },
  required: ['conseils'],
  additionalProperties: false,
};

const NOMS_POSTES = { TOP: 'top', JUNGLE: 'jungle', MIDDLE: 'mid', BOTTOM: 'ADC', UTILITY: 'support' };

export async function ecrireConseils(d) {
  const partie = [
    `Champion : ${d.moi.championName}${d.moi.role ? `, poste ${NOMS_POSTES[d.moi.role] ?? d.moi.role}` : ''}.`,
    `Résultat : ${d.win ? 'victoire' : 'défaite'} en ${Math.round(d.duree / 60)} min, ${d.moi.kills}/${d.moi.deaths}/${d.moi.assists}.`,
    d.face ? `Adversaire direct : ${d.face.championName}.` : null,
    d.groupe ? `Comparaison : les joueurs ${d.groupe.nom} au même poste.` : null,
    '',
    'Constats :',
    ...d.faits.map((f, i) => `${i + 1}. [${f.ton === 'v' ? 'point fort' : 'à corriger'}] ${f.texte}`),
  ].filter((l) => l != null).join('\n');

  const rep = await lireClient().beta.messages.create({
    model: MODELE,
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    system: SYSTEME,
    messages: [{ role: 'user', content: partie }],
  });
  if (rep.stop_reason === 'refusal' || rep.stop_reason === 'max_tokens') return null;
  const texte = rep.content.find((b) => b.type === 'text')?.text;
  if (!texte) return null;
  const conseils = JSON.parse(texte).conseils;
  if (!Array.isArray(conseils) || conseils.length !== d.faits.length) return null;
  return conseils.map((c) => String(c).trim().slice(0, 240));
}
