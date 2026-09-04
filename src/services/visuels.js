/**
 * Icônes d'agents et visuels de maps (valorant-api.com).
 *
 * Sert uniquement a l'habillage de l'historique des parties. Volontairement
 * separe de maps.js : celui-la ne garde que les maps CALIBREES pour la heatmap
 * et jette les autres, alors qu'ici on veut l'image de toutes les maps, meme
 * celles dont on ne sait pas placer les coordonnees.
 *
 * Le navigateur ne va pas chercher ces URL lui-meme : on les sert depuis notre
 * API, avec un cache. Ca evite deux appels externes a chaque chargement de page
 * et garde un seul endroit ou reparer si valorant-api change de forme.
 *
 * Si l'appel echoue, on renvoie des tables vides. L'historique s'affiche alors
 * sans images — degrade, jamais casse.
 */

const AGENTS = 'https://valorant-api.com/v1/agents?isPlayableCharacter=true';
const MAPS = 'https://valorant-api.com/v1/maps';
const TTL_MS = 24 * 60 * 60 * 1000;

let cache = { at: 0, data: null };

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} sur ${url}`);
  return res.json();
}

export async function getVisuels() {
  if (cache.data && Date.now() - cache.at < TTL_MS) return cache.data;

  try {
    const [agents, maps] = await Promise.all([fetchJson(AGENTS), fetchJson(MAPS)]);

    const data = { agents: {}, maps: {} };

    for (const a of agents.data ?? []) {
      // displayIcon : le buste sur fond transparent, lisible en petit.
      if (a.displayName && a.displayIcon) data.agents[a.displayName] = a.displayIcon;
    }

    for (const m of maps.data ?? []) {
      // listViewIcon : la vignette large que Riot utilise dans ses propres
      // listes de parties. Exactement le bon format ici.
      if (m.displayName && m.listViewIcon) data.maps[m.displayName] = m.listViewIcon;
    }

    cache = { at: Date.now(), data };
    return data;
  } catch (err) {
    console.error(`[visuels] indisponibles : ${err.message}`);
    // On ne met PAS l'echec en cache : le prochain appel reessaiera.
    return cache.data ?? { agents: {}, maps: {} };
  }
}
