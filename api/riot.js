// Client de l'API Riot. La clé ne quitte jamais le serveur : l'app ne parle
// qu'à nous.

import { RiotLimiter } from './limiter.js';

// Plateforme (là où vit le compte LoL) → région (où vivent comptes et parties).
const REGIONS = {
  euw1: 'europe', eun1: 'europe', tr1: 'europe', ru: 'europe', me1: 'europe',
  na1: 'americas', br1: 'americas', la1: 'americas', la2: 'americas',
  kr: 'asia', jp1: 'asia',
  oc1: 'sea', sg2: 'sea', tw2: 'sea', vn2: 'sea',
};

export const PLATFORMS = Object.keys(REGIONS);
export const isPlatform = (p) => Object.hasOwn(REGIONS, p);
export const regionOf = (platform) => REGIONS[platform];
// account-v1 n'existe pas sur « sea » : Riot le sert depuis « asia ».
export const accountRegionOf = (platform) => (REGIONS[platform] === 'sea' ? 'asia' : REGIONS[platform]);

export class RiotError extends Error {
  constructor(status, path) {
    super(`API Riot : HTTP ${status} sur ${path}`);
    this.status = status;
  }
}

export class RiotApi {
  constructor({ key = process.env.RIOT_API_KEY, limiter = new RiotLimiter(), fetch = globalThis.fetch, sleep } = {}) {
    this.key = key;
    this.limiter = limiter;
    this.fetch = fetch;
    this.sleep = sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  get configured() {
    return Boolean(this.key);
  }

  // `null` veut dire « n'existe pas » (404) : ce n'est pas une panne.
  async get(host, path, { priority = 'high', attempts = 4 } = {}) {
    for (let attempt = 1; ; attempt++) {
      await this.limiter.acquire(host, priority);
      const res = await this.fetch(`https://${host}.api.riotgames.com${path}`, {
        headers: { 'X-Riot-Token': this.key },
        signal: AbortSignal.timeout(10_000),
      });
      this.limiter.observe(host, res.headers);

      if (res.ok) return res.json();
      if (res.status === 404) return null;
      if (attempt < attempts && (res.status === 429 || res.status >= 500)) {
        // 429 : Riot dit combien de secondes attendre. On met toute la route en
        // pause, pas seulement cette requête.
        const retryAfter = Number(res.headers.get('retry-after'));
        const ms = res.status === 429 ? (retryAfter > 0 ? retryAfter * 1000 : 5000) : 500 * 2 ** attempt;
        if (res.status === 429) this.limiter.pause(host, ms);
        else await this.sleep(ms);
        continue;
      }
      throw new RiotError(res.status, path);
    }
  }

  account(platform, puuid) {
    return this.get(accountRegionOf(platform), `/riot/account/v1/accounts/by-puuid/${encodeURIComponent(puuid)}`);
  }

  summoner(platform, puuid) {
    return this.get(platform, `/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(puuid)}`);
  }

  leagues(platform, puuid, opts) {
    return this.get(platform, `/lol/league/v4/entries/by-puuid/${encodeURIComponent(puuid)}`, opts);
  }

  matchIds(platform, puuid, { start = 0, count = 20, startTime, endTime } = {}, opts) {
    const q = new URLSearchParams({ start: String(start), count: String(count) });
    if (startTime != null) q.set('startTime', String(startTime));
    if (endTime != null) q.set('endTime', String(endTime));
    return this.get(regionOf(platform), `/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?${q}`, opts);
  }

  match(platform, matchId, opts) {
    return this.get(regionOf(platform), `/lol/match/v5/matches/${encodeURIComponent(matchId)}`, opts);
  }
}
