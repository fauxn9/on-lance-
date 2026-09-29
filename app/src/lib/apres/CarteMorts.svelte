<script>
  // Tes morts sur la Faille. Pleine : un allié était à portée. Cerclée : mort
  // isolée. Le survol d'une ligne de la liste allume le point sur la carte.
  import { dd } from '../ddragon.svelte.js';

  let { morts = [] } = $props();
  let active = $state(null);

  // Coordonnées de la carte : environ 0 → 14 800 sur les deux axes, y vers le haut.
  const gauche = (x) => `${Math.min(97, Math.max(3, ((x + 120) / 14990) * 100))}%`;
  const haut = (y) => `${Math.min(97, Math.max(3, 100 - ((y + 120) / 15100) * 100))}%`;
  const mmss = (t) => `${Math.floor(t / 60000)}:${String(Math.floor((t % 60000) / 1000)).padStart(2, '0')}`;
  const APRES = { dragon: 'dragon adverse', ancien: 'dragon ancien adverse', baron: 'baron adverse', heraut: 'héraut adverse', larves: 'larves adverses', atakhan: 'Atakhan adverse', monstre: 'monstre adverse', tour: 'tourelle perdue' };
</script>

<div class="bloc">
  <div class="carte-faille">
    {#if dd.carte}<img src={dd.carte} alt="La Faille de l'invocateur" width="512" height="512" />{/if}
    <span class="voile"></span>
    {#each morts as m, i}
      <span
        class="point" class:isole={m.isole} class:actif={active === i}
        style:left={gauche(m.x)} style:top={haut(m.y)} style:--i={i}
        title="Mort à {mmss(m.t)}"
      >{i + 1}</span>
    {/each}
  </div>
  <ol class="liste">
    {#each morts as m, i}
      <li onpointerenter={() => (active = i)} onpointerleave={() => (active = null)} class:actif={active === i}>
        <span class="n" class:isole={m.isole}>{i + 1}</span>
        <span class="t mono">{mmss(m.t)}</span>
        {#if m.tueur && dd.champion(m.tueur).icone}<img src={dd.champion(m.tueur).icone} alt={dd.champion(m.tueur).nom} title={dd.champion(m.tueur).nom} />{/if}
        <span class="quoi">
          {m.attaquants > 1 ? `à ${m.attaquants} contre 1` : 'en 1 contre 1'}{m.isole ? ', seul' : ''}
          {#if m.apres}<em class="r">→ {APRES[m.apres] ?? m.apres}</em>{/if}
        </span>
      </li>
    {:else}
      <li class="aucune">Aucune mort. Propre.</li>
    {/each}
  </ol>
</div>

<style>
  .bloc { display: grid; grid-template-columns: minmax(0, 220px) minmax(0, 1fr); gap: 14px; align-items: start; }
  .carte-faille { position: relative; aspect-ratio: 1; border-radius: 12px; overflow: hidden; background: #0c1410; box-shadow: inset 0 0 0 1px var(--line); }
  .carte-faille img { width: 100%; height: 100%; object-fit: cover; filter: saturate(.55) brightness(.62); }
  .voile { position: absolute; inset: 0; background: radial-gradient(circle at 50% 50%, transparent 40%, rgba(6, 7, 9, .45)); }
  .point {
    position: absolute; translate: -50% -50%; width: 20px; height: 20px; display: grid; place-items: center;
    border-radius: 50%; background: var(--red); color: #fff; font: 800 10px var(--mono);
    box-shadow: 0 0 0 2px rgba(6, 7, 9, .8), 0 0 14px rgba(255, 77, 106, .6);
    transition: transform .25s cubic-bezier(.34, 1.56, .64, 1);
    animation: tombe .45s cubic-bezier(.34, 1.56, .64, 1) backwards; animation-delay: calc(.2s + var(--i) * 80ms);
  }
  .point.isole { background: rgba(6, 7, 9, .85); color: var(--red); box-shadow: 0 0 0 2px var(--red), 0 0 14px rgba(255, 77, 106, .5); }
  .point.actif { transform: scale(1.45); z-index: 2; }
  @keyframes tombe { from { transform: scale(0); } }
  .liste { display: grid; gap: 4px; }
  .liste li { display: flex; align-items: center; gap: 9px; padding: 6px 8px; border-radius: 10px; font-size: 12.5px; transition: background-color .2s; }
  .liste li.actif { background: rgba(255, 255, 255, .04); }
  .n { width: 20px; height: 20px; flex: none; display: grid; place-items: center; border-radius: 50%; background: var(--red); color: #fff; font: 800 10px var(--mono); }
  .n.isole { background: transparent; color: var(--red); box-shadow: inset 0 0 0 1.5px var(--red); }
  .t { color: var(--ink-2); font-size: 12px; min-width: 38px; }
  .liste img { width: 22px; height: 22px; border-radius: 6px; }
  .quoi { color: var(--ink-2); min-width: 0; }
  .quoi em { font-style: normal; font-weight: 600; margin-left: 4px; white-space: nowrap; }
  .aucune { color: var(--volt); }
  @container (max-width: 520px) {
    .bloc { grid-template-columns: 1fr; }
    .carte-faille { max-width: 240px; }
  }
</style>
