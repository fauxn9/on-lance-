<script>
  // Les réglages de l'app : le thème (quatre prêts à l'emploi et un custom à
  // la couleur de ton choix), et le rappel des raccourcis.
  import { onMount } from 'svelte';
  import { THEMES, choisir, couleurDe, lire, lisible, procheDuRouge, variables } from './theme.js';
  import Icone from './Icone.svelte';

  let { onfermer } = $props();

  let choix = $state(lire());
  let hex = $state(choix.couleur);
  const RAPIDES = ['#ff7ad9', '#ff8a4d', '#3dffa8', '#5f8bff', '#f2f4f7', '#ffd23f'];

  // Changement de thème : la nouvelle couleur se répand en cercle depuis la
  // carte cliquée, sur toute l'app.
  function appliquer(nouveau, e) {
    choix = nouveau;
    const calme = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!document.startViewTransition || calme || document.visibilityState !== 'visible') return choisir(nouveau);
    const racine = document.documentElement;
    racine.style.setProperty('--vt-x', `${e?.clientX ?? innerWidth / 2}px`);
    racine.style.setProperty('--vt-y', `${e?.clientY ?? innerHeight / 2}px`);
    racine.dataset.sens = 'theme';
    const t = document.startViewTransition(() => choisir(nouveau));
    t.finished.catch(() => {}).finally(() => delete document.documentElement.dataset.sens);
  }
  const prendre = (id, e) => appliquer({ ...choix, id }, e);
  function perso(c) {
    if (!/^#[0-9a-f]{6}$/i.test(c)) return;
    hex = c.toLowerCase();
    choix = { id: 'custom', couleur: hex };
    choisir(choix); // en direct pendant qu'on glisse dans la pipette : pas de fondu
  }
  function saisie(e) {
    let v = e.currentTarget.value.trim();
    if (!v.startsWith('#')) v = `#${v}`;
    if (/^#[0-9a-f]{3}$/i.test(v)) v = `#${[...v.slice(1)].map((x) => x + x).join('')}`;
    perso(v);
  }

  const couleurCustom = $derived(lisible(hex));
  const eclaircie = $derived(couleurCustom !== hex.toLowerCase());
  const rouge = $derived(procheDuRouge(couleurCustom));
  const style = (vars) => Object.entries(vars).map(([k, v]) => `${k}: ${v}`).join('; ');

  let dialogue;
  onMount(() => {
    dialogue.focus();
    const clavier = (e) => { if (e.key === 'Escape') onfermer(); };
    addEventListener('keydown', clavier);
    return () => removeEventListener('keydown', clavier);
  });
</script>

<button class="fond" onclick={onfermer} tabindex="-1" aria-label="Fermer les réglages"></button>
<div class="fenetre" role="dialog" aria-modal="true" aria-labelledby="titre-reglages" tabindex="-1" bind:this={dialogue}>
  <header>
    <span class="roue"><Icone nom="reglages" /></span>
    <h2 id="titre-reglages">Réglages</h2>
    <button class="fermer" onclick={onfermer} aria-label="Fermer"><Icone nom="fermer" /></button>
  </header>

  <section>
    <div class="titre-section">
      <p class="etiquette">Thème</p>
      <small class="dim">Appliqué à toute l'app et à l'overlay en jeu.</small>
    </div>
    <div class="themes" role="radiogroup" aria-label="Thème">
      {#each THEMES as t, i}
        {@const vars = variables(t.id === 'custom' ? { id: 'custom', couleur: hex } : { id: t.id })}
        <button
          class="theme" class:on={choix.id === t.id} role="radio" aria-checked={choix.id === t.id}
          style="{style(vars)}; --i: {i}" onclick={(e) => (t.id === 'custom' ? appliquer({ id: 'custom', couleur: hex }, e) : prendre(t.id, e))}
        >
          <span class="apercu" aria-hidden="true">
            <span class="cote"><i class="on"></i><i></i><i></i></span>
            <span class="scene">
              <span class="ligne-a"><b>Victoire</b><em>+22</em></span>
              <span class="barres"><i style:height="40%"></i><i style:height="62%"></i><i style:height="48%"></i><i style:height="84%"></i><i style:height="70%"></i></span>
              <span class="pastille-a">Importer</span>
            </span>
          </span>
          <span class="nom">
            {#if t.id === 'custom'}<Icone nom="pipette" />{/if}{t.nom}
            {#if choix.id === t.id}<span class="coche"><Icone nom="check" /></span>{/if}
          </span>
        </button>
      {/each}
    </div>

    {#if choix.id === 'custom'}
      <div class="custom">
        <label class="pipette" style:--c={couleurCustom} title="Choisir une couleur">
          <input type="color" value={hex} oninput={(e) => perso(e.currentTarget.value)} aria-label="Couleur du thème" />
          <Icone nom="pipette" />
        </label>
        <div class="champs">
          <label class="hex">
            <span class="dim mono">#</span>
            <input class="mono" value={hex.slice(1)} maxlength="7" spellcheck="false" onchange={saisie} aria-label="Code couleur" />
          </label>
          <div class="rapides">
            {#each RAPIDES as c}
              <button class="rapide" class:on={hex === c} style:--c={c} onclick={() => perso(c)} aria-label="Couleur {c}"></button>
            {/each}
          </div>
        </div>
      </div>
      {#if eclaircie || rouge}
        <p class="avis">
          {#if eclaircie}Couleur éclaircie en <b class="mono">{couleurCustom}</b> pour rester lisible sur le fond sombre.{/if}
          {#if rouge}Proche du rouge des défaites : victoires et défaites vont se ressembler.{/if}
        </p>
      {/if}
    {/if}
  </section>

  <section>
    <p class="etiquette">Raccourcis</p>
    <ul class="raccourcis">
      <li><span>Changer d'onglet</span><kbd>Ctrl 1</kbd>…<kbd>Ctrl 6</kbd></li>
      <li><span>Réglages</span><kbd>Ctrl ,</kbd></li>
      <li><span>Cacher l'overlay en jeu</span><kbd>Ctrl Maj H</kbd></li>
      <li><span>Déplacer les widgets de l'overlay</span><kbd>Ctrl Maj E</kbd></li>
    </ul>
  </section>
</div>

<style>
  .fond { position: fixed; inset: 0; z-index: 40; border: 0; padding: 0; cursor: default; background: rgba(3, 4, 6, .62); backdrop-filter: blur(6px); animation: fondu .25s ease both; }
  @keyframes fondu { from { opacity: 0; } }
  .fenetre {
    position: fixed; z-index: 41; left: 50%; top: 50%; translate: -50% -50%; width: min(620px, calc(100vw - 40px)); max-height: calc(100vh - 60px); overflow-y: auto;
    display: grid; gap: 22px; padding: 20px 22px 22px; border-radius: 20px; outline: none;
    background: var(--panel); box-shadow: inset 0 0 0 1px var(--line-2), 0 40px 100px -20px rgba(0, 0, 0, .9);
    animation: entre .45s var(--ease) both;
  }
  @keyframes entre { from { opacity: 0; transform: translateY(14px) scale(.97); } }
  header { display: flex; align-items: center; gap: 12px; }
  .roue { width: 34px; height: 34px; display: grid; place-items: center; border-radius: 11px; background: var(--volt-soft); color: var(--volt); box-shadow: inset 0 0 0 1px var(--volt-line); }
  .roue :global(svg) { width: 18px; height: 18px; animation: tourne-un-peu .8s var(--ease) both; }
  @keyframes tourne-un-peu { from { transform: rotate(-90deg); } }
  h2 { flex: 1; font-stretch: 120%; font-weight: 900; font-size: 22px; letter-spacing: -.02em; }
  .fermer { width: 34px; height: 34px; display: grid; place-items: center; border: 0; border-radius: 10px; background: transparent; color: var(--ink-3); cursor: pointer; transition: background-color .2s, color .2s; }
  .fermer:hover { background: var(--panel-3); color: var(--ink); }
  .fermer :global(svg) { width: 18px; height: 18px; }

  section { display: grid; gap: 12px; }
  .titre-section { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
  .titre-section small { font-size: 11.5px; }

  .themes { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; }
  .theme {
    display: grid; gap: 8px; padding: 6px 6px 9px; border: 0; border-radius: 14px; cursor: pointer; text-align: left; font: inherit; color: var(--ink);
    background: var(--bg-2); box-shadow: inset 0 0 0 1px var(--line); transition: box-shadow .25s, transform .25s var(--ease);
    animation: entre .45s var(--ease) both; animation-delay: calc(80ms + var(--i) * 40ms);
  }
  .theme:hover { transform: translateY(-2px); box-shadow: inset 0 0 0 1px var(--line-2); }
  .theme.on { box-shadow: inset 0 0 0 2px var(--volt), 0 0 26px -8px var(--volt-glow); }
  .theme:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
  /* Mini-app aux couleurs du thème : barre de côté, une victoire, un graphe, un bouton. */
  .apercu { display: flex; height: 76px; border-radius: 9px; overflow: hidden; background: var(--bg); box-shadow: inset 0 0 0 1px var(--line); }
  .cote { width: 13px; display: grid; align-content: start; gap: 4px; padding: 6px 3px; border-right: 1px solid var(--line); }
  .cote i { height: 7px; border-radius: 2px; background: var(--panel-3); }
  .cote i.on { background: var(--volt); box-shadow: 0 0 6px var(--volt-glow); }
  .scene { flex: 1; min-width: 0; display: grid; grid-template-rows: auto 1fr auto; gap: 4px; padding: 6px; background: radial-gradient(ellipse at 90% 0, var(--volt-soft), transparent 70%), var(--panel); }
  .ligne-a { display: flex; justify-content: space-between; font-size: 8.5px; line-height: 1; }
  .ligne-a b { color: var(--volt); font-weight: 900; font-stretch: 115%; }
  .ligne-a em { font-style: normal; font-family: var(--mono); color: var(--volt); font-size: 7.5px; }
  .barres { display: flex; align-items: flex-end; gap: 2px; min-height: 0; }
  .barres i { flex: 1; border-radius: 2px 2px 1px 1px; background: rgba(var(--volt-rgb), .35); }
  .barres i:nth-child(4) { background: var(--volt); }
  .pastille-a { justify-self: start; padding: 2px 5px; border-radius: 4px; font-size: 6.5px; font-weight: 800; background: var(--volt); color: var(--volt-ink); }
  .nom { display: flex; align-items: center; gap: 5px; padding: 0 3px; font-size: 12px; font-weight: 700; }
  .nom :global(svg) { width: 12px; height: 12px; flex: none; }
  .coche { margin-left: auto; width: 16px; height: 16px; display: grid; place-items: center; border-radius: 50%; background: var(--volt); color: var(--volt-ink); animation: pop .4s cubic-bezier(.34, 1.56, .64, 1); }
  .coche :global(svg) { width: 10px; height: 10px; stroke-width: 3.5; }
  @keyframes pop { from { transform: scale(0); } }

  .custom { display: flex; align-items: center; gap: 14px; padding: 12px; border-radius: 14px; background: var(--bg-2); box-shadow: inset 0 0 0 1px var(--line); animation: entre .35s var(--ease) both; }
  .pipette {
    position: relative; flex: none; width: 58px; height: 58px; display: grid; place-items: center; border-radius: 16px; cursor: pointer;
    background: var(--c); color: var(--volt-ink); box-shadow: 0 0 0 3px var(--panel), 0 0 0 4px var(--line-2), 0 10px 30px -10px var(--c);
    transition: transform .25s var(--ease);
  }
  .pipette:hover { transform: scale(1.05) rotate(-4deg); }
  .pipette :global(svg) { width: 22px; height: 22px; }
  .pipette input { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; height: 100%; border: 0; padding: 0; }
  .champs { flex: 1; min-width: 0; display: grid; gap: 10px; }
  .hex { display: flex; align-items: center; gap: 4px; width: 130px; padding: 7px 10px; border-radius: 10px; background: var(--panel); box-shadow: inset 0 0 0 1px var(--line-2); }
  .hex:focus-within { box-shadow: inset 0 0 0 1.5px var(--volt); }
  .hex input { width: 100%; border: 0; outline: 0; background: transparent; color: var(--ink); font-size: 13px; text-transform: uppercase; }
  .rapides { display: flex; gap: 8px; flex-wrap: wrap; }
  .rapide { width: 24px; height: 24px; border: 0; padding: 0; border-radius: 8px; cursor: pointer; background: var(--c); box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .25); transition: transform .2s var(--ease), box-shadow .2s; }
  .rapide:hover { transform: scale(1.12); }
  .rapide.on { box-shadow: 0 0 0 2px var(--panel), 0 0 0 3.5px var(--c); }
  .avis { font-size: 12px; line-height: 1.5; color: var(--gold); }
  .avis b { color: var(--ink); }

  .raccourcis { display: grid; }
  .raccourcis li { display: flex; align-items: center; gap: 6px; padding: 8px 0; font-size: 13px; color: var(--ink-3); box-shadow: inset 0 -1px 0 var(--line); }
  .raccourcis li:last-child { box-shadow: none; }
  .raccourcis span { flex: 1; color: var(--ink-2); }
  kbd { font: 600 11px var(--mono); padding: 3px 7px; border-radius: 6px; background: var(--panel-3); color: var(--ink-2); box-shadow: inset 0 -1px 0 rgba(0, 0, 0, .4); }

  @media (max-width: 700px) {
    .themes { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  }
</style>
