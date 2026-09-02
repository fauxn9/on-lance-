/**
 * Donnees de calibration des maps (pour la heatmap).
 *
 * Les coordonnees de mort renvoyees par l'API sont en unites de jeu. Pour les
 * poser sur une image de minimap, il faut par map un couple multiplicateur +
 * decalage. Ces valeurs sont publiques et servies par valorant-api.com, qui
 * fournit aussi l'image de minimap elle-meme.
 *
 * API publique, sans cle, et donnees quasi statiques (elles ne bougent qu'a
 * l'ajout d'une map) : un cache memoire de 24 h suffit largement.
 *
 * En cas d'echec, on renvoie null plutot que de lever : une mort sans
 * coordonnees minimap reste une mort exploitable (distances, isolement,
 * angles). Seule la heatmap perd cette entree, et la conversion pourra etre
 * refaite plus tard puisqu'on stocke aussi les coordonnees de jeu brutes.
 */

const SOURCE = 'https://valorant-api.com/v1/maps';
const TTL_MS = 24 * 60 * 60 * 1000;

let cache = { at: 0, byName: null };

async function load() {
  if (cache.byName && Date.now() - cache.at < TTL_MS) return cache.byName;

  try {
    const res = await fetch(SOURCE);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();

    const byName = new Map();
    for (const m of json.data ?? []) {
      // Une map sans multiplicateur (modes speciaux, maps de tir) n'est pas
      // exploitable pour la heatmap : on ne la met pas en cache.
      if (typeof m.xMultiplier !== 'number' || typeof m.yMultiplier !== 'number') continue;
      byName.set(m.displayName, {
        name: m.displayName,
        xMultiplier: m.xMultiplier,
        yMultiplier: m.yMultiplier,
        xScalarToAdd: m.xScalarToAdd,
        yScalarToAdd: m.yScalarToAdd,
        minimapUrl: m.displayIcon ?? null,
      });
    }

    cache = { at: Date.now(), byName };
    return byName;
  } catch (err) {
    console.error(`[maps] calibration indisponible : ${err.message}`);
    // On garde un eventuel cache perime plutot que rien du tout.
    return cache.byName ?? new Map();
  }
}

export async function getCalibration(mapName) {
  if (!mapName) return null;
  return (await load()).get(mapName) ?? null;
}

export async function getAllCalibrations() {
  return await load();
}
