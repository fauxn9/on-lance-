<script>
  import { untrack } from 'svelte';
  import * as api from './api.js';
  import { onde } from './actions.js';
  import Compteur from './Compteur.svelte';
  import Icone from './Icone.svelte';
  import LignePartie from './LignePartie.svelte';

  let { revision, profil, synchro, onsync } = $props();

  const FILTRES = [
    ['toutes', 'Toutes'], ['solo', 'Solo/Duo'], ['flex', 'Flex'], ['normales', 'Normales'], ['aram', 'ARAM'], ['autres', 'Autres modes'],
  ];
  let filtre = $state('toutes');
  let liste = $state([]);
  let suivant = $state(null);
  let enCours = $state(false);
  let premiere = $state(true);
  let erreur = $state(null);
  let fin = $state(false);
  let sentinelle = $state();
  let boutons = $state([]);

  // Pastille qui glisse sous le filtre actif.
  let mesure = $state(0);
  $effect(() => {
    const remesurer = () => mesure++;
    document.fonts?.ready.then(remesurer);
    addEventListener('resize', remesurer);
    return () => removeEventListener('resize', remesurer);
  });
  const pastille = $derived.by(() => {
    mesure;
    const b = boutons[FILTRES.findIndex(([id]) => id === filtre)];
    return b ? { x: b.offsetLeft, w: b.offsetWidth } : null;
  });

  async function charger(depuisZero) {
    if (enCours) return;
    enCours = true;
    try {
      const r = await api.parties(depuisZero ? null : suivant, filtre);
      liste = depuisZero ? r.matches : [...liste, ...r.matches];
      suivant = r.next;
      fin = r.next == null;
      erreur = null;
    } catch (e) {
      erreur = String(e);
    } finally {
      enCours = false;
      premiere = false;
    }
  }

  // Nouveau filtre ou nouvel historique : on repart du début. Seuls `filtre`
  // et `revision` déclenchent l'effet ; le reste est lu hors suivi, sinon
  // l'effet se relancerait lui-même en modifiant `enCours`.
  $effect(() => {
    filtre; revision;
    untrack(() => {
      fin = false;
      suivant = null;
      enCours = false;
      premiere = true;
      charger(true);
    });
  });

  // Défilement infini : la page suivante arrive avant d'atteindre le bas.
  $effect(() => {
    if (!sentinelle) return;
    const io = new IntersectionObserver((e) => {
      if (e[0].isIntersecting && !fin && suivant != null) charger(false);
    }, { rootMargin: '400px' });
    io.observe(sentinelle);
    return () => io.disconnect();
  });
</script>

<header class="tete">
  <div>
    <h1>Parties</h1>
    <p class="dim"><Compteur valeur={profil?.history.count ?? 0} /> parties{profil && !profil.history.backfillDone ? ' · les plus anciennes arrivent en fond' : ''}</p>
  </div>
  <button class="bouton" use:onde onclick={onsync} disabled={synchro}>
    <span class:tourne={synchro} class="ico"><Icone nom="sync" /></span>{synchro ? 'Synchronisation…' : 'Synchroniser'}
  </button>
</header>

