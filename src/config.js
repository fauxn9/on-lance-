import 'dotenv/config';

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Variable d'environnement manquante : ${name}`);
  return v;
}

export const config = {
  databaseUrl: process.env.DATABASE_URL ?? '',

  henrik: {
    apiKey: process.env.HENRIK_API_KEY ?? '',
    baseUrl: 'https://api.henrikdev.xyz',
    // Cle "basic" HenrikDev = ~30 req/min. On reste volontairement sous la limite.
    requestsPerMinute: Number(process.env.HENRIK_RPM ?? 25),
    // Nombre de matchs recents recuperes par joueur a chaque passage du cron.
    matchesPerPlayer: Number(process.env.HENRIK_MATCH_COUNT ?? 5),
  },

  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY ?? '',
    model: process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5-20251001',
  },

  detection: {
    // Un match n'est traite que s'il a demarre dans cette fenetre.
    // Evite de re-notifier tout l'historique au premier lancement.
    lookbackHours: Number(process.env.DETECTION_LOOKBACK_HOURS ?? 12),
    // Les stats d'un match ne sont pas toujours dispo instantanement cote API.
    // On laisse passer ce delai avant de traiter un match tout juste fini.
    settleDelayMinutes: Number(process.env.DETECTION_SETTLE_MINUTES ?? 3),
    // Nombre minimum de membres du groupe dans la meme game pour declencher.
    minPlayersInMatch: Number(process.env.DETECTION_MIN_PLAYERS ?? 2),
  },

  leaderboard: {
    // Fenetre d'import du RR. Volontairement plus large qu'une semaine : ca
    // rattrape un cron qui n'aurait pas tourne pendant quelques jours, sans
    // aller reimporter toute la saison a chaque passage.
    lookbackDays: Number(process.env.RR_LOOKBACK_DAYS ?? 14),
    // Fuseau qui definit ou tombe la frontiere du lundi (voir leaderboard.js).
    timeZone: process.env.LEADERBOARD_TZ ?? 'Europe/Paris',
  },

  // DRY_RUN=1 : le job calcule tout et affiche le resultat, mais n'ecrit rien
  // en base et n'envoie aucune notif. A utiliser pour les premiers tests.
  dryRun: process.env.DRY_RUN === '1',

  required,
};
