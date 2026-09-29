// Enregistre la commande /classement sur l'app Discord (une fois, et à chaque
// changement de commande). Utilise DISCORD_CLIENT_ID et DISCORD_CLIENT_SECRET.
import { enregistrerCommandes } from '../api/groupes/discord.js';

try {
  const r = await enregistrerCommandes();
  console.log('Commande /classement enregistrée.');
  console.log("Pour l'ajouter à un serveur Discord :", r.invitation);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
