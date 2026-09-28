<script>
  import { untrack } from 'svelte';
  import * as api from './api.js';
  import { dd } from './ddragon.svelte.js';
  import { ilYa } from './format.js';
  import CarteRang from './CarteRang.svelte';
  import CourbePL from './CourbePL.svelte';
  import Etapes from './Etapes.svelte';
  import Icone from './Icone.svelte';
  import LignePartie from './LignePartie.svelte';

  let { client, profil, compte, erreur, synchro, revision, onsync, onvoir } = $props();

  let recentes = $state([]);
  let chargement = $state(true);

  $effect(() => {
    revision; // se recharge à chaque nouvel historique, et seulement là
    untrack(() => api.parties(null, 'toutes'))
      .then((r) => (recentes = r.matches.slice(0, 6)))
      .catch(() => {})
      .finally(() => (chargement = false));
  });

  // Le rang en direct du client quand il est ouvert, sinon la dernière photo du serveur.
  const rangs = $derived(
    client.rangs?.length
      ? client.rangs
      : (profil?.ranks ?? []).map((r) => ({ file: r.queue, tier: r.tier, division: r.division, lp: r.lp, victoires: r.wins, defaites: r.losses })),
  );
  const solo = $derived(rangs.find((r) => r.file === 'RANKED_SOLO_5x5'));
  const flex = $derived(rangs.find((r) => r.file === 'RANKED_FLEX_SR'));
</script>

