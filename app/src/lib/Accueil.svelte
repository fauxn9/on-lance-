<script>
  import { untrack } from 'svelte';
  import * as api from './api.js';
  import { onde } from './actions.js';
  import { dd } from './ddragon.svelte.js';
  import { ilYa } from './format.js';
  import CarteRang from './CarteRang.svelte';
  import Compteur from './Compteur.svelte';
  import CourbePL from './CourbePL.svelte';
  import FocusCarte from './coach/FocusCarte.svelte';
  import Etapes from './Etapes.svelte';
  import Icone from './Icone.svelte';
  import LignePartie from './LignePartie.svelte';

  let { client, profil, compte, erreur, synchro, revision, onsync, onvoir, oncoach } = $props();

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

  // Le champion du moment : le plus joué sur les dernières parties.
  const champion = $derived.by(() => {
    if (!recentes.length) return null;
    const n = {};
    for (const m of recentes) n[m.championId] = (n[m.championId] ?? 0) + 1;
    const id = Object.entries(n).sort((a, b) => b[1] - a[1])[0][0];
    return dd.champion(Number(id));
  });
  const region = $derived(client.plateforme?.replace(/\d+$/, '').toUpperCase() ?? profil?.account?.platform?.replace(/\d+$/, '').toUpperCase());
</script>

