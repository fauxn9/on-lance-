import { config } from '../config.js';

/**
 * OAuth Discord (Brique 4).
 *
 * Pourquoi Discord plutot que Riot : RSO, le « Se connecter avec Riot », existe
 * mais n'est ouvert qu'aux applications ayant deja une production application
 * approuvee par Riot — hors de portee d'un projet perso. Discord, tout le monde
 * l'a deja, et c'est un clic sans mot de passe a retenir.
 *
 * Discord etablit QUI est la personne. Il ne prouve rien sur la propriete d'un
 * compte Valorant : ca, c'est le role du champ `verified` que l'app desktop
 * remplira (Brique 9).
 */

const AUTHORIZE = 'https://discord.com/oauth2/authorize';
const TOKEN = 'https://discord.com/api/oauth2/token';
const ME = 'https://discord.com/api/users/@me';

export function isConfigured() {
  return Boolean(config.discord.clientId && config.discord.clientSecret);
}

/**
 * URL vers laquelle envoyer l'utilisateur.
 * `state` est un jeton aleatoire qu'on retrouvera au retour : sans lui, un tiers
 * pourrait declencher une connexion a l'insu de l'utilisateur (CSRF).
 */
export function authorizeUrl({ state, redirectUri }) {
  const params = new URLSearchParams({
    client_id: config.discord.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'identify',
    state,
    prompt: 'none', // reutilise l'autorisation deja donnee, evite un ecran inutile
  });
  return `${AUTHORIZE}?${params}`;
}

/** Echange le code recu contre un jeton d'acces. */
async function exchangeCode(code, redirectUri) {
  const res = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.discord.clientId,
      client_secret: config.discord.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!res.ok) {
    throw new Error(`echange du code refuse par Discord (HTTP ${res.status}) : ${await res.text()}`);
  }
  return (await res.json()).access_token;
}

/**
 * Identite Discord de la personne qui vient de se connecter.
 * Le jeton d'acces n'est utilise que pour cet appel et jamais conserve : on n'a
 * besoin de rien d'autre de Discord ensuite.
 */
export async function fetchIdentity(code, redirectUri) {
  const accessToken = await exchangeCode(code, redirectUri);

  const res = await fetch(ME, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`profil Discord illisible (HTTP ${res.status})`);

  const u = await res.json();
  return {
    discordId: u.id,
    username: u.global_name || u.username,
    avatarUrl: u.avatar
      ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=128`
      : null,
  };
}
