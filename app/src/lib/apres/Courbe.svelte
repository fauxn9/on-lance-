<script>
  // Écart avec l'adversaire direct, minute par minute. Au-dessus de zéro, tu
  // mènes (vert volt) ; en dessous, tu es derrière (rouge). Tes morts sont
  // marquées sur la courbe ; le survol donne la valeur de chaque minute.
  let { valeurs = [], morts = [], unite = 'PO' } = $props();

  let largeur = $state(600);
  const H = 200, PAD = 14;
  const max = $derived(Math.max(1, ...valeurs.map((v) => Math.abs(v))));
  const x = (i) => (valeurs.length > 1 ? (i / (valeurs.length - 1)) * largeur : 0);
  const y = (v) => H / 2 - (v / max) * (H / 2 - PAD);
  const trace = $derived(valeurs.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' '));
  const aire = $derived(valeurs.length ? `${trace} L${x(valeurs.length - 1)} ${H / 2} L0 ${H / 2}Z` : '');
  // Valeur interpolée à un instant donné (une mort tombe entre deux minutes).
  const a = (t) => {
    const m = Math.min(valeurs.length - 1, t / 60000);
    const i = Math.floor(m);
    const f = m - i;
    return (valeurs[i] ?? 0) * (1 - f) + (valeurs[i + 1] ?? valeurs[i] ?? 0) * f;
  };
  const pointsMorts = $derived(morts.map((m) => ({ ...m, px: x(Math.min(valeurs.length - 1, m.t / 60000)), py: y(a(m.t)) })));
  const graduations = $derived(Array.from({ length: Math.floor((valeurs.length - 1) / 5) + 1 }, (_, k) => k * 5).filter((m) => m > 0 && m < valeurs.length - 1));

  let survol = $state(null);
  function bouge(e) {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left) / r.width) * (valeurs.length - 1));
    survol = Math.max(0, Math.min(valeurs.length - 1, i));
  }
  const nf = new Intl.NumberFormat('fr-FR');
  const signe = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${nf.format(Math.abs(Math.round(v)))}`;
  const mmss = (t) => `${Math.floor(t / 60000)}:${String(Math.floor((t % 60000) / 1000)).padStart(2, '0')}`;
  const cle = $derived(`${valeurs.length}:${valeurs[valeurs.length - 1]}:${unite}`);
</script>

<div class="courbe" bind:clientWidth={largeur} onpointermove={bouge} onpointerleave={() => (survol = null)} role="img" aria-label="Écart minute par minute">
  {#key cle}
    <svg width={largeur} height={H} viewBox="0 0 {largeur} {H}">
      <defs>
        <linearGradient id="c-pos" x1="0" x2="0" y1="0" y2="1"><stop offset="0" style="stop-color: var(--volt)" stop-opacity=".42" /><stop offset="1" style="stop-color: var(--volt)" stop-opacity="0" /></linearGradient>
        <linearGradient id="c-neg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#ff4d6a" stop-opacity="0" /><stop offset="1" stop-color="#ff4d6a" stop-opacity=".34" /></linearGradient>
        <clipPath id="c-haut"><rect width={largeur} height={H / 2} /></clipPath>
        <clipPath id="c-bas"><rect y={H / 2} width={largeur} height={H / 2} /></clipPath>
      </defs>
      {#each graduations as m}
        <line class="grad" x1={x(m)} x2={x(m)} y1={PAD} y2={H - PAD} />
        <text class="min" x={x(m)} y={H - 2}>{m}′</text>
      {/each}
      <line class="zero" x1="0" x2={largeur} y1={H / 2} y2={H / 2} />
      <g class="aires">
        <path d={aire} fill="url(#c-pos)" clip-path="url(#c-haut)" />
        <path d={aire} fill="url(#c-neg)" clip-path="url(#c-bas)" />
      </g>
      <path class="ligne" d={trace} pathLength="1" />
      {#each pointsMorts as p, k}
        <circle class="mort" class:isole={p.isole} cx={p.px} cy={p.py} r="5" style:--k={k}><title>Mort à {mmss(p.t)}</title></circle>
      {/each}
      {#if survol != null}
        <line class="curseur" x1={x(survol)} x2={x(survol)} y1="0" y2={H} />
        <circle class="point" cx={x(survol)} cy={y(valeurs[survol])} r="4" />
      {/if}
      <text class="borne" x="4" y={PAD + 4}>{signe(max)}</text>
      <text class="borne" x="4" y={H - PAD - 6}>{signe(-max)}</text>
    </svg>
  {/key}
  {#if survol != null}
    <span class="bulle mono" style:left="{Math.min(largeur - 110, Math.max(0, x(survol) - 55))}px">
      <b class:v={valeurs[survol] > 0} class:r={valeurs[survol] < 0}>{signe(valeurs[survol])} {unite}</b> à {survol} min
    </span>
  {/if}
</div>

<style>
  .courbe { position: relative; width: 100%; height: 200px; cursor: crosshair; }
  svg { display: block; overflow: visible; }
  .zero { stroke: #2a2f3a; stroke-dasharray: 3 4; }
  .grad { stroke: rgba(255, 255, 255, .04); }
  .min, .borne { font: 600 10px var(--mono); fill: var(--ink-3); }
  .min { text-anchor: middle; }
  .ligne {
    fill: none; stroke: var(--volt); stroke-width: 2.2; stroke-linejoin: round; stroke-linecap: round;
    stroke-dasharray: 1; stroke-dashoffset: 1; animation: trace 1.1s var(--ease) forwards;
    filter: drop-shadow(0 0 6px rgba(var(--volt-rgb), .35));
  }
  @keyframes trace { to { stroke-dashoffset: 0; } }
  .aires { opacity: 0; animation: apparait-aire .6s ease .5s forwards; }
  @keyframes apparait-aire { to { opacity: 1; } }
  .mort { fill: var(--red); stroke: var(--bg); stroke-width: 2; transform-box: fill-box; transform-origin: center; animation: pop .4s cubic-bezier(.34, 1.56, .64, 1) backwards; animation-delay: calc(.9s + var(--k) * 90ms); }
  .mort.isole { stroke: var(--red); stroke-width: 1.5; fill: var(--bg); }
  @keyframes pop { from { transform: scale(0); } }
  .curseur { stroke: rgba(255, 255, 255, .18); }
  .point { fill: var(--ink); }
  .bulle { position: absolute; top: -6px; width: 110px; text-align: center; padding: 4px 6px; border-radius: 8px; background: var(--panel-3); box-shadow: inset 0 0 0 1px var(--line-2); font-size: 11px; color: var(--ink-2); pointer-events: none; }
  .bulle b { font-weight: 700; color: var(--ink); }
  .bulle b.v { color: var(--volt); } .bulle b.r { color: var(--red); }
  @media (prefers-reduced-motion: reduce) {
    .ligne { animation: none; stroke-dashoffset: 0; }
    .aires { animation: none; opacity: 1; }
  }
</style>
