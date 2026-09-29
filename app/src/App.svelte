<script>
  import { flushSync, onMount, untrack } from 'svelte';
  import * as api from './lib/api.js';
  import { onde } from './lib/actions.js';
  import { chargerDDragon, dd } from './lib/ddragon.svelte.js';
  import { notifier } from './lib/notifications.svelte.js';
  import Barre from './lib/Barre.svelte';
  import Accueil from './lib/Accueil.svelte';
  import Parties from './lib/Parties.svelte';
  import Draft from './lib/Draft.svelte';
  import Partie from './lib/Partie.svelte';
  import Apres from './lib/Apres.svelte';
  import Potes from './lib/Potes.svelte';
  import Verdict from './lib/potes/Verdict.svelte';
  import { suivre } from './lib/partie.svelte.js';
  import { chargerCoach } from './lib/coach.svelte.js';
  import Icone from './lib/Icone.svelte';
  import Notifications from './lib/Notifications.svelte';
  import Reglages from './lib/Reglages.svelte';

  let client = $state({ etape: 'hors', compte: null, rangs: [], plateforme: null });
  let profil = $state(null);
  let erreur = $state(null);
  let vue = $state('accueil');
  let synchro = $state(false);
  // Incrémenté à chaque nouvel historique : les listes s'y abonnent.
  let revision = $state(0);
  let reglages = $state(false);

  const compte = $derived(
    client.compte
      ? { nom: client.compte.gameName, tag: client.compte.tagLine, icone: client.compte.icone, niveau: client.compte.niveau }
      : profil?.account
        ? { nom: profil.account.gameName, tag: profil.account.tagLine, icone: profil.account.profileIconId, niveau: profil.account.summonerLevel }
        : null,
  );

  const NAV = [
    { id: 'accueil', nom: 'Accueil', icone: 'maison', touche: '1' },
    { id: 'parties', nom: 'Parties', icone: 'historique', touche: '2' },
    { id: 'draft', nom: 'Draft', icone: 'epees', touche: '3' },
    { id: 'partie', nom: 'En direct', icone: 'cible', touche: '4' },
    { id: 'apres', nom: 'Après-partie', icone: 'courbe', touche: '5' },
    { id: 'potes', nom: 'Potes', icone: 'potes', touche: '6' },
  ];
  const indexVue = $derived(NAV.findIndex((n) => n.id === vue));

  // Changement d'onglet animé : le nouvel écran arrive du côté de l'onglet.
  function aller(id) {
    if (id === 'potes') nonLues = 0;
    if (id === vue) return;
    const cible = NAV.findIndex((n) => n.id === id);
    document.documentElement.dataset.sens = cible > indexVue ? 'bas' : 'haut';
    const calme = matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Fenêtre cachée (réduite, en arrière-plan) : pas d'animation, le
    // navigateur la refuserait de toute façon.
    if (!document.startViewTransition || calme || document.visibilityState !== 'visible') {
      vue = id;
      return;
    }
    const t = document.startViewTransition(() => flushSync(() => (vue = id)));
    // Une transition interrompue (autre changement d'onglet en route) n'est
    // pas une erreur : l'onglet est de toute façon affiché.
    t.ready.catch(() => {});
    t.updateCallbackDone.catch(() => {});
    t.finished.catch(() => {});
  }

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
      const r = await api.synchroniser();
      erreur = null;
      if (r?.added > 0) notifier({ titre: `${r.added} nouvelle${r.added > 1 ? 's' : ''} partie${r.added > 1 ? 's' : ''}`, texte: "L'historique est à jour.", icone: 'check' });
    } catch (e) {
      erreur = String(e);
    } finally {
      synchro = false;
      await chargerProfil();
      revision++;
    }
  }

  // La sélection des champions commence : l'écran Draft s'ouvre tout seul.
  // Le chargement commence : l'écran En direct, avec les 10 joueurs.
  let etapePrecedente = 'hors';
  $effect(() => {
    const e = client.etape;
    if (e === 'selection' && etapePrecedente !== 'selection') aller('draft');
    if (e === 'chargement' && etapePrecedente !== 'chargement') aller('partie');
    etapePrecedente = e;
  });
  $effect(() => {
    const e = client.etape, id = client.partie;
    untrack(() => suivre(e, id));
  });

  // Entre potes : toutes les minutes (hors partie), les nouveaux événements des
  // groupes. Ta partie → le verdict ; celle d'un pote → une notification.
  let verdict = $state(null);
  // Vannes des potes pas encore vues : une pastille sur l'onglet.
  let nonLues = $state(0);
  let revisionPotes = $state(0);
  let dernierEvenement = null;
  async function ecouterPotes() {
    if (['chargement', 'en_jeu'].includes(client.etape) || document.visibilityState === 'hidden') return;
    try {
      const { fil } = await api.potes('GET', `/fil?depuis=${dernierEvenement ?? 0}`);
      if (dernierEvenement === null) {
        dernierEvenement = fil[0]?.id ?? 0;
        return;
      }
      for (const e of [...fil].reverse()) {
        dernierEvenement = Math.max(dernierEvenement, e.id);
        if (e.moi && e.type === 'partie') verdict = e;
        else if (vue !== 'potes') nonLues++;
        if (!(e.moi && e.type === 'partie')) notifier({ titre: e.type === 'couronne' ? `${e.pseudo} gagne la semaine` : `${e.pseudo} · ${e.groupe}`, texte: e.texte, icone: e.type === 'couronne' ? 'couronne' : 'potes', duree: 9000 });
      }
      if (fil.length) revisionPotes++;
    } catch {}
  }

  // Debrief : une partie choisie dans l'historique, sinon la dernière jouée.
  let apresMatch = $state(null);
  let apresSous = $state('partie');
  function voirDebrief(id) {
    apresMatch = id;
    apresSous = 'partie';
    aller('apres');
  }
  function voirCoach() {
    apresSous = 'coach';
    aller('apres');
  }

  // Le coach se recalcule à chaque nouvel historique (les mesures des
  // nouvelles parties arrivent avec la synchro).
  $effect(() => {
    revision;
    untrack(() => chargerCoach());
  });
  // Après une partie, le debrief s'ouvre dès qu'elle arrive dans l'historique.
  let debriefAttendu = false;

  // Fin de partie : la notification arrive avant même que Riot publie la partie.
  function finDePartie(f) {
    debriefAttendu = true;
    if (f.variation != null) {
      const gagne = f.variation > 0;
      notifier({
        type: 'partie', ton: gagne ? 'victoire' : 'defaite', titre: gagne ? 'Victoire' : 'Défaite',
        delta: f.variation, rang: f.rangApres, duree: 9000,
      });
    } else {
      notifier({ titre: 'Partie terminée', texte: 'Les stats arrivent dans un instant.', icone: 'jeu' });
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
        if (nouveau) { chargerProfil(); chargerCoach(); }
      }),
      api.ecouter('historique', (h) => {
        chargerProfil();
        revision++;
        if (debriefAttendu && h?.added > 0) {
          debriefAttendu = false;
          voirDebrief(null);
        }
      }),
      api.ecouter('fin-de-partie', finDePartie),
      api.ecouter('erreur-serveur', (e) => (erreur = e)),
      api.ecouter('overlay-impossible', () => notifier({
        titre: "L'overlay ne peut pas s'afficher",
        texte: 'Ton jeu est en plein écran. Passe en « Fenêtré sans bordure » (Options › Vidéo › Mode fenêtre).',
        icone: 'alerte', duree: 12000,
      })),
    ];
    // Profil de la personne (tous ses comptes réunis), puis l'écoute des potes.
    api.identite().catch(() => {});
    const potesT = setInterval(ecouterPotes, api.enTauri ? 60_000 : 4000);
    setTimeout(ecouterPotes, 1500);
    stops.push(() => clearInterval(potesT));
    const clavier = (e) => {
      if (e.ctrlKey && e.key === ',') {
        e.preventDefault();
        reglages = !reglages;
        return;
      }
      const item = e.ctrlKey && NAV.find((n) => n.touche === e.key);
      if (item) {
        e.preventDefault();
        aller(item.id);
      }
    };
    addEventListener('keydown', clavier);
    return () => {
      stops.forEach((s) => s());
      removeEventListener('keydown', clavier);
    };
  });
