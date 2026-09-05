/**
 * L'interface n'a aucun état à elle.
 *
 * Elle reçoit une vue complète à chaque battement (toutes les deux secondes) et
 * se redessine. Rien à resynchroniser, donc rien à désynchroniser : une fenêtre
 * qui affiche « en partie » alors que la partie est finie serait le pire défaut
 * possible pour cette application.
 *
 * Le jeton d'appareil ne passe jamais par ici : `invoke('api', …)` demande à
 * Rust d'aller lire, et Rust seul détient le jeton.
 */

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const ouvrirUrl = window.__TAURI__.opener?.openUrl;

const $ = (id) => document.getElementById(id);

/* --- Traductions ------------------------------------------------------------ */

const FILES = {
  competitive: 'Compétitive', unrated: 'Non classée', swiftplay: 'Swiftplay',
  spikerush: 'Spike Rush', deathmatch: 'Deathmatch', team_deathmatch: 'Team Deathmatch',
  hurm: 'Team Deathmatch', ggteam: 'Escalade', onefa: 'Réplication',
  skirmish2v2: '2v2', premier: 'Premier',
};
const nomDeFile = (id) => (id ? FILES[id.toLowerCase()] ?? id : null);

/**
 * Les visuels — image de map, et surtout la traduction du nom interne
 * (`Triad`) en nom affichable (`Haven`). Elle vient du serveur, qui la tient de
 * valorant-api.com : aucune table écrite à la main ici, elle serait fausse à la
 * prochaine map ajoutée.
 */
let visuels = { maps: {}, agents: {}, codes: {} };

async function chargerVisuels() {
  try {
    visuels = await invoke('api', { chemin: '/visuels' });
  } catch {
    // Sans visuels, l'application reste entièrement lisible : c'est de
    // l'habillage, jamais de l'information.
  }
}

const nomDeMap = (code) => (code ? visuels.codes?.[code.toLowerCase()] ?? code : null);
const imageDeMap = (code) => visuels.maps?.[nomDeMap(code)] ?? null;
// Le nom du rang vient du serveur, pas d'une echelle recopiee ici : deux copies
// finiraient par afficher deux noms differents pour le meme joueur.
const nomDuRang = (tier) => (tier ? visuels.rangs?.[tier] ?? null : null);

/* --- Vues ------------------------------------------------------------------- */

function activerVue(nom) {
  for (const section of document.querySelectorAll('.vue')) {
    const active = section.dataset.vue === nom;
    section.classList.toggle('sortante', !active && section.classList.contains('active'));
    section.classList.toggle('active', active);
  }
  for (const onglet of document.querySelectorAll('.onglet')) {
    onglet.classList.toggle('actif', onglet.dataset.vue === nom);
  }
  placerGlisseur();
  if (nom === 'classement') chargerClassement();
}

/** L'indicateur suit l'onglet actif, en position et en largeur. */
function placerGlisseur() {
  const actif = document.querySelector('.onglet.actif');
  const glisseur = $('glisseur');
  if (!actif || !glisseur) return;
  glisseur.style.width = `${actif.offsetWidth}px`;
  glisseur.style.transform = `translateX(${actif.offsetLeft}px)`;
}

/* --- Écran 1 : l'état en direct --------------------------------------------- */

function apparence(etat) {
  if (!etat) return { classe: '', texte: 'Lecture…' };
  if (!etat.client_riot) return { classe: '', texte: 'Client Riot fermé' };
  switch (etat.etat) {
    case 'Ingame': return { classe: 'etat-ingame', texte: 'En partie' };
    case 'Pregame': return { classe: 'etat-pregame', texte: "Sélection d'agents" };
    case 'Menus': return { classe: 'etat-menus', texte: 'Dans les menus' };
    default: return { classe: '', texte: 'Valorant fermé' };
  }
}

/** Dernier score affiché, pour n'animer que les chiffres qui changent. */
let dernierScore = { nous: null, eux: null };

function poserChiffre(el, valeur, cle) {
  const texte = String(valeur ?? 0);
  if (el.textContent === texte) return;
  el.textContent = texte;
  if (dernierScore[cle] !== null) {
    el.classList.remove('saute');
    // Forcer un reflow : sans ça, retirer puis remettre la classe dans le même
    // tour de boucle ne relance pas l'animation.
    void el.offsetWidth;
    el.classList.add('saute');
  }
  dernierScore[cle] = valeur;
}

