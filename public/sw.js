/* Service worker "On lance ?" — reception des notifications de fin de match.
 *
 * A servir a la racine du site (https://ton-domaine/sw.js). Un service worker
 * ne peut controler que les pages situees au meme niveau ou en dessous, donc le
 * mettre dans un sous-dossier casserait l'abonnement.
 *
 * En dev, le Web Push fonctionne sur http://localhost sans certificat.
 * En prod, HTTPS est obligatoire (pas de contournement possible).
 */

const ICONS = {
  hype: '/icons/hype.png',
  push: '/icons/push.png',
  roast: '/icons/roast.png',
};

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'On lance ?', body: event.data?.text() ?? '' };
  }

  const options = {
    body: data.body ?? '',
    icon: ICONS[data.tone] ?? '/icons/default.png',
    badge: '/icons/badge.png',
    // Regroupe par match : si plusieurs notifs arrivent d'affilee, elles ne
    // s'empilent pas en spam.
    tag: data.matchId ?? 'on-lance',
    data: { matchId: data.matchId, map: data.map },
    vibrate: data.tone === 'roast' ? [100, 50, 100] : [80],
  };

  event.waitUntil(self.registration.showNotification(data.title ?? 'On lance ?', options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.matchId
    ? `/match/${event.notification.data.matchId}`
    : '/';

  // Si un onglet de l'app est deja ouvert, on le reutilise au lieu d'en ouvrir
  // un nouveau a chaque notif.
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return clients.openWindow(url);
    }),
  );
});
