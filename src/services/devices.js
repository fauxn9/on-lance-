import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * Brique 9 — appairage de l'application desktop.
 *
 * POURQUOI UN CODE PLUTOT QU'UNE CONNEXION DISCORD
 *
 * Une application de bureau n'a pas de navigateur, et personne ne veut refaire
 * un flux OAuth a chaque demarrage. On affiche donc un code sur le site, il est
 * recopie une fois dans l'application, et celle-ci repart avec un jeton long.
 *
 * CE QUE LE CODE PROTEGE
 *
 * Le code est court, donc devinable : c'est la seule barriere entre un inconnu
 * et un jeton d'acces au compte. D'ou trois regles qui vont ensemble et dont
 * aucune ne suffit seule — usage unique, duree de vie de dix minutes, alphabet
 * sans caracteres ambigus pour eviter les fautes de recopie qui pousseraient a
 * en regenerer en boucle.
 *
 * Le jeton, lui, n'est jamais stocke en clair : seule son empreinte l'est. Une
 * fuite de la base ne donne acces a rien.
 */

/** Sans O/0, I/1, S/5 : un code qu'on recopie a la main ne doit pas se lire de travers. */
const ALPHABET = 'ABCDEFGHJKLMNPQRTUVWXYZ2346789';
const LONGUEUR_CODE = 6;
export const DUREE_CODE_MINUTES = 10;

/** randomInt et pas Math.random : un code devinable n'a aucun interet. */
export function genererCode() {
  let code = '';
  for (let i = 0; i < LONGUEUR_CODE; i += 1) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

/** Tolerant a la saisie : espaces, tirets et minuscules sont acceptes. */
export const normaliserCode = (saisi) =>
  String(saisi ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export const genererJeton = () => randomBytes(32).toString('base64url');

/** Empreinte du jeton. Comparaison a temps constant a la lecture. */
export const empreinte = (jeton) =>
  createHash('sha256').update(String(jeton ?? '')).digest('hex');

export function memeEmpreinte(a, b) {
  const x = Buffer.from(String(a ?? ''), 'utf8');
  const y = Buffer.from(String(b ?? ''), 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Faut-il marquer le compte Riot comme verifie ?
 *
 * Le puuid vient du client Riot installe sur la machine : personne ne peut le
 * fabriquer sans etre reellement connecte avec ce compte. C'est donc une vraie
 * preuve de propriete, celle qui manquait depuis la brique 4.
 *
 * Le cas 'autre_compte' merite d'exister a part : quelqu'un peut tres bien
 * jouer sur un second compte, ou s'etre trompe en saisissant son Riot ID. On ne
 * rebranche RIEN tout seul dans ce cas — on le signale, et c'est lui qui
 * tranche. Rebasculer un compte en silence est exactement le bug qu'on a passe
 * la brique 4 a reparer.
 *
 * @returns 'verifie' | 'autre_compte' | 'aucun_compte' | 'sans_puuid'
 */
export function decisionVerification({ puuidLocal, puuidLie }) {
  if (!puuidLocal) return 'sans_puuid';
  if (!puuidLie) return 'aucun_compte';
  return puuidLocal === puuidLie ? 'verifie' : 'autre_compte';
}

/** Message destine a l'utilisateur, par decision. */
export const MESSAGES_VERIFICATION = {
  verifie: 'Compte Valorant vérifié : ce PC est bien connecté avec le Riot ID que tu as déclaré.',
  autre_compte: "Le compte Riot ouvert sur ce PC n'est pas celui que tu as déclaré sur le site. "
    + "Rien n'a été modifié — si tu joues sur un autre compte, change-le depuis ton tableau de bord.",
  aucun_compte: "Ce PC est appairé, mais aucun compte Valorant n'est encore rattaché à ton profil.",
  sans_puuid: "Ce PC est appairé. Le client Riot n'était pas ouvert, donc le compte n'a pas pu être vérifié.",
};

/** Un code perime ou deja utilise ne vaut rien, et pour la meme raison. */
export function codeUtilisable(ligne, maintenant = new Date()) {
  if (!ligne) return false;
  if (ligne.used_at) return false;
  return new Date(ligne.expires_at).getTime() > maintenant.getTime();
}