<div class="filtres" role="group" aria-label="Filtrer par file">
  {#if pastille}<span class="pastille" style:transform="translateX({pastille.x}px)" style:width="{pastille.w}px" aria-hidden="true"></span>{/if}
  {#each FILTRES as [id, nom], i}
    <button bind:this={boutons[i]} class:on={filtre === id} aria-pressed={filtre === id} onclick={() => (filtre = id)}>{nom}</button>
  {/each}
</div>

{#if erreur}
  <p class="erreur" role="alert"><Icone nom="alerte" />{erreur}</p>
{/if}

{#if premiere && enCours}
  <ul class="liste" aria-label="Chargement">
    {#each Array(7) as _, i}
      <li class="fantome" style:--i={i}><span class="squelette a"></span><span class="squelette b"></span><span class="squelette c"></span><span class="squelette d"></span></li>
    {/each}
  </ul>
{:else}
  <ul class="liste">
    {#each liste as m, i (m.matchId)}<LignePartie {m} i={i % 20} />{/each}
  </ul>
{/if}

{#if !liste.length && !enCours && !erreur}
  <div class="vide">
    <span class="rond"><Icone nom="historique" /></span>
    <p>Aucune partie dans cette catégorie.</p>
  </div>
{/if}
<div bind:this={sentinelle} class="sentinelle">
  {#if enCours && !premiere}<span class="chargeur" aria-label="Chargement"><i></i><i></i><i></i></span>{:else if fin && liste.length}<p class="dim mono">C'est tout pour l'instant.</p>{/if}
</div>

<style>
  .tete { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 18px; animation: apparait .5s var(--ease) both; }
  h1 { font-stretch: 122%; font-weight: 900; font-size: 30px; letter-spacing: -.03em; }
  .tete p { font-size: 12.5px; margin-top: 2px; }
  .ico { display: inline-flex; }
  .filtres { position: relative; display: inline-flex; gap: 2px; padding: 4px; border-radius: 13px; background: var(--panel); box-shadow: inset 0 0 0 1px var(--line); margin-bottom: 16px; animation: apparait .5s var(--ease) .06s both; }
  .pastille { position: absolute; top: 4px; left: 0; height: calc(100% - 8px); border-radius: 9px; background: var(--volt); box-shadow: 0 6px 20px -8px var(--volt-glow); transition: transform .5s cubic-bezier(.34, 1.4, .64, 1), width .5s cubic-bezier(.34, 1.4, .64, 1); }
  .filtres button { position: relative; border: 0; background: transparent; padding: 7px 13px; border-radius: 9px; color: var(--ink-2); font-weight: 600; font-size: 12.5px; cursor: pointer; transition: color .3s; }
  .filtres button:hover:not(.on) { color: var(--ink); }
  .filtres button.on { color: var(--volt-ink); }
  .filtres button:active { transform: scale(.96); }
  .liste { display: grid; gap: 7px; }
  .fantome { display: grid; grid-template-columns: 44px 150px 104px 1fr; align-items: center; gap: 16px; padding: 12px 16px; border-radius: 12px; background: var(--panel); box-shadow: inset 0 0 0 1px var(--line); opacity: 0; animation: apparait .4s var(--ease) both; animation-delay: calc(var(--i) * 50ms); }
  .a { height: 44px; border-radius: 11px; }
  .b, .c { height: 12px; }
  .d { height: 24px; max-width: 200px; }
  .erreur { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; padding: 10px 14px; border-radius: 12px; background: var(--red-soft); color: #ffc2cc; font-size: 13px; }
  .erreur :global(svg) { width: 17px; height: 17px; color: var(--red); }
  .vide { display: grid; justify-items: center; gap: 12px; padding: 50px 0; color: var(--ink-3); animation: apparait .5s var(--ease) both; }
  .rond { width: 52px; height: 52px; display: grid; place-items: center; border-radius: 16px; background: var(--panel); box-shadow: inset 0 0 0 1px var(--line); }
  .rond :global(svg) { width: 22px; height: 22px; }
  .sentinelle { padding: 18px 0 6px; text-align: center; font-size: 12px; min-height: 44px; display: grid; place-items: center; }
  .chargeur { display: inline-flex; gap: 6px; }
  .chargeur i { width: 7px; height: 7px; border-radius: 50%; background: var(--volt); animation: saute .9s ease-in-out infinite; }
  .chargeur i:nth-child(2) { animation-delay: .15s; }
  .chargeur i:nth-child(3) { animation-delay: .3s; }
  @keyframes saute { 0%, 100% { transform: translateY(0); opacity: .4; } 50% { transform: translateY(-6px); opacity: 1; } }
</style>
