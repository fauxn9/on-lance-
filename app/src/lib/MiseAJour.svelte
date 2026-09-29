<script>
  // Mises à jour : l'app vérifie au lancement puis toutes les 3 h. Si une
  // version est publiée, une pastille apparaît dans la barre de titre ; un
  // clic montre les nouveautés et le bouton. Téléchargement, installation et
  // redémarrage se font tout seuls. Jamais pendant une partie.
  import { onMount } from 'svelte';
  import * as api from './api.js';
  import { onde } from './actions.js';
  import Icone from './Icone.svelte';

  let { etape } = $props();

  let maj = $state(null); // { actuelle, disponible: { version, notes } }
  let ouvert = $state(false);
  let etat = $state('repos'); // repos | telechargement | installation | erreur
  let progression = $state(0);
  let erreur = $state(null);
  const enPartie = $derived(etape === 'chargement' || etape === 'en_jeu');

  async function verifier() {
    try {
      maj = await api.verifierMaj();
    } catch {
      // Hors ligne, serveur injoignable : on réessaiera plus tard, sans bruit.
    }
  }
  onMount(() => {
    const premier = setTimeout(verifier, 4000);
    const t = setInterval(verifier, 3 * 3600e3);
    const stops = [
      api.ecouter('maj-progression', (p) => {
        etat = 'telechargement';
        progression = p.total ? Math.min(1, p.recu / p.total) : 0;
      }),
      api.ecouter('maj-installation', () => (etat = 'installation')),
    ];
    return () => {
      clearTimeout(premier);
      clearInterval(t);
      stops.forEach((s) => s());
    };
  });

  async function installer() {
    if (enPartie || etat === 'telechargement' || etat === 'installation') return;
    etat = 'telechargement';
    progression = 0;
    erreur = null;
    try {
      await api.installerMaj(); // l'app redémarre à la fin
    } catch (e) {
      etat = 'erreur';
      erreur = String(e);
    }
  }
  const pct = $derived(Math.round(progression * 100));
</script>

{#if maj?.disponible}
  <div class="maj">
    <button class="pastille" class:occupe={etat === 'telechargement' || etat === 'installation'} onclick={() => (ouvert = !ouvert)} use:onde aria-expanded={ouvert}>
      {#if etat === 'telechargement'}
        <span class="mono">{pct} %</span><span class="jauge"><i style:transform="scaleX({progression})"></i></span>
      {:else if etat === 'installation'}
        <span>Installation…</span>
      {:else}
        <Icone nom="fleche" /><span>Mise à jour <b class="mono">{maj.disponible.version}</b></span>
      {/if}
    </button>

    {#if ouvert}
      <div class="carte-maj" role="dialog" aria-label="Mise à jour">
        <p class="kicker mono">Nouvelle version</p>
        <h2>On lance ? {maj.disponible.version}</h2>
        <p class="dim petit">Tu as la {maj.actuelle}.</p>
        {#if maj.disponible.notes}<p class="notes">{maj.disponible.notes}</p>{/if}
        {#if etat === 'telechargement'}
          <div class="barre-dl"><i style:transform="scaleX({progression})"></i></div>
          <p class="dim petit">Téléchargement… {pct} %</p>
        {:else if etat === 'installation'}
          <p class="petit">Installation : l'app se relance toute seule dans quelques secondes.</p>
        {:else}
          {#if etat === 'erreur'}<p class="erreur">{erreur}</p>{/if}
          <div class="boutons">
            <button class="bouton volt" onclick={installer} disabled={enPartie} use:onde>
              {enPartie ? 'Après ta partie' : 'Mettre à jour maintenant'}
            </button>
            <button class="bouton" onclick={() => (ouvert = false)}>Plus tard</button>
          </div>
          <p class="dim petit">Environ 2 Mo. Tes comptes et tes réglages restent.</p>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .maj { position: relative; }
  .pastille {
    display: inline-flex; align-items: center; gap: 7px; height: 26px; padding: 0 11px; border: 0; border-radius: 999px; cursor: pointer;
    background: var(--volt-soft); color: var(--volt); box-shadow: inset 0 0 0 1px var(--volt-line); font-size: 11.5px; font-weight: 700;
    animation: arrive .5s cubic-bezier(.34, 1.56, .64, 1), appel 1.6s ease-out .6s 3;
  }
  .pastille :global(svg) { width: 13px; height: 13px; rotate: -90deg; }
  .pastille.occupe { min-width: 120px; }
  @keyframes arrive { from { transform: scale(.6); opacity: 0; } }
  @keyframes appel { 0% { box-shadow: inset 0 0 0 1px var(--volt-line), 0 0 0 0 rgba(214, 255, 63, .5); } 100% { box-shadow: inset 0 0 0 1px var(--volt-line), 0 0 0 10px rgba(214, 255, 63, 0); } }
  .jauge { width: 56px; height: 4px; border-radius: 4px; background: rgba(214, 255, 63, .15); overflow: hidden; }
  .jauge i, .barre-dl i { display: block; height: 100%; background: var(--volt); transform-origin: left; transition: transform .3s linear; }
  .carte-maj {
    position: absolute; right: 0; top: calc(100% + 10px); z-index: 80; width: 320px; display: grid; gap: 8px; padding: 16px;
    border-radius: 16px; background: var(--panel-3); box-shadow: inset 0 0 0 1px var(--line-2), 0 30px 60px -20px rgba(0, 0, 0, .95);
    animation: apparait .3s var(--ease) both; cursor: default;
  }
  .kicker { font-size: 10.5px; letter-spacing: .14em; text-transform: uppercase; color: var(--volt); }
  h2 { font-stretch: 118%; font-weight: 900; font-size: 20px; letter-spacing: -.02em; }
  .notes { font-size: 13px; line-height: 1.5; color: var(--ink-2); white-space: pre-line; max-height: 160px; overflow-y: auto; }
  .petit { font-size: 11.5px; }
  .boutons { display: flex; gap: 8px; margin-top: 4px; }
  .barre-dl { height: 6px; border-radius: 6px; background: var(--panel); overflow: hidden; margin-top: 4px; }
  .erreur { font-size: 12px; color: var(--gold); }
</style>
