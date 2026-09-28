<script>
  import { onMount } from 'svelte';
  import * as api from './lib/api.js';
  import { chargerDDragon, dd } from './lib/ddragon.svelte.js';
  import Barre from './lib/Barre.svelte';
  import Accueil from './lib/Accueil.svelte';
  import Parties from './lib/Parties.svelte';
  import Icone from './lib/Icone.svelte';

  let client = $state({ etape: 'hors', compte: null, rangs: [], plateforme: null });
  let profil = $state(null);
  let erreur = $state(null);
  let vue = $state('accueil');
  let synchro = $state(false);
  // Incrémenté à chaque nouvel historique : les listes s'y abonnent.
  let revision = $state(0);

  const compte = $derived(
    client.compte
      ? { nom: client.compte.gameName, tag: client.compte.tagLine, icone: client.compte.icone, niveau: client.compte.niveau }
      : profil?.account
        ? { nom: profil.account.gameName, tag: profil.account.tagLine, icone: profil.account.profileIconId, niveau: profil.account.summonerLevel }
        : null,
  );

  async function chargerProfil() {
    try {
      profil = await api.profil();
      erreur = null;
    } catch (e) {
      erreur = String(e);
    }
  }

  async function synchroniser() {
    synchro = true;
    try {
      await api.synchroniser();
      erreur = null;
    } catch (e) {
      erreur = String(e);
    } finally {
      synchro = false;
      await chargerProfil();
      revision++;
    }
  }

  onMount(() => {
    chargerDDragon();
    api.etatClient().then((e) => (client = e));
    chargerProfil();
    const stops = [
      api.ecouter('client', (e) => {
        const nouveau = e.compte?.puuid && e.compte.puuid !== client.compte?.puuid;
        client = e;
        if (nouveau) chargerProfil();
      }),
      api.ecouter('historique', () => {
        chargerProfil();
        revision++;
      }),
      api.ecouter('erreur-serveur', (e) => (erreur = e)),
    ];
    return () => stops.forEach((s) => s());
  });

  const NAV = [
    { id: 'accueil', nom: 'Accueil', icone: 'maison' },
    { id: 'parties', nom: 'Parties', icone: 'historique' },
  ];
  const BIENTOT = [
    { nom: 'Draft', icone: 'epees', brique: 4 },
    { nom: 'En jeu', icone: 'cible', brique: 6 },
    { nom: 'Après-partie', icone: 'courbe', brique: 7 },
  ];
</script>

<div class="app">
  <Barre etape={client.etape} {compte} />
  <div class="corps">
    <nav class="cote" aria-label="Navigation">
      {#each NAV as item}
        <button class="nav" class:on={vue === item.id} onclick={() => (vue = item.id)} aria-current={vue === item.id ? 'page' : undefined}>
          <Icone nom={item.icone} />
          <span class="bulle">{item.nom}</span>
        </button>
      {/each}
      <span class="sep"></span>
      {#each BIENTOT as item}
        <button class="nav" disabled aria-label="{item.nom} (bientôt)">
          <Icone nom={item.icone} />
          <span class="bulle">{item.nom} · bientôt</span>
        </button>
      {/each}
      {#if compte && dd.profil(compte.icone)}
        <img class="avatar" src={dd.profil(compte.icone)} alt="" width="36" height="36" />
      {/if}
    </nav>

    <main class="contenu">
      {#if vue === 'accueil'}
        <Accueil {client} {profil} {compte} {erreur} {synchro} {revision} onsync={synchroniser} onvoir={() => (vue = 'parties')} />
      {:else}
        <Parties {revision} {profil} {synchro} onsync={synchroniser} />
      {/if}
      {#if !api.enTauri}
        <p class="demo mono">Mode démo : données inventées, hors de l'app.</p>
      {/if}
    </main>
  </div>
</div>

<style>
  .app { height: 100%; display: flex; flex-direction: column; background: radial-gradient(ellipse 70% 50% at 80% -10%, rgba(214, 255, 63, .05), transparent 70%), var(--bg); }
  .corps { flex: 1; min-height: 0; display: flex; }
  .cote { width: 64px; flex: none; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 14px 0; border-right: 1px solid var(--line); }
  .nav {
    position: relative; width: 42px; height: 42px; display: grid; place-items: center; border: 0; border-radius: 12px;
    background: transparent; color: var(--ink-3); cursor: pointer; transition: color .2s, background-color .2s;
  }
  .nav :global(svg) { width: 21px; height: 21px; }
  .nav:hover:not(:disabled) { color: var(--ink); background: rgba(255, 255, 255, .05); }
  .nav.on { color: var(--volt); background: var(--volt-soft); box-shadow: inset 0 0 0 1px var(--volt-line); }
  .nav:disabled { opacity: .35; cursor: default; }
  .bulle {
    position: absolute; left: 52px; top: 50%; translate: 0 -50%; z-index: 20; white-space: nowrap; pointer-events: none;
    padding: 6px 10px; border-radius: 8px; background: var(--panel-3); box-shadow: inset 0 0 0 1px var(--line-2);
    color: var(--ink); font-size: 12px; font-weight: 600; opacity: 0; transform: translateX(-4px); transition: opacity .15s, transform .15s;
  }
  .nav:hover .bulle { opacity: 1; transform: none; }
  .sep { width: 24px; height: 1px; background: var(--line-2); margin: 6px 0; }
  .avatar { margin-top: auto; width: 36px; height: 36px; border-radius: 12px; box-shadow: 0 0 0 2px var(--panel-3); }
  .contenu { flex: 1; min-width: 0; overflow-y: auto; padding: 22px 26px 30px; position: relative; }
  .demo { position: fixed; right: 14px; bottom: 10px; font-size: 11px; color: var(--gold); opacity: .8; pointer-events: none; }
</style>
