// Classement des items d'un patch, à partir des données officielles de Riot
// (Data Dragon). Sert à distinguer un item complet d'un composant, des bottes
// ou d'une potion quand on lit la chronologie d'achats d'une partie.

const CDN = 'https://ddragon.leagueoflegends.com';

// Versions Data Dragon, relues toutes les 3 h : le serveur tourne des jours
// sans redémarrer, il doit voir arriver le patch suivant.
let versions = { at: 0, liste: null };
async function lireVersions() {
  if (!versions.liste || Date.now() - versions.at > 3 * 3600e3) {
    const liste = await (await fetch(`${CDN}/api/versions.json`)).json();
    versions = { at: Date.now(), liste };
  }
  return versions.liste;
}

// patch « 16.19 » → version Data Dragon « 16.19.1 » (la plus récente du patch).
async function versionPour(patch) {
  const v = await lireVersions();
  return v.find((x) => x.startsWith(`${patch}.`)) ?? v[0];
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
  return (await patchsRecents(1))[0];
}

// Les n derniers patchs, du plus récent au plus ancien : « 16.19 », « 16.18 »…
// (lus dans Data Dragon, donc justes aussi au changement de saison).
export async function patchsRecents(n) {
  const vus = [];
  for (const v of await lireVersions()) {
    const p = v.split('.').slice(0, 2).join('.');
    if (!vus.includes(p)) vus.push(p);
    if (vus.length === n) break;
  }
  return vus;
}

// Champions en français (« MonkeyKing » → « Wukong ») avec leur icône, pour
// les phrases du debrief et du chambrage. En cache 12 h.
let infos = { at: 0, p: null };
export async function infosChampions() {
  if (!infos.p || Date.now() - infos.at > 12 * 3600e3) {
    infos = { at: Date.now(), p: (async () => {
      const [v] = await (await fetch(`${CDN}/api/versions.json`)).json();
      const j = await (await fetch(`${CDN}/cdn/${v}/data/fr_FR/champion.json`)).json();
      const parCle = {};
      for (const c of Object.values(j.data)) parCle[Number(c.key)] = { nom: c.name, id: c.id, icone: `${CDN}/cdn/${v}/img/champion/${c.id}.png` };
      return { version: v, parCle };
    })().catch(() => ({ version: null, parCle: {} })) };
  }
  return infos.p;
}

export async function nomsChampions() {
  const { parCle } = await infosChampions();
  return Object.fromEntries(Object.entries(parCle).map(([k, c]) => [k, c.nom]));
}
