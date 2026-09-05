#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:https';

/**
 * Sonde de l'API locale du client Riot — Brique 9, etape zero.
 *
 * POURQUOI CE SCRIPT EXISTE
 *
 * Toute la brique 9 repose sur une hypothese : le client Riot expose en local
 * assez d'informations pour detecter une fin de partie a la seconde et pour
 * prouver quel compte est connecte. Batir une application Tauri avant d'avoir
 * verifie ca, ce serait des semaines de travail sur un pari.
 *
 * Ce script ne fait donc qu'une chose : regarder ce qui est reellement
 * disponible sur CETTE machine, et le dire.
 *
 * CE QU'IL FAIT, ET CE QU'IL NE FAIT PAS
 *
 *   - Il LIT le fichier lockfile que le client Riot ecrit lui-meme, et
 *     interroge son serveur HTTP local. C'est ce que font tous les outils
 *     communautaires de ce genre.
 *   - Il n'injecte rien, ne s'accroche a aucun processus, ne modifie aucun
 *     fichier du jeu et n'envoie aucune requete aux serveurs de Riot. Il ne
 *     touche pas au jeu : uniquement au client, et en lecture.
 *
 * A savoir quand meme : ces routes locales ne sont pas documentees par Riot et
 * peuvent disparaitre du jour au lendemain. Rien de ce qui suit n'est un
 * engagement de leur part.
 *
 * POURQUOI CETTE VERSION NE DEVINE PLUS AUCUN NOM DE CHAMP
 *
 * Les deux versions precedentes lisaient des cles ecrites en dur
 * (`sessionLoopState`, `partyState`). Sur cette machine elles ressortent
 * vides alors que `queueId`, lu au meme endroit, ressort correctement : la
 * charge utile est donc bien decodee, ce sont les noms qui ont change. Cette
 * version n'en suppose plus aucun — elle affiche TOUT ce qu'elle trouve, et
 * en mode suivi elle affiche les champs QUI CHANGENT, quel que soit leur nom.
 *
 * UTILISATION
 *   Lance le client Riot (et Valorant si tu veux tester en partie), puis :
 *     node scripts/sonde-lockfile.mjs            rapport complet
 *     node scripts/sonde-lockfile.mjs --brut     vidage integral de la presence
 *     node scripts/sonde-lockfile.mjs --suivi    suivi des changements en direct
 *
 * Les secrets et les identifiants sont tronques : le rapport est fait pour
 * etre partage tel quel.
 */

const LOCKFILE = join(
  process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'),
  'Riot Games', 'Riot Client', 'Config', 'lockfile',
);

/** Tronque un secret pour qu'il reste identifiable sans etre utilisable. */
const masque = (s) => (typeof s === 'string' && s.length > 12
  ? `${s.slice(0, 6)}…${s.slice(-4)} (${s.length} car.)`
  : '(absent)');

/**
 * Rend une valeur affichable sans recopier d'identifiant complet.
 *
 * La sortie de ce script est destinee a etre collee dans une conversation :
 * un identifiant de partie ou de groupe n'a aucun interet pour le diagnostic
 * et n'a rien a faire dans un copier-coller.
 */
function lisible(valeur) {
  if (typeof valeur === 'string') {
    // UUID, jeton, chemin d'asset : on garde la fin, c'est elle qui parle.
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(valeur)) return `${valeur.slice(0, 8)}…`;
    if (valeur.length > 60) return `${valeur.slice(0, 24)}…(${valeur.length} car.)`;
    if (valeur.includes('/Game/')) return valeur.split('/').pop();
    return valeur;
  }
  if (valeur === null || typeof valeur !== 'object') return JSON.stringify(valeur);
  if (Array.isArray(valeur)) return `[${valeur.length} élément(s)]`;
  return `{${Object.keys(valeur).join(', ')}}`;
}

/**
 * Appel HTTPS local.
 *
 * On passe par node:https et pas par fetch() : le serveur du client Riot
 * presente un certificat auto-signe — il n'existe aucune autorite qui puisse
 * signer un certificat pour 127.0.0.1 — et le fetch global de Node ignore
 * purement et simplement l'option qui permettrait de l'accepter. La verification
 * n'est donc levee QUE pour cette connexion locale, jamais globalement.
 */
