// Mises à jour de l'app (Tauri updater) : l'app demande /api/maj, on lui
// renvoie le latest.json de la dernière release « tracker-v… » publiée par
// GitHub Actions. Passer par ici plutôt que par l'URL GitHub directe garde la
// main : une version ratée se retire en supprimant sa release, sans toucher
// aux apps installées. Le paquet lui-même est signé : l'app vérifie la
// signature avec la clé publique embarquée, quoi que ce serveur réponde.
//
// On lit le lien de téléchargement direct de la dernière release, pas l'API
// GitHub : l'API limite à 60 appels par heure et par IP, et les IP de Render
// sont partagées entre beaucoup de sites (elle répond 403 bien avant).

const DEPOT = 'fauxn9/on-lance-';
// Les releases « app-v… » du dépôt sont celles de l'ancienne app Valorant :
// ne jamais les proposer à l'app LoL.
const PREFIXE = 'tracker-v';
let cache = { at: 0, json: null };

// Le latest.json est bien celui de l'app LoL : son installeur est rangé dans
// une release « tracker-v… ».
export const estDeLApp = (json) =>
  Boolean(json?.version) && Object.values(json.platforms ?? {}).some((p) => String(p?.url ?? '').includes(`/download/${PREFIXE}`));

export async function derniereVersion() {
  if (Date.now() - cache.at < 10 * 60_000) return cache.json;
  const r = await fetch(`https://github.com/${DEPOT}/releases/latest/download/latest.json`, {
    headers: { 'user-agent': 'onlance-maj' },
    redirect: 'follow',
    signal: AbortSignal.timeout(8000),
  });
  let json = null;
  if (r.ok) {
    const j = await r.json().catch(() => null);
    if (estDeLApp(j)) json = j;
  } else if (r.status !== 404) {
    throw new Error(`GitHub : HTTP ${r.status}`);
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
