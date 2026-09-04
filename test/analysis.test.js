import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AXES, analyser, confiance, construireGroupe, gravite, mediane, position,
} from '../src/services/analysis.js';
import { nomDuRang, palierDuRang, estClasse } from '../src/services/tiers.js';

/* --- L'echelle de rang, verifiee contre de vraies parties ------------------ */

test("les ids de rang correspondent a ce que renvoie l'API", () => {
  // Observes le 04/09/2026 dans les parties reelles de fauxn9.
  assert.equal(nomDuRang(12), 'Or 1');
  assert.equal(nomDuRang(13), 'Or 2');
  assert.equal(nomDuRang(14), 'Or 3');
  assert.equal(nomDuRang(15), 'Platine 1');
  assert.equal(nomDuRang(16), 'Platine 2');
  assert.equal(nomDuRang(18), 'Diamant 1');
  assert.equal(nomDuRang(19), 'Diamant 2');
});

test("les bornes de l'echelle tiennent", () => {
  assert.equal(nomDuRang(3), 'Fer 1');
  assert.equal(nomDuRang(27), 'Radiant');
  assert.equal(nomDuRang(0), null);      // non classe
  assert.equal(nomDuRang(-1), null);
  assert.equal(palierDuRang(16), 'Platine');
  assert.equal(estClasse(0), false);
  assert.equal(estClasse(16), true);
});

/* --- La statistique du bareme --------------------------------------------- */

test('la mediane ignore les trous', () => {
  assert.equal(mediane([3, 1, 2]), 2);
  assert.equal(mediane([4, 1, 2, 3]), 2.5);
  // Les trous sont retires AVANT le calcul : il reste [1, 3], donc 2.
  assert.equal(mediane([1, null, undefined, NaN, 3]), 2);
  assert.equal(mediane([]), null);
});

test('la position situe le joueur dans son groupe, cote "mauvais"', () => {
  const groupe = [10, 20, 30, 40];
  assert.equal(position(45, groupe, 'haut'), 1);    // pire que tous
  assert.equal(position(5, groupe, 'haut'), 0);     // meilleur que tous
  assert.equal(position(45, groupe, 'bas'), 0);     // sens inverse
  assert.equal(position(5, groupe, 'bas'), 1);
});

test('une egalite ne condamne pas le joueur', () => {
  // Sans le demi-point, quelqu'un pile sur la valeur commune serait classe
  // pire que tous ceux qui la partagent.
  assert.equal(position(10, [10, 10, 10, 10], 'haut'), 0.5);
});

test('la position refuse de se prononcer sans groupe', () => {
  assert.equal(position(10, [], 'haut'), null);
  assert.equal(position(NaN, [1, 2], 'haut'), null);
});

test("la confiance plafonne : un gros echantillon n'aggrave pas un constat", () => {
  assert.equal(confiance(5, 10), 0.5);
  assert.equal(confiance(10, 10), 1);
  assert.equal(confiance(500, 10), 1);
});

test('les seuils de gravite', () => {
  assert.equal(gravite(0.95), 'fort');
  assert.equal(gravite(0.8), 'fort');
  assert.equal(gravite(0.65), 'net');
  assert.equal(gravite(0.4), 'info');
});

/* --- Le groupe de comparaison --------------------------------------------- */

const joueur = (puuid, tierId, extra = {}) => ({
  puuid, tierId,
  tauxIsolement: 40, tauxNonTradable: 60, tauxMortPrecoce: 20, tauxPremierMort: 15,
  degatsRecusParRound: 140, degatsInfligesParRound: 140, tauxHeadshot: 22,
  tauxMortApresPlant: 20,
  echantillons: {
    isolement: 40, trade: 40, entree: 40, ouverture: 40,
    degats_recus: 24, degats_infliges: 24, precision: 300, apres_plant: 40,
  },
  ...extra,
});

test('le groupe se resserre autour du rang du joueur', () => {
  const mesures = [
    ...Array.from({ length: 25 }, (_, i) => joueur(`p${i}`, 16)),  // Platine 2
    ...Array.from({ length: 25 }, (_, i) => joueur(`f${i}`, 5)),   // Fer 3
  ];
  const g = construireGroupe(mesures, { tierId: 16, exclurePuuid: 'moi' });

  assert.equal(g.ecart, 2);
  assert.equal(g.pairs.length, 25);            // les Fer sont dehors
  assert.ok(g.pairs.every((p) => p.tierId === 16));
});

test("le groupe s'elargit plutot que de rester vide, et le signale", () => {
  const mesures = Array.from({ length: 22 }, (_, i) => joueur(`p${i}`, 22)); // +6 divisions
  const g = construireGroupe(mesures, { tierId: 16, exclurePuuid: 'moi' });

  assert.equal(g.ecart, 8);        // a du aller jusqu'au palier le plus large
  assert.equal(g.suffisant, true);
});

