import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  attribuerPostes, choisirRang, formeDe, oublierTout, partieEnCours, reperesDuos, resumeMaitrise, resumeMatch,
} from '../api/live.js';
import { HostLimiter } from '../api/limiter.js';

test('rang : la Flex en Flex, la Solo/Duo ailleurs', () => {
  const e = [
    { queueType: 'RANKED_FLEX_SR', tier: 'GOLD', rank: 'I', leaguePoints: 10, wins: 5, losses: 5 },
    { queueType: 'RANKED_SOLO_5x5', tier: 'EMERALD', rank: 'II', leaguePoints: 64, wins: 58, losses: 49, hotStreak: true },
  ];
  assert.equal(choisirRang(e, 420).tier, 'EMERALD');
  assert.equal(choisirRang(e, 420).enFeu, true);
  assert.equal(choisirRang(e, 440).tier, 'GOLD');
  assert.equal(choisirRang(e, 450).tier, 'EMERALD');
  assert.equal(choisirRang([e[0]], 420).tier, 'GOLD', 'à défaut, l’autre file');
  assert.equal(choisirRang([], 420), null);
  assert.equal(choisirRang([{ queueType: 'CHERRY', tier: 'X' }], 420), null);
});

test('maîtrise : OTP seulement si le champion écrase le reste', () => {
  const liste = [
    { championId: 1, championLevel: 12, championPoints: 400_000, lastPlayTime: 5 },
    { championId: 2, championLevel: 7, championPoints: 100_000 },
    { championId: 3, championLevel: 5, championPoints: 50_000 },
  ];
  const otp = resumeMaitrise(liste, 1);
  assert.equal(otp.otp, true);
  assert.equal(otp.place, 1);
  assert.equal(otp.part, 0.727);
  assert.equal(resumeMaitrise(liste, 2).otp, false);
  const jamais = resumeMaitrise(liste, 99);
  assert.deepEqual([jamais.points, jamais.place, jamais.otp], [0, null, false]);
  assert.equal(resumeMaitrise(null, 1), null);
});

test('forme : série en cours, remakes ignorés, trou = arrêt', () => {
  const r = (w, remake = false) => ({ p: { moi: { c: 7, w, k: 1, d: 1, a: 1, r: remake } } });
  const base = { a: r(true), b: r(false, true), c: r(true), d: r(false), e: r(true) };
  const f = formeDe('moi', ['a', 'b', 'c', 'd', 'e'], (id) => base[id], 7);
  assert.equal(f.parties.length, 4);
  assert.deepEqual(f.serie, { victoire: true, n: 2 });
  assert.equal(f.surChampion, 4);
  const trou = formeDe('moi', ['a', 'x', 'c'], (id) => base[id], 7);
  assert.equal(trou.parties.length, 1, 'une partie inconnue coupe la liste');
  assert.equal(formeDe('moi', [], () => null, 7).serie, null);
});

test('duos : 2 parties communes suffisent, les groupes se rejoignent', () => {
  const d = reperesDuos([
    ['m1', 'm2', 'm3'],
    ['m1', 'm2', 'x'],
    ['m9'],
    ['y', 'm3', 'z1', 'z2'],
    ['z1', 'z2', 'q'],
  ]);
  assert.equal(d[0].groupe, d[1].groupe);
  assert.equal(d[0].ensemble, 2);
  assert.equal(d[2], null);
  assert.equal(d[3].groupe, d[4].groupe, '1 partie commune ne suffit pas, 2 oui');
  assert.notEqual(d[0].groupe, d[3].groupe);
});

test('postes : le Châtiment désigne le jungler, le reste suit les stats', () => {
  const eq = [
    { championId: 222, sorts: [4, 7] },   // Jinx
    { championId: 412, sorts: [4, 14] },  // Thresh
    { championId: 64, sorts: [11, 4] },   // Lee Sin
    { championId: 103, sorts: [4, 14] },  // Ahri
    { championId: 122, sorts: [4, 12] },  // Darius
  ];
  const roles = {
    222: { BOTTOM: 0.95, MIDDLE: 0.05 }, 412: { UTILITY: 0.97 }, 64: { JUNGLE: 0.9, TOP: 0.1 },
    103: { MIDDLE: 0.9 }, 122: { TOP: 0.8, JUNGLE: 0.2 },
  };
  const ordre = attribuerPostes(eq, roles).map((j) => j.championId);
  assert.deepEqual(ordre, [122, 64, 103, 222, 412]);
});

test('résumé de partie compact', () => {
  const r = resumeMatch({ info: { participants: [{ puuid: 'a', championId: 1, win: true, kills: 3, deaths: 2, assists: 9 }, { puuid: '' }] } });
  assert.deepEqual(r, { p: { a: { c: 1, w: true, k: 3, d: 2, a: 9, r: false } } });
});

