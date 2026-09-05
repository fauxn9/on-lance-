import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statistiqueInventee, chiffresFournisHebdo } from '../src/services/messages.js';

/* Les chiffres reellement fournis au modele pour ce match. */
const CONNUS = [1, 2, 231, 208, 19, 25, 15, 23, 6, 14, 24, 17];

const propre = (texte) =>
  assert.equal(statistiqueInventee(texte, CONNUS), null, `refuse a tort : ${texte}`);
const refuse = (texte, attendu) =>
  assert.equal(statistiqueInventee(texte, CONNUS), attendu, `laisse passer : ${texte}`);

/* --- Le cas reel qui a declenche ce garde-fou ----------------------------- */

test('refuse la statistique credible mais inventee vue en production', () => {
  // Message reellement envoye le 3 septembre : 34 n'a jamais ete calcule.
  refuse(
    "231 ACS sur Ascent, c'est clairement les 34% de taux de clutch en 1v1 qui parlent",
    '34',
  );
});

test('refuse un pourcentage colle a une metrique reelle', () => {
  refuse('ton winrate de 78% ce soir force le respect', '78');
  refuse('62% de headshots, on y croit moyen', '62');
  refuse('un K/D de 4 sur cette map', '4');
});

/* --- Ce qui doit continuer a passer --------------------------------------- */

test('laisse passer les chiffres reellement mesures', () => {
  propre('231 ACS et la premiere place, rien a redire');
  propre('19/25/6 sur Ascent, tu portes le groupe');
  propre('208 ACS contre 231, il te manque pas grand-chose');
});

test("laisse passer une blague chiffree qui ne singe aucune metrique", () => {
  // L'angle "fausse statistique" reste jouable, il doit juste rester absurde.
  propre('tu as passe 3 heures a hesiter devant la porte B');
  propre('47 litres de sueur pour un round gagne');
  propre('9 personnes sur 10 auraient reload avant de peek');
});

test('un texte sans aucun chiffre passe toujours', () => {
  propre("t'as fait la course en tete et tu la gardes");
});

/* --- Details de forme ----------------------------------------------------- */

test('reconnait un nombre a virgule deja fourni', () => {
  assert.equal(statistiqueInventee('1,5 kills par round', [1.5]), null);
});

test('ne se laisse pas berner par la distance au mot-cle', () => {
  // Le mot metrique est cherche autour du nombre, pas dans la phrase entiere :
  // un chiffre absurde en debut de phrase ne doit pas etre condamne par un
  // "ACS" situe tres loin derriere.
  propre('42 chaussettes plus tard, la game etait pliee, et tes 231 ACS aussi');
});

test('supporte une liste de chiffres connus vide', () => {
  assert.equal(statistiqueInventee('un ACS de 300', []), '300');
  assert.equal(statistiqueInventee('aucun chiffre ici', []), null);
});

/* --- Le bilan hebdo -------------------------------------------------------
   Le garde-fou n'existait que du cote fin de match. Le bilan du lundi est
   pourtant le message le plus vu de la semaine : il part a tout le groupe
   d'un coup, et il couronne quelqu'un. Le blanc de cloture du 5 septembre a
   revele qu'il partait sans aucune verification. */

const CLASSEMENT = [
  { rank: 1, displayName: 'hayann', rrTotal: 225, matches: 37, bestGain: 23, worstLoss: -23, tone: 'crown' },
  { rank: 2, displayName: 'fauxn9', rrTotal: 180, matches: 32, bestGain: 27, worstLoss: -22, tone: 'recap' },
  { rank: 3, displayName: 'Triple T', rrTotal: 18, matches: 9, bestGain: 20, worstLoss: -20, tone: 'recap' },
];

const hebdo = (texte, joueur = CLASSEMENT[1]) =>
  statistiqueInventee(texte, chiffresFournisHebdo({ player: joueur, standings: CLASSEMENT }));

test('le bilan hebdo autorise les chiffres du classement', () => {
  assert.equal(hebdo('225 RR pour hayann contre 180, en 37 matchs'), null);
});

test("le bilan hebdo autorise l'ecart avec le vainqueur, dans les deux sens", () => {
  // Le prompt le fournit explicitement, et c'est une soustraction verifiable :
  // 225 - 180. Le refuser condamnerait la phrase la plus naturelle du bilan.
  assert.equal(hebdo('hayann te met 45 RR dans la vue'), null);
  assert.equal(hebdo('207 RR de retard sur la premiere', CLASSEMENT[2]), null);
});

test('le bilan hebdo refuse un chiffre que personne ne lui a donne', () => {
  // Le cas qui compte : un total credible, mais faux.
  assert.equal(hebdo("t'as fini a 190 RR cette semaine"), '190');
  assert.equal(hebdo('un winrate de 64% sur la semaine'), '64');
});

test('le bilan hebdo laisse passer une blague chiffree', () => {
  // 82 ne figure nulle part dans le classement : c'est bien la garde qui juge
  // le contexte, et "cafes" n'est pas une metrique de jeu.
  assert.equal(hebdo('82 cafes plus tard, la semaine etait pliee'), null);
});
