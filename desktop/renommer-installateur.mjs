#!/usr/bin/env node
/**
 * Retire les espaces du nom de l'installateur, juste apres sa fabrication.
 *
 * POURQUOI CE FICHIER EXISTE
 *
 * `productName` vaut « On lance », avec une espace. Le bundler NSIS produit
 * donc « On lance_0.1.5_x64-setup.exe ». Or GitHub remplace les espaces par des
 * points dans le nom d'un fichier attache a une release : l'asset devient
 * « On.lance_0.1.5_x64-setup.exe », pendant que latest.json continue d'annoncer
 * le nom d'origine. L'URL ne designe alors plus rien, et TOUTES les
 * applications deja installees echouent sur :
 *
 *     download request failed with status 404 not found
 *
 * Constate en reel sur les releases app-v0.1.4 et app-v0.1.5 du 05/09/2026.
 *
 * On ne cherche pas a reproduire la regle de reecriture de GitHub — elle n'est
 * pas contractuelle et pourrait changer. On supprime le probleme a la source :
 * plus aucun caractere que GitHub voudrait reecrire, donc le nom qu'on publie
 * et celui qu'on annonce sont identiques par construction.
 *
 * POURQUOI ICI ET PAS DANS LE WORKFLOW
 *
 * Le meme correctif dans .github/workflows/app-pc.yml serait plus direct. Mais
 * ce dossier ne peut pas etre modifie a distance, ce qui impose une
 * manipulation manuelle a chaque fois — et une manipulation manuelle oubliee,
 * c'est exactement ce qui a laisse passer la 0.1.5. Ici, `npm run build` porte
 * la correction avec lui, sur la machine de n'importe qui.
 *
 * POURQUOI RENOMMER NE CASSE PAS LA SIGNATURE
 *
 * La signature minisign porte sur le CONTENU du fichier, jamais sur son nom.
 * Le fichier .sig garde d'ailleurs son ancien nom : il n'est pas publie, seul
 * son contenu part dans le manifeste, et le workflow le retrouve par son
 * extension.
 */

import { readdir, rename, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

const DOSSIER = 'src-tauri/target/release/bundle/nsis';

/** Ce qu'une URL de telechargement GitHub accepte sans etre reecrite. */
const SUR = /^[A-Za-z0-9._-]+$/;

const propre = (nom) => nom.replace(/\s+/g, '-');

async function main() {
  let fichiers;
  try {
    fichiers = await readdir(DOSSIER);
  } catch (err) {
    // Pas de bundle NSIS : `tauri build` a echoue, ou on construit pour une
    // autre cible. Ce n'est pas a ce script de s'en plaindre.
    console.log(`[nom] rien a renommer (${err.code})`);
    return;
  }

  let exes = fichiers.filter((f) => f.toLowerCase().endsWith('.exe'));
  if (exes.length === 0) {
    console.log('[nom] aucun installateur trouve');
    return;
  }

  // Un seul installateur doit rester, et ce doit etre celui qu'on vient de
  // construire.
  //
  // Le workflow le retrouve avec `Select-Object -First 1`, SANS tri : s'il
  // trainait ici l'installateur d'une version precedente — un cache de
  // compilation qui aurait survecu, une construction locale rejouee — le nom
  // choisi pourrait etre l'ancien. On publierait alors un exe 0.1.5 sous
  // l'etiquette 0.1.6, sans la moindre erreur nulle part. On ne laisse donc
  // pas ce choix au hasard : on garde le plus recent, on efface le reste.
  if (exes.length > 1) {
    const dates = new Map();
    for (const f of exes) dates.set(f, (await stat(join(DOSSIER, f))).mtimeMs);
    exes.sort((a, b) => dates.get(b) - dates.get(a));

    for (const vieux of exes.slice(1)) {
      await unlink(join(DOSSIER, vieux));
      console.log(`[nom] installateur perime efface : ${vieux}`);
    }
    exes = exes.slice(0, 1);
  }

  for (const nom of exes) {
    const vise = propre(nom);
    if (vise !== nom) {
      await rename(join(DOSSIER, nom), join(DOSSIER, vise));
      console.log(`[nom] ${nom}  ->  ${vise}`);
    }

    // On echoue la construction plutot que de publier une version que
    // personne ne pourra installer : un 404 chez les autres se decouvre bien
    // trop tard, et seulement quand quelqu'un clique.
    if (!SUR.test(vise)) {
      throw new Error(
        `Nom d'installateur risque pour une URL de telechargement : « ${vise} ». `
        + 'GitHub le reecrirait, et latest.json pointerait a cote.',
      );
    }
  }
}

main().catch((err) => {
  console.error(`[nom] ${err.message}`);
  process.exit(1);
});
