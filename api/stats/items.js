// Classement des items d'un patch, à partir des données officielles de Riot
// (Data Dragon). Sert à distinguer un item complet d'un composant, des bottes
// ou d'une potion quand on lit la chronologie d'achats d'une partie.

const CDN = 'https://ddragon.leagueoflegends.com';

// patch « 16.19 » → version Data Dragon « 16.19.1 » (la plus récente du patch).
let versions = null;
async function versionPour(patch) {
  versions ??= await (await fetch(`${CDN}/api/versions.json`)).json();
  return versions.find((v) => v.startsWith(`${patch}.`)) ?? versions[0];
}

export function classer(itemJson) {
  const complets = new Set();
  const bottes = new Set();
  const ignores = new Set(); // bijoux (trinkets) : jamais dans un build
  for (const [id, it] of Object.entries(itemJson.data ?? {})) {
    const tags = it.tags ?? [];
    if (tags.includes('Trinket')) { ignores.add(Number(id)); continue; }
    if (!it.gold?.purchasable || it.maps?.['11'] === false) continue;
    if (tags.includes('Boots')) {
      if ((it.depth ?? 1) >= 2) bottes.add(Number(id));
      continue;
    }
    if (tags.includes('Consumable')) continue;
    // Complet : ne se combine plus en rien, et coûte le prix d'un vrai item.
    const final = !it.into?.length;
    if (final && ((it.depth ?? 1) >= 3 || (it.gold?.total ?? 0) >= 2000)) complets.add(Number(id));
  }
  return { complets, bottes, ignores };
}

const cache = new Map();
export async function itemsDuPatch(patch) {
  if (!cache.has(patch)) {
    cache.set(patch, (async () => {
      const v = await versionPour(patch);
      const j = await (await fetch(`${CDN}/cdn/${v}/data/en_US/item.json`)).json();
      return classer(j);
    })().catch((e) => { cache.delete(patch); throw e; }));
  }
  return cache.get(patch);
}

// Patch en cours d'après Data Dragon : « 16.19.1 » → « 16.19 ».
export async function patchCourant() {
  versions ??= await (await fetch(`${CDN}/api/versions.json`)).json();
  return versions[0].split('.').slice(0, 2).join('.');
}

// Noms français des champions (« MonkeyKing » → « Wukong »), pour les phrases
// du debrief. En cache 12 h.
let noms = { at: 0, p: null };
export async function nomsChampions() {
  if (!noms.p || Date.now() - noms.at > 12 * 3600e3) {
    noms = { at: Date.now(), p: (async () => {
      const [v] = await (await fetch(`${CDN}/api/versions.json`)).json();
      const j = await (await fetch(`${CDN}/cdn/${v}/data/fr_FR/champion.json`)).json();
      return Object.fromEntries(Object.values(j.data).map((c) => [Number(c.key), c.name]));
    })().catch(() => ({})) };
  }
  return noms.p;
}
