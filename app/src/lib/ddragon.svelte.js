// Data Dragon : noms et icônes officiels des champions, items et icônes de
// profil. Mis en cache 12 h : la liste ne change qu'aux patchs.

const CDN = 'https://ddragon.leagueoflegends.com';
const CLE = 'ddragon-v1';

let donnees = $state({ version: null, parCle: {} });

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
    const champs = await (await fetch(`${CDN}/cdn/${version}/data/fr_FR/champion.json`)).json();
    const parCle = {};
    for (const c of Object.values(champs.data)) parCle[c.key] = { id: c.id, nom: c.name };
    donnees = { at: Date.now(), version, parCle };
    try { localStorage.setItem(CLE, JSON.stringify(donnees)); } catch {}
  } catch {
    // Hors ligne : les icônes manqueront, le reste de l'app fonctionne.
  }
}

export const dd = {
  get pret() { return Boolean(donnees.version); },
  champion(id, secours) {
    const c = donnees.parCle[id];
    return { nom: c?.nom ?? secours ?? '?', icone: donnees.version && c ? `${CDN}/cdn/${donnees.version}/img/champion/${c.id}.png` : null };
  },
  item: (id) => (donnees.version && id ? `${CDN}/cdn/${donnees.version}/img/item/${id}.png` : null),
  profil: (id) => (donnees.version && id != null ? `${CDN}/cdn/${donnees.version}/img/profileicon/${id}.png` : null),
};
