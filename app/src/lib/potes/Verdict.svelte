<script>
  // Le verdict des potes : après ta partie, ta ligne glisse de ton ancienne
  // place à la nouvelle dans le classement du groupe, en doublant (ou en se
  // faisant doubler par) tes potes, avec la vanne du groupe par-dessus.
  import { onMount } from 'svelte';
  import { dd } from '../ddragon.svelte.js';
  import Icone from '../Icone.svelte';

  let { e, onfermer = () => {}, onvoir = () => {} } = $props();
  const HAUT = 38;
  const lignes = $derived((e.data?.classement ?? []).slice().sort((a, b) => a.place - b.place));
  const monProfil = $derived(e.profil);
  // Au départ, chacun est à sa place d'avant la partie ; puis tout le monde
  // glisse vers sa place d'après.
  let arrive = $state(false);
  onMount(() => {
    const t = setTimeout(() => (arrive = true), 700);
    return () => clearTimeout(t);
  });
  const decalage = (l) => (arrive ? 0 : ((l.avant ?? l.place) - l.place) * HAUT);
  const ieme = (n) => (n === 1 ? '1er' : `${n}e`);
  const signe = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');
  const monte = $derived(e.data?.avant > e.data?.place);
  const descend = $derived(e.data?.avant < e.data?.place);
</script>

<aside class="verdict" class:monte class:descend role="dialog" aria-label="Le verdict des potes">
  <header>
    <span class="titre"><Icone nom="potes" />Le verdict des potes <span class="dim">· {e.groupe}</span></span>
    <button class="fermer" onclick={onfermer} aria-label="Fermer">×</button>
  </header>
  <p class="bulle">{e.texte}</p>
  {#if lignes.length > 1}
    <ol class="echelle" style:height="{lignes.length * HAUT}px">
      {#each lignes as l (l.profil)}
        <li class:moi={l.profil === monProfil} style:top="{(l.place - 1) * HAUT}px" style:transform="translateY({decalage(l)}px)">
          <span class="place mono">{l.place}</span>
          {#if dd.profil(l.icone)}<img src={dd.profil(l.icone)} alt="" />{:else}<span class="vide"></span>{/if}
          <b>{l.profil === monProfil ? 'toi' : l.pseudo}</b>
          <span class="lp mono" class:v={l.lp > 0} class:r={l.lp < 0}>{signe(l.lp)}</span>
        </li>
      {/each}
    </ol>
  {/if}
  <footer>
    <span class="mouvement mono">
      {#if monte}<span class="v">▲ {ieme(e.data.avant)} → {ieme(e.data.place)}</span>
      {:else if descend}<span class="r">▼ {ieme(e.data.avant)} → {ieme(e.data.place)}</span>
      {:else}{ieme(e.data?.place)} du groupe{/if}
    </span>
    <button class="lien" onclick={onvoir}>Voir le groupe</button>
  </footer>
</aside>

<style>
  .verdict {
    position: fixed; right: 18px; bottom: 18px; z-index: 60; width: 360px; display: grid; gap: 12px; padding: 14px;
    border-radius: 18px; background: var(--panel-2); box-shadow: inset 0 0 0 1px var(--line-2), 0 30px 70px -20px rgba(0, 0, 0, .95);
    animation: entre .6s cubic-bezier(.16, 1, .3, 1) both;
  }
  .verdict.monte { box-shadow: inset 0 0 0 1px var(--volt-line), 0 30px 70px -20px rgba(0, 0, 0, .95), 0 0 50px -20px var(--volt-glow); }
  .verdict.descend { box-shadow: inset 0 0 0 1px rgba(255, 77, 106, .35), 0 30px 70px -20px rgba(0, 0, 0, .95); }
  @keyframes entre { from { opacity: 0; transform: translateY(30px) scale(.96); } }
  header { display: flex; align-items: center; justify-content: space-between; }
  .titre { display: inline-flex; align-items: center; gap: 7px; font-size: 11px; font-weight: 750; letter-spacing: .1em; text-transform: uppercase; color: var(--volt); }
  .titre :global(svg) { width: 15px; height: 15px; }
  .titre .dim { text-transform: none; letter-spacing: 0; font-weight: 600; }
  .fermer { border: 0; background: transparent; color: var(--ink-3); font-size: 20px; line-height: 1; cursor: pointer; padding: 0 4px; }
  .fermer:hover { color: var(--ink); }
  .bulle { padding: 10px 14px; border-radius: 4px 16px 16px 16px; background: var(--panel-3); box-shadow: inset 0 0 0 1px var(--line-2); font-size: 14px; line-height: 1.45; animation: apparait .45s var(--ease) .25s both; }
  .echelle { position: relative; }
  .echelle li {
    position: absolute; left: 0; right: 0; height: 32px; display: grid; grid-template-columns: 18px 26px minmax(0, 1fr) auto; align-items: center; gap: 9px;
    padding: 0 10px; border-radius: 9px; background: rgba(255, 255, 255, .025); font-size: 12.5px;
    transition: transform 1.1s cubic-bezier(.65, 0, .35, 1);
  }
  .echelle li.moi { z-index: 2; background: var(--volt-soft); box-shadow: inset 0 0 0 1px var(--volt-line), 0 8px 24px -8px rgba(0, 0, 0, .8); }
  .descend .echelle li.moi { background: var(--red-soft); box-shadow: inset 0 0 0 1px rgba(255, 77, 106, .35), 0 8px 24px -8px rgba(0, 0, 0, .8); }
  .echelle .place { color: var(--ink-3); font-weight: 800; text-align: center; }
  .echelle img, .echelle .vide { width: 26px; height: 26px; border-radius: 8px; background: var(--panel-3); }
  .echelle b { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .moi b { color: var(--volt); }
  .descend .moi b { color: var(--red); }
  .echelle .lp { font-size: 12px; font-weight: 700; }
  footer { display: flex; justify-content: space-between; align-items: center; font-size: 12px; }
  .mouvement { font-weight: 800; }
  @media (prefers-reduced-motion: reduce) { .echelle li { transition: none; } }
</style>
