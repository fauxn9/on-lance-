import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContext, decrireMort, MAX_HISTORIQUE } from '../src/services/chat.js';

/* Un rapport de coach reduit a ce que buildContext() consomme. */
const rapport = (extra = {}) => ({
  rang: 'Platine 1',
  groupe: { taille: 52, ecartDeRang: 2, suffisant: true },
  aggregate: {
    deaths: 180, positionalSample: 160, isolatedDeaths: 80, tradeableDeaths: 40,
    medianTeammateDistance: 15.6, medianDuelDistance: 15.8,
  },
  patterns: [
    { severity: 'fort', fact: '51 % de tes morts tombent dans les 20 premières secondes du round' },
    { severity: 'net', fact: 'tu es le premier mort dans 20 % des rounds' },
  ],
  byMap: [
    { mapName: 'Ascent', deaths: 96, isolatedDeaths: 57, positionalSample: 88, medianTeammateDistance: 17.7 },
    { mapName: 'Abyss', deaths: 6, isolatedDeaths: 4, positionalSample: 5, medianTeammateDistance: 19.2 },
  ],
  ...extra,
});

const contexte = (extra) => buildContext({
  playerName: 'fauxn9', periodLabel: 'les 14 derniers jours', report: rapport(), ...extra,
});

/* --- Ce que le coach sait ------------------------------------------------- */

test('le contexte porte le rang et le groupe de comparaison', () => {
  const c = contexte();
  assert.match(c, /fauxn9 \(rang Platine 1\)/);
  assert.match(c, /52 joueurs a \+\/- 2 divisions/);
  assert.match(c, /ses propres parties/);
});

test('le contexte annonce ses trois points faibles, classes', () => {
  const c = contexte();
  assert.match(c, /1\. \[fort\] 51 % de tes morts/);
  assert.match(c, /2\. \[net\] tu es le premier mort/);
});

test('les maps a trop petit echantillon sont exclues du contexte', () => {
  // Abyss n'a que 5 morts mesurables : la citer inviterait a conclure dessus.
  const c = contexte();
  assert.match(c, /Ascent/);
  assert.ok(!/Abyss/.test(c), 'Abyss ne doit pas apparaitre');
});

/* --- Ce que le coach ignore, et doit savoir qu'il ignore ------------------ */

test('le contexte enonce explicitement ce qui n’est pas mesure', () => {
  const c = contexte();
  for (const sujet of ['visee', 'crosshair', 'temps de reaction', 'communication']) {
    assert.ok(c.includes(sujet), `${sujet} doit etre liste comme non mesure`);
  }
});

test('un groupe insuffisant est annonce comme tel', () => {
  const c = buildContext({
    playerName: 'x', periodLabel: 'p',
    report: rapport({ groupe: { taille: 3, ecartDeRang: null, suffisant: false } }),
  });
  assert.match(c, /indisponible/);
  assert.match(c, /seuils fixes/);
  assert.ok(!/GROUPE DE COMPARAISON : 3 joueurs/.test(c));
});

test('un rapport vide ne fait pas exploser le contexte', () => {
  const c = buildContext({ playerName: 'x', periodLabel: 'p', report: null });
  assert.ok(c.includes('JOUEUR : x'));
  assert.match(c, /NE MESURE PAS/);
});

/* --- "Pourquoi je suis mort la" ------------------------------------------- */

const mort = (extra = {}) => ({
  mapName: 'Ascent', round: 7, agent: 'Jett', weapon: 'Vandal',
  timeInRoundMs: 12_400, duelDistance: 18.2, nearestTeammate: 24.5,
  livingTeammates: 3, lastAlive: false, isolated: true, tradePossible: false,
  view: null, ...extra,
});

test('une mort est decrite avec ses seuils, pas seulement ses chiffres', () => {
  const d = decrireMort(mort());
  assert.match(d, /Round 7, en Jett/);
  assert.match(d, /Tue par : Vandal/);
  assert.match(d, /12 s apres le debut du round/);
  assert.match(d, /24,5 m/);
  // Sans le rappel du seuil, "isole : oui" ne veut rien dire pour le modele.
  assert.match(d, /Isole : oui \(seuil : plus de 15 m\)/);
  assert.match(d, /Mort vengeable : non/);
});

test('le dernier en vie est presente comme une situation, pas comme une faute', () => {
  const d = decrireMort(mort({ lastAlive: true }));
  assert.match(d, /Dernier en vie : oui/);
  assert.match(d, /pas une erreur de placement/);
  // Et surtout : aucun verdict d'isolement sur ce cas.
  assert.ok(!/Isole :/.test(d));
});

test("l'orientation reconstituee est livree avec sa reserve", () => {
  const d = decrireMort(mort({ view: { deltaDeg: 152, gapMs: 1800, outOfView: true, fromBehind: true } }));
  assert.match(d, /152° de son axe de regard \(donc dans le dos\)/);
  assert.match(d, /2 s avant/);
  assert.match(d, /prudence/);
});

test('une mort epinglee entre bien dans le contexte', () => {
  const c = contexte({ mortChoisie: mort() });
  assert.match(c, /LA MORT SUR LAQUELLE IL T'INTERROGE/);
  assert.match(c, /Round 7/);
});

test('sans mort epinglee, aucune section de ce type', () => {
  assert.ok(!/LA MORT SUR LAQUELLE/.test(contexte()));
});

/* --- Aucune coordonnee ne doit fuir --------------------------------------- */

test('le contexte ne contient jamais de coordonnees de jeu', () => {
  // La regle qui tient tout le projet : l'IA ne voit que des faits calcules.
  const c = contexte({
    mortChoisie: mort({
      location: { x: 4213.5, y: -9002.1 },
      minimap: { x: 0.42, y: 0.71 },
      killerLocation: { x: 5000, y: -8000 },
    }),
  });
  assert.ok(!c.includes('4213'), 'coordonnee de jeu presente');
  assert.ok(!c.includes('9002'), 'coordonnee de jeu presente');
  assert.ok(!c.includes('0.42'), 'coordonnee minimap presente');
  assert.ok(!/location/i.test(c), 'champ brut recopie');
});

test("l'historique envoye au modele est borne", () => {
  assert.equal(MAX_HISTORIQUE, 8);
});
