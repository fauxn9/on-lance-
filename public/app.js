/* Socle partage par toutes les pages de "On lance ?".
 *
 * Evite de recopier sur chaque page la lecture de session, l'en-tete, et
 * l'abonnement aux notifications — trois choses qui doivent se comporter
 * exactement pareil partout.
 */

export const $ = (id) => document.getElementById(id);

/**
 * Echappe une valeur avant de l'inserer dans du HTML.
 *
 * Les pseudos affiches ne viennent pas de celui qui regarde : le nom Discord
 * d'un membre s'affiche dans le classement de tous les autres. Sans echappement,
 * quelqu'un pourrait choisir un pseudo qui fait executer du code chez ses potes.
 */
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

/** Appel JSON qui leve une erreur portant le message du serveur. */
export async function api(url, options) {
  const res = await fetch(url, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options?.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error ?? `Erreur ${res.status}`);
    err.status = res.status;
    err.code = data.code;
    throw err;
  }
  return data;
}

/** Session courante : { user, discordConfigured }. user vaut null si deconnecte. */
export const session = () => api('/auth/me');

/**
 * Renvoie l'utilisateur connecte, ou redirige vers la connexion en gardant en
 * memoire la page demandee pour y revenir apres.
 */
export async function requireUser() {
  const { user } = await session();
  if (!user) {
    location.href = `/login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
    return null;
  }
  return user;
}

export const loginUrl = (next = location.pathname + location.search) =>
  `/auth/discord?next=${encodeURIComponent(next)}`;

export async function logout() {
  await api('/auth/logout', { method: 'POST' });
  location.href = '/';
}

/** En-tete commun : marque a gauche, utilisateur et liens a droite. */
export function renderHeader(el, user, { active = '' } = {}) {
  const links = [
    ['/dashboard.html', 'Tableau de bord'],
    ['/leaderboard.html', 'Classement'],
    ['/groupes.html', 'Groupes'],
  ];

  el.innerHTML = `
    <a class="brand" href="/">
      <span class="mark" aria-hidden="true">
        <svg width="15" height="15" viewBox="0 0 32 32"><path d="M7 8l9 16 9-16h-5.2L16 15.8 12.2 8z" fill="#16040a"/></svg>
      </span>
      <span>On lance <span class="q">?</span></span>
    </a>
    <nav class="head-nav">
      ${user ? links.map(([href, label]) =>
        `<a href="${href}"${href === active ? ' aria-current="page"' : ''}>${label}</a>`).join('') : ''}
    </nav>
    <div class="who-slot">
      ${user
        ? `<button class="who" id="whoBtn" title="Se déconnecter">
             ${user.avatarUrl ? `<img src="${user.avatarUrl}" alt="">` : '<span class="dot-av"></span>'}
             <span></span>
           </button>`
        : `<a class="head-cta" href="${loginUrl()}">Se connecter</a>`}
    </div>`;

  // Le pseudo vient de Discord ou du Riot ID : il n'a aucune raison de contenir
  // du HTML, mais il n'a pas plus de raison d'etre interprete comme tel.
  if (user) el.querySelector('.who span:last-child').textContent = user.displayName;

  const btn = $('whoBtn');
  if (btn) btn.addEventListener('click', () => { if (confirm('Se déconnecter ?')) logout(); });
}

/* --- Notifications --------------------------------------------------------
 * Un abonnement push appartient a UN navigateur sur UN appareil : celui qui
 * s'abonne sur son PC doit refaire la manip sur son telephone.
 */

function toUint8(base64url) {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export const pushSupported = () =>
  'serviceWorker' in navigator && 'PushManager' in window;

/** 'unsupported' | 'blocked' | 'on' | 'off' */
export async function pushState() {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

/**
 * Abonne cet appareil. Traduit au passage l'erreur de Brave, qui desactive par
 * defaut le service de push de Google et renvoie un message incomprehensible.
 */
export async function enablePush() {
  if (!pushSupported()) throw new Error('Ce navigateur ne gère pas les notifications push.');

  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;

  if ((await Notification.requestPermission()) !== 'granted') {
    throw new Error("Notifications refusées. Tu peux réautoriser le site via l'icône à gauche de l'adresse.");
  }

  const { publicKey } = await api('/push/public-key');
  if (!publicKey) throw new Error('Clé de notification absente côté serveur.');

  try {
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: toUint8(publicKey),
    });
    await api('/push/subscribe', {
      method: 'POST',
      body: JSON.stringify({ subscription: sub.toJSON() }),
    });
  } catch (err) {
    if (/push service error/i.test(err.message)) {
      throw new Error(
        'Ton navigateur bloque le service de notifications. Sur Brave : Réglages → '
        + 'Confidentialité → active « Utiliser les services Google pour la messagerie push », '
        + 'puis redémarre le navigateur.',
      );
    }
    throw err;
  }
}

export const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
export const fr = (n, d = 1) =>
  n === null || n === undefined ? '—' : Number(n).toFixed(d).replace('.', ',');
