/* Service worker "On lance ?" — reception des notifications de fin de match.
 *
 * A servir a la racine du site (https://ton-domaine/sw.js). Un service worker
 * ne peut controler que les pages situees au meme niveau ou en dessous, donc le
 * mettre dans un sous-dossier casserait l'abonnement.
 *
 * En dev, le Web Push fonctionne sur http://localhost sans certificat.
 * En prod, HTTPS est obligatoire (pas de contournement possible).
 */

// Une seule icone pour tous les tons : le ton se lit deja dans le titre et le
// texte, et une icone par ton obligerait a maintenir un jeu d'images pour un
// gain nul. Le badge est la petite silhouette monochrome affichee par Android
// dans la barre de statut.
const ICON = '/icons/icon-192.png';
const BADGE = '/icons/badge.png';

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'On lance ?', body: event.data?.text() ?? '' };
  }

  const options = {
    body: data.body ?? '',
    icon: ICON,
    badge: BADGE,
    // Regroupe par match : si plusieurs notifs arrivent d'affilee, elles ne
    // s'empilent pas en spam. Les notifs hebdo se regroupent par semaine.
    tag: data.matchId ?? data.weekStart ?? 'on-lance',
    data: { matchId: data.matchId, map: data.map, kind: data.kind },
    vibrate: data.tone === 'roast' ? [100, 50, 100] : [80],
  };

  event.waitUntil(self.registration.showNotification(data.title ?? 'On lance ?', options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // Pas de page par match pour l'instant : on renvoie vers l'accueil. Le jour
  // ou une vue de match existera, c'est ici qu'on ciblera /match/<id>.
  const url = '/';

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
