import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

/**
 * Sessions par cookie signe (Brique 4).
 *
 * Pas de table de sessions ni de dependance : un cookie contenant l'identifiant
 * de l'utilisateur, une date d'expiration, et une signature HMAC. Le serveur
 * n'a rien a stocker et redemarrer ne deconnecte personne — ce qui compte sur
 * Render, ou l'instance gratuite s'endort et repart regulierement.
 *
 * Le compromis assume : on ne peut pas revoquer une session precise avant son
 * expiration. A cette echelle (un groupe de potes) c'est sans consequence, et
 * changer SESSION_SECRET invalide tout d'un coup si besoin.
 */

const COOKIE = 'onlance_session';
const MAX_AGE_DAYS = 30;

/** base64url : passe sans encodage supplementaire dans un cookie. */
const b64 = (buf) => Buffer.from(buf).toString('base64url');
const unb64 = (str) => Buffer.from(str, 'base64url');

function sign(payload) {
  return createHmac('sha256', config.session.secret).update(payload).digest();
}

/**
 * Fabrique la valeur du cookie : "<charge>.<signature>".
 * La charge contient l'expiration, donc un cookie perime est rejete meme s'il
 * est correctement signe.
 */
export function createSession(userId) {
  const expiresAt = Date.now() + MAX_AGE_DAYS * 86_400_000;
  const payload = b64(JSON.stringify({ u: userId, e: expiresAt }));
  return `${payload}.${b64(sign(payload))}`;
}

/**
 * Verifie et decode un cookie de session.
 * Renvoie l'identifiant utilisateur, ou null si le cookie est absent, mal
 * forme, mal signe ou expire — les quatre cas se traitent pareil : pas de session.
 */
export function readSession(value) {
  if (!value || typeof value !== 'string') return null;

  const [payload, signature] = value.split('.');
  if (!payload || !signature) return null;

  const expected = sign(payload);
  const given = unb64(signature);

  // Comparaison a temps constant : une comparaison naive laisserait fuir la
  // signature attendue octet par octet.
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  try {
    const { u, e } = JSON.parse(unb64(payload).toString('utf8'));
    if (typeof u !== 'number' || typeof e !== 'number') return null;
    if (Date.now() > e) return null;
    return u;
  } catch {
    return null;
  }
}

/** Lecture d'un cookie depuis l'en-tete brut, sans dependance. */
export function readCookie(header, name = COOKIE) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

/**
 * En-tete Set-Cookie.
 *
 * HttpOnly : inaccessible au JavaScript de la page, donc inexploitable par une
 * injection de script. SameSite=Lax : le cookie accompagne la redirection de
 * retour de Discord (un GET de premier niveau) mais pas une requete tierce.
 * Secure en production uniquement, sinon le cookie ne partirait pas sur
 * http://localhost pendant le developpement.
 */
export function sessionCookie(value, { maxAgeSeconds = MAX_AGE_DAYS * 86_400 } = {}) {
  const parts = [
    `${COOKIE}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (config.session.secureCookies) parts.push('Secure');
  return parts.join('; ');
}

export const clearCookie = () => sessionCookie('', { maxAgeSeconds: 0 });

/** Jeton imprevisible, pour les liens d'invitation et l'anti-CSRF de l'OAuth. */
export const randomToken = (bytes = 16) => randomBytes(bytes).toString('hex');

export { COOKIE };