test('la collecte s’efface quand une demande à l’écran attend', () => {
  const l = new HostLimiter({ limits: [{ max: 100, windowMs: 1000 }], now: () => 0, sleep: async () => {} });
  assert.equal(l.wait('low'), 0);
  l.urgentes = 1;
  assert.ok(l.wait('low') > 0);
  assert.equal(l.wait('high'), 0);
});

// Faux client Riot : 10 joueurs, 2 duos, tout répond.
function fauxRiot() {
  const appels = [];
  const puuids = Array.from({ length: 10 }, (_, i) => `p${i}`);
  const partagees = { p0: ['d1', 'd2'], p1: ['d1', 'd2'], p5: ['e1', 'e2'], p6: ['e1', 'e2'] };
  const noter = (x) => (appels.push(x), Promise.resolve());
  return {
    appels,
    configured: true,
    activeGame: async (pf, puuid) => (noter('spectateur'), puuid === 'p0' ? {
      gameId: 42, gameQueueConfigId: 420, mapId: 11, gameMode: 'CLASSIC',
      participants: puuids.map((p, i) => ({
        puuid: p, riotId: `Joueur${i}#EUW`, teamId: i < 5 ? 100 : 200, championId: 100 + i,
        spell1Id: i % 5 === 1 ? 11 : 4, spell2Id: 14, perks: { perkIds: [8010], perkStyle: 8000, perkSubStyle: 8400 },
      })),
    } : null),
    leagues: async (pf, p) => (await noter('rang'), [{ queueType: 'RANKED_SOLO_5x5', tier: 'GOLD', rank: 'II', leaguePoints: 40, wins: 10, losses: 8 }]),
    masteries: async (pf, p) => (await noter('maitrise'), [{ championId: 100 + Number(p.slice(1)), championLevel: 10, championPoints: 90_000 }]),
    matchIds: async (pf, p) => (await noter('ids'), [...(partagees[p] ?? []), `${p}-a`, `${p}-b`]),
    match: async (pf, id) => (await noter('partie'), {
      info: { participants: puuids.map((p) => ({ puuid: p, championId: 1, win: !id.endsWith('b'), kills: 1, deaths: 1, assists: 1 })) },
    }),
  };
}

test('écran de chargement complet, une seule analyse par partie', async () => {
  oublierTout();
  const riot = fauxRiot();
  const lireRoles = async () => ({});
  const premiere = await partieEnCours(riot, { puuid: 'p0', platform: 'euw1' }, { lireRoles });
  assert.equal(premiere.enCours, true);
  assert.equal(premiere.joueurs.length, 10);
  assert.ok(!('puuid' in premiere.joueurs[0]), 'les puuid restent sur le serveur');

  // Attendre la fin de l'analyse.
  let v;
  for (let i = 0; i < 50; i++) {
    v = await partieEnCours(riot, { puuid: 'p0', platform: 'euw1' }, { gameId: 42, lireRoles });
    if (v.complet) break;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.equal(v.complet, true);
  assert.deepEqual(v.etapes, { rangs: true, maitrises: true, duos: true, forme: true });
  const moi = v.joueurs.find((j) => j.moi);
  assert.equal(moi.riotId, 'Joueur0#EUW');
  assert.equal(moi.rang.tier, 'GOLD');
  assert.equal(moi.maitrise.otp, true);
  assert.ok(moi.duo, 'p0 et p1 jouent ensemble');
  const p1 = v.joueurs.find((j) => j.riotId === 'Joueur1#EUW');
  assert.equal(p1.duo.groupe, moi.duo.groupe);
  assert.equal(p1.poste, 'JUNGLE', 'Châtiment');
  const p5 = v.joueurs.find((j) => j.riotId === 'Joueur5#EUW');
  assert.notEqual(p5.duo.groupe, moi.duo.groupe);
  assert.equal(moi.forme.parties.length, 4);

  // Un seul appel au spectateur (le 2e passe par l'identifiant de partie), et
  // chaque partie téléchargée une seule fois même partagée par un duo.
  assert.equal(riot.appels.filter((a) => a === 'spectateur').length, 1);
  assert.equal(riot.appels.filter((a) => a === 'rang').length, 10);
  assert.equal(riot.appels.filter((a) => a === 'partie').length, 24);
});

test('pas en partie : réponse en cache quelques secondes', async () => {
  oublierTout();
  const riot = fauxRiot();
  assert.deepEqual(await partieEnCours(riot, { puuid: 'p3', platform: 'euw1' }), { enCours: false });
  assert.deepEqual(await partieEnCours(riot, { puuid: 'p3', platform: 'euw1' }), { enCours: false });
  assert.equal(riot.appels.length, 1);
});
