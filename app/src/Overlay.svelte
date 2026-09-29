<script>
  // L'overlay en jeu (brique 6). Une fenêtre transparente sur le jeu, qui
  // laisse passer les clics ; Ctrl+Maj+H la masque, Ctrl+Maj+E permet de
  // déplacer les widgets. Rien ici ne suit les temps de recharge adverses
  // (interdit par Riot) : seulement ce que le jeu montre déjà à tout le monde,
  // et ton propre build.
  import { onMount, untrack } from 'svelte';
  import * as api from './lib/api.js';
  import { chargerDDragon, dd } from './lib/ddragon.svelte.js';
  import { competenceAMonter, ecartOr, milliers, minutes, objectifs, prochainsAchats } from './lib/overlay/calculs.js';
  import Widget, { reinitialiserPositions } from './lib/overlay/Widget.svelte';
  import ListeAugments from './lib/augments/ListeAugments.svelte';

  let jeu = $state(null);
  let edition = $state(false);
  let masque = $state(false);
  let visible = $state(true);
  let pick = $state(null);
  let catalogue = $state({});
  let build = $state(null);
  let generation = $state(0);
  let accueil = $state(true);

  const moi = $derived(jeu?.joueurs.find((j) => j.moi));
  const faille = $derived(jeu?.mode === 'CLASSIC');
  const or = $derived(jeu && faille ? ecartOr(jeu.joueurs) : null);
  const obj = $derived(jeu && faille && moi ? objectifs(jeu.objectifs, moi.equipe) : null);

  // Le champion joué : celui de la sélection, sinon celui que le jeu annonce.
  // Le build n'est demandé qu'une fois par champion (pas à chaque seconde).
  const champion = $derived(moi ? (pick && dd.cle(moi.champion) === pick.championId ? pick.championId : dd.cle(moi.champion)) : null);
  // ARAM et ARAM Mayhem (mode « KIWI », file 2400) : pas de poste, builds d'ARAM.
  const aram = $derived(['ARAM', 'KIWI'].includes(jeu?.mode) || [450, 2400].includes(pick?.file));
  const mayhem = $derived(jeu?.mode === 'KIWI' || pick?.file === 2400);
  $effect(() => {
    const c = champion;
    if (!c) return;
    const role = aram ? null : (untrack(() => moi?.poste) ?? pick?.poste ?? null);
    const file = pick?.file ?? (mayhem ? 2400 : aram ? 450 : 420);
    untrack(() => api.buildChampion(c, role, file)).then((b) => (build = b)).catch(() => (build = null));
  });

  const competence = $derived(jeu && build ? competenceAMonter(jeu.niveau, jeu.competences, build.competences) : null);
  const physique = $derived.by(() => {
    if (!jeu || !moi) return 0.5;
    const eux = jeu.joueurs.filter((j) => j.equipe !== moi.equipe).map((j) => dd.cle(j.champion)).filter(Boolean);
    return eux.length ? eux.reduce((s, k) => s + dd.physique(k), 0) / eux.length : 0.5;
  });
  const achats = $derived(moi && build ? prochainsAchats(build, moi.items, catalogue, physique) : null);
  const prochain = $derived(achats?.suivants[0] ? { id: achats.suivants[0], ...catalogue[achats.suivants[0]] } : null);

  const montre = $derived(edition || (visible && !masque));
  // ARAM Mayhem : on choisit un augment au début de la partie, puis aux
  // niveaux 7, 11 et 15, à la base après une mort. La carte ne s'affiche qu'à
  // ces moments-là : au début, et pendant une mort s'il reste un augment à
  // prendre (une mort passée à la base « consomme » ceux débloqués avant).
  const debloques = $derived(jeu ? [7, 11, 15].filter((n) => jeu.niveau >= n).length : 0);
  let consommes = $state(0);
  let etaitMort = false;
  $effect(() => {
    const mort = !!moi?.mort;
    if (etaitMort && !mort) consommes = untrack(() => debloques);
    etaitMort = mort;
  });
  const momentAugment = $derived(mayhem && jeu && moi && (jeu.temps < 90 || (moi.mort && debloques > consommes)));
  const augmentsBuild = $derived(build?.augments?.length ? build.augments : null);
  // Chaque changement d'affichage redessine tout l'overlay (plein écran,
  // transparent, sans carte graphique) : on n'affiche que ce qui change
  // vraiment. Minuteurs à 10 s près, à la seconde dans la dernière minute.
  const dans = (t) => {
    const reste = t - (jeu?.temps ?? 0);
    return reste <= 0 ? null : minutes(reste > 60 ? Math.ceil(reste / 10) * 10 : reste);
  };
  // Or qui manque : à 50 PO près ; jauge : par paliers de 5 %.
  const manque = (prix) => Math.ceil(Math.max(0, prix - (jeu?.or ?? 0)) / 50) * 50;
  const palier = (x) => Math.min(1, Math.floor(x * 20) / 20);
  const COULEURS = { Fire: '#ff7a45', Water: '#4fb6ff', Earth: '#c9a26b', Air: '#dfefff', Chemtech: '#9be15d', Hextech: '#a18bff' };
  const NOMS = { dragon: 'Dragon', ancien: 'Dragon ancien', baron: 'Baron Nashor' };
  const pieces = (n) => `${Math.round(n).toLocaleString('fr-FR')} PO`;

  onMount(() => {
    chargerDDragon();
    api.etatOverlay().then((e) => {
      edition = e.edition;
      masque = e.masque;
      pick = e.pick;
      catalogue = e.catalogue?.items ?? {};
    });
    const t = setTimeout(() => (accueil = false), 9000);
    const stops = [
      api.ecouter('jeu', (v) => (jeu = v)),
      api.ecouter('overlay-edition', (v) => (edition = v)),
      api.ecouter('overlay-masque', (v) => (masque = v)),
      api.ecouter('overlay-visible', (v) => (visible = v)),
    ];
    return () => {
      clearTimeout(t);
      stops.forEach((s) => s());
    };
  });

  function reinitialiser() {
    reinitialiserPositions();
    generation++;
  }