test('un joueur non classe ne sert de reference a personne', () => {
  const mesures = Array.from({ length: 30 }, (_, i) => joueur(`p${i}`, 0));
  const g = construireGroupe(mesures, { tierId: 16, exclurePuuid: 'moi' });
  assert.equal(g.suffisant, false);
});

test('le joueur ne se compare pas a lui-meme', () => {
  const mesures = [joueur('moi', 16), ...Array.from({ length: 25 }, (_, i) => joueur(`p${i}`, 16))];
  const g = construireGroupe(mesures, { tierId: 16, exclurePuuid: 'moi' });
  assert.ok(!g.pairs.some((p) => p.puuid === 'moi'));
});

/* --- Le choix des trois pires --------------------------------------------- */

const groupeType = () => Array.from({ length: 30 }, (_, i) => joueur(`p${i}`, 16));

test('seuls les trois constats les plus graves sortent', () => {
  const moi = joueur('moi', 16, {
    tauxIsolement: 90, tauxNonTradable: 95, tauxMortPrecoce: 80,
    tauxPremierMort: 70, tauxMortApresPlant: 60, degatsRecusParRound: 200,
  });
  const r = analyser({ moi, mesures: [moi, ...groupeType()] });

  assert.equal(r.constats.length, 3);
  assert.ok(r.ecartes.length > 0, 'les autres doivent être écartés, pas perdus');

  // Tries du plus grave au moins grave.
  const sev = r.constats.map((c) => c.severite);
  assert.deepEqual(sev, [...sev].sort((a, b) => b - a));
});

test('un joueur meilleur que son rang ne recoit aucun reproche', () => {
  const moi = joueur('moi', 16, {
    tauxIsolement: 5, tauxNonTradable: 10, tauxMortPrecoce: 2, tauxPremierMort: 1,
    degatsRecusParRound: 60, degatsInfligesParRound: 260, tauxHeadshot: 40,
    tauxMortApresPlant: 2,
  });
  const r = analyser({ moi, mesures: [moi, ...groupeType()] });
  assert.equal(r.constats.length, 0);
});

test('un ecart enorme sur un petit echantillon ne bat pas un ecart net sur un gros', () => {
  const moi = joueur('moi', 16, {
    // Pire du groupe sur l'isolement, mais sur 9 morts seulement.
    tauxIsolement: 99,
    // Nettement au-dessus sur les degats recus, sur 24 rounds pleins.
    degatsRecusParRound: 190,
    echantillons: { ...joueur('x', 16).echantillons, isolement: 9 },
  });
  const r = analyser({ moi, mesures: [moi, ...groupeType()] });

  const iso = r.constats.find((c) => c.cle === 'isolement');
  const deg = r.constats.find((c) => c.cle === 'degats_recus');
  assert.ok(deg, 'les degats recus doivent ressortir');
  if (iso) assert.ok(deg.severite > iso.severite, 'le petit echantillon ne doit pas gagner');
});

test('un echantillon trop maigre fait taire un axe entier', () => {
  const moi = joueur('moi', 16, {
    tauxIsolement: 99,
    echantillons: { ...joueur('x', 16).echantillons, isolement: 2 },
  });
  const r = analyser({ moi, mesures: [moi, ...groupeType()] });
  assert.ok(!r.constats.some((c) => c.cle === 'isolement'));
});

test('sans groupe de comparaison, le coach ne conclut rien', () => {
  const moi = joueur('moi', 16, { tauxIsolement: 99 });
  const r = analyser({ moi, mesures: [moi, joueur('p1', 16), joueur('p2', 16)] });

  assert.equal(r.groupe.suffisant, false);
  assert.equal(r.constats.length, 0);
});

test('chaque constat porte de quoi être vérifié', () => {
  const moi = joueur('moi', 16, { tauxIsolement: 95, degatsRecusParRound: 210 });
  const r = analyser({ moi, mesures: [moi, ...groupeType()] });

  for (const c of r.constats) {
    assert.ok(c.fait.length > 20, 'une phrase lisible');
    assert.equal(typeof c.reference, 'number', 'la valeur du groupe');
    assert.ok(c.echantillon > 0, "la taille de l'échantillon");
    assert.ok(c.pairs > 0, 'le nombre de pairs comparés');
    assert.ok(['fort', 'net', 'info'].includes(c.gravite));
    // Le fait cite la valeur ET la reference : verifiable a la lecture.
    assert.ok(c.fait.includes(String(c.valeur)));
  }
});

test('le rang du joueur accompagne le rapport', () => {
  const moi = joueur('moi', 16, { tauxIsolement: 95 });
  const r = analyser({ moi, mesures: [moi, ...groupeType()] });
  assert.equal(r.rang, 'Platine 2');
  assert.equal(r.groupe.ecartDeRang, 2);
});

/* --- Coherence de la table des axes --------------------------------------- */