function dessinerDirect(vue) {
  const etat = vue.etat;
  const enPartie = etat?.etat === 'Ingame';

  const { classe, texte } = apparence(etat);
  $('pastille').className = `pastille ${classe}`;
  $('libelle').textContent = texte;
  $('scene').classList.toggle('en-partie', enPartie);

  $('mode').textContent = nomDeFile(etat?.queue) ?? '';
  $('map').textContent = nomDeMap(etat?.map_code) ?? '';
  $('groupe').textContent = etat?.party_size > 1 ? `groupe de ${etat.party_size}` : '';

  const image = imageDeMap(etat?.map_code);
  const fond = $('fond');
  fond.style.backgroundImage = image ? `url("${image}")` : '';
  fond.classList.toggle('visible', Boolean(image));

  // Le score n'existe que pendant la partie. Ailleurs, l'afficher à 0-0
  // laisserait croire à une partie en cours.
  const score = enPartie ? (etat?.score ?? null) : null;
  $('score').hidden = !score;
  $('repos').hidden = Boolean(score);
  if (score) {
    poserChiffre($('score-nous'), score.nous, 'nous');
    poserChiffre($('score-eux'), score.eux, 'eux');
  } else {
    dernierScore = { nous: null, eux: null };
    const rang = nomDuRang(etat?.tier);
    $('rang-nom').hidden = !rang;
    $('rang-nom').textContent = rang ?? '';
    $('repos-texte').textContent = etat?.client_riot === false
      ? 'Lance le client Riot pour voir ton état ici'
      : rang ? "En attente d'une partie" : 'Valorant fermé';
  }

  $('souci').hidden = !etat?.souci;
  $('souci').textContent = etat?.souci ?? '';
}

/* --- Le fil des événements --------------------------------------------------- */

const MAX_FIL = 8;

const PHRASES = {
  groupe: (e) => `Le groupe passe à <strong>${e.taille}</strong>`,
  file: () => 'Recherche de partie lancée',
  selection: (e) => `Partie trouvée — <strong>${nomDeMap(e.map_code) ?? '?'}</strong>`,
  esquive: () => 'Quelqu\'un a quitté la sélection',
  debut: (e) => `Début de partie sur <strong>${nomDeMap(e.map_code) ?? '?'}</strong>`,
  fin: (e) => (e.score
    ? `Partie terminée <strong>${e.score.nous} – ${e.score.eux}</strong>`
    : 'Partie terminée'),
  ferme: () => 'Valorant fermé',
};

function ajouterAuFil(evenements) {
  const fil = $('fil');
  const heure = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  for (const e of evenements) {
    const phrase = PHRASES[e.type];
    if (!phrase) continue;

    const li = document.createElement('li');
    const h = document.createElement('span');
    h.className = 'heure';
    h.textContent = heure;
    const q = document.createElement('span');
    q.className = 'quoi';
    q.innerHTML = phrase(e);
    li.append(h, q);
    fil.prepend(li);
  }
  while (fil.children.length > MAX_FIL) fil.lastElementChild.remove();
}

/* --- Écran 2 : le classement -------------------------------------------------- */

let groupeCourant = null;
let chargementEnCours = false;

function resteAvant(iso) {
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return 'clôture imminente';
  const heures = Math.floor(ms / 3_600_000);
  const jours = Math.floor(heures / 24);
  if (jours >= 1) return `${jours} j ${heures % 24} h restantes`;
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return `${heures} h ${minutes} min restantes`;
}

async function chargerClassement() {
  if (chargementEnCours) return;
  chargementEnCours = true;
  try {
    if (!groupeCourant) {
      const { groups } = await invoke('api', { chemin: '/me/groups' });
      groupeCourant = groups?.[0]?.id ?? null;
    }
    if (!groupeCourant) {
      $('classement-vide').hidden = false;
      $('classement-vide').textContent = "Tu n'es dans aucun groupe.";
      return;
    }

    const data = await invoke('api', { chemin: `/groups/${groupeCourant}/leaderboard` });
    dessinerClassement(data);
  } catch (err) {
    $('classement-vide').hidden = false;
    $('classement-vide').textContent = String(err);
  } finally {
    chargementEnCours = false;
  }
}

