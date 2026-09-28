// Connexion à Postgres (Supabase). Ouverte à la première requête seulement :
// la page d'accueil du site n'a pas besoin de base pour s'afficher.

import pg from 'pg';

let pool = null;

export function db() {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL manquant');
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === 'off' ? false : { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30_000,
    });
  }
  return pool;
}

export const query = (text, params) => db().query(text, params);
