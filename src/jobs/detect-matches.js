#!/usr/bin/env node
import { config } from '../config.js';
import { detecterPourTous } from '../services/pipeline.js';
import { closePool } from '../db/index.js';

/**
 * Point d'entree du cron (toutes les 5-10 min).
 *
 * IMPORTANT pour l'hebergement : ce script s'execute puis se termine. C'est un
 * vrai Cron Job, pas un serveur qui tourne en continu — c'est ce qui permet de
 * rester dans le tier gratuit de Render sans se faire endormir apres 15 min
 * d'inactivite.
 *
 * La chaine elle-meme vit dans `src/services/pipeline.js` : depuis la brique 9,
 * le serveur web l'appelle aussi, quand un PC annonce une fin de partie. Ce
 * cron reste le filet — si l'application PC est fermee ou si la relance ne
 * trouve rien, la notification part ici, comme avant.
 */

async function main() {
  const started = Date.now();
  console.log(`[detect] Demarrage${config.dryRun ? ' (DRY RUN — aucune ecriture)' : ''}`);

  if (!config.henrik.apiKey) {
    console.error('[detect] HENRIK_API_KEY manquante — impossible de recuperer les matchs.');
    process.exit(1);
  }

  let total = 0;
  try {
    total = await detecterPourTous();
  } finally {
    if (!config.dryRun) await closePool().catch(() => {});
  }

  console.log(
    `\n[detect] Termine — ${total} match(s) traite(s) en ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
}

main().catch((err) => {
  console.error('[detect] Erreur fatale :', err);
  process.exit(1);
});