function dessinerClassement(data) {
  $('semaine').textContent = data.label ?? 'Cette semaine';
  $('reste').textContent = data.isCurrentWeek && data.endsAt ? resteAvant(data.endsAt) : '';

  const standings = data.standings ?? [];
  const liste = $('classement');
  liste.replaceChildren();
  $('classement-vide').hidden = standings.length > 0;

  // L'échelle des barres : le plus gros total de la semaine fait la largeur
  // pleine. Une échelle absolue écraserait tout en début de semaine.
  const sommet = Math.max(1, ...standings.map((s) => Math.abs(s.rrTotal)));

  standings.forEach((s, i) => {
    const li = document.createElement('li');
    li.className = 'rang';
    if (s.rank === 1 && s.rrTotal > 0) li.classList.add('premier');
    if (s.displayName === moi) li.classList.add('moi');
    li.style.animationDelay = `${i * 55}ms`;

    const barre = document.createElement('span');
    barre.className = 'barre';

    const place = document.createElement('span');
    place.className = 'place';
    place.textContent = s.rank;

    const bloc = document.createElement('span');
    const nom = document.createElement('span');
    nom.className = 'nom';
    nom.textContent = s.displayName;
    const detail = document.createElement('span');
    detail.className = 'detail';
    detail.textContent = s.matches > 0
      ? `${s.matches} match${s.matches > 1 ? 's' : ''} · record +${s.bestGain ?? 0}`
      : 'aucune partie';
    bloc.append(nom, detail);

    const rr = document.createElement('span');
    const signe = s.rrTotal > 0 ? '+' : '';
    rr.className = `rr ${s.rrTotal > 0 ? 'positif' : s.rrTotal < 0 ? 'negatif' : 'nul'}`;
    rr.textContent = `${signe}${s.rrTotal}`;

    li.append(barre, place, bloc, rr);
    liste.append(li);

    // La barre part de zéro : on la remplit au tour suivant pour que la
    // transition CSS ait un point de départ à animer.
    requestAnimationFrame(() => {
      barre.style.width = `${Math.round((Math.abs(s.rrTotal) / sommet) * 100)}%`;
    });
  });
}

/* --- Vue globale -------------------------------------------------------------- */

let moi = null;

function dessiner(vue) {
  $('version').textContent = `v${vue.version}`;
  $('ecran-appairage').hidden = vue.appairee;
  $('app').hidden = !vue.appairee;
  $('qui').hidden = !vue.appairee;

  if (!vue.appairee) return;

  moi = vue.utilisateur ?? null;
  $('compte').textContent = vue.utilisateur ?? '—';
  $('riot-id').textContent = vue.riot_id ?? '';
  dessinerDirect(vue);
  placerGlisseur();
}

function retour(texte, genre) {
  const el = $('retour');
  el.hidden = !texte;
  el.textContent = texte ?? '';
  el.className = `retour${genre ? ` ${genre}` : ''}`;
  if (texte && genre === 'ok') setTimeout(() => { el.hidden = true; }, 6000);
}

/* --- Interactions --------------------------------------------------------------- */

let site = 'https://onlance.xyz';

// Saisie tolérante : le code est recopié à la main depuis un écran, souvent
// avec des espaces ou des tirets. Refuser pour ça obligerait à en régénérer un.
$('code').addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
});

$('form-appairage').addEventListener('submit', async (e) => {
  e.preventDefault();
  const bouton = $('bouton-appairer');
  bouton.disabled = true;
  retour('Appairage en cours…');
  try {
    const message = await invoke('appairer', { code: $('code').value });
    retour(message, 'ok');
    $('code').value = '';
    await chargerVisuels();
    dessiner(await invoke('etat_actuel'));
  } catch (err) {
    retour(String(err), 'ko');
  } finally {
    bouton.disabled = false;
  }
});

$('oublier').addEventListener('click', async () => {
  await invoke('oublier');
  groupeCourant = null;
  retour("Ce PC a été oublié. Le site garde l'appareil dans sa liste — retire-le depuis ton tableau de bord.");
  dessiner(await invoke('etat_actuel'));
});

for (const lien of document.querySelectorAll('[data-site]')) {
  lien.addEventListener('click', (e) => {
    e.preventDefault();
    ouvrirUrl?.(`${site}/dashboard.html`);
  });
}

$('onglets').addEventListener('click', (e) => {
  const onglet = e.target.closest('.onglet');
  if (onglet) activerVue(onglet.dataset.vue);
});

window.addEventListener('resize', placerGlisseur);

/* --- Boucle ------------------------------------------------------------------- */

listen('etat', (e) => {
  site = e.payload.site ?? site;
  dessiner(e.payload);
});

listen('evenements', (e) => {
  ajouterAuFil(e.payload ?? []);
  // Une partie qui se termine change le classement : on le rafraîchit, mais
  // pas tout de suite — le serveur a besoin d'un moment pour aller chercher le
  // match, et un classement identique rechargé pour rien n'apprend rien.
  if ((e.payload ?? []).some((ev) => ev.type === 'fin')) {
    setTimeout(chargerClassement, 45_000);
  }
});

// Premier dessin sans attendre le premier battement : deux secondes de fenêtre
// vide au lancement, c'est deux secondes de trop.
(async () => {
  const vue = await invoke('etat_actuel');
  site = vue.site ?? site;
  dessiner(vue);
  if (vue.appairee) {
    await chargerVisuels();
    dessiner(await invoke('etat_actuel'));
    chargerClassement();
  }
})();

// Le classement bouge quand les potes jouent, pas seulement quand on joue.
setInterval(() => {
  if (document.querySelector('.vue.active')?.dataset.vue === 'classement') chargerClassement();
}, 120_000);
