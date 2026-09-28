<script>
  import { slide } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { onde } from './actions.js';
  import { dd } from './ddragon.svelte.js';
  import { duree, ilYa, ilYaCourt, kda, nomFile, nomPoste, signe, un } from './format.js';

  let { m, compact = false, i = 0 } = $props();
  const champ = $derived(dd.champion(m.championId, m.championName));
  const issue = $derived(m.remake ? 'remake' : m.win ? 'victoire' : 'defaite');
  const LIBELLE = { remake: 'Remake', victoire: 'Victoire', defaite: 'Défaite' };
  let ouvert = $state(false);

  const minutes = $derived(Math.max(1, m.durationS / 60));
  const DATE = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  const k = (n) => (n >= 1000 ? `${un(n / 1000)}k` : String(n));
</script>

<li class="partie {issue}" class:compact class:ouvert style:--i={Math.min(i, 14)}>
  <button class="resume" use:onde onclick={() => !compact && (ouvert = !ouvert)} aria-expanded={compact ? undefined : ouvert} tabindex={compact ? -1 : 0}>
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
        <small class="mono">{un(m.cs / minutes)}/min</small>
      </span>
      <span class="items">
        {#each m.items as it}
          {#if it && dd.item(it)}<img src={dd.item(it)} alt="" width="24" height="24" loading="lazy" />{:else}<i></i>{/if}
        {/each}
      </span>
      <span class="duree mono dim">{duree(m.durationS)}</span>
    {:else}
      <span class="duree mono dim" title={ilYa(m.gameStart)}>{ilYaCourt(m.gameStart)}</span>
    {/if}
    <span class="lp mono" class:v={m.lpDelta > 0} class:r={m.lpDelta < 0}>{m.lpDelta != null ? `${signe(m.lpDelta)} PL` : ''}</span>
    {#if !compact}<span class="chevron" aria-hidden="true"></span>{/if}
  </button>

  {#if ouvert}
    <div class="detail" transition:slide={{ duration: 380, easing: cubicOut }}>
      <div class="bloc charge">
        <p class="etiquette">Sorts & runes</p>
        <div class="icones">
          {#each m.spells as s}
            {@const sort = dd.sort(s)}
            {#if sort}<img src={sort.icone} alt={sort.nom} title={sort.nom} width="30" height="30" />{/if}
          {/each}
          {#if dd.rune(m.keystone)}<img class="rune" src={dd.rune(m.keystone).icone} alt={dd.rune(m.keystone).nom} title={dd.rune(m.keystone).nom} width="34" height="34" />{/if}
          {#if dd.rune(m.secondaryStyle)}<img class="rune petite" src={dd.rune(m.secondaryStyle).icone} alt={dd.rune(m.secondaryStyle).nom} title={dd.rune(m.secondaryStyle).nom} width="22" height="22" />{/if}
        </div>
        {#if dd.rune(m.keystone)}<small>{dd.rune(m.keystone).nom}</small>{/if}
      </div>
      <div class="bloc chiffres">
        <p><small>Dégâts aux champions</small><b class="mono">{k(m.damage)}</b><span class="jauge"><i style:transform="scaleX({Math.min(1, m.damage / 45000)})"></i></span></p>
        <p><small>Or gagné</small><b class="mono">{k(m.gold)}</b><span class="jauge"><i class="or" style:transform="scaleX({Math.min(1, m.gold / 20000)})"></i></span></p>
        <p><small>Score de vision</small><b class="mono">{m.vision}</b><span class="jauge"><i class="vision" style:transform="scaleX({Math.min(1, m.vision / 60)})"></i></span></p>
        <p><small>Or par minute</small><b class="mono">{Math.round(m.gold / minutes)}</b><span class="jauge"><i class="or" style:transform="scaleX({Math.min(1, m.gold / minutes / 600)})"></i></span></p>
      </div>
      <div class="bloc infos">
        <small class="capitale">{DATE.format(m.gameStart)}</small>
        <small class="dim mono">{m.matchId}</small>
        <span class="bientot"><span class="tag">Brique 7</span>L'analyse détaillée arrive avec le coach.</span>
      </div>
    </div>
  {/if}
</li>

<style>
  .partie {
    position: relative; border-radius: 12px; overflow: hidden;
    background: var(--panel); box-shadow: inset 0 0 0 1px var(--line);
    animation: arrive .45s var(--ease) both; animation-delay: calc(var(--i) * 35ms);
    transition: box-shadow .25s, transform .25s var(--ease);
  }
  @keyframes arrive { from { opacity: 0; transform: translateY(10px); } }
  .partie:not(.compact):hover { box-shadow: inset 0 0 0 1px var(--line-2), 0 14px 30px -20px rgba(0, 0, 0, .9); transform: translateY(-1px); }
  .partie.ouvert { box-shadow: inset 0 0 0 1px var(--line-2), 0 18px 40px -24px rgba(0, 0, 0, .9); }
  .resume {
    width: 100%; border: 0; background: transparent; text-align: left; cursor: pointer; color: inherit;
    display: grid; align-items: center; gap: 16px; padding: 10px 16px 10px 14px;
    grid-template-columns: 44px 150px 104px 92px 1fr 52px 64px 14px;
  }
  .partie.victoire { background: linear-gradient(90deg, rgba(214, 255, 63, .05), var(--panel) 40%); color: var(--volt); }
  .partie.defaite { background: linear-gradient(90deg, rgba(255, 77, 106, .06), var(--panel) 40%); color: var(--red); }
  .partie.remake { color: var(--ink-3); }
  .resume > * { color: var(--ink); }
  .compact { background: transparent !important; box-shadow: none !important; border-radius: 0; border-top: 1px solid var(--line); animation-delay: calc(var(--i) * 45ms); }
  .compact .resume { grid-template-columns: 34px minmax(0, 1fr) 92px 56px 58px; padding: 7px 12px; gap: 12px; cursor: default; }
  .bord { position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: currentColor !important; }
  .compact .bord { display: none; }
  .champ { position: relative; }
  .champ img, .vide { width: 44px; height: 44px; border-radius: 11px; background: var(--panel-3); transition: transform .35s cubic-bezier(.34, 1.56, .64, 1); }
  .partie:not(.compact):hover .champ img { transform: scale(1.08) rotate(-2deg); }
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
  .lp.v { color: var(--volt); }
  .lp.r { color: var(--red); }
  .chevron { width: 8px; height: 8px; border-right: 1.5px solid var(--ink-3); border-bottom: 1.5px solid var(--ink-3); transform: rotate(45deg) translateY(-3px); transition: transform .35s var(--ease); }
  .ouvert .chevron { transform: rotate(225deg) translateY(-3px); border-color: var(--volt); }

  .detail { display: grid; grid-template-columns: 1fr 1.6fr 1.2fr; gap: 14px; padding: 4px 16px 16px 72px; color: var(--ink); }
  .bloc { padding: 12px 14px; border-radius: 10px; background: rgba(6, 7, 9, .45); box-shadow: inset 0 0 0 1px var(--line); min-width: 0; }
  .charge { display: flex; flex-direction: column; gap: 8px; }
  .icones { display: flex; align-items: center; gap: 6px; }
  .icones img { width: 30px; height: 30px; border-radius: 8px; }
  .icones .rune { width: 34px; height: 34px; border-radius: 50%; background: #0b0d10; margin-left: 6px; }
  .icones .petite { width: 22px; height: 22px; margin-left: 0; opacity: .85; }
  .chiffres { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 18px; }
  .chiffres p { display: grid; grid-template-columns: 1fr auto; align-items: baseline; gap: 2px 8px; }
  .chiffres b { font-size: 13px; }
  .jauge { grid-column: 1 / -1; height: 4px; border-radius: 4px; background: var(--panel-3); overflow: hidden; }
  .jauge i { display: block; height: 100%; background: var(--volt); transform-origin: left; animation: jauge .9s var(--ease) both .1s; }
  .jauge i.or { background: var(--gold); }
  .jauge i.vision { background: var(--blue); }
  @keyframes jauge { from { transform: scaleX(0); } }
  .infos { display: flex; flex-direction: column; gap: 4px; }
  .capitale { text-transform: capitalize; color: var(--ink); }
  .bientot { margin-top: auto; display: flex; align-items: center; gap: 8px; font-size: 11.5px; color: var(--ink-3); white-space: normal; }
</style>
