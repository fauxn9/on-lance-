<script>
  import { dd } from '../ddragon.svelte.js';
  import { nomFragment } from '../format.js';

  let { runes } = $props();
  const cle = $derived(dd.rune(runes.perks[0]));
</script>

<div class="page">
  <div class="arbre">
    {#if dd.rune(runes.primaryStyleId)}<img class="style" src={dd.rune(runes.primaryStyleId).icone} alt={dd.rune(runes.primaryStyleId).nom} title={dd.rune(runes.primaryStyleId).nom} />{/if}
    {#if cle}<img class="cle" src={cle.icone} alt={cle.nom} title={cle.nom} />{/if}
    <div class="mineures">
      {#each runes.perks.slice(1) as p, i}
        {@const r = dd.rune(p)}
        {#if r}<img src={r.icone} alt={r.nom} title={r.nom} style:--i={i} />{/if}
      {/each}
    </div>
  </div>
  <div class="arbre secondaire">
    {#if dd.rune(runes.subStyleId)}<img class="style" src={dd.rune(runes.subStyleId).icone} alt={dd.rune(runes.subStyleId).nom} title={dd.rune(runes.subStyleId).nom} />{/if}
    <div class="mineures">
      {#each runes.subPerks as p, i}
        {@const r = dd.rune(p)}
        {#if r}<img src={r.icone} alt={r.nom} title={r.nom} style:--i={i + 3} />{/if}
      {/each}
    </div>
  </div>
  <p class="nom-cle">{cle?.nom ?? ''}</p>
  <ul class="fragments">
    {#each runes.fragments as f}<li>{nomFragment(f)}</li>{/each}
  </ul>
</div>

<style>
  .page { display: grid; gap: 10px; }
  .arbre { display: flex; align-items: center; gap: 10px; }
  .style { width: 22px; height: 22px; opacity: .85; }
  .cle { width: 54px; height: 54px; border-radius: 50%; background: radial-gradient(circle, rgba(214, 255, 63, .12), transparent 70%); animation: cle .7s cubic-bezier(.34, 1.56, .64, 1) both; }
  @keyframes cle { from { transform: scale(.5) rotate(-30deg); opacity: 0; } }
  .mineures { display: flex; gap: 6px; }
  .mineures img { width: 32px; height: 32px; border-radius: 50%; background: #0b0d10; box-shadow: inset 0 0 0 1px var(--line-2); animation: apparait .4s var(--ease) both; animation-delay: calc(80ms + var(--i) * 50ms); }
  .secondaire { padding-left: 2px; }
  .secondaire .mineures img { width: 28px; height: 28px; }
  .nom-cle { font-weight: 700; font-size: 13px; }
  .fragments { display: flex; flex-wrap: wrap; gap: 5px; }
  .fragments li { font-size: 10.5px; font-weight: 600; color: var(--ink-2); padding: 3px 8px; border-radius: 999px; box-shadow: inset 0 0 0 1px var(--line-2); }
</style>