</script>

<div class="app">
  <Barre etape={client.etape} {compte} />
  <div class="corps">
    <nav class="cote" aria-label="Navigation">
      <span class="indic" style:transform="translateY({indexVue * 48}px)" aria-hidden="true"></span>
      {#each NAV as item}
        <button class="nav" class:on={vue === item.id} onclick={() => aller(item.id)} use:onde aria-current={vue === item.id ? 'page' : undefined}>
          <Icone nom={item.icone} />
          {#if item.id === 'potes' && nonLues}<span class="pastille-nav mono">{nonLues > 9 ? '9+' : nonLues}</span>{/if}
          <span class="bulle">{item.nom}<kbd>Ctrl {item.touche}</kbd></span>
        </button>
      {/each}
      <button class="nav roue" class:ouvert={reglages} onclick={() => (reglages = true)} use:onde aria-label="Réglages" aria-haspopup="dialog">
        <Icone nom="reglages" />
        <span class="bulle">Réglages<kbd>Ctrl ,</kbd></span>
      </button>
      {#if compte && dd.profil(compte.icone)}
        <img class="avatar" src={dd.profil(compte.icone)} alt="" width="36" height="36" />
      {/if}
    </nav>

    <main class="contenu">
      {#if vue === 'accueil'}
        <Accueil {client} {profil} {compte} {erreur} {synchro} {revision} onsync={synchroniser} onvoir={() => aller('parties')} oncoach={voirCoach} />
      {:else if vue === 'parties'}
        <Parties {revision} {profil} {synchro} onsync={synchroniser} ondebrief={voirDebrief} />
      {:else if vue === 'draft'}
        <Draft {client} />
      {:else if vue === 'partie'}
        <Partie {client} />
      {:else}
        {#if vue === 'apres'}
          <Apres matchId={apresMatch} {revision} sous={apresSous} onchoisir={(id) => (apresMatch = id)} onsous={(v) => (apresSous = v)} />
        {:else}
          <Potes revision={revisionPotes} />
        {/if}
      {/if}
    </main>
  </div>
  {#if !api.enTauri}
    <p class="demo mono">Mode démo : données inventées, hors de l'app.</p>
  {/if}
  {#if verdict}
    <Verdict e={verdict} onfermer={() => (verdict = null)} onvoir={() => { verdict = null; aller('potes'); }} />
  {/if}
  <Notifications />
  {#if reglages}<Reglages onfermer={() => (reglages = false)} />{/if}
</div>

<style>
  .app { height: 100%; display: flex; flex-direction: column; background: radial-gradient(ellipse 70% 50% at 80% -10%, rgba(var(--volt-rgb), .05), transparent 70%), var(--bg); }
  .corps { flex: 1; min-height: 0; display: flex; }
  .cote { position: relative; width: 64px; flex: none; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 14px 0; border-right: 1px solid var(--line); z-index: 5; }
  /* L'indicateur glisse d'un onglet à l'autre, avec un léger rebond. */
  .indic {
    position: absolute; top: 14px; left: 11px; width: 42px; height: 42px; border-radius: 12px; pointer-events: none;
    background: var(--volt-soft); box-shadow: inset 0 0 0 1px var(--volt-line), 0 0 24px -6px var(--volt-glow);
    transition: transform .55s cubic-bezier(.34, 1.56, .64, 1);
  }
  .indic::before { content: ""; position: absolute; left: -11px; top: 9px; bottom: 9px; width: 3px; border-radius: 0 3px 3px 0; background: var(--volt); box-shadow: 0 0 12px var(--volt); }
  .nav {
    position: relative; width: 42px; height: 42px; display: grid; place-items: center; border: 0; border-radius: 12px;
    background: transparent; color: var(--ink-3); cursor: pointer; transition: color .25s;
  }
  .nav:global(.ondulable) { overflow: visible; }
  .nav :global(.onde) { border-radius: 12px; }
  .nav :global(svg) { width: 21px; height: 21px; transition: transform .35s cubic-bezier(.34, 1.56, .64, 1); }
  .nav:hover:not(:disabled) { color: var(--ink); }
  .nav:hover:not(:disabled) :global(svg) { transform: scale(1.1); }
  .nav:active:not(:disabled) :global(svg) { transform: scale(.88); }
  .nav.on { color: var(--volt); }
  .pastille-nav {
    position: absolute; top: 3px; right: 2px; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 999px;
    display: grid; place-items: center; background: var(--red); color: #fff; font-size: 9.5px; font-weight: 800;
    box-shadow: 0 0 0 2px var(--bg); animation: pastille .45s cubic-bezier(.34, 1.56, .64, 1);
  }
  @keyframes pastille { from { transform: scale(0); } }
  .nav:disabled { opacity: .32; cursor: default; }
  .bulle {
    position: absolute; left: 54px; top: 50%; translate: 0 -50%; z-index: 20; display: flex; align-items: center; gap: 8px; white-space: nowrap; pointer-events: none;
    padding: 6px 8px 6px 11px; border-radius: 9px; background: var(--panel-3); box-shadow: inset 0 0 0 1px var(--line-2), 0 10px 30px -8px rgba(0, 0, 0, .8);
    color: var(--ink); font-size: 12px; font-weight: 650; opacity: 0; transform: translateX(-6px) scale(.96); transform-origin: left;
    transition: opacity .15s, transform .25s var(--ease);
  }
  .nav:hover .bulle { opacity: 1; transform: none; }
  kbd { font: 600 10px var(--mono); font-style: normal; padding: 2px 6px; border-radius: 5px; background: rgba(255, 255, 255, .06); color: var(--ink-3); }
  /* La roue crantée tourne d'un cran au survol, et reste tournée tant que les réglages sont ouverts. */
  .roue { margin-top: auto; }
  .nav.roue :global(svg) { transition: transform .6s cubic-bezier(.34, 1.56, .64, 1); }
  .nav.roue:hover:not(:disabled) :global(svg), .roue.ouvert :global(svg) { transform: rotate(90deg); }
  .roue.ouvert { color: var(--volt); }
  .avatar { margin-top: 6px; width: 36px; height: 36px; border-radius: 12px; box-shadow: 0 0 0 2px var(--panel-3); }
  .contenu { flex: 1; min-width: 0; overflow-y: auto; padding: 22px 26px 30px; position: relative; view-transition-name: contenu; }
  .demo { position: fixed; left: 78px; bottom: 10px; font-size: 11px; color: var(--gold); opacity: .8; pointer-events: none; }
</style>
