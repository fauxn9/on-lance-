<script>
  // Les meilleurs augments d'un champion en ARAM Mayhem, en trois colonnes
  // par rareté : les trois cartes d'un même choix ont la même rareté, il
  // suffit de regarder la bonne colonne.
  import { augs, chargerAugments } from '../augments.svelte.js';

  let { augments = [], par = 5, compact = false } = $props();
  chargerAugments();

  const RARETES = [['argent', 'Argent'], ['or', 'Or'], ['prisme', 'Prismatique']];
  const colonnes = $derived(RARETES.map(([r, nom]) => ({ r, nom, liste: augments.filter((a) => augs.info(a.id)?.r === r).slice(0, par) })));
  const pct = (x) => `${Math.round(x * 100)} %`;
</script>

<div class="cadre">
<div class="colonnes" class:compact>
  {#each colonnes as c}
    <div class="col {c.r}">
      <small class="rarete">{c.nom}</small>
      {#each c.liste as a, i (a.id)}
        {@const info = augs.info(a.id)}
        <div class="aug" style:--i={i} title="{info?.n} · {pct(a.winrate)} de victoires sur {a.games} partie{a.games > 1 ? 's' : ''}">
          <span class="ico">{#if info?.i}<img src={info.i} alt="" />{/if}</span>
          <span class="nom">{info?.n ?? '…'}</span>
          {#if !compact}<span class="wr mono">{pct(a.winrate)}</span>{/if}
          <b class="tier t-{a.tier}">{a.tier}</b>
        </div>
      {:else}
        <p class="rien">Pas encore de données</p>
      {/each}
    </div>
  {/each}
</div>
</div>

<style>
  .cadre { container-type: inline-size; }
  .colonnes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
  .col { display: grid; gap: 5px; align-content: start; min-width: 0; }
  .rarete { display: flex; align-items: center; gap: 6px; font-size: 10.5px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--c); margin-bottom: 2px; }
  .rarete::before { content: ''; width: 8px; height: 8px; border-radius: 2px; rotate: 45deg; background: var(--c); }
  .argent { --c: #c9d3df; }
  .or { --c: #f2c14e; }
  .prisme { --c: #c4a8ff; }
  .prisme .rarete::before { background: linear-gradient(135deg, #ffb3f0, #b7a4ff 45%, #6ff0ff); }
  .aug {
    display: flex; align-items: center; gap: 8px; min-width: 0; padding: 4px 6px 4px 4px; border-radius: 9px;
    background: rgba(255, 255, 255, .03); box-shadow: inset 0 0 0 1px var(--line); animation: apparait .35s var(--ease) both; animation-delay: calc(var(--i) * 40ms);
  }
  .ico { flex: none; width: 28px; height: 28px; border-radius: 7px; overflow: hidden; background: var(--bg); box-shadow: 0 0 0 1px color-mix(in srgb, var(--c) 55%, transparent); }
  .ico img { width: 100%; height: 100%; display: block; }
  .nom { flex: 1; min-width: 0; font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .wr { font-size: 10.5px; color: var(--ink-3); }
  .tier { flex: none; width: 20px; height: 20px; display: grid; place-items: center; border-radius: 6px; font: 900 11px var(--mono); background: var(--panel-3); color: var(--ink-2); }
  .t-S { background: var(--volt); color: var(--volt-ink); }
  .t-A { background: rgba(var(--volt-rgb), .18); color: var(--volt); }
  .t-C { color: var(--ink-3); background: transparent; box-shadow: inset 0 0 0 1px var(--line-2); }
  .rien { font-size: 11px; color: var(--ink-3); padding: 4px 2px; }
  .compact { gap: 8px; }
  .compact .aug { padding: 3px 5px 3px 3px; gap: 6px; }
  .compact .ico { width: 24px; height: 24px; }
  .compact .nom { font-size: 11.5px; }
  /* Panneau étroit (sélection des champions, petite fenêtre) : une rareté par ligne. */
  @container (max-width: 430px) {
    .colonnes { grid-template-columns: minmax(0, 1fr); }
  }
</style>