{#if !compte && client.etape === 'hors'}
  <section class="attente">
    <div class="radar" aria-hidden="true">
      <span></span><span></span><span></span>
    </div>
    <span class="manette"><Icone nom="jeu" /></span>
    <h1>Lance League of Legends.</h1>
    <p>L'app se relie toute seule à ton compte dès que le client est ouvert. Rien à saisir, aucun mot de passe.</p>
    <p class="guet mono"><span class="point"></span>En attente du client…</p>
  </section>
{:else}
  <header class="banniere">
    {#key champion?.splash}
      {#if champion?.splash}<img class="splash" src={champion.splash} alt="" />{/if}
    {/key}
    <div class="voile"></div>
    <div class="qui">
      <span class="avatar">
        {#if compte && dd.profil(compte.icone)}<img src={dd.profil(compte.icone)} alt="" width="64" height="64" />{:else}<span class="squelette rond"></span>{/if}
        {#if compte?.niveau}<em class="mono">{compte.niveau}</em>{/if}
      </span>
      <div>
        <h1>{compte?.nom ?? '…'}<span class="tag-riot">#{compte?.tag ?? ''}</span></h1>
        <p class="sous">
          {#if region}<span class="tag">{region}</span>{/if}
          {#if champion}<span>En ce moment sur <b>{champion.nom}</b></span>{/if}
        </p>
      </div>
    </div>
    <div class="phase">
      {#if client.etape !== 'hors'}
        <Etapes etape={client.etape} />
      {:else}
        <p class="ferme"><span class="point"></span>Client fermé · dernier état connu</p>
      {/if}
    </div>
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
    <section class="carte recentes">
      <div class="titre-carte">
        <p class="etiquette">Dernières parties</p>
        <button class="lien" onclick={onvoir}>Tout l'historique <span class="fleche">→</span></button>
      </div>
      {#if recentes.length}
        <ul class="liste">
          {#each recentes as m, i (m.matchId)}<LignePartie {m} {i} compact />{/each}
        </ul>
      {:else if chargement}
        <ul class="liste" aria-label="Chargement">
          {#each Array(5) as _, i}<li class="fantome" style:--i={i}><span class="squelette c1"></span><span class="squelette c2"></span><span class="squelette c3"></span></li>{/each}
        </ul>
      {:else}
        <p class="dim vide">Aucune partie pour l'instant. Elles arrivent dès la première synchronisation.</p>
      {/if}
    </section>

    <div class="colonne">
      <FocusCarte onvoir={oncoach} />
      <section class="carte histo">
        <p class="etiquette">Historique</p>
        <p class="compte-parties"><Compteur classe="gros" valeur={profil?.history.count ?? 0} duree={1500} /> parties</p>
        <div class="progression" class:fini={profil?.history.backfillDone}><span></span></div>
        <p class="dim etat">
          {#if !profil}—
          {:else if profil.history.backfillDone}Tout ton historique est là.
          {:else}Tes anciennes parties arrivent en fond.{/if}
        </p>
        {#if profil?.history.lastSyncAt}<p class="dim etat">Dernière synchro {ilYa(new Date(profil.history.lastSyncAt).getTime())}</p>{/if}
        <button class="bouton" use:onde onclick={onsync} disabled={synchro}>
          <span class:tourne={synchro} class="ico"><Icone nom="sync" /></span>{synchro ? 'Synchronisation…' : 'Synchroniser'}
        </button>
        <p class="note dim">Chaque fin de partie se synchronise toute seule.</p>
      </section>
    </div>
  </div>
{/if}

<style>
  /* Bannière */
  .banniere { position: relative; overflow: hidden; border-radius: 18px; min-height: 150px; padding: 22px 24px; margin-bottom: 16px; display: flex; flex-direction: column; justify-content: space-between; gap: 18px; background: var(--panel); box-shadow: inset 0 0 0 1px var(--line); isolation: isolate; }
  .splash { position: absolute; inset: 0; z-index: -2; width: 100%; height: 100%; object-fit: cover; object-position: 65% 22%; animation: devoile 1.4s var(--ease) both; }
  @keyframes devoile { from { opacity: 0; transform: scale(1.08); } to { opacity: .55; transform: scale(1); } }
  .voile { position: absolute; inset: 0; z-index: -1; background: linear-gradient(90deg, var(--panel) 18%, rgba(15, 18, 23, .75) 48%, rgba(15, 18, 23, .15)), linear-gradient(0deg, var(--panel), transparent 60%); }
  .qui { display: flex; align-items: center; gap: 16px; animation: apparait .6s var(--ease) both; }
  .avatar { position: relative; flex: none; }
  .avatar img, .rond { display: block; width: 64px; height: 64px; border-radius: 18px; box-shadow: 0 0 0 2px rgba(var(--volt-rgb), .5), 0 14px 30px -10px rgba(0, 0, 0, .9); }
  .avatar em { position: absolute; left: 50%; bottom: -8px; translate: -50% 0; font-style: normal; font-size: 10.5px; font-weight: 700; padding: 1px 7px; border-radius: 999px; background: var(--volt); color: var(--volt-ink); }
  h1 { font-stretch: 122%; font-weight: 900; font-size: 30px; letter-spacing: -.03em; line-height: 1.05; }
  .tag-riot { font-weight: 600; font-size: 18px; color: var(--ink-3); margin-left: 3px; font-stretch: 100%; }
  .sous { display: flex; align-items: center; gap: 10px; margin-top: 6px; font-size: 12.5px; color: var(--ink-2); }
  .sous b { color: var(--ink); }
  .phase { animation: apparait .6s var(--ease) .12s both; }
  .ferme { display: inline-flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--ink-3); }
  .point { width: 7px; height: 7px; border-radius: 50%; background: var(--ink-3); }

  .erreur { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; padding: 10px 14px; border-radius: 12px; background: var(--red-soft); box-shadow: inset 0 0 0 1px rgba(255, 77, 106, .3); color: #ffc2cc; font-size: 13px; animation: apparait .4s var(--ease) both; }
  .erreur :global(svg) { width: 17px; height: 17px; color: var(--red); flex: none; }
  .erreur .lien { margin-left: auto; }

  .grille-rangs { display: grid; grid-template-columns: 1fr 1fr 1.5fr; gap: 14px; margin-bottom: 14px; }
  .grille-bas { display: grid; grid-template-columns: 1.9fr 1fr; gap: 14px; }
  .recentes { animation: apparait .6s var(--ease) .16s both; }
  .liste { margin: 0 -16px -8px; }
  .liste :global(li:first-child) { border-top: 0; }
  .fleche { display: inline-block; transition: transform .3s var(--ease); }
  .lien:hover .fleche { transform: translateX(4px); }
  .fantome { display: grid; grid-template-columns: 34px 1fr 90px; align-items: center; gap: 12px; padding: 9px 16px; border-top: 1px solid var(--line); opacity: 0; animation: apparait .4s var(--ease) both; animation-delay: calc(var(--i) * 60ms); }
  .fantome:first-child { border-top: 0; }
  .c1 { height: 34px; border-radius: 9px; }
  .c2 { height: 12px; width: 60%; }
  .c3 { height: 12px; }
  .vide { padding: 20px 0; font-size: 13px; }
  .colonne { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
  .colonne > :global(.focus) { animation: apparait .6s var(--ease) .19s both; }
  .histo { flex: 1; display: flex; flex-direction: column; gap: 6px; animation: apparait .6s var(--ease) .22s both; }
  .compte-parties { font-size: 14px; color: var(--ink-2); margin-top: 6px; }
  .compte-parties :global(.gros) { font-size: 38px; color: var(--ink); font-stretch: 122%; font-weight: 900; margin-right: 4px; letter-spacing: -.03em; font-variant-numeric: tabular-nums; }
  .progression { position: relative; height: 4px; border-radius: 4px; background: var(--panel-3); overflow: hidden; margin: 4px 0 6px; }
  /* Statique exprès : une barre animée en boucle ferait redessiner la fenêtre
     à chaque image, et sans GPU ça se paie en RAM. */
  .progression span { position: absolute; inset: 0; border-radius: 4px; background: repeating-linear-gradient(-45deg, rgba(var(--volt-rgb), .7) 0 6px, rgba(var(--volt-rgb), .25) 6px 12px); }
  .progression.fini span { background: var(--volt); opacity: .6; }
  .etat { font-size: 12.5px; }
  .histo .bouton { margin-top: auto; align-self: flex-start; }
  .ico { display: inline-flex; }
  .note { font-size: 11.5px; }

  /* Attente du client */
  .attente { position: relative; height: 100%; min-height: 460px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 14px; }
  .radar { position: absolute; top: 50%; left: 50%; width: 460px; height: 460px; translate: -50% -62%; pointer-events: none; }
  .radar span { position: absolute; inset: 0; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(var(--volt-rgb), .22); opacity: 0; animation: onde-radar 4.5s cubic-bezier(.2, .6, .4, 1) 3 backwards; }
  .radar span:nth-child(2) { animation-delay: 1.5s; }
  .radar span:nth-child(3) { animation-delay: 3s; }
  @keyframes onde-radar { from { transform: scale(.18); opacity: .9; } to { transform: scale(1); opacity: 0; } }
  .manette { position: relative; width: 68px; height: 68px; display: grid; place-items: center; border-radius: 22px; background: color-mix(in srgb, var(--volt) 7%, var(--bg)); color: var(--volt); box-shadow: inset 0 0 0 1px var(--volt-line), 0 0 50px -10px var(--volt-glow); animation: flotte 3.5s ease-in-out 3; }
  .manette :global(svg) { width: 32px; height: 32px; }
  @keyframes flotte { 50% { transform: translateY(-6px); } }
  .attente h1 { position: relative; font-size: 36px; margin-top: 10px; }
  .attente p { position: relative; color: var(--ink-2); max-width: 44ch; font-size: 14.5px; }
  .guet { display: inline-flex; align-items: center; gap: 10px; font-size: 12.5px; color: var(--ink-3) !important; margin-top: 8px; }
  .guet .point { background: var(--volt); animation: pulse 2s 4; }

  @media (max-width: 1100px) {
    .grille-rangs { grid-template-columns: 1fr 1fr; }
    .grille-rangs :global(.courbe) { grid-column: 1 / -1; min-height: 170px; }
  }
</style>
