<script module>
  // Positions choisies par le joueur, en % de l'écran (le centre haut de
  // chaque widget) : elles tiennent quelle que soit la résolution.
  const CLE = 'overlay-positions-v1';
  let positions = {};
  try { positions = JSON.parse(localStorage.getItem(CLE) ?? '{}') ?? {}; } catch {}
  export function reinitialiserPositions() {
    positions = {};
    try { localStorage.removeItem(CLE); } catch {}
  }
  function sauver(id, p) {
    positions[id] = p;
    try { localStorage.setItem(CLE, JSON.stringify(positions)); } catch {}
  }
  export const positionDe = (id) => positions[id];
</script>

<script>
  let { id, titre, defaut, edition = false, generation = 0, children } = $props();

  // `generation` change quand on réinitialise : chaque widget relit sa place.
  let pos = $state({ x: 50, y: 50 });
  $effect(() => {
    generation;
    pos = { ...(positionDe(id) ?? defaut) };
  });

  // Le widget reste entier à l'écran quelle que soit la résolution : sa
  // position est en %, sa taille en pixels.
  let largeur = $state(0), hauteur = $state(0);
  let fl = $state(innerWidth), fh = $state(innerHeight);
  const MARGE = 8;
  const gauche = $derived(Math.min(fl - largeur / 2 - MARGE, Math.max(largeur / 2 + MARGE, (pos.x / 100) * fl)));
  const haut = $derived(Math.min(fh - hauteur - MARGE, Math.max(MARGE, (pos.y / 100) * fh)));

  let glisse = $state(null);
  function bas(e) {
    if (!edition || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    // Depuis la position affichée (bornée), sinon le widget sauterait au clic.
    glisse = { dx: e.clientX - gauche, dy: e.clientY - haut };
  }
  function bouge(e) {
    if (!glisse) return;
    const x = ((e.clientX - glisse.dx) / innerWidth) * 100;
    const y = ((e.clientY - glisse.dy) / innerHeight) * 100;
    pos = { x: Math.min(98, Math.max(2, x)), y: Math.min(96, Math.max(0, y)) };
  }
  function lacher() {
    if (!glisse) return;
    glisse = null;
    sauver(id, pos);
  }
</script>

<svelte:window bind:innerWidth={fl} bind:innerHeight={fh} />

<div
  class="widget" class:edition class:glisse={glisse}
  style:left="{gauche}px" style:top="{haut}px"
  bind:clientWidth={largeur} bind:clientHeight={hauteur}
  onpointerdown={bas} onpointermove={bouge} onpointerup={lacher} onpointercancel={lacher}
  role="group" aria-label={titre}
>
  {#if edition}<span class="poignee" class:dessous={pos.y < 8}>{titre}</span>{/if}
  {@render children()}
</div>

<style>
  .widget { position: absolute; translate: -50% 0; pointer-events: none; }
  .edition { pointer-events: auto; cursor: grab; outline: 1.5px dashed rgba(214, 255, 63, .65); outline-offset: 6px; border-radius: 14px; }
  .edition.glisse { cursor: grabbing; outline-style: solid; }
  .poignee {
    position: absolute; left: 50%; bottom: calc(100% + 10px); translate: -50% 0; white-space: nowrap;
    padding: 3px 9px; border-radius: 999px; background: var(--volt); color: var(--volt-ink);
    font-size: 11px; font-weight: 800; letter-spacing: .04em;
  }
  /* Widget collé en haut de l'écran : l'étiquette passe dessous. */
  .poignee.dessous { bottom: auto; top: calc(100% + 10px); }
</style>
