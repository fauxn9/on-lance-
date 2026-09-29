<script>
  import { onde } from '../actions.js';
  import { dd } from '../ddragon.svelte.js';
  import { nomPoste } from '../format.js';
  import Icone from '../Icone.svelte';
  import PageRunes from './PageRunes.svelte';

  let { build, chargement = false, importEnCours = false, faits = new Set(), auto = $bindable(false), onimporter, peutSorts = false } = $props();

  const champ = $derived(build ? dd.champion(build.championId) : null);
  const pct = (x) => (x == null ? '—' : `${(x * 100).toFixed(1).replace('.', ',')} %`);
  const nombre = new Intl.NumberFormat('fr-FR');
  const vide = $derived(build && !build.runes && !build.coeur && !build.depart);
</script>

<section class="panneau" aria-busy={chargement}>
  {#if champ?.splash}{#key champ.splash}<img class="fond" src={champ.splash} alt="" />{/key}{/if}
  {#if !build}
    <div class="attente">
      <span class="squelette a"></span><span class="squelette b"></span><span class="squelette c"></span>
    </div>
  {:else}
    <header class="tete">
      {#if champ?.icone}<img class="portrait" src={champ.icone} alt="" />{/if}
      <div class="titre">
        <h2>{champ?.nom}</h2>
        <p class="sous">
          <span class="tag">{build.role === 'ARAM' ? 'ARAM' : nomPoste(build.role)}</span>
          {#if build.games}
            <span><b class="mono" class:v={build.winrate >= 0.5}>{pct(build.winrate)}</b> de victoires</span>
            <span class="dim mono">{nombre.format(build.games)} parties · patch {build.patchs?.join(' + ')}</span>
          {/if}
        </p>
      </div>
      <div class="actions">
        <button class="bouton volt" use:onde disabled={vide || importEnCours} onclick={() => onimporter(['runes', 'sorts', 'items'])}>
          {#if importEnCours}<span class="tourne ico"><Icone nom="sync" /></span>Import…{:else}<Icone nom="fleche" />Tout importer{/if}
        </button>
        <div class="parts">
          {#each [['runes', 'Runes'], ['sorts', 'Sorts'], ['items', 'Items']] as [id, nom]}
            <button class="part" class:fait={faits.has(id)} use:onde disabled={vide || importEnCours || (id === 'sorts' && !peutSorts)} onclick={() => onimporter([id])} title={id === 'sorts' && !peutSorts ? 'Les sorts se règlent pendant la sélection' : `Importer ${nom.toLowerCase()}`}>
              {#if faits.has(id)}<Icone nom="check" />{/if}{nom}
            </button>
          {/each}
        </div>
        <label class="auto"><input type="checkbox" bind:checked={auto} /><span class="interrupteur"></span>Import auto au verrouillage</label>
      </div>
    </header>

    {#if !build.fiable && build.games}
      <p class="alerte"><Icone nom="alerte" />Seulement {nombre.format(build.games)} parties analysées sur ce patch : à prendre avec des pincettes.</p>
    {/if}

    {#if vide}
      <div class="vide">
        <span class="rond"><Icone nom="courbe" /></span>
        <p><b>Pas encore assez de parties sur ce champion.</b></p>
        <p class="dim">Le moteur de stats analyse des parties Émeraude+ en continu : les builds apparaissent au fil de la collecte.</p>
      </div>
    {:else}
      <div class="grille">
        {#if build.runes}
          <div class="bloc runes">
            <p class="etiquette">Runes <span class="mono dim" title="{Math.round(build.runes.pickrate * 100)} % des parties sur ce poste">{pct(build.runes.winrate)}<span class="pris"> · {Math.round(build.runes.pickrate * 100)} % des parties</span></span></p>
            <PageRunes runes={build.runes} />
          </div>
        {/if}

        <div class="bloc">
          <p class="etiquette">Sorts & compétences</p>
          <div class="sorts">
            {#each build.sorts?.ids ?? [] as s}
              {@const sort = dd.sort(s)}
              {#if sort}<img src={sort.icone} alt={sort.nom} title={sort.nom} />{/if}
            {/each}
            {#if build.sorts}<span class="mono dim petit">{pct(build.sorts.winrate)}</span>{/if}
          </div>
          {#if build.competences.max}
            <div class="competences">
              {#each [...build.competences.max] as k, i}
                <span class="touche touche-{k}">{k}</span>{#if i < 2}<span class="sep">›</span>{/if}
              {/each}
              {#if build.competences.debut}<span class="dim petit">début {build.competences.debut.split('').join(' ')}</span>{/if}
            </div>
          {/if}
        </div>

        <div class="bloc items">
          <p class="etiquette">Items</p>
          <div class="chemin">
            {#if build.depart}
              <div class="etape-items"><small>Départ</small><div class="icones">{#each build.depart.ids as id}<img src={dd.item(id)} alt="" />{/each}</div></div>
              <span class="fl">→</span>
            {/if}
            {#if build.coeur}
              <div class="etape-items coeur"><small>Cœur <span class="mono">{pct(build.coeur.winrate)}</span></small><div class="icones">{#each build.coeur.ids as id, i}<img src={dd.item(id)} alt="" style:--i={i} />{/each}</div></div>
            {/if}
            {#if build.bottes}
              <span class="fl">+</span>
              <div class="etape-items"><small>Bottes</small><div class="icones"><img src={dd.item(build.bottes.id)} alt="" /></div></div>
            {/if}
          </div>
          {#if build.situation.length}
            <small class="situation-titre">Selon la partie</small>
            <div class="icones situation">
              {#each build.situation as s}<span class="item-sit" title="{pct(s.winrate)} sur {s.games} parties"><img src={dd.item(s.id)} alt="" /><em class="mono">{Math.round(s.winrate * 100)}</em></span>{/each}
            </div>
          {/if}
        </div>

        {#if build.matchups.favorables.length || build.matchups.difficiles.length}
          <div class="bloc matchups">
            <p class="etiquette">Matchups</p>
            <div class="colonnes">
              <div>
                <small class="v">Favorables</small>
                <div class="icones">{#each build.matchups.favorables.slice(0, 4) as m}<span class="mu" title="{dd.champion(m.championId).nom} · {pct(m.winrate)}"><img src={dd.champion(m.championId).icone} alt="" /><em class="mono v">{Math.round(m.winrate * 100)}</em></span>{/each}</div>
              </div>
              <div>
                <small class="r">Difficiles</small>
                <div class="icones">{#each build.matchups.difficiles.slice(0, 4) as m}<span class="mu" title="{dd.champion(m.championId).nom} · {pct(m.winrate)}"><img src={dd.champion(m.championId).icone} alt="" /><em class="mono r">{Math.round(m.winrate * 100)}</em></span>{/each}</div>
              </div>
            </div>
          </div>
        {/if}
      </div>
    {/if}
  {/if}
</section>

<style>
  .panneau { container-type: inline-size; position: relative; overflow: hidden; border-radius: 16px; background: var(--panel); box-shadow: inset 0 0 0 1px var(--line); padding: 16px; transition: opacity .25s; }
  .panneau[aria-busy='true'] { opacity: .6; }
  /* L'illustration du champion, en fond du haut du panneau, fondue dans le noir. */
  .fond {
    position: absolute; top: 0; right: 0; width: 72%; height: 210px; object-fit: cover; object-position: 60% 18%;
    opacity: .3; pointer-events: none;
    -webkit-mask-image: radial-gradient(ellipse 80% 90% at 85% 0%, #000 25%, transparent 72%);
    mask-image: radial-gradient(ellipse 80% 90% at 85% 0%, #000 25%, transparent 72%);
    animation: fond .9s var(--ease) both;
  }
  @keyframes fond { from { opacity: 0; transform: scale(1.06); } }
  .panneau > :not(.fond) { position: relative; }
  .attente { display: grid; gap: 10px; }
  .a { height: 56px; width: 60%; } .b { height: 120px; } .c { height: 80px; }
  .tete { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-bottom: 14px; animation: apparait .4s var(--ease) both; }
  .portrait { width: 56px; height: 56px; border-radius: 16px; box-shadow: 0 0 0 2px rgba(214, 255, 63, .45), 0 12px 30px -10px rgba(0, 0, 0, .9); }
  h2 { font-stretch: 120%; font-weight: 900; font-size: 24px; letter-spacing: -.02em; }
  .sous { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 12.5px; color: var(--ink-2); margin-top: 3px; }
  .actions { margin-left: auto; display: flex; flex-direction: column; align-items: flex-end; gap: 7px; }
  .parts { display: flex; gap: 5px; }
  .part { display: inline-flex; align-items: center; gap: 5px; border: 0; cursor: pointer; padding: 4px 10px; border-radius: 8px; font-size: 11.5px; font-weight: 650; background: rgba(255, 255, 255, .04); color: var(--ink-2); box-shadow: inset 0 0 0 1px var(--line-2); transition: color .2s, box-shadow .2s, background-color .2s; }
  .part:hover:not(:disabled) { color: var(--ink); }
  .part:disabled { opacity: .45; cursor: default; }
  .part.fait { color: var(--volt); box-shadow: inset 0 0 0 1px var(--volt-line); background: var(--volt-soft); }
  .part :global(svg) { width: 12px; height: 12px; }
  .ico { display: inline-flex; }
  .auto { display: inline-flex; align-items: center; gap: 8px; font-size: 11.5px; color: var(--ink-3); cursor: pointer; }
  .auto input { position: absolute; opacity: 0; pointer-events: none; }
  .interrupteur { position: relative; width: 28px; height: 16px; border-radius: 999px; background: var(--panel-3); box-shadow: inset 0 0 0 1px var(--line-2); transition: background-color .25s; }
  .interrupteur::after { content: ""; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: var(--ink-3); transition: transform .3s cubic-bezier(.34, 1.56, .64, 1), background-color .25s; }
  .auto input:checked + .interrupteur { background: var(--volt-soft); box-shadow: inset 0 0 0 1px var(--volt-line); }
  .auto input:checked + .interrupteur::after { transform: translateX(12px); background: var(--volt); }
  .auto input:focus-visible + .interrupteur { outline: 2px solid var(--volt); outline-offset: 2px; }
  .alerte { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--gold); margin-bottom: 12px; }
  .alerte :global(svg) { width: 15px; height: 15px; }

  .grille { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr); gap: 10px; }
  .bloc { padding: 12px 14px; border-radius: 12px; background: rgba(6, 7, 9, .45); box-shadow: inset 0 0 0 1px var(--line); animation: apparait .45s var(--ease) both; }
  .bloc:nth-child(2) { animation-delay: 60ms; } .bloc:nth-child(3) { animation-delay: 120ms; } .bloc:nth-child(4) { animation-delay: 180ms; }
  .bloc .etiquette { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 10px; white-space: nowrap; }
  /* Panneau étroit (pendant la sélection) : l'essentiel, sans retour à la ligne. */
  .bloc.runes { container-type: inline-size; }
  @container (max-width: 300px) { .pris { display: none; } }
  .runes { grid-row: span 2; }
  .sorts { display: flex; align-items: center; gap: 6px; }
  .sorts img { width: 34px; height: 34px; border-radius: 9px; }
  .petit { font-size: 11px; margin-left: 6px; }
  .competences { display: flex; align-items: center; gap: 6px; margin-top: 12px; }
  .touche { width: 28px; height: 28px; display: grid; place-items: center; border-radius: 8px; font: 800 13px var(--mono); background: var(--panel-3); box-shadow: inset 0 0 0 1px var(--line-2); }
  .touche:first-child { background: var(--volt); color: var(--volt-ink); box-shadow: none; }
  .sep { color: var(--ink-3); }
  .chemin { display: flex; align-items: flex-end; gap: 8px; flex-wrap: wrap; }
  .etape-items small, .situation-titre, .colonnes small { display: block; font-size: 10.5px; color: var(--ink-3); margin-bottom: 5px; font-weight: 600; }
  .icones { display: flex; gap: 4px; }
  .icones img { width: 32px; height: 32px; border-radius: 8px; box-shadow: 0 0 0 1px var(--line-2); }
  .coeur img { width: 38px; height: 38px; box-shadow: 0 0 0 1.5px var(--volt-line); animation: apparait .4s var(--ease) both; animation-delay: calc(var(--i) * 70ms); }
  .fl { color: var(--ink-3); padding-bottom: 8px; }
  .situation-titre { margin-top: 12px; }
  .situation { flex-wrap: wrap; }
  .item-sit, .mu { position: relative; }
  .item-sit em, .mu em { position: absolute; right: -3px; bottom: -4px; font-style: normal; font-size: 9px; font-weight: 700; padding: 0 4px; border-radius: 5px; background: var(--bg); box-shadow: inset 0 0 0 1px var(--line-2); }
  .matchups { grid-column: 1 / -1; }
  .colonnes { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .colonnes small.v { color: var(--volt); } .colonnes small.r { color: var(--red); }
  /* Panneau étroit (fenêtre réduite, colonne latérale) : une seule colonne. */
  @container (max-width: 560px) {
    .grille { grid-template-columns: minmax(0, 1fr); }
    .runes { grid-row: auto; }
    .actions { margin-left: 0; align-items: flex-start; }
  }
  .vide { display: grid; justify-items: center; text-align: center; gap: 8px; padding: 34px 20px; }
  .vide .rond { width: 52px; height: 52px; display: grid; place-items: center; border-radius: 16px; background: var(--panel-2); box-shadow: inset 0 0 0 1px var(--line); color: var(--ink-3); }
  .vide :global(svg) { width: 22px; height: 22px; }
  .vide p { max-width: 46ch; font-size: 13px; }
</style>
