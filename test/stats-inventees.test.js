import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statistiqueInventee } from '../src/services/messages.js';

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
