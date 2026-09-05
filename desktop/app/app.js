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
  if (nom === 'parties') chargerParties();
  if (nom === 'coach') chargerCoach();
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

/**
 * Le score de la dernière partie terminée.
 *
 * Il vient de l'événement `fin`, pas du serveur : c'est la machine locale qui
 * l'a gelé avant la remise à zéro, et personne d'autre ne l'a vu.
 */
let dernierScoreFin = null;

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

/* --- Écran 3 : l'historique des parties ---------------------------------------- */

const imageAgent = (agent) => visuels.agents?.[agent] ?? null;
const imageMap = (nom) => visuels.maps?.[nom] ?? null;

let partiesChargees = false;

async function chargerParties() {
  if (partiesChargees) return;
  try {
    const { matches } = await invoke('api', { chemin: '/me/matches?limit=15' });
    partiesChargees = true;
    dessinerParties(matches ?? []);
  } catch (err) {
    $('parties-vide').hidden = false;
    $('parties-vide').textContent = String(err);
  }
}

function dessinerParties(matches) {
  const liste = $('parties');
  liste.replaceChildren();
  $('parties-vide').hidden = matches.length > 0;
  if (matches.length === 0) $('parties-vide').textContent = 'Aucune partie enregistrée.';

  matches.forEach((m, i) => {
    const li = document.createElement('li');
    li.className = `partie${m.won ? ' gagnee' : ''}`;
    li.style.animationDelay = `${i * 45}ms`;

    const tete = document.createElement('div');
    tete.className = 'partie-tete';
    tete.setAttribute('role', 'button');
    tete.tabIndex = 0;

    const art = document.createElement('span');
    art.className = 'partie-map-art';
    const fondMap = imageMap(m.map);
    if (fondMap) art.style.backgroundImage = `url("${fondMap}")`;

    const agent = document.createElement('span');
    agent.className = 'agent';
    const iconeAgent = imageAgent(m.agent);
    if (iconeAgent) agent.style.backgroundImage = `url("${iconeAgent}")`;
    agent.title = m.agent ?? '';

    const milieu = document.createElement('span');
    const titre = document.createElement('span');
    titre.className = 'partie-titre';
    titre.textContent = m.map ?? '?';
    const detail = document.createElement('span');
    detail.className = 'partie-detail';
    detail.textContent = `${m.acs ?? '—'} ACS · ${dateCourte(m.playedAt)}`;
    milieu.append(titre, detail);

    const droite = document.createElement('span');
    droite.className = 'partie-droite';
    const kda = document.createElement('span');
    kda.className = 'partie-kda';
    kda.textContent = `${m.kills}/${m.deaths}/${m.assists}`;
    const rr = document.createElement('span');
    rr.className = 'partie-rr';
    if (Number.isFinite(m.rrChange)) {
      rr.textContent = `${m.rrChange > 0 ? '+' : ''}${m.rrChange} RR`;
      rr.style.color = m.rrChange > 0 ? 'var(--gain)' : m.rrChange < 0 ? 'var(--loss)' : 'var(--faint)';
    }
    droite.append(kda, rr);

    tete.append(art, agent, milieu, droite);

    // Le panneau est créé vide : la feuille de match n'est demandée qu'au
    // premier dépli, et une seule fois.
    const boite = document.createElement('div');
    boite.className = 'feuille-boite';
    const feuille = document.createElement('div');
    feuille.className = 'feuille';
    const dedans = document.createElement('div');
    dedans.className = 'feuille-dedans';
    feuille.append(dedans);
    boite.append(feuille);

    const basculer = () => basculerPartie(li, dedans, m.matchId);
    tete.addEventListener('click', basculer);
    tete.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); basculer(); }
    });

    li.append(tete, boite);
    liste.append(li);
  });
}

const dateCourte = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
};

async function basculerPartie(li, dedans, matchId) {
  const ouverte = li.classList.toggle('ouverte');
  if (!ouverte || dedans.dataset.charge === '1') return;

  dedans.textContent = 'Chargement…';
  try {
    const feuille = await invoke('api', { chemin: `/me/matches/${matchId}/scoreboard` });
    dedans.dataset.charge = '1';
    dessinerFeuille(dedans, feuille);
  } catch (err) {
    // Les parties analysées avant l'ajout de la feuille de match n'en ont pas :
    // le serveur le dit en clair, on le répète tel quel.
    dedans.textContent = String(err);
  }
}

