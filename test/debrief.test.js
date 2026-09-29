import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyser, choisir, constats, fenetreCs } from '../api/debrief.js';
import { lignesReperes, mesurer, mortsDe, palierDe, situer, tranche } from '../api/stats/reperes.js';

const POSTES = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];

// Une petite partie de 20 minutes : le top bleu (pid 1) meurt deux fois seul,
// dont une juste avant un baron rouge, et perd des CS entre 8 et 12 min.
function partie() {
  const participants = Array.from({ length: 10 }, (_, i) => ({
    participantId: i + 1, puuid: `p${i + 1}`, teamId: i < 5 ? 100 : 200, teamPosition: POSTES[i % 5],
    championId: 100 + i, championName: `Champ${i + 1}`, win: i >= 5,
    kills: i === 5 ? 6 : 2, deaths: i === 0 ? 3 : 1, assists: 3, totalMinionsKilled: 150, neutralMinionsKilled: 0,
    visionScore: 20, challenges: { killParticipation: 0.5, teamDamagePercentage: 0.2 },
  }));
  const frames = Array.from({ length: 21 }, (_, m) => {
    const participantFrames = {};
    for (let pid = 1; pid <= 10; pid++) {
      // Le top bleu farme comme son adversaire, sauf entre 8 et 12 min.
      const cs = pid === 1 ? m * 7 - (m > 8 ? Math.min(m - 8, 4) * 5 : 0) : m * 7;
      participantFrames[pid] = {
        minionsKilled: cs, jungleMinionsKilled: 0, totalGold: 500 + m * 400 + (pid === 6 ? m * 30 : 0), xp: m * 500,
        position: pid <= 5 ? { x: 2000 + pid * 100, y: 2000 } : { x: 12000, y: 12000 },
      };
    }
    return { participantFrames, events: [] };
  });
  // Deux morts du top bleu loin de ses alliés, une mort près d'eux.
  frames[6].events.push({ type: 'CHAMPION_KILL', timestamp: 6 * 60000, victimId: 1, killerId: 6, assistingParticipantIds: [7], position: { x: 9000, y: 9000 } });
  frames[15].events.push({ type: 'CHAMPION_KILL', timestamp: 15 * 60000, victimId: 1, killerId: 6, assistingParticipantIds: [], position: { x: 10000, y: 4000 } });
  frames[15].events.push({ type: 'ELITE_MONSTER_KILL', timestamp: 15 * 60000 + 40000, killerId: 7, killerTeamId: 200, monsterType: 'BARON_NASHOR', assistingParticipantIds: [6] });
  frames[18].events.push({ type: 'CHAMPION_KILL', timestamp: 18 * 60000, victimId: 1, killerId: 8, assistingParticipantIds: [], position: { x: 2200, y: 2050 } });
  frames[10].events.push({ type: 'ELITE_MONSTER_KILL', timestamp: 10 * 60000, killerId: 2, killerTeamId: 100, monsterType: 'DRAGON', monsterSubType: 'FIRE_DRAGON', assistingParticipantIds: [1] });
  return {
    match: { metadata: { matchId: 'EUW1_1' }, info: { queueId: 420, gameDuration: 1200, gameStartTimestamp: 0, participants } },
    timeline: { info: { frames } },
  };
}

test('mesures : CS à 10 min, écart d’or, objectifs, morts isolées', () => {
  const { match, timeline } = partie();
  const m = mesurer(match, timeline);
  const top = m.get(1).valeurs;
  assert.equal(top.cs10, 60, '70 CS moins 10 perdus');
  assert.equal(top.or15, -450, 'Champ6 a 30 PO de plus par minute');
  assert.equal(top.objectifs, 1, 'présent sur le seul dragon bleu');
  assert.equal(top.isoles, 2 / 3);
  assert.equal(m.get(1).role, 'TOP');
  assert.equal(m.get(6).valeurs.or15, 450);
});

test('morts : isolement et objectif adverse dans la foulée', () => {
  const { match, timeline } = partie();
  const morts = mortsDe(match, timeline, 1);
  assert.equal(morts.length, 3);
  assert.deepEqual(morts.map((x) => x.isole), [true, true, false]);
  assert.equal(morts[1].apres, 'baron');
  assert.equal(morts[0].attaquants, 2);
  assert.equal(morts[0].tueur, 105);
});

