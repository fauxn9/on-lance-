// Une partie + sa chronologie → des lignes de statistiques.
//
// Fonction pure et testée : tout ce que le moteur sait, il le tient d'ici.
// Aucune donnée personnelle ne sort de cette fonction (pas de puuid, pas de
// pseudo) : seulement des compteurs par champion et par rôle.

const ROLES = new Set(['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']);
const TOUCHES = { 1: 'Q', 2: 'W', 3: 'E', 4: 'R' };
const FIN_ACHATS_DEPART = 75_000; // la première visite en boutique finit vers 1:05

export const patchDe = (gameVersion) => String(gameVersion ?? '').split('.').slice(0, 2).join('.');

// Achats d'un joueur dans l'ordre, annulations (« undo ») retirées.
export function achats(timeline, participantId) {
  const liste = [];
  for (const frame of timeline?.info?.frames ?? []) {
    for (const ev of frame.events ?? []) {
      if (ev.participantId !== participantId) continue;
      if (ev.type === 'ITEM_PURCHASED') liste.push({ id: ev.itemId, t: ev.timestamp });
      else if (ev.type === 'ITEM_UNDO' && ev.beforeId && !ev.afterId) {
        const i = liste.map((a) => a.id).lastIndexOf(ev.beforeId);
        if (i >= 0) liste.splice(i, 1);
      }
    }
  }
  return liste;
}

// Points de compétence dans l'ordre : « QWEQQRQEQE… »
export function montees(timeline, participantId) {
  let s = '';
  for (const frame of timeline?.info?.frames ?? []) {
    for (const ev of frame.events ?? []) {
      if (ev.type === 'SKILL_LEVEL_UP' && ev.participantId === participantId && ev.levelUpType !== 'EVOLVE') {
        s += TOUCHES[ev.skillSlot] ?? '';
      }
    }
  }
  return s;
}

// Ordre de priorité des compétences de base : celle montée au maximum en
// premier passe devant. À égalité (partie courte), le plus de points gagne.
export function ordreMax(sequence) {
  const points = { Q: 0, W: 0, E: 0 };
  const maxAu = {};
  [...sequence].forEach((c, i) => {
    if (!(c in points)) return;
    points[c]++;
    if (points[c] === 5 && maxAu[c] == null) maxAu[c] = i;
  });
  if (Object.values(points).reduce((a, b) => a + b, 0) < 6) return null; // trop court pour conclure
  return ['Q', 'W', 'E']
    .sort((a, b) => (maxAu[a] ?? 99) - (maxAu[b] ?? 99) || points[b] - points[a])
    .join('');
}

export function cleRunes(perks) {
  const [p, s] = perks?.styles ?? [];
  const f = perks?.statPerks;
  if (!p || !s || !f || p.selections?.length !== 4 || s.selections?.length !== 2) return null;
  return `${p.style}:${p.selections.map((x) => x.perk).join(',')}|${s.style}:${s.selections.map((x) => x.perk).join(',')}|${f.offense},${f.flex},${f.defense}`;
}

// → [{ champion_id, role, kind, key, games: 1, wins: 0|1 }, …] + le patch et la file.
export function extraire(match, timeline, items) {
  const info = match?.info;
  if (!info || info.gameEndedInEarlySurrender || info.participants?.some((p) => p.gameEndedInEarlySurrender)) return null;
  const queue = info.queueId;
  const aram = queue === 450 || queue === 2400;
  const lignes = [];

  for (const p of info.participants ?? []) {
    const role = aram ? 'ARAM' : p.teamPosition;
    if (!aram && !ROLES.has(role)) continue; // poste inconnu : on ne devine pas
    const win = p.win ? 1 : 0;
    const ajout = (kind, key) => lignes.push({ champion_id: p.championId, role, kind, key: String(key), games: 1, wins: win });

    ajout('champ', '');
    const runes = cleRunes(p.perks);
    if (runes) ajout('runes', runes);
    ajout('spells', [p.summoner1Id, p.summoner2Id].sort((a, b) => a - b).join(','));

    const liste = achats(timeline, p.participantId);
    const depart = liste.filter((a) => a.t < FIN_ACHATS_DEPART && !items.ignores.has(a.id)).map((a) => a.id).sort((a, b) => a - b);
    if (depart.length) ajout('start', depart.join(','));
    const bottes = liste.find((a) => items.bottes.has(a.id));
    if (bottes) ajout('boots', bottes.id);
    const complets = [...new Set(liste.filter((a) => items.complets.has(a.id)).map((a) => a.id))];
    if (complets.length >= 3) ajout('core', complets.slice(0, 3).join('>'));
    for (const id of complets) ajout('item', id);

    const seq = montees(timeline, p.participantId);
    if (seq.length >= 3) ajout('skillstart', seq.slice(0, 3));
    const max = ordreMax(seq);
    if (max) ajout('skillmax', max);

    if (!aram) {
      const face = info.participants.find((o) => o.teamId !== p.teamId && o.teamPosition === p.teamPosition);
      if (face) ajout('matchup', face.championId);
    }
    for (const n of [1, 2, 3, 4, 5, 6]) {
      const a = p[`playerAugment${n}`];
      if (a) ajout('augment', a);
    }
  }
  return { patch: patchDe(info.gameVersion), queue, lignes };
}

// Additionne les doublons avant l'écriture : une même clé ne peut apparaître
// qu'une fois dans un INSERT … ON CONFLICT.
export function regrouper(lignes) {
  const m = new Map();
  for (const l of lignes) {
    const k = `${l.champion_id}|${l.role}|${l.kind}|${l.key}`;
    const x = m.get(k);
    if (x) { x.games += l.games; x.wins += l.wins; } else m.set(k, { ...l });
  }
  return [...m.values()];
}
