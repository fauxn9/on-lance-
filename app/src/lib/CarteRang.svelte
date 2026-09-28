<script>
  import { COULEUR_TIER, nomRang, pourcent } from './format.js';

  let { titre, rang } = $props();
  const haut = $derived(rang && ['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(rang.tier));
  const parties = $derived(rang ? rang.victoires + rang.defaites : 0);
</script>

<section class="carte rang" style:--tier={rang ? COULEUR_TIER[rang.tier] : 'var(--ink-3)'}>
  <p class="etiquette">{titre}</p>
  {#if rang}
    <p class="nom">{nomRang(rang.tier, rang.division)}</p>
    {#if !haut}
      <div class="barre" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={rang.lp} aria-label="Points de ligue">
        <span style:width="{Math.min(100, rang.lp)}%"></span>
      </div>
    {/if}
    <p class="stats">
      <span class="mono lp">{rang.lp} PL</span>
      <span class="mono">{rang.victoires}V {rang.defaites}D</span>
      <span class="mono" class:v={rang.victoires / Math.max(1, parties) >= 0.5}>{pourcent(rang.victoires, parties)}</span>
    </p>
  {:else}
    <p class="nom non">Non classé</p>
    <p class="stats dim">Pas encore de partie classée cette saison.</p>
  {/if}
</section>

<style>
  .rang { position: relative; overflow: hidden; }
  .rang::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 3px; background: var(--tier); opacity: .9; }
  .rang::after { content: ""; position: absolute; right: -40px; top: -40px; width: 140px; height: 140px; border-radius: 50%; background: radial-gradient(circle, color-mix(in srgb, var(--tier) 22%, transparent), transparent 70%); pointer-events: none; }
  .nom { font-stretch: 118%; font-weight: 850; font-size: 24px; letter-spacing: -.02em; margin: 8px 0 12px; color: var(--tier); }
  .nom.non { color: var(--ink-2); font-size: 20px; }
  .barre { height: 6px; border-radius: 6px; background: var(--panel-3); overflow: hidden; }
  .barre span { display: block; height: 100%; border-radius: 6px; background: var(--tier); box-shadow: 0 0 12px color-mix(in srgb, var(--tier) 60%, transparent); transition: width .8s var(--ease); }
  .stats { display: flex; gap: 14px; margin-top: 10px; font-size: 12.5px; color: var(--ink-2); }
  .lp { color: var(--ink); font-weight: 700; }
</style>
