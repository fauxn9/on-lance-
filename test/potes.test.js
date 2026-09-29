import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bornes, classer, debutDeSemaine, decalerSemaine, ecartFile, nomSemaine, vainqueur } from '../api/groupes/semaine.js';
import { faitsDe, secours, statistiqueInventee } from '../api/groupes/chambrage.js';
import { embedClassement, signatureValide } from '../api/groupes/discord.js';

test('semaine : lundi, dans le fuseau du groupe', () => {
  assert.equal(debutDeSemaine(new Date('2026-09-02T18:38:00Z')), '2026-08-31');
  // Dimanche 23 h à Paris : encore la semaine du 31/08 ; lundi 0 h 30 : la suivante.
  assert.equal(debutDeSemaine(new Date('2026-09-06T21:00:00Z')), '2026-08-31');
  assert.equal(debutDeSemaine(new Date('2026-09-06T22:30:00Z')), '2026-09-07');
  assert.equal(debutDeSemaine(new Date('2026-09-06T22:30:00Z'), 'UTC'), '2026-08-31');
  assert.equal(decalerSemaine('2026-09-07', -1), '2026-08-31');
  assert.equal(nomSemaine('2026-09-28'), 'semaine du 28 septembre');
});

test('bornes : minuit de Paris, changement d’heure compris', () => {
  const b = bornes('2026-09-28');
  assert.equal(b.debut.toISOString(), '2026-09-27T22:00:00.000Z');
  assert.equal(b.fin.toISOString(), '2026-10-04T22:00:00.000Z');
  // Semaine du passage à l'heure d'hiver (25/10/2026) : fin à minuit UTC+1.
  assert.equal(bornes('2026-10-19').fin.toISOString(), '2026-10-25T23:00:00.000Z');
});

test('LP de la semaine : l’échelle continue traverse les divisions', () => {
  const p = (tier, division, lp) => ({ tier, division, lp });
  assert.equal(ecartFile(p('GOLD', 'I', 80), [p('PLATINUM', 'IV', 10)]), 30, 'Or I 80 → Platine IV 10 = +30');
  assert.equal(ecartFile(undefined, [p('GOLD', 'II', 50), p('GOLD', 'II', 70)]), 20, 'sans photo d’avant : depuis la première de la semaine');
  assert.equal(ecartFile(p('GOLD', 'II', 50), []), 0, 'pas joué');
  assert.equal(ecartFile(undefined, []), 0);
});

test('classement : LP, puis moins de parties, absents à 0', () => {
  const membres = [
    { profil: 1, pseudo: 'kasai', comptes: ['a', 'a2'] },
    { profil: 2, pseudo: 'pingu', comptes: ['b'] },
    { profil: 3, pseudo: 'kiwi', comptes: ['c'] },
  ];
  const photo = (tier, division, lp) => ({ tier, division, lp });
  const avant = new Map([['a:RANKED_SOLO_5x5', photo('GOLD', 'II', 50)], ['b:RANKED_SOLO_5x5', photo('GOLD', 'I', 0)]]);
  const pendant = new Map([
    ['a:RANKED_SOLO_5x5', [photo('GOLD', 'II', 90)]],
    ['a2:RANKED_FLEX_SR', [photo('SILVER', 'I', 10), photo('SILVER', 'I', 30)]],
    ['b:RANKED_SOLO_5x5', [photo('GOLD', 'I', 60)]],
  ]);
  const parties = new Map([['a', { parties: 3, victoires: 2 }], ['a2', { parties: 1, victoires: 1 }], ['b', { parties: 2, victoires: 2 }]]);
  const c = classer(membres, { avant, pendant }, parties);
  assert.deepEqual(c.map((l) => [l.pseudo, l.lp, l.parties, l.place]), [['pingu', 60, 2, 1], ['kasai', 60, 4, 2], ['kiwi', 0, 0, 3]]);
  assert.equal(vainqueur(c).pseudo, 'pingu');
  assert.equal(vainqueur(c).egalite, false);
  assert.equal(vainqueur(classer(membres, { avant: new Map(), pendant: new Map() }, new Map())), null, 'semaine vide : pas de vainqueur');
});

test('stat inventée : refusée seulement si elle ressemble à une vraie mesure', () => {
  assert.equal(statistiqueInventee('tu perds 18 LP et t’es 3e', [18, 3]), null);
  assert.equal(statistiqueInventee('avec tes 34 % de winrate', [18]), '34');
  assert.equal(statistiqueInventee('12 kills en une game genre', [4]), '12');
  assert.equal(statistiqueInventee('t’as mis 3 ans à revenir en lane', [18]), null, 'une vanne absurde passe');
});

test('secours : dans la voix, et les faits pour l’IA', () => {
  const f = {
    type: 'partie', pseudo: 'kasai', champion: 'Sett', victoire: false, kda: '2/7/3', lpPartie: -18, file: 'Solo/Duo',
    place: 3, total: 4, lpSemaine: 12, depasses: [], depassePar: ['kiwi'], potes: [], devant: { pseudo: 'kiwi', ecart: 6 }, ton: 'push',
  };
  assert.equal(secours(f), 'kiwi vient de te passer devant au classement, tu vas vraiment laisser faire ça');
  const g = { ...f, depassePar: [], potes: [{ pseudo: 'pingu', champion: 'Darius', kda: '9/1/4', memeEquipe: false }] };
  assert.match(secours(g), /pingu était en face/);
  const h = { ...f, depassePar: [], ton: 'roast', place: 4 };
  assert.match(secours(h), /dernier du groupe/);
  const phrase = secours(h);
  assert.equal(phrase[0], phrase[0].toLowerCase(), 'commence en minuscule, comme lui');
  assert.equal(secours({ ...f, depassePar: [], devant: null, ton: 'push', place: 1, total: 1 }).startsWith('1er du groupe'), true, '« 1er », pas « 1e »');
  const faits = faitsDe(g).join('\n');
  assert.match(faits, /-18 LP/);
  assert.match(faits, /pingu \(Darius, 9\/1\/4, EN FACE\)/);
});

test('Discord : signature refusée sans clé, embed du classement', () => {
  assert.equal(signatureValide('00', '1', Buffer.from('{}')), false);
  const e = embedClassement({ nom: 'les bouffons' }, { nom: 'semaine du 28 septembre' }, [
    { place: 1, pseudo: 'pingu', lp: 60, parties: 2, victoires: 2 },
    { place: 2, pseudo: 'kiwi', lp: 0, parties: 0, victoires: 0 },
  ]);
  assert.equal(e.title, 'les bouffons · semaine du 28 septembre');
  assert.match(e.description, /\*\*1\.\*\* pingu · \+60 LP · 2V 0D/);
  assert.match(e.description, /kiwi · 0 LP · 0 partie/);
});