function dessinerFeuille(dedans, feuille) {
  dedans.replaceChildren();
  const joueurs = feuille.joueurs ?? [];
  const monEquipe = joueurs.find((j) => j.moi)?.team ?? null;

  for (const [cle, titre] of [['nous', 'Mon équipe'], ['eux', 'Adversaires']]) {
    const membres = joueurs.filter((j) => (cle === 'nous') === (j.team === monEquipe));
    if (membres.length === 0) continue;

    const bloc = document.createElement('div');
    bloc.className = `equipe ${cle}`;
    const t = document.createElement('div');
    t.className = 'equipe-titre';
    t.textContent = titre;
    bloc.append(t);

    for (const j of membres) {
      const ligne = document.createElement('div');
      ligne.className = `joueur${j.moi ? ' c-est-moi' : ''}`;

      const mini = document.createElement('span');
      mini.className = 'mini';
      const icone = imageAgent(j.agent);
      if (icone) mini.style.backgroundImage = `url("${icone}")`;
      mini.title = j.agent ?? '';

      const nom = document.createElement('span');
      nom.className = 'qui-nom';
      nom.textContent = j.name ?? '?';

      const acs = document.createElement('span');
      acs.className = 'acs';
      acs.textContent = j.acs != null ? `${j.acs} ACS` : '';

      const kda = document.createElement('span');
      kda.className = 'kda';
      kda.textContent = `${j.kills}/${j.deaths}/${j.assists}`;

      ligne.append(mini, nom, acs, kda);
      bloc.append(ligne);
    }
    dedans.append(bloc);
  }
}

/* --- Écran 4 : le coach --------------------------------------------------------- */

let coachCharge = false;

async function chargerCoach() {
  if (coachCharge) return;
  try {
    // Sans `generate=1` : on ne demande que les faits calculés. La mise en mots
    // par l'IA coûte de l'argent à chaque appel et reste réservée au site.
    const rapport = await invoke('api', { chemin: '/me/coach?days=14' });
    coachCharge = true;
    dessinerCoach(rapport);
  } catch (err) {
    $('coach-vide').hidden = false;
    $('coach-vide').textContent = String(err);
  }
}

const GRAVITES = { fort: 'fort', net: 'net', info: 'info' };

function dessinerCoach(rapport) {
  const patterns = rapport.patterns ?? [];
  $('coach-vide').hidden = patterns.length > 0;
  if (patterns.length === 0) {
    $('coach-vide').textContent = rapport.message
      ?? 'Pas encore assez de parties analysées pour conclure quoi que ce soit.';
    $('coach-note').hidden = true;
    return;
  }

  $('coach-tete').hidden = !rapport.rang;
  $('coach-rang').textContent = rapport.rang ?? '';
  $('coach-groupe').textContent = rapport.groupe?.taille
    ? `comparé à ${rapport.groupe.taille} joueurs de ton niveau`
    : '';
  $('coach-note').hidden = false;

  const boite = $('constats');
  boite.replaceChildren();

  patterns.forEach((p, i) => {
    const carte = document.createElement('article');
    carte.className = `constat ${GRAVITES[p.severity] ?? 'info'}`;
    carte.style.animationDelay = `${i * 70}ms`;

    const titre = document.createElement('div');
    titre.className = 'constat-titre';
    const nom = document.createElement('span');
    nom.textContent = TITRES_AXES[p.key] ?? p.key;
    const grav = document.createElement('span');
    grav.className = 'gravite';
    grav.textContent = p.severity ?? '';
    titre.append(nom, grav);

    const fait = document.createElement('p');
    fait.className = 'constat-fait';
    fait.textContent = p.fact ?? '';

    carte.append(titre, fait);

    // Les deux jauges n'ont de sens que si on a une référence à comparer.
    if (Number.isFinite(p.valeur) && Number.isFinite(p.reference)) {
      const sommet = Math.max(p.valeur, p.reference, 1);
      carte.append(
        jauge('moi', 'toi', p.valeur, sommet, p.unite),
        jauge('repere', 'ton rang', p.reference, sommet, p.unite),
      );
    }

    if (p.sample) {
      const ech = document.createElement('div');
      ech.className = 'echantillon';
      ech.textContent = `sur ${p.sample} observations`;
      carte.append(ech);
    }

    boite.append(carte);
  });
}

