<script>
  // Le fil des potes : chaque fin de partie chambrée, chaque couronne du lundi,
  // et les réactions du groupe (GG, aïe, cheh).
  import { dd } from '../ddragon.svelte.js';
  import { ilYaCourt } from '../format.js';
  import Icone from '../Icone.svelte';

  let { evenements = [], onreagir = () => {}, multi = false } = $props();
  const REACTIONS = [['gg', 'GG'], ['aie', 'aïe'], ['cheh', 'cheh']];
  const ieme = (n) => (n === 1 ? '1er' : `${n}e`);
  const signe = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');
</script>

<ul class="fil">
  {#each evenements as e, i (e.id)}
    {@const c = e.data?.championId ? dd.champion(e.data.championId) : null}
    <li class={e.type} class:moi={e.moi} style:--i={Math.min(i, 10)}>
      <span class="pastille">
        {#if e.type === 'couronne'}<span class="rond-couronne"><Icone nom="couronne" /></span>
        {:else if c?.icone}<img src={c.icone} alt={c.nom} />{/if}
      </span>
      <div class="corps">
        <p class="tete">
          <b>{e.moi ? 'toi' : e.pseudo}</b>
          {#if e.type === 'couronne'}<span class="tag or">gagne la semaine</span>{/if}
          {#if multi}<span class="dim">· {e.groupe}</span>{/if}
          <span class="dim mono">{ilYaCourt(e.t)}</span>
        </p>
        <p class="bulle">{e.texte}</p>
        {#if e.type === 'partie' && e.data}
          <p class="meta mono">
            <span class:v={e.data.victoire} class:r={!e.data.victoire}>{e.data.victoire ? 'Victoire' : 'Défaite'}</span>
            {#if c}<span>{c.nom} {e.data.kda}</span>{/if}
            {#if e.data.lpPartie != null}<span class:v={e.data.lpPartie > 0} class:r={e.data.lpPartie < 0}>{signe(e.data.lpPartie)} LP</span>{/if}
            {#if e.data.avant && e.data.place && e.data.avant !== e.data.place}
              <span class="mouvement" class:v={e.data.place < e.data.avant} class:r={e.data.place > e.data.avant}>{ieme(e.data.avant)} → {ieme(e.data.place)}</span>
            {/if}
          </p>
        {/if}
        <div class="reactions">
          {#each REACTIONS as [type, nom]}
            {@const n = e.reactions?.[type] ?? 0}
            <button class:on={e.maReaction === type} class:vide={!n} onclick={() => onreagir(e, e.maReaction === type ? null : type)} aria-pressed={e.maReaction === type}>
              {nom}{#if n}<span class="mono">{n}</span>{/if}
            </button>
          {/each}
        </div>
      </div>
    </li>
  {:else}
    <li class="rien">
      <p class="dim">Rien pour l'instant. Dès qu'un pote finit une partie, la vanne tombe ici.</p>
    </li>
  {/each}
</ul>

<style>
  .fil { display: grid; gap: 12px; }
  li { display: grid; grid-template-columns: 36px minmax(0, 1fr); gap: 10px; animation: apparait .4s var(--ease) both; animation-delay: calc(var(--i) * 45ms); }
  .pastille img, .rond-couronne { width: 36px; height: 36px; border-radius: 11px; }
  .rond-couronne { display: grid; place-items: center; background: rgba(255, 200, 87, .12); box-shadow: inset 0 0 0 1px rgba(255, 200, 87, .4); color: var(--gold); }
  .rond-couronne :global(svg) { width: 18px; height: 18px; fill: var(--gold); stroke-width: 1.5; }
  .corps { display: grid; gap: 5px; min-width: 0; }
  .tete { display: flex; align-items: baseline; gap: 6px; font-size: 12.5px; flex-wrap: wrap; }
  .tete b { font-size: 13px; }
  .moi .tete b { color: var(--volt); }
  .tete .mono { font-size: 11px; margin-left: auto; }
  .tag.or { color: var(--gold); box-shadow: inset 0 0 0 1px rgba(255, 200, 87, .35); background: rgba(255, 200, 87, .08); }
  .bulle {
    position: relative; justify-self: start; max-width: 100%; padding: 9px 13px; border-radius: 4px 14px 14px 14px;
    background: var(--panel-3); box-shadow: inset 0 0 0 1px var(--line-2); font-size: 13.5px; line-height: 1.45; color: var(--ink);
  }
  .couronne .bulle { background: linear-gradient(135deg, rgba(255, 200, 87, .12), var(--panel-3) 60%); box-shadow: inset 0 0 0 1px rgba(255, 200, 87, .3); }
  .moi .bulle { box-shadow: inset 0 0 0 1px var(--volt-line); }
  .meta { display: flex; gap: 10px; flex-wrap: wrap; font-size: 11px; color: var(--ink-3); }
  .mouvement { font-weight: 700; }
  .reactions { display: flex; gap: 5px; }
  .reactions button {
    display: inline-flex; align-items: center; gap: 5px; border: 0; cursor: pointer; padding: 3px 9px; border-radius: 999px;
    background: rgba(255, 255, 255, .04); box-shadow: inset 0 0 0 1px var(--line); color: var(--ink-2); font-size: 11.5px; font-weight: 700;
    transition: background-color .2s, color .2s, box-shadow .2s, transform .3s cubic-bezier(.34, 1.56, .64, 1);
  }
  .reactions button.vide { color: var(--ink-3); }
  .reactions button:hover { background: rgba(255, 255, 255, .08); }
  .reactions button:active { transform: scale(.9); }
  .reactions button.on { background: var(--volt-soft); color: var(--volt); box-shadow: inset 0 0 0 1px var(--volt-line); animation: pop .35s cubic-bezier(.34, 1.56, .64, 1); }
  .reactions .mono { font-size: 10.5px; }
  @keyframes pop { 50% { transform: scale(1.18); } }
  .rien { display: block; font-size: 12.5px; padding: 18px 0; }
</style>
