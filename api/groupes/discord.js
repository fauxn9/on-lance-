// Discord (brique 8).
//
// Deux tuyaux, sans aucun bot connecté en permanence :
// - un webhook par groupe : le groupe colle l'URL du webhook de son salon dans
//   l'app, et on y poste le chambrage de fin de partie et la couronne du lundi.
//   L'URL ne ressort jamais du serveur (qui l'a peut poster dans le salon).
// - la commande /classement : Discord appelle /api/discord/interactions, on
//   vérifie sa signature (Ed25519) et on répond avec le classement du groupe
//   lié à ce salon (ou, à défaut, à ce serveur Discord).

import crypto from 'node:crypto';
import { query } from '../db.js';

const WEBHOOK = /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/(\d{15,25})\/([\w-]{20,})$/;
const AVATAR = 'https://onlance.xyz/img/logo-256.png';

// Vérifie une URL de webhook auprès de Discord et renvoie son salon.
export async function verifierWebhook(url) {
  const m = WEBHOOK.exec(String(url ?? '').trim());
  if (!m) return { erreur: "Ce n'est pas une URL de webhook Discord." };
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!r?.ok) return { erreur: 'Discord ne reconnaît pas ce webhook (supprimé ?).' };
  const w = await r.json();
  return { url: m[0], guild: w.guild_id ?? null, salon: w.channel_id ?? null, nom: w.name ?? 'webhook' };
}

export async function posterDiscord(groupe, message) {
  if (!groupe.webhook) return;
  const r = await fetch(`${groupe.webhook}?wait=false`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'On lance ?', avatar_url: AVATAR, allowed_mentions: { parse: [] }, ...message }),
    signal: AbortSignal.timeout(8000),
  }).catch((e) => ({ ok: false, status: e.message }));
  // Webhook supprimé côté Discord : on le délie plutôt que d'échouer à chaque partie.
  if (r.status === 404 || r.status === 401) {
    await query('update groupes set webhook = null, discord_guild = null, discord_salon = null, discord_nom = null where id = $1', [groupe.id]);
  } else if (!r.ok) {
    console.error(`discord (groupe ${groupe.id}) : HTTP ${r.status}`);
  }
}

// ---------------------------------------------------------------- /classement

// La clé publique Ed25519 de l'app Discord (portail > General Information).
let cle = null;
function clePublique() {
  const hex = process.env.DISCORD_PUBLIC_KEY;
  if (!hex) return null;
  cle ??= crypto.createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(hex, 'hex')]),
    format: 'der', type: 'spki',
  });
  return cle;
}

export function signatureValide(signature, horodatage, corps) {
  const k = clePublique();
  if (!k || !signature || !horodatage) return false;
  try {
    return crypto.verify(null, Buffer.concat([Buffer.from(horodatage), corps]), k, Buffer.from(signature, 'hex'));
  } catch {
    return false;
  }
}

export function embedClassement(g, semaine, c) {
  const joue = c.filter((l) => l.parties > 0);
  const lignes = c.map((l) => `**${l.place}.** ${l.pseudo} · ${l.lp > 0 ? '+' : ''}${l.lp} LP · ${l.parties ? `${l.victoires}V ${l.parties - l.victoires}D` : '0 partie'}`);
  return {
    title: `${g.nom} · ${semaine.nom}`,
    description: joue.length ? lignes.join('\n') : `${lignes.join('\n')}\n\npersonne a lancé de classée cette semaine, vous attendez quoi`,
    color: 0xd6ff3f,
    footer: { text: 'On lance ? · les LP de Solo/Duo et Flex depuis lundi' },
  };
}

// Handler express : `req.body` est le corps brut (Buffer).
export function interactions({ classementDe }) {
  return async (req, res) => {
    if (!signatureValide(req.get('x-signature-ed25519'), req.get('x-signature-timestamp'), req.body)) {
      return res.status(401).send('signature invalide');
    }
    const i = JSON.parse(req.body.toString('utf8'));
    if (i.type === 1) return res.json({ type: 1 }); // PING de vérification
    if (i.type === 2 && i.data?.name === 'classement') {
      try {
        const { rows } = await query(
          `select * from groupes where webhook is not null and (discord_salon = $1 or discord_guild = $2)
            order by (discord_salon = $1) desc, created_at desc limit 1`,
          [i.channel_id ?? '', i.guild_id ?? ''],
        );
        const g = rows[0];
        if (!g) {
          return res.json({ type: 4, data: { flags: 64, content: "aucun groupe On lance ? n'est lié à ce serveur. dans l'app : onglet Potes, ton groupe, « Lier un salon Discord »" } });
        }
        const { semaine, classement } = await classementDe(g);
        return res.json({ type: 4, data: { embeds: [embedClassement(g, semaine, classement)], allowed_mentions: { parse: [] } } });
      } catch (err) {
        console.error('/classement :', err.message);
        return res.json({ type: 4, data: { flags: 64, content: 'le classement est indispo là, réessaie dans un moment' } });
      }
    }
    return res.json({ type: 4, data: { flags: 64, content: 'commande inconnue' } });
  };
}

// Enregistre la commande /classement pour l'app Discord (à lancer une fois,
// et à chaque changement de commande) : `npm run discord:commandes`.
export async function enregistrerCommandes() {
  const id = process.env.DISCORD_CLIENT_ID, secret = process.env.DISCORD_CLIENT_SECRET;
  if (!id || !secret) throw new Error('DISCORD_CLIENT_ID et DISCORD_CLIENT_SECRET manquants');
  const t = await fetch('https://discord.com/api/v10/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}` },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'applications.commands.update' }),
  });
  if (!t.ok) throw new Error(`jeton Discord refusé (HTTP ${t.status}) : ${await t.text()}`);
  const { access_token } = await t.json();
  const r = await fetch(`https://discord.com/api/v10/applications/${id}/commands`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${access_token}` },
    body: JSON.stringify([{ name: 'classement', description: 'Le classement de la semaine de ton groupe On lance ?', type: 1, contexts: [0], integration_types: [0] }]),
  });
  if (!r.ok) throw new Error(`commande refusée (HTTP ${r.status}) : ${await r.text()}`);
  return { id, invitation: `https://discord.com/oauth2/authorize?client_id=${id}&scope=applications.commands` };
}
