/**
 * L'interface n'a aucun état à elle.
 *
 * Elle reçoit une vue complète à chaque battement (toutes les deux secondes) et
 * se redessine. Rien à resynchroniser, donc rien à désynchroniser : une fenêtre
 * qui affiche « en partie » alors que la partie est finie serait le pire défaut
 * possible pour cette application.
 */

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const ouvrirUrl = window.__TAURI__.opener?.openUrl;

const $ = (id) => document.getElementById(id);

/* --- Mise en mots de l'état ------------------------------------------------ */

/**
 * Les codes de map sont les noms internes de Riot (Triad = Haven,
 * Juliett = Sunset). La traduction complète se fait côté serveur, depuis
 * valorant-api.com ; ici on garde les plus courantes pour l'affichage, et on
 * retombe sur le code brut quand on ne connaît pas — jamais sur un vide, qui
 * donnerait l'impression que l'application a perdu le fil.
 */
const MAPS = {
  ascent: 'Ascent', bonsai: 'Split', canyon: 'Fracture', duality: 'Bind',
  foxtrot: 'Breeze', infinity: 'Abyss', jam: 'Lotus', juliett: 'Sunset',
  pitt: 'Pearl', plummet: 'Summit', port: 'Icebox', rook: 'Corrode',
  triad: 'Haven',
};
const nomDeMap = (code) => (code ? MAPS[code.toLowerCase()] ?? code : null);

const FILES = {
  competitive: 'Compétitive', unrated: 'Non classée', swiftplay: 'Swiftplay',
  spikerush: 'Spike Rush', deathmatch: 'Deathmatch', team_deathmatch: 'Team Deathmatch',
  hurm: 'Team Deathmatch', ggteam: 'Escalade', onefa: 'Réplication',
  skirmish2v2: '2v2', premier: 'Premier',
};
const nomDeFile = (id) => (id ? FILES[id.toLowerCase()] ?? id : null);

/** Le libellé et la couleur, pour un état donné. */
function apparence(etat) {
  if (!etat) return { classe: 'etat-attente', texte: 'Lecture…' };
  if (!etat.client_riot) return { classe: 'etat-attente', texte: 'Client Riot fermé' };
  switch (etat.etat) {
    case 'Ingame': return { classe: 'etat-ingame', texte: 'En partie' };
    case 'Pregame': return { classe: 'etat-pregame', texte: 'Sélection d\'agents' };
    case 'Menus': return { classe: 'etat-menus', texte: 'Dans les menus' };
    default: return { classe: 'etat-attente', texte: 'Valorant fermé' };
  }
}

/* --- Dessin ---------------------------------------------------------------- */

function dessiner(vue) {
  $('version').textContent = `v${vue.version}`;
  $('ecran-appairage').hidden = vue.appairee;
  $('ecran-etat').hidden = !vue.appairee;

  if (!vue.appairee) return;

  $('compte').textContent = vue.utilisateur ?? '—';
  $('riot-id').textContent = vue.riot_id ?? '';

  const { classe, texte } = apparence(vue.etat);
  $('pastille').className = `pastille ${classe}`;
  $('libelle').textContent = texte;

  const lignes = [];
  const map = nomDeMap(vue.etat?.map_code);
  const file = nomDeFile(vue.etat?.queue);
  if (map) lignes.push(['Map', map]);
  if (file) lignes.push(['Mode', file]);
  if (vue.etat?.party_size > 1) lignes.push(['Groupe', `${vue.etat.party_size} joueurs`]);

  $('details').replaceChildren(
    ...lignes.flatMap(([cle, valeur]) => {
      const dt = document.createElement('dt');
      dt.textContent = cle;
      const dd = document.createElement('dd');
      dd.textContent = valeur;
      return [dt, dd];
    }),
  );

  const souci = vue.etat?.souci ?? null;
  $('souci').hidden = !souci;
  $('souci').textContent = souci ?? '';
}

function retour(texte, genre) {
  const el = $('retour');
  el.hidden = !texte;
  el.textContent = texte ?? '';
  el.className = `retour${genre ? ` ${genre}` : ''}`;
}

/* --- Interactions ----------------------------------------------------------- */

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
    dessiner(await invoke('etat_actuel'));
  } catch (err) {
    retour(String(err), 'ko');
  } finally {
    bouton.disabled = false;
  }
});

$('oublier').addEventListener('click', async () => {
  await invoke('oublier');
  retour('Ce PC a été oublié. Le site garde l\'appareil dans sa liste — retire-le depuis ton tableau de bord.');
  dessiner(await invoke('etat_actuel'));
});

for (const id of ['ouvrir-site', 'ouvrir-site-2']) {
  $(id).addEventListener('click', (e) => {
    e.preventDefault();
    ouvrirUrl?.(`${site}/dashboard.html`);
  });
}

/* --- Boucle ---------------------------------------------------------------- */

listen('etat', (e) => {
  site = e.payload.site ?? site;
  dessiner(e.payload);
});

// Premier dessin sans attendre le premier battement : deux secondes de fenêtre
// vide au lancement, c'est deux secondes de trop.
invoke('etat_actuel').then((vue) => {
  site = vue.site ?? site;
  dessiner(vue);
});
