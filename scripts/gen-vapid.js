#!/usr/bin/env node
/**
 * Genere la paire de cles VAPID necessaire au Web Push.
 * A lancer UNE SEULE FOIS, puis coller le resultat dans le .env.
 * Regenerer ces cles invalide tous les abonnements existants.
 */
import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();

console.log('\nColler ces lignes dans le .env :\n');
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log('VAPID_SUBJECT=mailto:ton@email.com');
console.log('\nLa cle publique est aussi exposee par GET /push/public-key');
console.log('pour que le navigateur puisse s abonner.\n');