function requeteLocale(options) {
  return new Promise((resoudre, rejeter) => {
    const req = request({ ...options, rejectUnauthorized: false }, (res) => {
      let corps = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { corps += c; });
      res.on('end', () => resoudre({ status: res.statusCode, corps }));
    });
    req.on('error', rejeter);
    req.setTimeout(5000, () => { req.destroy(new Error('délai dépassé')); });
    req.end();
  });
}

async function lireLockfile() {
  const brut = await readFile(LOCKFILE, 'utf8');
  const [name, pid, port, password, protocol] = brut.trim().split(':');
  return { name, pid, port, password, protocol };
}

function fabriqueAppel({ port, password }) {
  const auth = Buffer.from(`riot:${password}`).toString('base64');

  return async function appel(chemin) {
    let res;
    try {
      res = await requeteLocale({
        host: '127.0.0.1', port: Number(port), path: chemin, method: 'GET',
        headers: { Authorization: `Basic ${auth}` },
      });
    } catch (err) {
      return { ok: false, status: 0, corps: err.message };
    }

    if (res.status < 200 || res.status >= 300) {
      return { ok: false, status: res.status, corps: res.corps.slice(0, 200) };
    }
    try {
      return { ok: true, status: res.status, data: JSON.parse(res.corps) };
    } catch {
      return { ok: true, status: res.status, data: res.corps.slice(0, 200) };
    }
  };
}

/**
 * Le detail utile d'une presence est du JSON encode en base64 dans `private`.
 *
 * On renvoie l'objet COMPLET, sans filtrer : c'est precisement le filtre des
 * versions precedentes qui masquait les champs dont on a besoin.
 */