test('chaque axe est complet et unique', () => {
  const cles = new Set();
  for (const a of AXES) {
    assert.ok(a.cle && !cles.has(a.cle), `clé manquante ou dupliquée : ${a.cle}`);
    cles.add(a.cle);
    assert.ok(a.champ && a.titre, a.cle);
    assert.ok(['haut', 'bas'].includes(a.mauvais), a.cle);
    assert.ok(a.minimum > 0, a.cle);
    assert.equal(typeof a.phrase(10, 20, 30), 'string', a.cle);
  }
});

/* --- Extraction depuis un match brut -------------------------------------- */

/** Match minimal, mais avec la vraie forme de la reponse HenrikDev. */
const matchBrut = () => ({
  rounds: [{ id: 0 }, { id: 1, plant: { round_time_in_ms: 30_000 } }],
  teams: [{ team_id: 'Blue', won: true }, { team_id: 'Red', won: false }],
  players: [
    { puuid: 'a', name: 'Moi', tag: 'EUW', team_id: 'Blue', agent: { name: 'Jett' },
      tier: { id: 16, name: 'Platinum 2' },
      stats: { score: 500, kills: 2, deaths: 2, assists: 1,
        headshots: 3, bodyshots: 5, legshots: 2, damage: { dealt: 300, received: 260 } } },
    { puuid: 'b', name: 'Autre', tag: '000', team_id: 'Red', agent: { name: 'Sage' },
      tier: { id: 15, name: 'Platinum 1' },
      stats: { score: 400, kills: 2, deaths: 1, assists: 0,
        headshots: 1, bodyshots: 4, legshots: 1, damage: { dealt: 200, received: 180 } } },
  ],
  kills: [
    // Round 0 : "a" meurt a 8 s — precoce, et premier mort du round.
    { round: 0, time_in_round_in_ms: 8_000, victim: { puuid: 'a' }, killer: { puuid: 'b' } },
    { round: 0, time_in_round_in_ms: 25_000, victim: { puuid: 'b' }, killer: { puuid: 'a' } },
    // Round 1 : "b" tombe le premier a 25 s, puis "a" a 45 s — donc apres la
    // pose (30 s), pas precoce, et surtout PAS premier mort du round.
    { round: 1, time_in_round_in_ms: 25_000, victim: { puuid: 'b' }, killer: { puuid: 'a' } },
    { round: 1, time_in_round_in_ms: 45_000, victim: { puuid: 'a' }, killer: { puuid: 'b' } },
  ],
});

test('mesurerMatch compte le timing, les ouvertures et les poses', async () => {
  const { mesurerMatch } = await import('../src/services/analysis.js');
  const m = mesurerMatch(matchBrut(), []);

  const a = m.get('a');
  assert.equal(a.morts, 2);
  assert.equal(a.mortsPrecoces, 1);      // seulement celle a 8 s
  assert.equal(a.mortsApresPlant, 1);    // seulement celle a 45 s, round 1
  assert.equal(a.ouvertures, 1);         // premier mort du round 0 seulement
  assert.equal(a.tierId, 16);
  assert.equal(a.tirs, 10);
  assert.equal(a.degatsRecus, 260);

  const b = m.get('b');
  assert.equal(b.morts, 2);
  assert.equal(b.ouvertures, 1);         // premier mort du round 1
  assert.equal(b.mortsPrecoces, 0);      // ses deux morts sont a 25 s
});

test('mesurerMatch lit les morts sous le nom victimPuuid', async () => {
  const { mesurerMatch } = await import('../src/services/analysis.js');
  // C'est le champ que renvoie analyzeMatch(). Se tromper de nom ne leve
  // aucune erreur : ca vide simplement toutes les mesures positionnelles.
  const morts = [
    { victimPuuid: 'a', lastAlive: false, nearestTeammate: 22, isolated: true, tradePossible: false },
    { victimPuuid: 'a', lastAlive: false, nearestTeammate: 4, isolated: false, tradePossible: true },
    { victimPuuid: 'a', lastAlive: true, nearestTeammate: null, isolated: false, tradePossible: false },
  ];
  const a = mesurerMatch(matchBrut(), morts).get('a');

  assert.equal(a.mortsPositionnelles, 2, 'le dernier en vie est exclu');
  assert.equal(a.mortsIsolees, 1);
  assert.equal(a.mortsNonTradables, 1);
});

test('agreger additionne les comptes puis en tire les taux', async () => {
  const { mesurerMatch, agreger } = await import('../src/services/analysis.js');
  const un = mesurerMatch(matchBrut(), [
    { victimPuuid: 'a', lastAlive: false, nearestTeammate: 22, isolated: true, tradePossible: false },
  ]).get('a');

  const t = agreger([un, un]);
  assert.equal(t.morts, 4);
  assert.equal(t.mortsPrecoces, 2);
  assert.equal(t.tauxMortPrecoce, 50);
  assert.equal(t.tauxIsolement, 100);
  assert.equal(t.tierId, 16);
  assert.equal(t.echantillons.entree, 4);
});
