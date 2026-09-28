// Limiteur de débit de l'API Riot.
//
// Riot compte les requêtes par « route » : euw1 et europe ont chacune leur
// budget. Une clé personnelle a droit à 20 requêtes par seconde et 100 par
// 2 minutes ; une clé de production, bien plus. Les vraies limites arrivent
// dans l'en-tête X-App-Rate-Limit de chaque réponse : on s'y aligne tout seul,
// le jour où la clé de production arrive rien n'est à changer.
//
// Deux priorités : `high` pour ce que l'utilisateur attend à l'écran, `low`
// pour le rattrapage de l'historique en fond. Le fond ne consomme jamais plus
// de 70 % d'une fenêtre, pour laisser de la place aux demandes interactives,
// et il s'efface complètement tant qu'une demande à l'écran attend son tour
// (écran de chargement : 10 joueurs à analyser avant le début de la partie).

const LOW_SHARE = 0.7;

export function parseLimits(header) {
  if (!header) return null;
  const limits = String(header)
    .split(',')
    .map((part) => part.trim().split(':').map(Number))
    .filter(([max, sec]) => max > 0 && sec > 0)
    .map(([max, sec]) => ({ max, windowMs: sec * 1000 }));
  return limits.length ? limits : null;
}

export class HostLimiter {
  constructor({ limits, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
    this.limits = limits;
    this.now = now;
    this.sleep = sleep;
    this.hits = [];
    this.pausedUntil = 0;
    this.urgentes = 0;
  }

  // Temps à attendre avant de pouvoir envoyer une requête (0 = tout de suite).
  wait(priority = 'high') {
    const t = this.now();
    let wait = Math.max(0, this.pausedUntil - t);
    if (priority === 'low' && this.urgentes > 0) wait = Math.max(wait, 50);
    for (const { max, windowMs } of this.limits) {
      const cap = priority === 'low' ? Math.max(1, Math.floor(max * LOW_SHARE)) : max;
      const inWindow = this.hits.filter((h) => h > t - windowMs);
      if (inWindow.length >= cap) {
        // Il faut que la plus ancienne des requêtes en trop sorte de la fenêtre.
        const oldest = inWindow[inWindow.length - cap];
        wait = Math.max(wait, oldest + windowMs - t + 1);
      }
    }
    return wait;
  }

  async acquire(priority = 'high') {
    const urgente = priority !== 'low';
    if (urgente) this.urgentes++;
    try {
      for (;;) {
        const w = this.wait(priority);
        if (w <= 0) break;
        await this.sleep(w);
      }
    } finally {
      if (urgente) this.urgentes--;
    }
    const t = this.now();
    this.hits.push(t);
    const longest = Math.max(...this.limits.map((l) => l.windowMs));
    while (this.hits.length && this.hits[0] <= t - longest) this.hits.shift();
  }

  pause(ms) {
    this.pausedUntil = Math.max(this.pausedUntil, this.now() + ms);
  }

  setLimits(limits) {
    if (limits) this.limits = limits;
  }
}

export class RiotLimiter {
  constructor({ limits = parseLimits(process.env.RIOT_LIMITS || '20:1,100:120'), now, sleep } = {}) {
    this.defaults = limits;
    this.now = now;
    this.sleep = sleep;
    this.hosts = new Map();
  }

  host(name) {
    let h = this.hosts.get(name);
    if (!h) {
      h = new HostLimiter({ limits: this.defaults, now: this.now, sleep: this.sleep });
      this.hosts.set(name, h);
    }
    return h;
  }

  acquire(name, priority) {
    return this.host(name).acquire(priority);
  }

  // Aligne le limiteur sur ce que Riot annonce réellement pour cette clé.
  observe(name, headers) {
    this.host(name).setLimits(parseLimits(headers.get?.('x-app-rate-limit')));
  }

  pause(name, ms) {
    this.host(name).pause(ms);
  }
}