</script>

<div class="calque" class:montre class:edition>
  {#if edition}
    <div class="bandeau">
      <b>Mode édition</b>
      <span>Glisse les widgets où tu veux. <kbd>Ctrl</kbd> <kbd>Maj</kbd> <kbd>E</kbd> pour terminer.</span>
      <button onclick={reinitialiser}>Remettre en place</button>
    </div>
  {:else if accueil && jeu}
    <div class="accueil">
      <b>On lance ?</b> est là
      <span><kbd>Ctrl</kbd> <kbd>Maj</kbd> <kbd>H</kbd> masquer</span>
      <span><kbd>Ctrl</kbd> <kbd>Maj</kbd> <kbd>E</kbd> déplacer</span>
    </div>
  {/if}

  {#if or || edition}
    <Widget id="or" titre="Écart d'or" defaut={{ x: 50, y: 0.8 }} {edition} {generation}>
      <div class="carte or">
        <span class="etiq">Or estimé</span>
        <b class="mono" class:v={or?.ecart > 0} class:r={or?.ecart < 0}>{or ? milliers(or.ecart) : '+1,2 k'}</b>
        <span class="barre-or"><i style:transform="scaleX({or && or.nous + or.eux ? or.nous / (or.nous + or.eux) : 0.5})"></i></span>
        {#if or?.duel}
          {@const face = dd.champion(dd.cle(or.duel.champion))}
          <span class="sep"></span>
          <span class="etiq">vs</span>
          {#if face.icone}<img src={face.icone} alt={face.nom} />{/if}
          <b class="mono" class:v={or.duel.ecart > 0} class:r={or.duel.ecart < 0}>{milliers(or.duel.ecart)}</b>
        {/if}
      </div>
    </Widget>
  {/if}

  {#if obj || edition}
    <Widget id="objectifs" titre="Objectifs" defaut={{ x: 92, y: 44 }} {edition} {generation}>
      <div class="carte objectifs">
        {#each [obj?.dragon ?? { genre: 'dragon', apparition: 300 }, obj?.baron].filter(Boolean) as o (o.genre)}
          {@const d = dans(o.apparition)}
          <div class="obj" class:pret={!d}>
            <span class="pastille {o.genre}"></span>
            <span class="nom">{NOMS[o.genre]}</span>
            <b class="mono">{d ?? 'là'}</b>
          </div>
        {/each}
        {#if obj && (obj.compte.nous.length || obj.compte.eux.length)}
          <div class="ames">
            <span class="camp nous">{#each obj.compte.nous as e}<i style:background={COULEURS[e] ?? '#ccc'}></i>{/each}</span>
            <small>{obj.ame ? (obj.ame === 'nous' ? 'Âme pour vous' : 'Âme pour eux') : 'dragons'}</small>
            <span class="camp eux">{#each obj.compte.eux as e}<i style:background={COULEURS[e] ?? '#ccc'}></i>{/each}</span>
          </div>
        {/if}
      </div>
    </Widget>
  {/if}

  {#if competence || edition}
    <Widget id="competence" titre="Compétence" defaut={{ x: 50, y: 76 }} {edition} {generation}>
      {#key competence}
        <div class="carte competence">
          <kbd class="touche">{competence ?? 'Q'}</kbd>
          <span><small>Point de compétence</small><b>Monte {competence ?? 'Q'}</b></span>
          {#if build?.competences?.max}<small class="ordre mono">{[...build.competences.max].join(' › ')}</small>{/if}
        </div>
      {/key}
    </Widget>
  {/if}

  {#if (momentAugment && augmentsBuild) || edition}
    <Widget id="augments" titre="Augments" defaut={{ x: 91, y: 24 }} {edition} {generation}>
      <div class="carte augments">
        <span class="etiq">Meilleurs augments{#if moi}{' · '}{dd.champion(dd.cle(moi.champion)).nom}{/if}</span>
        <small class="astuce">Tes 3 cartes ont la même rareté : regarde sa section.</small>
        {#if augmentsBuild}
          <ListeAugments augments={augmentsBuild} par={3} compact vertical />
        {:else}
          <small class="vide">Les meilleurs augments de ton champion, par rareté, au moment de choisir.</small>
        {/if}
      </div>
    </Widget>
  {/if}

  {#if prochain || edition}
    <Widget id="achat" titre="Prochain achat" defaut={{ x: 8, y: 36 }} {edition} {generation}>
      <div class="carte achat">
        <span class="etiq">Prochain achat</span>
        {#if prochain}
          {@const peut = jeu && jeu.or >= prochain.p}
          <div class="item">
            {#if dd.item(prochain.id)}<img src={dd.item(prochain.id)} alt="" />{/if}
            <span>
              <b>{prochain.n}</b>
              <small class="mono" class:v={peut}>{peut ? 'Achetable' : `encore ${pieces(manque(prochain.p))} · ${pieces(prochain.p)}`}</small>
            </span>
          </div>
          <span class="jauge"><i class:plein={peut} style:transform="scaleX({palier((jeu?.or ?? 0) / prochain.p)})"></i></span>
          {#if achats.suivants.length > 1}
            <div class="ensuite">
              <small>Ensuite</small>
              {#each achats.suivants.slice(1) as id}{#if dd.item(id)}<img src={dd.item(id)} alt={catalogue[id]?.n} title={catalogue[id]?.n} />{/if}{/each}
            </div>
          {/if}
          {#if achats.raison}<small class="raison">{achats.raison}</small>{/if}
        {:else}
          <small class="vide">Ton build s'affiche ici.</small>
        {/if}
      </div>
    </Widget>
  {/if}
</div>

<style>
  .calque { position: fixed; inset: 0; overflow: hidden; opacity: 0; transition: opacity .2s; font-size: 13px; }
  .calque.montre { opacity: 1; }
  .calque.edition { background: rgba(4, 5, 7, .35); }

  .carte {
    display: flex; align-items: center; gap: 9px; padding: 8px 12px; border-radius: 12px; white-space: nowrap;
    background: rgba(8, 10, 14, .84); color: var(--ink);
    /* Pas de grande ombre floue : chaque rafraîchissement la recalculerait. */
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .09), 0 2px 6px rgba(0, 0, 0, .45);
    animation: apparait .25s var(--ease) both;
  }
  .etiq { font-size: 10.5px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--ink-3); }
  .mono { font-family: var(--mono); font-variant-numeric: tabular-nums; }
  .v { color: var(--volt); } .r { color: var(--red); }
  kbd { font: 700 10.5px var(--mono); padding: 1px 6px; border-radius: 5px; background: rgba(255, 255, 255, .1); box-shadow: inset 0 -1px 0 rgba(0, 0, 0, .4); }

  /* Écart d'or */
  .or b { font-size: 15px; }
  .barre-or { width: 84px; height: 6px; border-radius: 6px; background: var(--red); overflow: hidden; }
  .barre-or i { display: block; height: 100%; background: var(--blue); transform-origin: left; }
  .or img { width: 22px; height: 22px; border-radius: 6px; }
  .sep { width: 1px; height: 18px; background: rgba(255, 255, 255, .12); }

  /* Objectifs */
  .objectifs { flex-direction: column; align-items: stretch; gap: 6px; min-width: 190px; }
  .obj { display: flex; align-items: center; gap: 8px; }
  .obj .nom { flex: 1; font-weight: 600; color: var(--ink-2); }
  .obj b { font-size: 14px; }
  .obj.pret b { color: var(--volt); }
  .pastille { width: 9px; height: 9px; border-radius: 3px; transform: rotate(45deg); background: #ff7a45; }
  .pastille.ancien { background: #e8d9a8; }
  .pastille.baron { background: #b36bff; }
  .ames { display: flex; align-items: center; gap: 8px; padding-top: 5px; border-top: 1px solid rgba(255, 255, 255, .08); }
  .ames small { flex: 1; text-align: center; font-size: 10.5px; color: var(--ink-3); }
  .camp { display: flex; gap: 3px; min-width: 40px; }
  .camp.eux { justify-content: flex-end; }
  .camp i { width: 8px; height: 8px; border-radius: 50%; box-shadow: 0 0 0 1.5px rgba(8, 10, 14, .9); }
  .camp.nous { box-shadow: inset 2px 0 0 var(--blue); padding-left: 5px; }
  .camp.eux { box-shadow: inset -2px 0 0 var(--red); padding-right: 5px; }

  /* Compétence */
  /* Mise en avant par la couleur, sans lueur ni pulsation (redessinées à chaque image). */
  .competence { gap: 11px; padding: 8px 14px 8px 8px; box-shadow: inset 0 0 0 1.5px var(--volt), 0 2px 6px rgba(0, 0, 0, .45); animation: apparait .25s var(--ease) both; }
  .touche { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 9px; font-size: 17px; background: var(--volt); color: var(--volt-ink); box-shadow: inset 0 -3px 0 rgba(0, 0, 0, .25); }
  .competence span { display: grid; line-height: 1.2; }
  .competence small { font-size: 10.5px; color: var(--ink-3); }
  .competence b { font-size: 14px; }
  .ordre { margin-left: 4px; color: var(--ink-2) !important; font-size: 11.5px !important; }

  /* Augments (ARAM Mayhem) */
  .augments { flex-direction: column; align-items: stretch; gap: 6px; width: 250px; white-space: normal; }
  .astuce { font-size: 10.5px; color: var(--ink-3); line-height: 1.35; margin-bottom: 2px; }

  /* Prochain achat */
  .achat { flex-direction: column; align-items: stretch; gap: 7px; width: 230px; white-space: normal; }
  .item { display: flex; align-items: center; gap: 10px; }
  .item img { width: 40px; height: 40px; border-radius: 9px; box-shadow: 0 0 0 1px rgba(255, 255, 255, .12); }
  .item span { display: grid; min-width: 0; line-height: 1.25; }
  .item b { font-size: 13.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .item small { font-size: 11px; color: var(--ink-3); }
  .jauge { height: 4px; border-radius: 4px; background: rgba(255, 255, 255, .08); overflow: hidden; }
  .jauge i { display: block; height: 100%; background: var(--gold); transform-origin: left; }
  .jauge i.plein { background: var(--volt); }
  .ensuite { display: flex; align-items: center; gap: 5px; }
  .ensuite small { font-size: 10.5px; color: var(--ink-3); margin-right: 3px; }
  .ensuite img { width: 24px; height: 24px; border-radius: 6px; opacity: .85; }
  .raison { font-size: 11px; color: var(--gold); }
  .vide { color: var(--ink-3); }

  /* Accueil et mode édition */
  .accueil, .bandeau {
    position: absolute; left: 50%; top: 9%; translate: -50% 0; display: flex; align-items: center; gap: 14px;
    padding: 9px 16px; border-radius: 999px; background: rgba(8, 10, 14, .9); color: var(--ink-2); white-space: nowrap;
    box-shadow: inset 0 0 0 1px var(--volt-line), 0 2px 8px rgba(0, 0, 0, .5);
    animation: apparait .4s var(--ease) both;
  }
  .accueil b, .bandeau b { color: var(--volt); }
  .accueil span { display: inline-flex; gap: 4px; align-items: center; font-size: 12px; }
  .bandeau { top: 42%; pointer-events: auto; }
  .bandeau button { border: 0; border-radius: 999px; padding: 5px 12px; background: rgba(255, 255, 255, .08); color: var(--ink); font: inherit; font-weight: 650; font-size: 12px; cursor: pointer; }
  .bandeau button:hover { background: rgba(255, 255, 255, .14); }

  @media (prefers-reduced-motion: reduce) {
    .carte, .competence { animation: none; }
  }
</style>
