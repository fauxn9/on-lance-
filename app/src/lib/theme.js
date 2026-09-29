// Les thèmes de l'app : une couleur d'accent (victoires, boutons, focus…) et
// des fonds légèrement teintés de cette couleur. Le choix est gardé dans le
// navigateur de l'app, partagé par la fenêtre principale et l'overlay.

const CLE = 'onlance.theme';

export const THEMES = [
  { id: 'volt', nom: 'Volt', couleur: '#d6ff3f', teinte: 0 },
  { id: 'hextech', nom: 'Hextech', couleur: '#4fdcff', teinte: 5 },
  { id: 'void', nom: 'Néant', couleur: '#b794ff', teinte: 6 },
  { id: 'solaire', nom: 'Solaire', couleur: '#ffbd45', teinte: 4 },
  { id: 'custom', nom: 'Custom', couleur: null, teinte: 5 },
];
export const DEFAUT = { id: 'volt', couleur: '#ff7ad9' };

// Les fonds du thème Volt, d'origine : les autres thèmes les teintent.
const FONDS = { bg: '#060709', 'bg-2': '#0a0c10', panel: '#0f1217', 'panel-2': '#141820', 'panel-3': '#1b2029' };

export const versRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const versHex = (rgb) => `#${rgb.map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')}`;

function luminance([r, g, b]) {
  const c = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
}
export const contraste = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

function versHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function depuisHsl([h, s, l]) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

// Une couleur choisie à la main doit rester lisible en texte sur le fond
// sombre (victoires, chiffres) : on l'éclaircit jusqu'à un contraste de 5,5.
export function lisible(hex) {
  let rgb = versRgb(hex);
  const fond = versRgb(FONDS.panel);
  const [h, s] = versHsl(rgb);
  let l = versHsl(rgb)[2];
  while (contraste(rgb, fond) < 5.5 && l < 0.95) {
    l += 0.02;
    rgb = depuisHsl([h, s, l]);
  }
  return versHex(rgb);
}

// Proche du rouge des défaites ? Victoires et défaites se ressembleraient.
export function procheDuRouge(hex) {
  const [h, s] = versHsl(versRgb(hex));
  return s > 0.35 && (h >= 330 || h <= 18);
}

export function lire() {
  try {
    const t = JSON.parse(localStorage.getItem(CLE));
    if (t && THEMES.some((x) => x.id === t.id)) return { ...DEFAUT, ...t };
  } catch {}
  return { ...DEFAUT };
}

export function couleurDe(choix) {
  const t = THEMES.find((x) => x.id === choix.id) ?? THEMES[0];
  return t.couleur ?? lisible(choix.couleur);
}

// Les variables CSS d'un thème (pour l'appliquer, ou pour les aperçus).
export function variables(choix) {
  const t = THEMES.find((x) => x.id === choix.id) ?? THEMES[0];
  const couleur = couleurDe(choix);
  const rgb = versRgb(couleur);
  const noir = [10, 12, 14];
  const encre = contraste(rgb, noir) >= contraste(rgb, [255, 255, 255]) ? '#0a0c0e' : '#ffffff';
  const v = { '--volt': couleur, '--volt-rgb': rgb.join(', '), '--volt-ink': encre };
  for (const [nom, fond] of Object.entries(FONDS)) {
    const f = versRgb(fond);
    v[`--${nom}`] = t.teinte ? versHex(f.map((x, i) => x + (rgb[i] - x) * (t.teinte / 100))) : fond;
  }
  return v;
}

export function appliquer(choix) {
  const racine = document.documentElement;
  for (const [k, val] of Object.entries(variables(choix))) racine.style.setProperty(k, val);
  racine.dataset.theme = choix.id;
}

export function choisir(choix) {
  try { localStorage.setItem(CLE, JSON.stringify(choix)); } catch {}
  appliquer(choix);
}

// Au démarrage de chaque fenêtre, et quand l'autre fenêtre change de thème.
export function demarrer() {
  appliquer(lire());
  addEventListener('storage', (e) => { if (e.key === CLE) appliquer(lire()); });
}
