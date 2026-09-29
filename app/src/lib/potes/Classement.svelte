<script>
  // Le classement de la semaine : les LP depuis lundi, barres qui partent de
  // zéro (vers la droite si tu gagnes, vers la gauche si tu perds).
  import { dd } from '../ddragon.svelte.js';
  import Icone from '../Icone.svelte';

  let { lignes = [], moi = null } = $props();
  const max = $derived(Math.max(20, ...lignes.map((l) => Math.abs(l.lp))));
  const signe = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');
</script>

<ol class="classement">
  {#each lignes as l, i (l.profil)}
    <li class:moi={l.profil === moi} class:premier={l.place === 1 && l.parties > 0} style:--i={i}>
      <span class="place mono">{l.place}</span>
      <span class="avatar">
        {#if dd.profil(l.icone)}<img src={dd.profil(l.icone)} alt="" />{:else}<span class="vide">{l.pseudo[0]}</span>{/if}
        {#if l.place === 1 && l.parties > 0}<span class="couronne"><Icone nom="couronne" /></span>{/if}
      </span>
      <span class="qui">
        <b>{l.pseudo}</b>
        <small class="mono">{l.parties ? `${l.victoires}V ${l.parties - l.victoires}D` : 'pas encore joué'}</small>
        {#if l.profil === moi && i > 0}<small class="objectif">à {lignes[i - 1].lp - l.lp || 'égalité avec'}{lignes[i - 1].lp - l.lp ? ' LP de' : ''} {lignes[i - 1].pseudo}</small>{/if}
      </span>
      <span class="barre" aria-hidden="true">
        <span class="axe"></span>
        {#if l.lp}
          <i class:neg={l.lp < 0} style:--w={Math.abs(l.lp) / max}></i>
        {/if}
      </span>
      <b class="lp mono" class:v={l.lp > 0} class:r={l.lp < 0}>{signe(l.lp)} <small>LP</small></b>
    </li>
  {/each}
</ol>

<style>
  .classement { display: grid; gap: 6px; }
  li {
    display: grid; grid-template-columns: 22px 40px minmax(0, 1fr) minmax(90px, 1.2fr) 74px; align-items: center; gap: 12px;
    padding: 8px 12px; border-radius: 12px; background: var(--panel-2); box-shadow: inset 0 0 0 1px var(--line);
    animation: apparait .45s var(--ease) both; animation-delay: calc(var(--i) * 55ms);
  }
  li.moi { background: linear-gradient(90deg, var(--volt-soft), var(--panel-2) 70%); box-shadow: inset 3px 0 0 var(--volt), inset 0 0 0 1px var(--volt-line); }
  .place { font-size: 15px; font-weight: 800; color: var(--ink-3); text-align: center; }
  .premier .place { color: var(--gold); }
  .avatar { position: relative; width: 40px; height: 40px; }
  .avatar img, .vide { width: 40px; height: 40px; border-radius: 12px; }
  .vide { display: grid; place-items: center; background: var(--panel-3); font-weight: 800; text-transform: uppercase; color: var(--ink-2); }
  .premier .avatar img { box-shadow: 0 0 0 2px var(--gold), 0 0 18px -4px rgba(255, 200, 87, .6); }
  .couronne { position: absolute; top: -11px; left: 50%; translate: -50% 0; color: var(--gold); filter: drop-shadow(0 2px 4px rgba(0, 0, 0, .6)); animation: couronne .6s cubic-bezier(.34, 1.56, .64, 1) .3s backwards; }
  .couronne :global(svg) { width: 18px; height: 18px; fill: var(--gold); stroke-width: 1.5; }
  @keyframes couronne { from { transform: translateY(-8px) scale(.4); opacity: 0; } }
  .qui { display: grid; min-width: 0; line-height: 1.25; }
  .qui b { font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .qui small { font-size: 11px; color: var(--ink-3); }
  .qui .objectif { color: var(--volt); font-weight: 650; }
  .barre { position: relative; height: 10px; }
  .axe { position: absolute; left: 50%; top: -4px; bottom: -4px; width: 1px; background: var(--line-2); }
  .barre i {
    position: absolute; top: 0; bottom: 0; left: 50%; width: calc(50% * var(--w)); border-radius: 0 6px 6px 0;
    background: linear-gradient(90deg, rgba(var(--volt-rgb), .35), var(--volt)); transform-origin: left;
    animation: pousse .9s var(--ease) backwards; animation-delay: calc(200ms + var(--i) * 55ms);
  }
  .barre i.neg { left: auto; right: 50%; border-radius: 6px 0 0 6px; background: linear-gradient(-90deg, rgba(255, 77, 106, .35), var(--red)); transform-origin: right; }
  @keyframes pousse { from { transform: scaleX(0); } }
  .lp { text-align: right; font-size: 15px; font-weight: 800; }
  .lp small { font-size: 10px; font-weight: 700; color: var(--ink-3); }
</style>
