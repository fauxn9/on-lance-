import webpush from 'web-push';
import { query } from '../db/index.js';

/**
 * Envoi des notifications Web Push.
 *
 * Architecture volontairement en deux temps : le job de detection ECRIT les
 * notifs en base avec le statut 'pending', puis on les envoie. Si l'envoi
 * plante (navigateur injoignable, panne reseau), le message n'est pas perdu :
 * il reste 'pending' et le passage suivant du cron le reprend.
 */

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY ?? '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY ?? '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? 'mailto:contact@onlance.app';

let configured = false;

function ensureConfigured() {
  if (configured) return true;
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return false;
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
  configured = true;
  return true;
}

export function getPublicKey() {
  return VAPID_PUBLIC;
}

/**
 * Envoie un payload a tous les appareils d'un user.
 * Les abonnements expires (404/410) sont supprimes : c'est la reponse standard
 * d'un navigateur qui a revoque l'abonnement, inutile de reessayer ensuite.
 *
 * L'appel a ensureConfigured() est indispensable ici et pas seulement dans
 * drainPending() : cette fonction est aussi appelee directement par la route
 * /push/test, qui ne passe pas par la file d'attente. Sans lui, web-push part
 * sans cles VAPID et echoue — en renvoyant simplement sent: 0, ce qui donne
 * l'impression trompeuse d'un abonnement manquant.
 */
async function pushToUser(userId, payload) {
  if (!ensureConfigured()) {
    console.warn('[push] VAPID non configure — envoi impossible. Lancer : npm run vapid');
    return { sent: 0, noSubscription: false, notConfigured: true };
  }

  const { rows } = await query(
    'SELECT id, endpoint, keys FROM push_subscriptions WHERE user_id = $1',
    [userId],
  );

  if (rows.length === 0) return { sent: 0, noSubscription: true };

  let sent = 0;
  let lastError = null;

  for (const sub of rows) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        JSON.stringify(payload),
      );
      sent++;
    } catch (err) {
      lastError = `${err.statusCode ?? ''} ${err.message}`.trim();
      if (err.statusCode === 404 || err.statusCode === 410) {
        await query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]);
        console.log(`[push] abonnement expire supprime (user ${userId})`);
      } else {
        console.error(`[push] echec user ${userId} : ${lastError}`);
      }
    }
  }

  // On remonte la derniere erreur : sans elle, un echec d'envoi et une absence
  // d'abonnement se ressemblent cote appelant, alors que les causes n'ont rien
  // a voir.
  return { sent, noSubscription: false, error: sent === 0 ? lastError : null };
}

const TITLES = {
  hype: 'Premier du groupe',
  push: 'Pas loin du podium',
  roast: 'Dernier du groupe',
  // Brique 2 — fin de semaine
  crown: 'Vainqueur de la semaine',
  recap: 'Bilan de la semaine',
};

/**
 * Vide la file des notifications en attente.
 * Appele a la fin de chaque passage du cron de detection.
 */
export async function drainPending({ maxAttempts = 3 } = {}) {
  if (!ensureConfigured()) {
    console.warn('[push] VAPID non configure — notifications non envoyees.');
    console.warn('[push] Lancer : node scripts/gen-vapid.js');
    return { sent: 0, skipped: 0 };
  }

  // LEFT JOIN volontaire : les notifs hebdo (kind = 'weekly') ne sont rattachees
  // a aucun match. Un INNER JOIN les ferait disparaitre de la file sans erreur.
  const { rows } = await query(
    `SELECT n.id, n.user_id, n.tone, n.kind, n.week_start, n.rank_in_group,
            n.body, n.attempts, d.map_name, d.match_id
     FROM notifications n
     LEFT JOIN detected_matches d ON d.id = n.detected_match_id
     WHERE n.status = 'pending' AND n.attempts < $1
     ORDER BY n.created_at ASC
     LIMIT 100`,
    [maxAttempts],
  );

  let sent = 0;
  let skipped = 0;

  for (const n of rows) {
    const result = await pushToUser(n.user_id, {
      title: TITLES[n.tone] ?? 'On lance ?',
      body: n.body,
      tone: n.tone,
      kind: n.kind ?? 'match',
      matchId: n.match_id ?? null,
      map: n.map_name ?? null,
      weekStart: n.week_start ?? null,
    });

    if (result.noSubscription) {
      // Pas d'appareil abonne : inutile de retenter indefiniment.
      await query(
        `UPDATE notifications SET status = 'failed', attempts = attempts + 1 WHERE id = $1`,
        [n.id],
      );
      skipped++;
      continue;
    }

    if (result.sent > 0) {
      await query(
        `UPDATE notifications SET status = 'sent', sent_at = now(), attempts = attempts + 1
         WHERE id = $1`,
        [n.id],
      );
      sent++;
    } else {
      const attempts = n.attempts + 1;
      await query(
        `UPDATE notifications SET status = $2, attempts = $1 WHERE id = $3`,
        [attempts, attempts >= maxAttempts ? 'failed' : 'pending', n.id],
      );
    }
  }

  if (rows.length > 0) {
    console.log(`[push] ${sent} envoyee(s), ${skipped} sans abonnement, ${rows.length} traitee(s)`);
  }

  return { sent, skipped };
}

export { pushToUser };
