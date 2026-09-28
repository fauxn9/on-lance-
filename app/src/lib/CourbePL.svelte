<script>
  import { nomRang, signe } from './format.js';

  let { points = [] } = $props();
  const L = 600, H = 140, M = 8;
  const TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER'];
  const DIVS = ['IV', 'III', 'II', 'I'];

  const pts = $derived(points.filter((p) => p.ladder != null));
  const bornes = $derived.by(() => {
    if (pts.length < 2) return null;
    const vals = pts.map((p) => p.ladder);
    let min = Math.min(...vals), max = Math.max(...vals);
    if (max - min < 100) { const c = (min + max) / 2; min = c - 50; max = c + 50; }
    return { min: min - 10, max: max + 10 };
  });
  const x = (i) => M + (i / Math.max(1, pts.length - 1)) * (L - 2 * M);
  const y = (v) => H - M - ((v - bornes.min) / (bornes.max - bornes.min)) * (H - 2 * M);
  const trace = $derived(bornes ? pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.ladder).toFixed(1)}`).join(' ') : '');
  // Lignes de division visibles dans la fenêtre, avec le nom du rang.
  const lignes = $derived.by(() => {
    if (!bornes) return [];
    const out = [];
    for (let v = Math.ceil(bornes.min / 100) * 100; v <= bornes.max; v += 100) {
      const t = Math.min(7, Math.floor(v / 400));
      out.push({ v, nom: t >= 7 ? 'Maître' : nomRang(TIERS[t], DIVS[Math.floor((v % 400) / 100)]), fort: v % 400 === 0 });
    }
    return out;
  });
  const ecart = $derived(pts.length > 1 ? pts.at(-1).ladder - pts[0].ladder : 0);
</script>

<section class="carte courbe">
  <div class="titre-carte">
    <p class="etiquette">Courbe de PL · Solo/Duo</p>
    {#if pts.length > 1}<span class="mono ecart" class:v={ecart > 0} class:r={ecart < 0}>{signe(ecart)} PL</span>{/if}
  </div>
  {#if bornes}
    <svg viewBox="0 0 {L} {H}" preserveAspectRatio="none" role="img" aria-label="Évolution des points de ligue, {signe(ecart)} PL sur la période">
      <defs>
        <linearGradient id="aire" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stop-color="#d6ff3f" stop-opacity=".28" />
          <stop offset="1" stop-color="#d6ff3f" stop-opacity="0" />
        </linearGradient>
      </defs>
      {#each lignes as l}
        <line x1="0" x2={L} y1={y(l.v)} y2={y(l.v)} class:fort={l.fort} />
      {/each}
      <path d="{trace} L{x(pts.length - 1)} {H} L{x(0)} {H} Z" fill="url(#aire)" />
      <path d={trace} class="ligne" />
    </svg>
    <div class="reperes">
      {#each lignes as l}
        <span class="mono" style:top="{(y(l.v) / H) * 100}%">{l.nom}</span>
      {/each}
    </div>
  {:else}
    <p class="vide dim">La courbe se dessine au fil de tes parties classées.</p>
  {/if}
</section>

<style>
  .courbe { position: relative; display: flex; flex-direction: column; }
  .titre-carte { margin-bottom: 8px; }
  .ecart { font-size: 13px; font-weight: 700; }
  svg { width: 100%; height: 120px; flex: 1; min-height: 100px; }
  line { stroke: rgba(255, 255, 255, .05); stroke-dasharray: 3 5; vector-effect: non-scaling-stroke; }
  line.fort { stroke: rgba(255, 255, 255, .14); stroke-dasharray: none; }
  .ligne { fill: none; stroke: var(--volt); stroke-width: 2.2; vector-effect: non-scaling-stroke; filter: drop-shadow(0 0 6px rgba(214, 255, 63, .45)); }
  .reperes { position: absolute; left: 16px; right: 16px; top: 44px; bottom: 16px; pointer-events: none; }
  .reperes span { position: absolute; right: 0; translate: 0 -120%; font-size: 10px; color: var(--ink-3); }
  .vide { font-size: 13px; margin: auto 0; padding: 24px 0; }
</style>
