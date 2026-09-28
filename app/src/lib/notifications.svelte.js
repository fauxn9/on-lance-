// File des notifications (fin de partie, nouvelles parties…).

export const notifications = $state([]);
let prochain = 0;

export function notifier(n) {
  const note = { id: ++prochain, duree: 7000, ...n };
  notifications.push(note);
  if (notifications.length > 3) notifications.shift();
  setTimeout(() => fermer(note.id), note.duree);
  return note.id;
}

export function fermer(id) {
  const i = notifications.findIndex((n) => n.id === id);
  if (i >= 0) notifications.splice(i, 1);
}
