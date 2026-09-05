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

let cache = { at: 0, byName: null, byCode: null };

async function load() {
  if (cache.byName && Date.now() - cache.at < TTL_MS) return cache;

  try {
    const res = await fetch(SOURCE);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();

    const byName = new Map();
    // La presence locale du client Riot ne donne pas le nom affichable d'une
    // map mais son nom interne : Triad pour Haven, Juliett pour Sunset. La
    // correspondance se lit dans `mapUrl`, qu'on indexe ici — plutot qu'une
    // table ecrite a la main, qui serait fausse a la prochaine map ajoutee.
    const byCode = new Map();

    for (const m of json.data ?? []) {
      const code = String(m.mapUrl ?? '').split('/').pop();
      if (code && m.displayName) byCode.set(code.toLowerCase(), m.displayName);

      // Une map sans multiplicateur (modes speciaux, maps de tir) n'est pas
      // exploitable pour la heatmap : on ne la met pas dans cet index-la.
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

    cache = { at: Date.now(), byName, byCode };
    return cache;
  } catch (err) {
    console.error(`[maps] calibration indisponible : ${err.message}`);
    // On garde un eventuel cache perime plutot que rien du tout.
    return { byName: cache.byName ?? new Map(), byCode: cache.byCode ?? new Map() };
  }
}

export async function getCalibration(mapName) {
  if (!mapName) return null;
  return (await load()).byName.get(mapName) ?? null;
}

export async function getAllCalibrations() {
  return (await load()).byName;
}

/**
 * Nom affichable d'une map a partir de son nom interne (Triad -> Haven).
 *
 * Renvoie le code tel quel si la correspondance est inconnue : mieux vaut
 * afficher « Triad » qu'un vide, et ca reste identifiable dans un journal.
 */
export async function nomDeMap(code) {
  if (!code) return null;
  const { byCode } = await load();
  return byCode.get(String(code).toLowerCase()) ?? String(code);
}