function decoderPresence(p) {
  if (!p?.private) return null;
  try {
    return JSON.parse(Buffer.from(p.private, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Aplatit l'objet decode en couples cle -> valeur.
 *
 * Certaines versions du client imbriquent l'etat dans un sous-objet. Aplatir
 * evite d'avoir a savoir a quelle profondeur regarder.
 */
function aplatir(objet, prefixe = '', sortie = {}) {
  for (const [cle, val] of Object.entries(objet ?? {})) {
    const chemin = prefixe ? `${prefixe}.${cle}` : cle;
    if (val && typeof val === 'object' && !Array.isArray(val)) aplatir(val, chemin, sortie);
    else sortie[chemin] = val;
  }
  return sortie;
}

/**
 * Retrouve le champ d'etat de partie sans connaitre son nom.
 *
 * On le reconnait a sa VALEUR : MENUS, PREGAME, INGAME sont les trois seules
 * que le client ecrit. C'est plus solide que n'importe quel nom de cle, qui
 * peut changer d'une version du jeu a l'autre.
 */
const ETATS_CONNUS = ['MENUS', 'PREGAME', 'INGAME'];

function trouverEtatDePartie(plat) {
  for (const [cle, val] of Object.entries(plat ?? {})) {
    if (typeof val === 'string' && ETATS_CONNUS.includes(val.toUpperCase())) {
      return { cle, valeur: val.toUpperCase() };
    }
  }
  return null;
}

const titre = (t) => console.log(`\n${'─'.repeat(64)}\n${t}\n${'─'.repeat(64)}`);
const ligne = (cle, valeur) => console.log(`  ${String(cle).padEnd(28)} ${valeur}`);

/** Affiche integralement une presence decodee, cle par cle. */
function vider(plat) {
  const cles = Object.keys(plat).sort();
  if (cles.length === 0) { ligne('contenu', '(vide)'); return; }
  for (const cle of cles) ligne(`  ${cle}`, lisible(plat[cle]));
}

async function main({ brut = false } = {}) {
  console.log('Sonde de l\'API locale du client Riot — lecture seule\n');

  /* --- 1. Le lockfile ---------------------------------------------------- */

  titre('1. Lockfile');
  let lock;
  try {
    lock = await lireLockfile();
    ligne('chemin', LOCKFILE);
    ligne('client', lock.name);
    ligne('pid', lock.pid);
    ligne('port', lock.port);
    ligne('protocole', lock.protocol);
    ligne('mot de passe', masque(lock.password));
  } catch (err) {
    ligne('chemin', LOCKFILE);
    console.log(`\n  ÉCHEC : ${err.code === 'ENOENT'
      ? "fichier absent — le client Riot n'est pas lancé."
      : err.message}`);
    console.log('\n  Lance le client Riot, puis relance ce script.');
    return;
  }

  const appel = fabriqueAppel(lock);

  /* --- 2. Qui est connecte ---------------------------------------------- */

  titre('2. Identité du compte connecté');
  const ent = await appel('/entitlements/v1/token');
  if (ent.ok && ent.data?.subject) {
    ligne('puuid local', ent.data.subject);
    ligne('jeton d’accès', masque(ent.data.accessToken));
    ligne('entitlements', masque(ent.data.token));
    console.log('\n  → C\'est CE puuid qui prouve la propriété d\'un Riot ID');
    console.log('    et permet enfin de passer `verified` à true.');
  } else {
    ligne('résultat', `échec (HTTP ${ent.status})`);
    console.log(`  corps : ${ent.corps ?? '(vide)'}`);
  }

  /* --- 3. Valorant tourne-t-il ? ---------------------------------------- */

  titre('3. Sessions de jeu en cours');
  const ses = await appel('/product-session/v1/external-sessions');
  if (ses.ok && ses.data && typeof ses.data === 'object') {
    const entrees = Object.entries(ses.data);
    if (entrees.length === 0) ligne('sessions', 'aucune — le jeu n’est pas lancé');
    for (const [id, s] of entrees) {
      ligne(s.productId ?? id, `${s.exitCode === undefined ? 'en cours' : 'terminée'} · pid ${s.pid ?? '?'}`);
    }
  } else {
    ligne('résultat', `échec (HTTP ${ses.status})`);
  }

  /* --- 4. La presence : l'etat de partie en direct ----------------------- */

  titre('4. Présence (l’état de partie, en direct)');
  const pres = await appel('/chat/v4/presences');
  let etat = null;

  if (pres.ok && Array.isArray(pres.data?.presences)) {
    ligne('présences visibles', pres.data.presences.length);

    // Un meme compte a PLUSIEURS presences, une par produit. Celle du client
    // ("riot_client") ne contient aucun etat de partie : il faut celle du jeu.
    const miennes = pres.data.presences.filter((p) => p.puuid === ent.data?.subject);
    ligne('mes présences', miennes.map((p) => p.product ?? '?').join(', ') || 'aucune');

    const jeu = miennes.find((p) => p.product === 'valorant');
    if (!jeu) {
      ligne('présence Valorant', 'ABSENTE — le jeu n’est pas lancé');
      console.log('\n  L’état de partie ne peut pas être observé sans le jeu ouvert.');
    } else {
      const plat = aplatir(decoderPresence(jeu));
      console.log('\n  Champs visibles de l’enveloppe de présence :');
      for (const [cle, val] of Object.entries(jeu)) {
        if (cle === 'private') continue; // c'est ce qu'on décode juste après
        ligne(`  ${cle}`, lisible(val));
      }
      console.log('\n  Contenu décodé (intégral, aucun champ filtré) :');
      vider(plat);

      etat = trouverEtatDePartie(plat);
      console.log('');
      if (etat) {
        ligne('état de partie trouvé', `${etat.cle} = ${etat.valeur}`);
        console.log('\n  → C’est ce champ qui fait la fin de partie à la seconde.');
      } else {
        ligne('état de partie', 'AUCUN champ ne vaut MENUS / PREGAME / INGAME');
        console.log('\n  Regarde la liste ci-dessus : si un champ ressemble à un état');
        console.log('  de partie sous un autre nom, c’est lui qu’il faut suivre.');
      }
    }

    // Les amis : c'est ce qui permettrait de savoir qui joue, sans API externe.
    const autres = pres.data.presences.filter((p) => p.puuid !== ent.data?.subject);
    ligne('amis visibles', autres.length);
    const amisEnJeu = autres.filter((p) => p.product === 'valorant');
    ligne('dont sur Valorant', amisEnJeu.length);
    for (const a of amisEnJeu) {
      const e = trouverEtatDePartie(aplatir(decoderPresence(a)));
      ligne(`  ${a.game_name ?? a.puuid.slice(0, 8)}`, e?.valeur ?? '?');
    }
  } else {
    ligne('résultat', `échec (HTTP ${pres.status})`);
    console.log(`  corps : ${pres.corps ?? '(vide)'}`);
  }

  if (brut) return;

  /* --- 5. Ce qu'on en conclut ------------------------------------------- */

  titre('5. Verdict');
  const aIdentite = Boolean(ent.ok && ent.data?.subject);
  const aListePresences = Boolean(pres.ok && pres.data?.presences);

  // Distinguer "prouve" de "pas observe" : sans le jeu ouvert, l'etat de partie
  // n'est pas absent, il n'a simplement pas pu etre teste.
  ligne('preuve de compte (verified)', aIdentite ? 'PROUVÉ' : 'ÉCHEC');
  ligne('liste des présences', aListePresences ? 'PROUVÉ' : 'ÉCHEC');
  ligne(
    'état de partie en direct',
    etat ? `PROUVÉ (${etat.cle} = ${etat.valeur})` : 'NON OBSERVÉ — relance avec Valorant ouvert',
  );

  if (aIdentite && etat) {
    console.log('\n  Tout est vérifié. La brique 9 tient debout.');
  } else if (aIdentite && aListePresences) {
    console.log('\n  L’identité est prouvée, l’état de partie reste à vérifier.');
    console.log('  Lance Valorant, puis :  node scripts/sonde-lockfile.mjs --suivi');
  } else {
    console.log('\n  Une brique manque : à regarder avant d’investir dans l’app desktop.');
  }
}

/**
 * Mode suivi : interroge la presence toutes les deux secondes et n'affiche que
 * ce qui a CHANGE — le nom du champ compris.
 *
 * Les versions precedentes affichaient deux champs choisis a l'avance, et
 * affichaient donc « ? » quand ces noms n'existaient pas. Ici on compare
 * l'objet entier a son etat precedent : peu importe comment Riot appelle ses
 * champs, un changement se voit.
 */
async function suivre() {
  console.log('Suivi de l’état de partie — Ctrl+C pour arrêter.\n');

  let lock;
  try {
    lock = await lireLockfile();
  } catch {
    console.log('Le client Riot n’est pas lancé.');
    return;
  }

  const appel = fabriqueAppel(lock);
  const ent = await appel('/entitlements/v1/token');
  const moi = ent.data?.subject;
  if (!moi) { console.log('Impossible de lire le compte connecté.'); return; }

  let precedent = null;
  const heure = () => new Date().toLocaleTimeString('fr-FR');

  setInterval(async () => {
    const pres = await appel('/chat/v4/presences');
    if (!pres.ok) return;

    const jeu = (pres.data.presences ?? []).find(
      (p) => p.puuid === moi && p.product === 'valorant',
    );
    const plat = jeu ? aplatir(decoderPresence(jeu)) : null;

    if (!plat) {
      if (precedent !== null) console.log(`${heure()}  —  Valorant fermé`);
      precedent = null;
      return;
    }

    // Premiere lecture : on affiche tout, c'est la reference.
    if (precedent === null) {
      console.log(`${heure()}  état initial :`);
      vider(plat);
      const e = trouverEtatDePartie(plat);
      console.log(e
        ? `           état de partie : ${e.cle} = ${e.valeur}\n`
        : '           (aucun champ ne vaut MENUS / PREGAME / INGAME)\n');
      precedent = plat;
      return;
    }

    // Ensuite : uniquement les differences, nom du champ inclus.
    const cles = new Set([...Object.keys(precedent), ...Object.keys(plat)]);
    const diffs = [];
    for (const cle of cles) {
      const avant = JSON.stringify(precedent[cle]);
      const apres = JSON.stringify(plat[cle]);
      if (avant !== apres) diffs.push(`${cle}: ${lisible(precedent[cle])} → ${lisible(plat[cle])}`);
    }
    if (diffs.length === 0) return;

    precedent = plat;
    console.log(`${heure()}  ${diffs.shift()}`);
    for (const d of diffs) console.log(`          ${d}`);
  }, 2000);
}

if (process.argv.includes('--suivi')) {
  suivre().catch((err) => { console.error(err.message); process.exitCode = 1; });
} else {
  main({ brut: process.argv.includes('--brut') }).catch((err) => {
    console.error('\nÉchec inattendu :', err.message);
    process.exitCode = 1;
  });
}
