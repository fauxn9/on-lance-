// Data Dragon : noms et icônes officiels des champions, items, sorts,
// runes et icônes de profil. Mis en cache 12 h : tout ça ne change qu'aux
// patchs.

const CDN = 'https://ddragon.leagueoflegends.com';
const CLE = 'ddragon-v3';

let donnees = $state({ version: null, champions: {}, sorts: {}, runes: {} });

export async function chargerDDragon() {
  try {
    const cache = JSON.parse(localStorage.getItem(CLE) ?? 'null');
    if (cache && Date.now() - cache.at < 12 * 3600e3) {
      donnees = cache;
      return;
    }
  } catch {}
  try {
    const [version] = await (await fetch(`${CDN}/api/versions.json`)).json();
    const base = `${CDN}/cdn/${version}/data/fr_FR`;
    const [champs, sorts, runes] = await Promise.all(
      ['champion.json', 'summoner.json', 'runesReforged.json'].map((f) => fetch(`${base}/${f}`).then((r) => r.json())),
    );
    const champions = {};
    // attack / magic (0-10) : profil de dégâts, pour l'analyse des compos.
    for (const c of Object.values(champs.data)) champions[c.key] = { id: c.id, nom: c.name, ad: c.info?.attack ?? 5, ap: c.info?.magic ?? 5 };
    const s = {};
    for (const x of Object.values(sorts.data)) s[x.key] = { id: x.id, nom: x.name };
    const r = {};
    for (const style of runes) {
      r[style.id] = { nom: style.name, icone: style.icon };
      for (const slot of style.slots) for (const p of slot.runes) r[p.id] = { nom: p.name, icone: p.icon };
    }
    donnees = { at: Date.now(), version, champions, sorts: s, runes: r };
    try { localStorage.setItem(CLE, JSON.stringify(donnees)); } catch {}
  } catch {
    // Hors ligne : les icônes manqueront, le reste de l'app fonctionne.
  }
}

export const dd = {
  get pret() { return Boolean(donnees.version); },
  champion(id, secours) {
    const c = donnees.champions[id];
    return {
      nom: c?.nom ?? secours ?? '?',
      icone: donnees.version && c ? `${CDN}/cdn/${donnees.version}/img/champion/${c.id}.png` : null,
      splash: c ? `${CDN}/cdn/img/champion/splash/${c.id}_0.jpg` : null,
      // L'illustration verticale de l'écran de chargement du jeu (308 × 560).
      portrait: c ? `${CDN}/cdn/img/champion/loading/${c.id}_0.jpg` : null,
    };
  },
  // Tous les champions, triés par nom (recherche de build).
  get liste() {
    return Object.entries(donnees.champions)
      .map(([cle, c]) => ({ cle: Number(cle), nom: c.nom, icone: `${CDN}/cdn/${donnees.version}/img/champion/${c.id}.png` }))
      .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  },
  // Part de dégâts physiques estimée (0 à 1), d'après les notes officielles.
  physique(id) {
    const c = donnees.champions[id];
    return c ? c.ad / Math.max(1, c.ad + c.ap) : 0.5;
  },
  item: (id) => (donnees.version && id ? `${CDN}/cdn/${donnees.version}/img/item/${id}.png` : null),
  profil: (id) => (donnees.version && id != null ? `${CDN}/cdn/${donnees.version}/img/profileicon/${id}.png` : null),
  sort(id) {
    const s = donnees.sorts[id];
    return s ? { nom: s.nom, icone: `${CDN}/cdn/${donnees.version}/img/spell/${s.id}.png` } : null;
  },
  rune(id) {
    const r = donnees.runes[id];
    return r ? { nom: r.nom, icone: `${CDN}/cdn/img/${r.icone}` } : null;
  },
};
