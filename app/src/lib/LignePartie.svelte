<script>
  import { dd } from './ddragon.svelte.js';
  import { duree, ilYa, kda, nomFile, nomPoste, signe, un } from './format.js';

  let { m, compact = false } = $props();
  const champ = $derived(dd.champion(m.championId, m.championName));
  const issue = $derived(m.remake ? 'remake' : m.win ? 'victoire' : 'defaite');
  const LIBELLE = { remake: 'Remake', victoire: 'Victoire', defaite: 'Défaite' };
</script>

<li class="partie {issue}" class:compact>
  <span class="bord"></span>
  <span class="champ">
    {#if champ.icone}<img src={champ.icone} alt="" width="44" height="44" loading="lazy" />{:else}<span class="vide"></span>{/if}
    {#if !compact && m.champLevel}<em class="mono">{m.champLevel}</em>{/if}
  </span>
  <span class="quoi">
    <b>{compact ? champ.nom : LIBELLE[issue]}</b>
    <small>{compact ? LIBELLE[issue] : `${nomFile(m.queueId)}${m.position ? ` · ${nomPoste(m.position)}` : ''}`}</small>
    {#if !compact}<small class="dim">{ilYa(m.gameStart)}</small>{/if}
  </span>
  <span class="kda">
    <b class="mono">{m.kills}/<span class="r">{m.deaths}</span>/{m.assists}</b>
    <small class="mono">{kda(m.kills, m.deaths, m.assists)} KDA</small>
  </span>
  {#if !compact}
    <span class="cs">
      <b class="mono">{m.cs} CS</b>
      <small class="mono">{un(m.cs / Math.max(1, m.durationS / 60))}/min</small>
    </span>
    <span class="items">
      {#each m.items as it}
        {#if it && dd.item(it)}<img src={dd.item(it)} alt="" width="24" height="24" loading="lazy" />{:else}<i></i>{/if}
      {/each}
    </span>
    <span class="duree mono dim">{duree(m.durationS)}</span>
  {:else}
    <span class="duree mono dim">{ilYa(m.gameStart)}</span>
  {/if}
  <span class="lp mono" class:v={m.lpDelta > 0} class:r={m.lpDelta < 0}>{m.lpDelta != null ? `${signe(m.lpDelta)} PL` : ''}</span>
</li>

<style>
  .partie {
    position: relative; display: grid; align-items: center; gap: 16px; padding: 10px 16px 10px 14px; border-radius: 12px;
    grid-template-columns: 44px 150px 104px 92px 1fr 52px 64px;
    background: var(--panel); box-shadow: inset 0 0 0 1px var(--line); overflow: hidden; animation: apparait .35s var(--ease) both;
  }
  .partie.compact { grid-template-columns: 34px minmax(0, 1fr) 96px 122px 60px; padding: 7px 12px 7px 12px; gap: 12px; background: transparent; box-shadow: none; border-radius: 0; border-top: 1px solid var(--line); animation: none; }
  .bord { position: absolute; left: 0; top: 0; bottom: 0; width: 3px; }
  .victoire .bord { background: var(--volt); }
  .defaite .bord { background: var(--red); }
  .remake .bord { background: var(--ink-3); }
  .partie:not(.compact).victoire { background: linear-gradient(90deg, rgba(214, 255, 63, .05), var(--panel) 40%); }
  .partie:not(.compact).defaite { background: linear-gradient(90deg, rgba(255, 77, 106, .06), var(--panel) 40%); }
  .compact .bord { display: none; }
  .champ { position: relative; }
  .champ img, .vide { width: 44px; height: 44px; border-radius: 11px; background: var(--panel-3); }
  .compact .champ img, .compact .vide { width: 34px; height: 34px; border-radius: 9px; }
  .champ em { position: absolute; right: -5px; bottom: -4px; font-style: normal; font-size: 10px; font-weight: 700; padding: 1px 5px; border-radius: 6px; background: var(--bg); box-shadow: inset 0 0 0 1px var(--line-2); }
  .quoi, .kda, .cs { display: flex; flex-direction: column; min-width: 0; }
  b { font-size: 13.5px; font-weight: 700; white-space: nowrap; }
  small { font-size: 11.5px; color: var(--ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .victoire .quoi b { color: var(--volt); }
  .defaite .quoi b { color: var(--red); }
  .compact .quoi b { color: var(--ink); }
  .compact.victoire .quoi small { color: var(--volt); }
  .compact.defaite .quoi small { color: var(--red); }
  .items { display: flex; gap: 3px; }
  .items img, .items i { width: 24px; height: 24px; border-radius: 6px; background: var(--panel-3); }
  .items img:last-child { border-radius: 50%; }
  .duree { font-size: 12px; text-align: right; white-space: nowrap; }
  .lp { font-size: 12.5px; font-weight: 700; text-align: right; }
</style>