const TITRES_AXES = {
  ouverture: 'Premier mort du round',
  entree: 'Morts en début de round',
  isolement: 'Morts isolées',
  trade: 'Morts non tradables',
  degats_recus: 'Dégâts encaissés',
  degats_infliges: 'Dégâts infligés',
  precision: 'Précision',
  apres_plant: 'Morts après le plant',
};

function jauge(classe, etiquette, valeur, sommet, unite) {
  const bloc = document.createElement('div');
  bloc.className = `jauge ${classe}`;

  const nom = document.createElement('span');
  nom.className = 'jauge-nom';
  nom.textContent = etiquette;

  const piste = document.createElement('span');
  piste.className = 'jauge-piste';
  const remplissage = document.createElement('span');
  remplissage.className = 'jauge-remplissage';
  piste.append(remplissage);

  const val = document.createElement('span');
  val.className = 'jauge-valeur';
  val.textContent = `${valeur}${unite ?? ''}`;

  bloc.append(nom, piste, val);
  requestAnimationFrame(() => {
    remplissage.style.width = `${Math.round((valeur / sommet) * 100)}%`;
  });
  return bloc;
}

/* --- Le débrief de fin de partie ------------------------------------------------ */

/**
 * L'application sait qu'une partie vient de finir. Le serveur, lui, doit encore
 * aller la chercher — et l'API met un moment à la publier. On surveille donc
 * l'apparition d'un match plus récent que celui qu'on connaissait, puis on
 * demande son débrief.
 *
 * Les délais montent : inutile de harceler le serveur pendant cinq minutes à
 * un appel toutes les deux secondes pour un événement qui arrive une fois par
 * demi-heure.
 */
const ATTENTES_MS = [20_000, 25_000, 30_000, 45_000, 60_000, 60_000, 90_000];

let dernierMatchConnu = null;
let guetteEnCours = false;

const patienter = (ms) => new Promise((r) => setTimeout(r, ms));

async function dernierMatchId() {
  try {
    const { matches } = await invoke('api', { chemin: '/me/matches?limit=1' });
    return matches?.[0]?.matchId ?? null;
  } catch {
    return null;
  }
}

async function guetterLeDebrief() {
  if (guetteEnCours) return;
  guetteEnCours = true;
  const avant = dernierMatchConnu;

  try {
    for (const attente of ATTENTES_MS) {
      await patienter(attente);
      const id = await dernierMatchId();
      if (!id || id === avant) continue;

      dernierMatchConnu = id;
      try {
        const debrief = await invoke('api', { chemin: `/me/matches/${id}/debrief` });
        // Les listes déjà chargées ne connaissent pas cette partie.
        partiesChargees = false;
        coachCharge = false;
        chargerClassement();
        montrerDebrief(debrief);
        return;
      } catch {
        // La partie existe mais n'est pas encore analysée : on continue.
      }
    }
  } finally {
    guetteEnCours = false;
  }
}