test('fenêtre de CS perdus sur l’adversaire direct', () => {
  const moi = [0, 7, 14, 21, 28, 35, 42, 49, 56, 58, 60, 62, 64, 71, 78];
  const lui = moi.map((_, m) => m * 7);
  const f = fenetreCs(moi, lui);
  assert.equal(f.perdu, 20);
  assert.ok(f.de >= 7 && f.de <= 8 && f.a >= 12, JSON.stringify(f));
  assert.equal(fenetreCs(lui, lui), null, 'rien de perdu, rien à dire');
});

test('situer : position 0 = meilleur, égalités pour moitié, médiane', () => {
  const histo = [{ tranche: 10, games: 50 }, { tranche: 12, games: 50 }]; // cs10 : 50 à 50 CS, 50 à 60 CS
  const bas = situer('cs10', 50, histo);
  assert.equal(bas.n, 100);
  assert.equal(bas.position, 0.75, 'la moitié du groupe fait mieux, l’autre moitié à égalité');
  assert.equal(situer('cs10', 70, histo).position, 0);
  assert.equal(situer('morts', 0, [{ tranche: 3, games: 10 }]).position, 0, 'moins de morts = mieux');
  assert.equal(bas.mediane, 52.5);
  assert.equal(situer('cs10', 50, []), null);
});

test('lignes de repères : palier et tous rangs, postes concernés seulement', () => {
  const { match, timeline } = partie();
  const lignes = lignesReperes(mesurer(match, timeline), palierDe('GRANDMASTER'));
  assert.ok(lignes.some((l) => l.kind === 'm:cs10:MASTER+' && l.role === 'TOP'));
  assert.ok(lignes.some((l) => l.kind === 'm:cs10:TOUS'));
  assert.ok(!lignes.some((l) => l.kind.startsWith('m:cs10') && l.role === 'UTILITY'), 'pas de CS pour les supports');
  assert.equal(tranche('or15', -450), -2);
});

test('constats : sous la médiane seulement, et 3 au plus dont un point fort', () => {
  const situations = {
    cs10: { n: 500, position: 0.9, mediane: 70, valeur: 52 },
    kp: { n: 500, position: 0.1, mediane: 0.5, valeur: 0.72 },
    vision: { n: 500, position: 0.45, mediane: 1, valeur: 1.05 },
    degats: { n: 50, position: 0.99, mediane: 0.2, valeur: 0.1 },
  };
  const morts = [{ t: 900000, isole: true, apres: 'baron' }, { t: 1000000, isole: true, apres: null }];
  const liste = constats({ role: 'TOP', situations, fenetre: { de: 8, a: 12, moi: 4, lui: 28, perdu: 24 }, morts, faceNom: 'Darius', palierNom: 'Or' });
  const cles = liste.map((c) => c.cle);
  assert.ok(!cles.includes('vision'), 'dans la moitié haute : pas un reproche');
  assert.ok(!cles.includes('degats'), 'trop peu de pairs : l’axe se tait');
  assert.match(liste.find((c) => c.cle === 'cs10').texte, /52 CS à 10 min ; la médiane des Or top est à 70 CS/);
  const trois = choisir(liste);
  assert.equal(trois.length, 3);
  assert.equal(trois[2].ton, 'v', 'le point fort ferme la liste');
  assert.deepEqual(trois.slice(0, 2).map((c) => c.cle), ['mort_objectif', 'fenetre_cs']);
});

test('analyser : la partie complète, repères absents = pas de comparaison', async () => {
  const { match, timeline } = partie();
  const d = await analyser({ match, timeline, puuid: 'p1', palier: 'GOLD', lireHisto: async () => ({}) });
  assert.equal(d.moi.role, 'TOP');
  assert.equal(d.face.championName, 'Champ6');
  assert.equal(d.courbes.or.length, 21);
  assert.equal(d.courbes.or[15], -450);
  assert.equal(d.morts.length, 3);
  assert.deepEqual(d.objectifs, { equipe: 1, moi: 1, liste: d.objectifs.liste });
  assert.equal(d.mesures.length, 0);
  assert.ok(d.retenir.some((r) => r.cle === 'mort_objectif'));
  assert.equal(await analyser({ match, timeline, puuid: 'inconnu', lireHisto: async () => ({}) }), null);
});
