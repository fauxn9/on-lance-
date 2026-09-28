// Tout ce qui transforme une donnée brute en français lisible.

const TIERS = {
  IRON: 'Fer', BRONZE: 'Bronze', SILVER: 'Argent', GOLD: 'Or', PLATINUM: 'Platine',
  EMERALD: 'Émeraude', DIAMOND: 'Diamant', MASTER: 'Maître', GRANDMASTER: 'Grand Maître', CHALLENGER: 'Challenger',
};
export const COULEUR_TIER = {
  IRON: '#9a9a9a', BRONZE: '#c98a5a', SILVER: '#b8c4cf', GOLD: '#e8c35a', PLATINUM: '#4fd1c5',
  EMERALD: '#3ddc84', DIAMOND: '#7aa7ff', MASTER: '#c77dff', GRANDMASTER: '#ff5a6e', CHALLENGER: '#ffd166',
};

export function nomRang(tier, division) {
  const t = TIERS[tier] ?? tier;
  return ['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(tier) || !division ? t : `${t} ${division}`;
}

// Inverse de l'échelle continue du serveur (Fer IV 0 PL = 0, 100 par division).
const ORDRE_TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND'];
export function rangDepuisEchelle(l) {
  if (l == null) return null;
  if (l >= 2800) return { tier: 'MASTER', division: null, nom: 'Maître+' };
  const tier = ORDRE_TIERS[Math.max(0, Math.floor(l / 400))];
  const division = ['IV', 'III', 'II', 'I'][Math.floor((l % 400) / 100)];
  return { tier, division, nom: nomRang(tier, division) };
}

const FILES = {
  420: 'Classée Solo/Duo', 440: 'Classée Flex', 400: 'Normale (draft)', 430: 'Normale (aveugle)',
  480: 'Swiftplay', 490: 'Partie rapide', 450: 'ARAM', 2400: 'ARAM Mayhem', 1700: 'Arena', 1710: 'Arena',
  900: 'ARURF', 1900: 'URF', 1020: 'Un pour tous', 700: 'Clash', 720: 'Clash ARAM', 0: 'Personnalisée',
  830: "Contre l'IA", 840: "Contre l'IA", 850: "Contre l'IA", 870: "Contre l'IA", 880: "Contre l'IA", 890: "Contre l'IA",
};
export const nomFile = (id) => FILES[id] ?? 'Autre mode';

export const nomFileClassee = (q) => (q === 'RANKED_SOLO_5x5' ? 'Classée Solo/Duo' : 'Classée Flex');

const POSTES = { TOP: 'Top', JUNGLE: 'Jungle', MIDDLE: 'Mid', BOTTOM: 'ADC', UTILITY: 'Support' };
export const nomPoste = (p) => POSTES[p] ?? '';

const FRAGMENTS = {
  5008: 'Force adaptative', 5005: "Vitesse d'attaque", 5007: 'Accélération de compétence', 5010: 'Vitesse de déplacement',
  5001: 'PV croissants', 5011: 'PV', 5013: 'Ténacité', 5002: 'Armure', 5003: 'Résistance magique',
};
export const nomFragment = (id) => FRAGMENTS[id] ?? 'Fragment';

const PHASES = { PLANNING: 'Planification', BAN_PICK: 'Bans et picks', FINALIZATION: 'Finalisation', GAME_STARTING: 'Lancement' };
export const nomPhase = (p) => PHASES[p] ?? 'Sélection';

const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });
export function ilYa(ms) {
  const s = (ms - Date.now()) / 1000;
  const unites = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [u, n] of unites) if (Math.abs(s) >= n) return rtf.format(Math.round(s / n), u);
  return "à l'instant";
}

// Version courte pour les listes serrées : « 24 min », « 6 h », « hier », « 3 j ».
const jourMois = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
export function ilYaCourt(ms) {
  const min = (Date.now() - ms) / 60000;
  if (min < 1) return "à l'instant";
  if (min < 60) return `${Math.round(min)} min`;
  if (min < 1440) return `${Math.round(min / 60)} h`;
  if (min < 2880) return 'hier';
  if (min < 10080) return `${Math.round(min / 1440)} j`;
  return jourMois.format(ms);
}

export const duree = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

const nf1 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const un = (n) => nf1.format(n);
export const kda = (k, d, a) => (d === 0 ? 'Parfait' : nf2.format((k + a) / d));
export const pourcent = (v, t) => (t ? `${Math.round((100 * v) / t)} %` : '—');
export const signe = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');
