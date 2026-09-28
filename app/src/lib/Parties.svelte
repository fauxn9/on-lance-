<script>
  import { untrack } from 'svelte';
  import * as api from './api.js';
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
  let erreur = $state(null);
  let fin = $state(false);
  let sentinelle = $state();

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
    <p class="dim">{profil?.history.count ?? 0} parties{profil && !profil.history.backfillDone ? ' · les plus anciennes arrivent en fond' : ''}</p>
  </div>
  <button class="bouton" onclick={onsync} disabled={synchro}>
    <span class:tourne={synchro} class="ico"><Icone nom="sync" /></span>{synchro ? 'Synchronisation…' : 'Synchroniser'}
  </button>
</header>

<div class="filtres" role="group" aria-label="Filtrer par file">
  {#each FILTRES as [id, nom]}
    <button class:on={filtre === id} aria-pressed={filtre === id} onclick={() => (filtre = id)}>{nom}</button>
  {/each}
</div>

{#if erreur}
  <p class="erreur" role="alert"><Icone nom="alerte" />{erreur}</p>
{/if}

<ul class="liste">
  {#each liste as m (m.matchId)}<LignePartie {m} />{/each}
</ul>

{#if !liste.length && !enCours && !erreur}
  <p class="dim vide">Aucune partie dans cette catégorie.</p>
{/if}
<div bind:this={sentinelle} class="sentinelle">
  {#if enCours}<p class="dim mono">Chargement…</p>{:else if fin && liste.length}<p class="dim mono">C'est tout pour l'instant.</p>{/if}
</div>

<style>
  .tete { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
  h1 { font-stretch: 118%; font-weight: 850; font-size: 26px; letter-spacing: -.02em; }
  .tete p { font-size: 12.5px; margin-top: 2px; }
  .ico { display: inline-flex; }
  .filtres { display: inline-flex; gap: 4px; padding: 4px; border-radius: 12px; background: var(--panel); box-shadow: inset 0 0 0 1px var(--line); margin-bottom: 16px; }
  .filtres button { border: 0; background: transparent; padding: 7px 13px; border-radius: 9px; color: var(--ink-2); font-weight: 600; font-size: 12.5px; cursor: pointer; transition: background-color .2s, color .2s; }
  .filtres button:hover { color: var(--ink); }
  .filtres button.on { background: var(--volt); color: var(--volt-ink); }
  .liste { display: grid; gap: 7px; }
  .erreur { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; padding: 10px 14px; border-radius: 12px; background: var(--red-soft); color: #ffc2cc; font-size: 13px; }
  .erreur :global(svg) { width: 17px; height: 17px; color: var(--red); }
  .vide { padding: 30px 0; text-align: center; }
  .sentinelle { padding: 18px 0 6px; text-align: center; font-size: 12px; min-height: 40px; }
</style>
