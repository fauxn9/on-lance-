<script>
  let { etape } = $props();
  const ETAPES = [
    ['menus', 'Menus'], ['file', 'File'], ['selection', 'Sélection'],
    ['chargement', 'Chargement'], ['en_jeu', 'En jeu'], ['fin', 'Fin'],
  ];
  const index = $derived(ETAPES.findIndex(([id]) => id === etape));
</script>

<ol class="etapes" aria-label="Phase de jeu">
  {#each ETAPES as [id, nom], i}
    <li class:fait={index > i} class:actif={index === i} aria-current={index === i ? 'step' : undefined}>
      <span class="puce"></span>{nom}
    </li>
  {/each}
</ol>

<style>
  .etapes { display: flex; align-items: center; gap: 6px; margin: 0; padding: 0; list-style: none; }
  li { display: inline-flex; align-items: center; gap: 7px; padding: 6px 11px; border-radius: 999px; font-size: 12px; font-weight: 600; color: var(--ink-3); transition: color .3s, background-color .3s, box-shadow .3s; }
  .puce { width: 6px; height: 6px; border-radius: 50%; background: var(--panel-3); transition: background-color .3s; }
  li.fait { color: var(--ink-2); }
  li.fait .puce { background: var(--ink-3); }
  li.actif { color: var(--volt); background: var(--volt-soft); box-shadow: inset 0 0 0 1px var(--volt-line); }
  li.actif .puce { background: var(--volt); animation: pulse 2s infinite; }
</style>
