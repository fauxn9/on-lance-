<script>
  // Les six étapes d'une game. Une barre lumineuse glisse sous l'étape en
  // cours et laisse une trace sur celles déjà passées.
  let { etape } = $props();
  const ETAPES = [
    ['menus', 'Menus'], ['file', 'File'], ['selection', 'Sélection'],
    ['chargement', 'Chargement'], ['en_jeu', 'En jeu'], ['fin', 'Fin'],
  ];
  const index = $derived(ETAPES.findIndex(([id]) => id === etape));
  let items = $state([]);
  // Remesure quand les polices arrivent ou que la fenêtre change de taille.
  let mesure = $state(0);
  $effect(() => {
    const remesurer = () => mesure++;
    document.fonts?.ready.then(remesurer);
    addEventListener('resize', remesurer);
    return () => removeEventListener('resize', remesurer);
  });
  const curseur = $derived.by(() => {
    mesure;
    const el = items[index];
    return el ? { x: el.offsetLeft, w: el.offsetWidth } : null;
  });
</script>

<ol class="etapes" aria-label="Phase de jeu">
  {#if curseur}
    <span class="curseur" style:transform="translateX({curseur.x}px)" style:width="{curseur.w}px" aria-hidden="true"></span>
  {/if}
  {#each ETAPES as [id, nom], i}
    <li bind:this={items[i]} class:fait={index > i} class:actif={index === i} aria-current={index === i ? 'step' : undefined}>
      <span class="puce"></span>{nom}
    </li>
  {/each}
</ol>

<style>
  .etapes { position: relative; display: flex; align-items: center; gap: 4px; margin: 0; padding: 4px; list-style: none; border-radius: 999px; background: rgba(6, 7, 9, .55); box-shadow: inset 0 0 0 1px var(--line); }
  .curseur {
    position: absolute; top: 4px; left: 0; height: calc(100% - 8px); border-radius: 999px; pointer-events: none;
    background: var(--volt-soft); box-shadow: inset 0 0 0 1px var(--volt-line), 0 0 22px -6px var(--volt-glow);
    transition: transform .6s cubic-bezier(.34, 1.4, .64, 1), width .6s cubic-bezier(.34, 1.4, .64, 1);
  }
  li { position: relative; display: inline-flex; align-items: center; gap: 7px; padding: 6px 12px; border-radius: 999px; font-size: 12px; font-weight: 600; color: var(--ink-3); transition: color .4s; }
  .puce { width: 6px; height: 6px; border-radius: 50%; background: var(--panel-3); transition: background-color .4s, transform .4s; }
  li.fait { color: var(--ink-2); }
  li.fait .puce { background: var(--volt); opacity: .45; }
  li.actif { color: var(--volt); }
  li.actif .puce { background: var(--volt); transform: scale(1.2); animation: pulse 2s 3; }
</style>