function montrerDebrief(d) {
  const joueurs = d.joueurs ?? [];
  const moi = joueurs.find((j) => j.moi);
  const monEquipe = moi?.team ?? null;

  const nous = joueurs.filter((j) => j.team === monEquipe);
  const eux = joueurs.filter((j) => j.team !== monEquipe);

  // Le score de la partie : le nombre de rounds gagnés n'est pas stocké
  // joueur par joueur, mais `won` l'est. On l'affiche donc à partir de ce
  // qu'on sait, sans inventer un score qu'on n'a pas.
  const gagne = moi?.won === true;
  $('debrief-issue').textContent = gagne ? 'Victoire' : moi?.won === false ? 'Défaite' : 'Partie terminée';
  $('debrief-issue').className = `issue ${gagne ? 'gagne' : moi?.won === false ? 'perdu' : ''}`;

  const carte = d.map ?? null;
  $('debrief-map').textContent = carte ?? '';
  const image = carte ? visuels.maps?.[carte] : null;
  $('debrief-fond').style.backgroundImage = image ? `url("${image}")` : '';

  // Le score observé par l'application prime : la machine l'a gelé juste avant
  // la remise à zéro, personne d'autre ne l'a vu. Celui du serveur n'est qu'un
  // repli, déduit du nombre de rounds et de l'issue.
  const score = dernierScoreFin ?? d.score ?? null;
  $('debrief-nous').textContent = score?.nous ?? '—';
  $('debrief-eux').textContent = score?.eux ?? '—';

  $('debrief-vanne').hidden = !d.message?.body;
  $('debrief-vanne').textContent = d.message?.body ?? '';

  const constats = d.constats ?? [];
  $('debrief-bloc-constats').hidden = constats.length === 0;
  const boite = $('debrief-constats');
  boite.replaceChildren();
  constats.forEach((c, i) => {
    const el = document.createElement('div');
    el.className = 'd-constat';
    el.style.animationDelay = `${120 + i * 70}ms`;

    const titre = document.createElement('span');
    titre.className = 'd-constat-titre';
    titre.textContent = c.titre;

    const valeur = document.createElement('span');
    valeur.className = 'd-constat-valeur';
    valeur.textContent = `${c.valeur}${c.unite ?? ''}`;

    const phrase = document.createElement('span');
    phrase.className = 'd-constat-phrase';
    phrase.textContent = c.phrase ?? '';

    el.append(titre, valeur, phrase);
    boite.append(el);
  });

  const feuille = $('debrief-feuille');
  feuille.replaceChildren();
  let retard = 200;
  for (const [cle, titre, membres] of [['nous', 'Mon équipe', nous], ['eux', 'Adversaires', eux]]) {
    if (membres.length === 0) continue;
    const bloc = document.createElement('div');
    bloc.className = `equipe-bloc ${cle}`;

    const bandeau = document.createElement('div');
    bandeau.className = 'equipe-bandeau';
    const g = document.createElement('span');
    g.textContent = titre;
    const dr = document.createElement('span');
    dr.textContent = 'ACS · K/D/A';
    bandeau.append(g, dr);
    bloc.append(bandeau);

    for (const j of membres) {
      const ligne = document.createElement('div');
      ligne.className = `d-joueur${j.moi ? ' c-est-moi' : ''}`;
      ligne.style.animationDelay = `${retard}ms`;
      retard += 45;

      const portrait = document.createElement('span');
      portrait.className = 'portrait';
      const icone = imageAgent(j.agent);
      if (icone) portrait.style.backgroundImage = `url("${icone}")`;
      portrait.title = j.agent ?? '';

      const bloc2 = document.createElement('span');
      const nom = document.createElement('span');
      nom.className = 'd-joueur-nom';
      nom.textContent = j.name ?? '?';
      const rang = document.createElement('span');
      rang.className = 'd-joueur-rang';
      rang.textContent = j.tier ?? '';
      bloc2.append(nom, rang);

      const acs = document.createElement('span');
      acs.className = 'd-joueur-acs';
      acs.textContent = j.acs != null ? j.acs : '';

      const kda = document.createElement('span');
      kda.className = 'd-joueur-kda';
      kda.textContent = `${j.kills}/${j.deaths}/${j.assists}`;

      ligne.append(portrait, bloc2, acs, kda);
      bloc.append(ligne);
    }
    feuille.append(bloc);
  }

  $('debrief').hidden = false;
}

function fermerDebrief() {
  $('debrief').hidden = true;
}

// Exposé pour pouvoir ouvrir le débrief sans attendre une vraie fin de partie
// (aperçus, mise au point). L'application, elle, passe par `guetterLeDebrief`.
window.montrerDebrief = montrerDebrief;

$('debrief-fermer').addEventListener('click', fermerDebrief);
$('debrief').addEventListener('click', (e) => {
  // Cliquer à côté du panneau ferme, comme partout ailleurs.
  if (e.target.id === 'debrief' || e.target.id === 'debrief-fond') fermerDebrief();
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('debrief').hidden) fermerDebrief();
});

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
  partiesChargees = false;
  coachCharge = false;
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
  const evenements = e.payload ?? [];
  ajouterAuFil(evenements);

  const fin = evenements.find((ev) => ev.type === 'fin');
  if (fin) {
    dernierScoreFin = fin.score ?? null;
    guetterLeDebrief();
  }
  // Une partie qui se termine change le classement : on le rafraîchit, mais
  // pas tout de suite — le serveur a besoin d'un moment pour aller chercher le
  // match, et un classement identique rechargé pour rien n'apprend rien.
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
    // La référence pour repérer une partie NOUVELLE à la fin de la prochaine.
    dernierMatchConnu = await dernierMatchId();
  }
})();

// Le classement bouge quand les potes jouent, pas seulement quand on joue.
setInterval(() => {
  if (document.querySelector('.vue.active')?.dataset.vue === 'classement') chargerClassement();
}, 120_000);