{#if !compte && client.etape === 'hors'}
  <section class="bienvenue">
    <div class="halo"></div>
    <span class="jeu"><Icone nom="jeu" /></span>
    <h1>Lance League of Legends.</h1>
    <p>L'app se relie toute seule à ton compte dès que le client est ouvert. Rien à saisir, aucun mot de passe.</p>
    <p class="attente mono"><span class="point"></span>En attente du client…</p>
  </section>
{:else}
  <header class="tete">
    <div class="qui">
      {#if compte && dd.profil(compte.icone)}<img src={dd.profil(compte.icone)} alt="" width="52" height="52" />{/if}
      <div>
        <h1>{compte?.nom ?? '…'}<span class="dim">#{compte?.tag ?? ''}</span></h1>
        <p class="dim">Niveau {compte?.niveau ?? '—'}{client.plateforme ? ` · ${client.plateforme.replace(/\d+$/, '').toUpperCase()}` : ''}</p>
      </div>
    </div>
    {#if client.etape !== 'hors'}
      <Etapes etape={client.etape} />
    {:else}
      <p class="ferme dim"><span class="point"></span>Client fermé · dernier état connu</p>
    {/if}
  </header>

  {#if erreur}
    <p class="erreur" role="alert"><Icone nom="alerte" />{erreur}<button class="lien" onclick={onsync}>Réessayer</button></p>
  {/if}

  <div class="grille-rangs">
    <CarteRang titre="Classée Solo/Duo" rang={solo} />
    <CarteRang titre="Classée Flex" rang={flex} />
    <CourbePL points={profil?.lpHistory ?? []} />
  </div>

  <div class="grille-bas">
    <section class="carte">
      <div class="titre-carte">
        <p class="etiquette">Dernières parties</p>
        <button class="lien" onclick={onvoir}>Tout l'historique →</button>
      </div>
      {#if recentes.length}
        <ul class="liste">
          {#each recentes as m (m.matchId)}<LignePartie {m} compact />{/each}
        </ul>
      {:else if chargement}
        <p class="dim vide">Chargement…</p>
      {:else}
        <p class="dim vide">Aucune partie pour l'instant. Elles arrivent dès la première synchronisation.</p>
      {/if}
    </section>

    <section class="carte histo">
      <p class="etiquette">Historique</p>
      <p class="compte-parties"><b class="mono">{profil?.history.count ?? 0}</b> parties</p>
      <p class="dim etat">
        {#if !profil}—
        {:else if profil.history.backfillDone}Tout ton historique est là.
        {:else}Récupération de tes anciennes parties en cours, en fond.{/if}
      </p>
      {#if profil?.history.lastSyncAt}<p class="dim etat">Dernière synchro {ilYa(new Date(profil.history.lastSyncAt).getTime())}</p>{/if}
      <button class="bouton" onclick={onsync} disabled={synchro}>
        <span class:tourne={synchro} class="ico"><Icone nom="sync" /></span>{synchro ? 'Synchronisation…' : 'Synchroniser'}
      </button>
      <p class="note dim">Chaque fin de partie se synchronise toute seule.</p>
    </section>
  </div>
{/if}

<style>
  .tete { display: flex; align-items: center; justify-content: space-between; gap: 20px; flex-wrap: wrap; margin-bottom: 20px; }
  .qui { display: flex; align-items: center; gap: 14px; }
  .qui img { width: 52px; height: 52px; border-radius: 15px; box-shadow: 0 0 0 2px var(--panel-3), 0 10px 30px -10px rgba(0, 0, 0, .8); }
  h1 { font-stretch: 118%; font-weight: 850; font-size: 24px; letter-spacing: -.02em; }
  h1 .dim { font-weight: 600; font-size: 18px; margin-left: 2px; }
  .ferme { display: inline-flex; align-items: center; gap: 8px; font-size: 12.5px; }
  .point { width: 7px; height: 7px; border-radius: 50%; background: var(--ink-3); }
  .erreur { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; padding: 10px 14px; border-radius: 12px; background: var(--red-soft); box-shadow: inset 0 0 0 1px rgba(255, 77, 106, .3); color: #ffc2cc; font-size: 13px; }
  .erreur :global(svg) { width: 17px; height: 17px; color: var(--red); flex: none; }
  .erreur .lien { margin-left: auto; }
  .grille-rangs { display: grid; grid-template-columns: 1fr 1fr 1.6fr; gap: 14px; margin-bottom: 14px; }
  .grille-bas { display: grid; grid-template-columns: 1.9fr 1fr; gap: 14px; }
  .liste { margin: 0 -16px -8px; }
  .liste :global(li:first-child) { border-top: 0; }
  .vide { padding: 20px 0; font-size: 13px; }
  .histo { display: flex; flex-direction: column; gap: 6px; }
  .compte-parties { font-size: 14px; color: var(--ink-2); margin-top: 6px; }
  .compte-parties b { font-size: 34px; color: var(--ink); font-family: var(--sans); font-stretch: 118%; font-weight: 850; margin-right: 4px; letter-spacing: -.02em; }
  .etat { font-size: 12.5px; }
  .histo .bouton { margin-top: auto; align-self: flex-start; }
  .ico { display: inline-flex; }
  .note { font-size: 11.5px; }

  .bienvenue { position: relative; height: 100%; min-height: 420px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 14px; }
  .halo { position: absolute; width: 520px; height: 520px; border-radius: 50%; background: radial-gradient(circle, rgba(214, 255, 63, .09), transparent 65%); pointer-events: none; }
  .jeu { width: 64px; height: 64px; display: grid; place-items: center; border-radius: 20px; background: var(--volt-soft); box-shadow: inset 0 0 0 1px var(--volt-line); color: var(--volt); }
  .jeu :global(svg) { width: 30px; height: 30px; }
  .bienvenue h1 { font-size: 34px; }
  .bienvenue p { color: var(--ink-2); max-width: 44ch; font-size: 14.5px; }
  .attente { display: inline-flex; align-items: center; gap: 10px; font-size: 12.5px; color: var(--ink-3) !important; margin-top: 8px; }
  .attente .point { background: var(--volt); animation: pulse 2s infinite; }

  @media (max-width: 1100px) {
    .grille-rangs { grid-template-columns: 1fr 1fr; }
    .grille-rangs :global(.courbe) { grid-column: 1 / -1; }
  }
</style>
