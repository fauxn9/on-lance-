// Suggestions de picks en sélection des champions. Fonction pure, testée.
//
// Ne regarde que ce qui est visible pour tout le monde dans la sélection :
// les champions (jamais les pseudos, jamais les rangs des autres). Riot
// interdit de désanonymiser la sélection classée, et on n'en a pas besoin.

import { wilson } from './build.js';

const wr = (x) => (x?.games ? x.wins / x.games : null);

/**
 * @param entree.role        poste du joueur (TOP…), ou 'ARAM'
 * @param entree.face        champion adverse probable sur le même poste (ou null)
 * @param entree.exclus      champions déjà pris ou bannis
 * @param entree.pool        [{ championId, points }] — maîtrises lues sur le client
 * @param entree.banc        [championId] — ARAM : champions disponibles (banc + le sien)
 * @param entree.base        { championId: { games, wins, part } } sur ce poste
 * @param entree.duels       { championId: { games, wins } } contre `face`
 * @param entree.perso       { championId: { games, wins } } historique du joueur
 */
export function suggerer({ role, face = null, exclus = [], pool = [], banc = null, base = {}, duels = {}, perso = {} }) {
  const interdits = new Set(exclus.map(Number));
  const maitrise = new Map(pool.map((p) => [Number(p.championId), p.points ?? 0]));

  // Candidats : en ARAM, le banc. Sinon le pool du joueur jouable à ce poste,
  // plus les champions les plus solides du patch à ce poste.
  let candidats;
  if (banc) {
    candidats = banc.map(Number);
  } else {
    // Sans statistiques sur ce poste (début de patch), on garde tout le pool.
    const sansStats = Object.keys(base).length === 0;
    const jouables = [...maitrise.keys()].filter((id) => sansStats || (base[id]?.part ?? 0) >= 0.1 || (perso[id]?.games ?? 0) >= 3);
    const meta = Object.entries(base)
      .filter(([, b]) => b.games >= 150)
      .sort((a, b) => wilson(b[1].wins, b[1].games) - wilson(a[1].wins, a[1].games))
      .slice(0, 8)
      .map(([id]) => Number(id));
    candidats = [...new Set([...jouables, ...meta])];
  }
  candidats = candidats.filter((id) => !interdits.has(id));

  const notes = candidats.map((id) => {
    const b = base[id];
    const raisons = [];
    let score = b && b.games >= 30 ? wilson(b.wins, b.games) : 0.44;

    const d = duels[id];
    if (face && d?.games >= 12 && b?.games) {
      const ecart = Math.max(-0.15, Math.min(0.15, wr(d) - wr(b)));
      score += ecart * 0.8;
      if (ecart >= 0.02) raisons.push({ type: 'contre', championId: face, winrate: wr(d), games: d.games });
      else if (ecart <= -0.02) raisons.push({ type: 'difficile', championId: face, winrate: wr(d), games: d.games });
    }

    const p = perso[id];
    if (p?.games >= 5) {
      score += (wr(p) - 0.5) * 0.2 * Math.min(1, p.games / 20);
      raisons.push({ type: 'perso', winrate: wr(p), games: p.games });
    }

    const pts = maitrise.get(id) ?? 0;
    if (pts > 0) {
      score += Math.min(0.04, Math.log10(pts + 1) * 0.008);
      if (pts >= 50_000) raisons.push({ type: 'maitrise', points: pts });
    }

    if (b?.games >= 150 && !pts && !banc) raisons.push({ type: 'meta', winrate: wr(b), games: b.games });
    if (banc && b?.games) raisons.push({ type: 'aram', winrate: wr(b), games: b.games });

    return { championId: id, score, winrate: wr(b), games: b?.games ?? 0, raisons };
  });

  notes.sort((a, b) => b.score - a.score);
  // Note affichée sur 100 : 0.40 → 0, 0.60 → 100.
  return notes.slice(0, banc ? 5 : 3).map((n) => ({ ...n, note: Math.round(Math.max(0, Math.min(1, (n.score - 0.4) / 0.2)) * 100) }));
}
