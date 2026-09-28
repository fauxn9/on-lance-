// Les calculs de l'overlay, sans dépendance (testés dans test/overlay.test.js).
// Tout part de ce qui est visible en jeu : objets de chacun, objectifs
// annoncés à toute la partie, et ton propre niveau.

// Réapparitions stables depuis des années. La première apparition du baron,
// elle, a changé plusieurs fois : on ne l'affiche pas (le jeu l'annonce).
export const PREMIER_DRAGON = 300;
export const RESPAWN = { dragon: 300, ancien: 360, baron: 360 };

// Prochain dragon (ou dragon ancien) et prochain baron, et le compte des
// dragons de chaque équipe (âme au 4e).
export function objectifs(liste, monEquipe) {
  const recent = (l) => [...l].sort((a, b) => b.temps - a.temps)[0];
  const dragons = liste.filter((o) => o.genre === 'dragon');
  const compte = { nous: [], eux: [] };
  for (const d of dragons) {
    if (d.equipe === monEquipe) compte.nous.push(d.element);
    else if (d.equipe) compte.eux.push(d.element);
  }
  const ame = compte.nous.length >= 4 ? 'nous' : compte.eux.length >= 4 ? 'eux' : null;
  const dernier = recent(liste.filter((o) => o.genre === 'dragon' || o.genre === 'ancien'));
  let dragon;
  if (!dernier) dragon = { genre: 'dragon', apparition: PREMIER_DRAGON };
  else {
    // Une fois une âme prise, seul le dragon ancien revient.
    const ancien = Boolean(ame) || dernier.genre === 'ancien';
    dragon = { genre: ancien ? 'ancien' : 'dragon', apparition: dernier.temps + RESPAWN[ancien ? 'ancien' : 'dragon'] };
  }
  const b = recent(liste.filter((o) => o.genre === 'baron'));
  return { dragon, baron: b ? { genre: 'baron', apparition: b.temps + RESPAWN.baron } : null, compte, ame };
}

// Écart d'or estimé par la valeur des objets (ce qu'on voit au tableau des
// scores), pour l'équipe et contre ton adversaire direct.
export function ecartOr(joueurs) {
  const moi = joueurs.find((j) => j.moi);
  if (!moi) return null;
  let nous = 0, eux = 0;
  for (const j of joueurs) j.equipe === moi.equipe ? (nous += j.valeur) : (eux += j.valeur);
  const face = moi.poste ? joueurs.find((j) => j.equipe !== moi.equipe && j.poste === moi.poste) : null;
  return { nous, eux, ecart: nous - eux, duel: face ? { champion: face.champion, ecart: moi.valeur - face.valeur } : null };
}

// Quelle compétence monter avec le prochain point ? L'ultime dès qu'il est
// disponible (6, 11, 16), les premiers points dans l'ordre de départ du build,
// puis l'ordre de montée au max. Une compétence de base ne dépasse pas la
// moitié du niveau (arrondie au-dessus).
export function competenceAMonter(niveau, [q, w, e, r], ordre) {
  const lv = { Q: q, W: w, E: e, R: r };
  const pris = q + w + e + r;
  if (!ordre?.max || pris >= niveau) return null;
  const maxR = niveau >= 16 ? 3 : niveau >= 11 ? 2 : niveau >= 6 ? 1 : 0;
  if (r < maxR) return 'R';
  const plafond = Math.min(5, Math.ceil(niveau / 2));
  const x = ordre.debut?.[pris];
  if (pris < 3 && x && 'QWE'.includes(x) && lv[x] < plafond) return x;
  for (const c of ordre.max) if ('QWE'.includes(c) && lv[c] < plafond) return c;
  return null;
}

// Les prochains objets du build que tu n'as pas encore : 1er objet, bottes,
// la suite du cœur, puis les objets de situation, en commençant par ceux qui
// répondent à la compo adverse (armure contre du physique, résistance
// magique contre du magique). `physique` : part de dégâts physiques en face.
export function prochainsAchats(build, possedes, items, physique) {
  if (!build) return null;
  const a = new Set(possedes);
  const bottes = possedes.some((id) => items[id]?.t?.includes('Boots'));
  const coeur = build.coeur?.ids ?? [];
  const ordre = [...coeur.slice(0, 1)];
  if (build.bottes?.id && !bottes) ordre.push(build.bottes.id);
  ordre.push(...coeur.slice(1));

  let situation = (build.situation ?? []).map((s) => s.id);
  const tag = physique >= 0.65 ? 'Armor' : physique <= 0.4 ? 'SpellBlock' : null;
  const adaptes = tag ? situation.filter((id) => items[id]?.t?.includes(tag)) : [];
  situation = [...adaptes, ...situation.filter((id) => !adaptes.includes(id))];
  ordre.push(...situation);

  const suivants = [...new Set(ordre)].filter((id) => !a.has(id) && items[id]).slice(0, 3);
  const adapte = suivants.find((id) => adaptes.includes(id));
  return {
    suivants,
    raison: adapte ? (tag === 'Armor' ? 'Surtout des dégâts physiques en face' : 'Surtout des dégâts magiques en face') : null,
  };
}

export const minutes = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
export const milliers = (n) => {
  const a = Math.abs(n);
  const t = a >= 1000 ? `${(a / 1000).toFixed(1).replace('.', ',')} k` : String(Math.round(a));
  return n > 0 ? `+${t}` : n < 0 ? `−${t}` : '0';
};
