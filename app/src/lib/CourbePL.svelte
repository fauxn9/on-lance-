<script>
  import { ilYa, signe } from './format.js';
  import { nomRang } from './format.js';

  let { points = [] } = $props();
  const L = 600, H = 150, M = 10;
  const TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER'];
  const DIVS = ['IV', 'III', 'II', 'I'];

  const pts = $derived(points.filter((p) => p.ladder != null));
  const bornes = $derived.by(() => {
    if (pts.length < 2) return null;
    const vals = pts.map((p) => p.ladder);
    let min = Math.min(...vals), max = Math.max(...vals);
    if (max - min < 100) { const c = (min + max) / 2; min = c - 50; max = c + 50; }
    return { min: min - 12, max: max + 12 };
  });
  const x = (i) => M + (i / Math.max(1, pts.length - 1)) * (L - 2 * M);
  const y = (v) => H - M - ((v - bornes.min) / (bornes.max - bornes.min)) * (H - 2 * M);
  // Courbe lissée (Catmull-Rom → Bézier) : plus lisible qu'une ligne brisée.
  const trace = $derived.by(() => {
    if (!bornes) return '';
    const P = pts.map((p, i) => [x(i), y(p.ladder)]);
    let d = `M${P[0][0].toFixed(1)} ${P[0][1].toFixed(1)}`;
    for (let i = 0; i < P.length - 1; i++) {
      const [x0, y0] = P[i - 1] ?? P[i], [x1, y1] = P[i], [x2, y2] = P[i + 1], [x3, y3] = P[i + 2] ?? P[i + 1];
      const c1 = [x1 + (x2 - x0) / 6, y1 + (y2 - y0) / 6], c2 = [x2 - (x3 - x1) / 6, y2 - (y3 - y1) / 6];
      d += ` C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
    }
    return d;
  });
  const nomEchelle = (v) => {
    const t = Math.min(7, Math.floor(v / 400));
    return t >= 7 ? `Maître ${Math.round(v - 2800)} PL` : `${nomRang(TIERS[t], DIVS[Math.floor((v % 400) / 100)])} · ${Math.round(v % 100)} PL`;
  };
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

  // Survol : le point le plus proche de la souris.
  let survol = $state(null);
  function bouge(e) {
    const r = e.currentTarget.getBoundingClientRect();
    const rx = ((e.clientX - r.left) / r.width) * L;
    survol = Math.max(0, Math.min(pts.length - 1, Math.round(((rx - M) / (L - 2 * M)) * (pts.length - 1))));
  }
  const pointSurvol = $derived(survol != null && bornes ? { p: pts[survol], x: x(survol), y: y(pts[survol].ladder) } : null);
</script>

<section class="carte courbe">
  <div class="titre-carte">
    <p class="etiquette">Courbe de PL · Solo/Duo</p>
    {#if pts.length > 1}<span class="mono ecart" class:v={ecart > 0} class:r={ecart < 0}>{signe(ecart)} PL</span>{/if}
  </div>
  {#if bornes}
    <div class="zone" onpointermove={bouge} onpointerleave={() => (survol = null)} role="img" aria-label="Évolution des points de ligue : {signe(ecart)} PL sur la période">
      <svg viewBox="0 0 {L} {H}" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="aire" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" style="stop-color: var(--volt)" stop-opacity=".3" />
            <stop offset="1" style="stop-color: var(--volt)" stop-opacity="0" />
          </linearGradient>
        </defs>
        {#each lignes as l}
          <line x1="0" x2={L} y1={y(l.v)} y2={y(l.v)} class:fort={l.fort} />
        {/each}
        <g class="dessin">
          <path d="{trace} L{x(pts.length - 1)} {H} L{x(0)} {H} Z" fill="url(#aire)" />
          <path d={trace} class="ligne" />
        </g>
        {#if pointSurvol}
          <line class="guide" x1={pointSurvol.x} x2={pointSurvol.x} y1="0" y2={H} />
        {/if}
      </svg>
      <div class="reperes" aria-hidden="true">
        {#each lignes as l}
          <span class="mono" style:top="{(y(l.v) / H) * 100}%">{l.nom}</span>
        {/each}
      </div>
      {#if pointSurvol}
        <span class="point" style:left="{(pointSurvol.x / L) * 100}%" style:top="{(pointSurvol.y / H) * 100}%"></span>
        <div class="bulle" class:gauche={pointSurvol.x > L * 0.6} style:left="{(pointSurvol.x / L) * 100}%" style:top="{(pointSurvol.y / H) * 100}%">
          <b class="mono">{nomEchelle(pointSurvol.p.ladder)}</b>
          <small>{ilYa(pointSurvol.p.t)}</small>
        </div>
      {:else}
        <span class="point fin" style:left="{(x(pts.length - 1) / L) * 100}%" style:top="{(y(pts.at(-1).ladder) / H) * 100}%"></span>
      {/if}
    </div>
  {:else}
    <div class="vide">
      <svg viewBox="0 0 200 50" aria-hidden="true"><path d="M0 40 C 30 38, 40 20, 70 24 S 120 36, 140 18 S 180 10, 200 8" /></svg>
      <p class="dim">La courbe se dessine au fil de tes parties classées.</p>
    </div>
  {/if}
</section>

<style>
  .courbe { position: relative; display: flex; flex-direction: column; animation: apparait .6s var(--ease) .08s both; }
  .titre-carte { margin-bottom: 6px; }
  .ecart { font-size: 13px; font-weight: 700; }
  .zone { position: relative; flex: 1; min-height: 104px; cursor: crosshair; }
  svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
  line { stroke: rgba(255, 255, 255, .05); stroke-dasharray: 3 5; vector-effect: non-scaling-stroke; }
  line.fort { stroke: rgba(255, 255, 255, .14); stroke-dasharray: none; }
  line.guide { stroke: rgba(var(--volt-rgb), .45); stroke-dasharray: 2 4; }
  .dessin { animation: dessine 1.5s cubic-bezier(.65, 0, .35, 1) .2s both; }
  @keyframes dessine { from { clip-path: inset(0 100% 0 0); } to { clip-path: inset(0 0 0 0); } }
  .ligne { fill: none; stroke: var(--volt); stroke-width: 2.4; vector-effect: non-scaling-stroke; stroke-linecap: round; }
  .reperes { position: absolute; inset: 0; pointer-events: none; }
  .reperes span { position: absolute; right: 0; translate: 0 -120%; font-size: 10px; color: var(--ink-3); }
  .point { position: absolute; width: 10px; height: 10px; border-radius: 50%; translate: -50% -50%; background: var(--volt); box-shadow: 0 0 0 4px rgba(var(--volt-rgb), .18), 0 0 14px var(--volt); pointer-events: none; }
  .point.fin { animation: apparait .4s var(--ease) 1.6s both, pulse 2.4s 2s 3; }
  .bulle { position: absolute; translate: 14px -50%; pointer-events: none; padding: 7px 10px; border-radius: 10px; background: var(--panel-3); box-shadow: inset 0 0 0 1px var(--line-2), 0 12px 30px -8px rgba(0, 0, 0, .8); white-space: nowrap; }
  .bulle.gauche { translate: calc(-100% - 14px) -50%; }
  .bulle b { display: block; font-size: 12px; }
  .bulle small { font-size: 11px; color: var(--ink-3); }
  .vide { margin: auto 0; padding: 12px 0; display: grid; gap: 8px; }
  .vide svg { position: static; width: 100%; height: 50px; }
  .vide path { fill: none; stroke: var(--panel-3); stroke-width: 3; stroke-dasharray: 6 8; stroke-linecap: round; }
  .vide p { font-size: 13px; }
</style>
