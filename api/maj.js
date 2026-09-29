// Mises à jour de l'app (Tauri updater) : l'app demande /api/maj, on lui
// renvoie le latest.json de la dernière release « tracker-v… » publiée par
// GitHub Actions. Passer par ici plutôt que par l'URL GitHub directe garde la
// main : une version ratée se retire en supprimant sa release, sans toucher
// aux apps installées. Le paquet lui-même est signé : l'app vérifie la
// signature avec la clé publique embarquée, quoi que ce serveur réponde.

const DEPOT = 'fauxn9/on-lance-';
// Les releases « app-v… » du dépôt sont celles de l'ancienne app Valorant :
// ne jamais les proposer à l'app LoL.
const PREFIXE = 'tracker-v';
let cache = { at: 0, json: null };

export async function derniereVersion() {
  if (Date.now() - cache.at < 10 * 60_000) return cache.json;
  const r = await fetch(`https://api.github.com/repos/${DEPOT}/releases?per_page=30`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'onlance-maj' },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`GitHub : HTTP ${r.status}`);
  const release = (await r.json()).find((x) => !x.draft && !x.prerelease && x.tag_name.startsWith(PREFIXE));
  const asset = release?.assets.find((a) => a.name === 'latest.json');
  let json = null;
  if (asset) {
    const j = await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(8000) });
    if (j.ok) json = await j.json();
  }
  cache = { at: Date.now(), json };
  return json;
}

// Express : 200 + latest.json, ou 204 (rien de neuf publié).
export async function routeMaj(req, res) {
  try {
    const json = await derniereVersion();
    if (!json) return res.status(204).end();
    res.set('cache-control', 'no-store').json(json);
  } catch (err) {
    console.error('maj :', err.message);
    res.status(204).end();
  }
}
