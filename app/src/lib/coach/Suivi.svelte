<script>
  // Le focus partie après partie : une barre par partie (de la plus ancienne
  // à la plus récente), verte quand l'objectif est tenu, et la ligne de
  // l'objectif en pointillés. Avec onchoisir, chaque barre ouvre son debrief.
  import { ilYa } from '../format.js';

  let { suivi = [], cible, grand = false, onchoisir = null } = $props();
  const max = $derived(Math.max(cible * 1.35, ...suivi.map((s) => s.valeur)) || 1);
  const ligne = $derived(Math.min(100, (cible / max) * 100));
</script>

<div class="suivi" class:grand role={onchoisir ? 'group' : 'img'} aria-label="Objectif tenu sur {suivi.filter((s) => s.tenu).length} des {suivi.length} dernières parties">
  <span class="cible" style:bottom="{ligne}%"></span>
  {#each suivi as s, i (s.matchId)}
    {@const h = `${Math.max(4, (s.valeur / max) * 100)}%`}
    {@const titre = `${s.tenu ? 'Objectif tenu' : 'Objectif raté'} · ${ilYa(s.t)} · ${s.win ? 'victoire' : 'défaite'}`}
    {#if onchoisir}
      <button class="barre" class:tenu={s.tenu} class:derniere={i === suivi.length - 1} style:--h={h} style:--i={i} title="{titre} · voir le debrief" aria-label="{titre}, voir le debrief" onclick={() => onchoisir(s.matchId)}></button>
    {:else}
      <span class="barre" class:tenu={s.tenu} class:derniere={i === suivi.length - 1} style:--h={h} style:--i={i} title={titre}></span>
    {/if}
  {/each}
</div>

<style>
  .suivi { position: relative; display: flex; align-items: flex-end; gap: 4px; height: 46px; padding-top: 4px; }
  .suivi.grand { height: 120px; gap: 6px; }
  .cible { position: absolute; left: 0; right: 0; height: 0; border-top: 1.5px dashed rgba(var(--volt-rgb), .55); z-index: 1; pointer-events: none; }
  .barre {
    flex: 1; height: var(--h); padding: 0; border: 0; border-radius: 4px 4px 2px 2px; background: rgba(255, 77, 106, .45);
    transform-origin: bottom; animation: pousse .6s var(--ease) backwards; animation-delay: calc(var(--i) * 35ms);
    transition: filter .2s, transform .25s var(--ease);
  }
  .barre.tenu { background: var(--volt); }
  .barre.derniere { box-shadow: 0 0 0 1.5px var(--bg), 0 0 0 3px rgba(255, 255, 255, .35); }
  button.barre { cursor: pointer; }
  button.barre:hover { filter: brightness(1.35); transform: scaleY(1.04); }
  button.barre:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
  @keyframes pousse { from { transform: scaleY(0); } }
</style>
