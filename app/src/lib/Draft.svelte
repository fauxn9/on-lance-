<script>
  import { untrack } from 'svelte';
  import * as api from './api.js';
  import { onde } from './actions.js';
  import { dd } from './ddragon.svelte.js';
  import { nomFile, nomPhase, nomPoste } from './format.js';
  import { notifier } from './notifications.svelte.js';
  import Icone from './Icone.svelte';
  import PanneauBuild from './draft/PanneauBuild.svelte';
  import Counters from './draft/Counters.svelte';

  let { client } = $props();
  const sel = $derived(client.selection);
  const aram = $derived(sel?.file === 450 || sel?.file === 2400);

  // ---------------------------------------------------------------- chrono
  let restant = $state(0);
  $effect(() => {
    const ms = sel?.tempsRestantMs;
    if (ms == null) return;
    const fin = Date.now() + ms;
    restant = Math.max(0, Math.ceil(ms / 1000));
    const t = setInterval(() => (restant = Math.max(0, Math.ceil((fin - Date.now()) / 1000))), 250);
    return () => clearInterval(t);
  });

  // ---------------------------------------------------------------- suggestions
  let sugg = $state(null);
  const cleSugg = $derived(sel ? JSON.stringify([sel.file, sel.monPoste, sel.ennemis, sel.bans, sel.allies.map((a) => a.champion || a.intention), sel.banc]) : null);
  $effect(() => {
    if (!cleSugg) { sugg = null; return; }
    const t = setTimeout(() => untrack(() => api.suggestions().then((r) => (sugg = r)).catch(() => (sugg = null))), 350);
    return () => clearTimeout(t);
  });

  // ---------------------------------------------------------------- champion affiché
  // En sélection : l'aperçu cliqué, sinon ton pick, sinon la 1re suggestion.
  // Hors sélection : le champion cherché.
  let apercu = $state(null);
  let explore = $state(Number(localStorage.getItem('draft-champion')) || null);
  let roleExplore = $state('auto');
  $effect(() => { if (!sel) apercu = null; });
  const champion = $derived(sel ? (apercu ?? sel.monChampion ?? sugg?.suggestions?.[0]?.championId ?? null) : explore);
  const role = $derived(sel ? (aram ? null : sel.monPoste) : ['auto', 'ARAM', 'MAYHEM'].includes(roleExplore) ? null : roleExplore);
  const file = $derived(sel ? (sel.file ?? 420) : roleExplore === 'ARAM' ? 450 : roleExplore === 'MAYHEM' ? 2400 : 420);

  let build = $state(null);
  let chargement = $state(false);
  $effect(() => {
    const c = champion, r = role, f = file;
    if (!c) { build = null; return; }
    chargement = true;
    untrack(() => api.buildChampion(c, r, f))
      .then((b) => (build = b))
      .catch((e) => notifier({ titre: 'Build indisponible', texte: String(e), icone: 'alerte' }))
      .finally(() => (chargement = false));
  });

  // ---------------------------------------------------------------- build ou counters
  let onglet = $state(localStorage.getItem('draft-onglet') === 'counters' ? 'counters' : 'build');
  $effect(() => { try { localStorage.setItem('draft-onglet', onglet); } catch {} });
  // Pas de counters en ARAM : pas d'adversaire direct.
  const countersPossibles = $derived(file !== 450 && file !== 2400);
  const vueCounters = $derived(onglet === 'counters' && countersPossibles);
  // Un clic sur un champion des counters : on explore le sien.
  function voirCounters(id) {
    if (sel) apercu = id;
    else {
      explore = id;
      try { localStorage.setItem('draft-champion', String(id)); } catch {}
    }
  }

  // ---------------------------------------------------------------- import
  let auto = $state(localStorage.getItem('import-auto') === '1');
  $effect(() => { try { localStorage.setItem('import-auto', auto ? '1' : '0'); } catch {} });
  let importEnCours = $state(false);
  let faits = $state(new Set());
  $effect(() => { champion; faits = new Set(); });

  async function importer(parties) {
    if (!build || importEnCours) return;
    importEnCours = true;
    const nom = dd.champion(build.championId).nom;
    const titre = build.queue === 2400 ? `${nom} · Mayhem` : aram || build.role === 'ARAM' ? `${nom} · ARAM` : `${nom} · ${nomPoste(build.role)}`;
    try {
      const ok = await api.importer(build, titre, parties);
      faits = new Set([...faits, ...ok]);
      notifier({ titre: `${nom} importé`, texte: ok.map((p) => ({ runes: 'runes', sorts: 'sorts', items: 'set d’items' })[p]).join(', ') + ' dans le client.', icone: 'check', duree: 4500 });
    } catch (e) {
      notifier({ titre: "L'import n'a pas abouti", texte: String(e), icone: 'alerte' });
    } finally {
      importEnCours = false;
    }
  }

  // Import automatique : une fois, quand ton pick est verrouillé et que le
  // build affiché est bien le sien.
  let dejaAuto = '';
  $effect(() => {
    if (!auto || !sel?.verrouille || !build || build.championId !== sel.monChampion) return;
    const cle = `${sel.monChampion}:${sel.file}`;
    if (dejaAuto === cle) return;
    dejaAuto = cle;
    untrack(() => importer(['runes', 'sorts', 'items']));
  });

  // ---------------------------------------------------------------- compos
  const compo = (ids) => {
    const l = ids.filter(Boolean);
    if (!l.length) return null;
    const ad = l.reduce((s, id) => s + dd.physique(id), 0) / l.length;
    return { ad, ap: 1 - ad, n: l.length };
  };
  const nous = $derived(sel ? compo(sel.allies.map((a) => a.champion || a.intention)) : null);
  const eux = $derived(sel ? compo(sel.ennemis) : null);

  // ---------------------------------------------------------------- recherche
  let recherche = $state('');
  let ouverte = $state(false);
  const resultats = $derived(recherche.trim() ? dd.liste.filter((c) => c.nom.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').includes(recherche.toLowerCase().normalize('NFD').replace(/\p{M}/gu, ''))).slice(0, 8) : []);
  function choisir(c) {
    explore = c.cle;
    recherche = '';
    ouverte = false;
    try { localStorage.setItem('draft-champion', String(c.cle)); } catch {}
  }

  const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)} %`);
  function raison(r) {
    const nom = r.championId ? dd.champion(r.championId).nom : '';
    switch (r.type) {
      case 'contre': return { ton: 'v', texte: `Bon contre ${nom} : ${pct(r.winrate)}` };
      case 'difficile': return { ton: 'r', texte: `${nom} le contre : ${pct(r.winrate)}` };
      case 'perso': return { ton: 'v', texte: `Ton champion : ${pct(r.winrate)} sur ${r.games} parties` };
      case 'maitrise': return { ton: '', texte: `Maîtrise : ${Math.round(r.points / 1000)} k points` };
      case 'meta': return { ton: '', texte: `Solide ce patch : ${pct(r.winrate)}` };
      case 'aram': return { ton: '', texte: `${pct(r.winrate)} en ARAM` };
      default: return { ton: '', texte: '' };
    }
  }
  const ROLES = [['auto', 'Auto'], ['TOP', 'Top'], ['JUNGLE', 'Jungle'], ['MIDDLE', 'Mid'], ['BOTTOM', 'ADC'], ['UTILITY', 'Support'], ['ARAM', 'ARAM'], ['MAYHEM', 'Mayhem']];
</script>

{#if sel}
  <header class="tete">
    <div>
      <p class="kicker mono">{nomFile(sel.file)}</p>
      <h1>Sélection des champions</h1>
    </div>
    <div class="chrono" class:urgent={restant <= 10}>
      <span class="phase">{nomPhase(sel.phase)}</span>
      <b class="mono">{restant}</b>
    </div>
  </header>

  <div class="draft">
    <aside class="equipe">
      <p class="etiquette">Ton équipe</p>
      <ul>
        {#each sel.allies as a, i}
          {@const id = a.champion || a.intention}
          <li class:moi={a.moi} class:intention={!a.champion && a.intention} style:--i={i}>
            {#if id && dd.champion(id).icone}<img src={dd.champion(id).icone} alt="" />{:else}<span class="vide-slot"></span>{/if}
            <span class="qui">
              <b>{id ? dd.champion(id).nom : a.moi ? 'À toi de choisir' : 'En attente'}</b>
              <small>{a.moi ? 'Toi · ' : ''}{a.poste ? nomPoste(a.poste) : aram ? 'ARAM' : ''}</small>
            </span>
            {#if a.moi && sel.verrouille}<span class="tag v">Verrouillé</span>{/if}
          </li>
        {/each}
      </ul>
      {#if nous}
        <div class="compo">
          <div class="barre-compo"><i class="ad" style:flex={nous.ad}></i><i class="ap" style:flex={nous.ap}></i></div>
          <small><span class="ad-t">{Math.round(nous.ad * 100)} % physique</span> · <span class="ap-t">{Math.round(nous.ap * 100)} % magique</span></small>
        </div>
      {/if}
    </aside>

    <div class="centre">
      {#if sugg?.suggestions?.length && !sel.verrouille}
        <section class="suggestions">
          <p class="etiquette">{aram ? 'Sur ton banc, le meilleur choix' : 'Pour toi, contre eux'}</p>
          <div class="cartes">
            {#each sugg.suggestions.slice(0, aram ? 4 : 3) as s, i (s.championId)}
              {@const c = dd.champion(s.championId)}
              <button class="sugg" class:on={champion === s.championId} use:onde onclick={() => (apercu = s.championId)} style:--i={i}>
                <span class="haut">
                  {#if c.icone}<img src={c.icone} alt="" />{/if}
                  <span><b>{c.nom}</b><small class="mono">{pct(s.winrate)}</small></span>
                  <em class="note mono">{s.note}</em>
                </span>
                <span class="jauge"><i style:transform="scaleX({s.note / 100})"></i></span>
                {#each s.raisons.slice(0, 2) as r}
                  {@const x = raison(r)}
                  <small class="raison {x.ton}">{x.texte}</small>
                {/each}
              </button>
            {/each}
          </div>
        </section>
      {/if}
      {#if countersPossibles}
        <div class="onglets-draft" role="tablist" aria-label="Build ou counters">
          <button role="tab" aria-selected={!vueCounters} class:on={!vueCounters} onclick={() => (onglet = 'build')}>Build</button>
          <button role="tab" aria-selected={vueCounters} class:on={vueCounters} onclick={() => (onglet = 'counters')}>Counters</button>
        </div>
      {/if}
      {#if vueCounters && champion}
        <Counters {champion} role={sel.monPoste} onchoisir={voirCounters} />
      {:else}
        <PanneauBuild {build} {chargement} {importEnCours} {faits} bind:auto onimporter={importer} peutSorts={true} />
      {/if}
    </div>

    <aside class="equipe eux">
      <p class="etiquette">En face</p>
      <ul>
        {#each sel.ennemis as id, i}
          <li style:--i={i}>
            {#if dd.champion(id).icone}<img src={dd.champion(id).icone} alt="" />{/if}
            <span class="qui">
              <b>{dd.champion(id).nom}</b>
              <small>{sugg?.postes?.[id] ? `${nomPoste(sugg.postes[id])} probable` : ''}</small>
            </span>
            {#if sugg?.face === id}<span class="tag r">Ton adversaire</span>{/if}
          </li>
        {:else}
          <li class="attente-picks"><span class="vide-slot"></span><small class="dim">Picks adverses pas encore visibles</small></li>
        {/each}
      </ul>
      {#if eux}
        <div class="compo">
          <div class="barre-compo"><i class="ad" style:flex={eux.ad}></i><i class="ap" style:flex={eux.ap}></i></div>
          <small><span class="ad-t">{Math.round(eux.ad * 100)} % physique</span> · <span class="ap-t">{Math.round(eux.ap * 100)} % magique</span></small>
          {#if eux.n >= 3 && eux.ad >= 0.68}<p class="conseil">Ils tapent surtout en physique : l'armure rentabilise tôt.</p>
          {:else if eux.n >= 3 && eux.ap >= 0.6}<p class="conseil">Beaucoup de dégâts magiques en face : pense à la résistance magique.</p>{/if}
        </div>
      {/if}
      {#if sel.bans.length}
        <p class="etiquette bans-titre">Bannis</p>
        <div class="bans">{#each sel.bans as id}{#if dd.champion(id).icone}<img src={dd.champion(id).icone} alt={dd.champion(id).nom} title={dd.champion(id).nom} />{/if}{/each}</div>
      {/if}
    </aside>
  </div>
{:else}
  <header class="tete">
    <div>
      <p class="kicker mono">Builds</p>
      <h1>Explorer un champion</h1>
      <p class="dim sous-titre">Pendant la sélection des champions, cet écran s'ouvre tout seul avec tes suggestions.</p>
    </div>
  </header>
  <div class="explorer">
    <div class="recherche">
      <Icone nom="cible" />
      <input
        type="search" placeholder="Chercher un champion…" bind:value={recherche}
        onfocus={() => (ouverte = true)} onblur={() => setTimeout(() => (ouverte = false), 150)}
        onkeydown={(e) => e.key === 'Enter' && resultats[0] && choisir(resultats[0])}
        aria-label="Chercher un champion"
      />
      {#if ouverte && resultats.length}
        <ul class="resultats">
          {#each resultats as c}
            <li><button onmousedown={() => choisir(c)}><img src={c.icone} alt="" />{c.nom}</button></li>
          {/each}
        </ul>
      {/if}
    </div>
    {#if countersPossibles}
      <div class="onglets-draft" role="tablist" aria-label="Build ou counters">
        <button role="tab" aria-selected={!vueCounters} class:on={!vueCounters} onclick={() => (onglet = 'build')}>Build</button>
        <button role="tab" aria-selected={vueCounters} class:on={vueCounters} onclick={() => (onglet = 'counters')}>Counters</button>
      </div>
    {/if}
    <div class="roles" role="group" aria-label="Poste">
      {#each ROLES as [id, nom]}
        <button class:on={roleExplore === id} aria-pressed={roleExplore === id} onclick={() => (roleExplore = id)}>{nom}</button>
      {/each}
    </div>
  </div>
  {#if champion && vueCounters}
    <Counters {champion} {role} onchoisir={voirCounters} />
  {:else if champion}
    <PanneauBuild {build} {chargement} {importEnCours} {faits} bind:auto onimporter={importer} peutSorts={false} />
  {:else}
    <div class="choisis">
      <span class="rond"><Icone nom="epees" /></span>
      <p>Choisis un champion pour voir son build.</p>
    </div>
  {/if}
{/if}

<style>
  .tete { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 16px; animation: apparait .4s var(--ease) both; }
  .kicker { font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: var(--volt); margin-bottom: 4px; }
  h1 { font-stretch: 122%; font-weight: 900; font-size: 28px; letter-spacing: -.03em; }
  .sous-titre { font-size: 12.5px; margin-top: 4px; }
  .chrono { display: flex; align-items: center; gap: 12px; padding: 8px 8px 8px 14px; border-radius: 14px; background: var(--panel); box-shadow: inset 0 0 0 1px var(--line); }
  .phase { font-size: 12px; color: var(--ink-2); font-weight: 600; }
  .chrono b { min-width: 46px; text-align: center; font-size: 22px; padding: 4px 8px; border-radius: 10px; background: var(--volt-soft); color: var(--volt); box-shadow: inset 0 0 0 1px var(--volt-line); transition: background-color .3s, color .3s; }
  .chrono.urgent b { background: var(--red-soft); color: var(--red); box-shadow: inset 0 0 0 1px rgba(255, 77, 106, .35); }

  .draft { display: grid; grid-template-columns: 210px minmax(0, 1fr) 210px; gap: 14px; align-items: start; }
  .equipe { display: grid; gap: 10px; }
  .equipe ul { display: grid; gap: 6px; }
  .equipe li { display: flex; align-items: center; gap: 10px; padding: 7px 9px; border-radius: 12px; background: var(--panel); box-shadow: inset 3px 0 0 var(--blue), inset 0 0 0 1px var(--line); animation: apparait .4s var(--ease) both; animation-delay: calc(var(--i) * 45ms); }
  .eux li { box-shadow: inset -3px 0 0 var(--red), inset 0 0 0 1px var(--line); }
  .equipe li.moi { background: linear-gradient(90deg, var(--volt-soft), var(--panel) 80%); box-shadow: inset 3px 0 0 var(--volt), inset 0 0 0 1px var(--volt-line); }
  .equipe li.intention img { opacity: .5; filter: grayscale(.6); }
  .equipe img, .vide-slot { width: 38px; height: 38px; border-radius: 10px; flex: none; }
  .vide-slot { background: var(--panel-3); box-shadow: inset 0 0 0 1px var(--line); }
  .qui { display: flex; flex-direction: column; min-width: 0; }
  .qui b { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .qui small { font-size: 11px; color: var(--ink-3); }
  .equipe .tag { margin-left: auto; font-size: 10px; padding: 2px 7px; }
  .attente-picks { box-shadow: inset 0 0 0 1px var(--line) !important; }
  .compo { display: grid; gap: 5px; padding: 10px 12px; border-radius: 12px; background: var(--panel); box-shadow: inset 0 0 0 1px var(--line); }
  .barre-compo { display: flex; height: 6px; border-radius: 6px; overflow: hidden; gap: 2px; }
  .barre-compo i { transition: flex .6s var(--ease); }
  .ad { background: #ff8a4d; } .ap { background: #8f7bff; }
  .compo small { font-size: 11px; color: var(--ink-3); }
  .ad-t { color: #ffae85; } .ap-t { color: #b3a6ff; }
  .conseil { font-size: 11.5px; color: var(--ink-2); line-height: 1.4; }
  .bans-titre { margin-top: 4px; }
  .bans { display: flex; flex-wrap: wrap; gap: 4px; }
  .bans img { width: 26px; height: 26px; border-radius: 7px; filter: grayscale(1) brightness(.6); box-shadow: 0 0 0 1px var(--line-2); }

  .centre { display: grid; gap: 12px; min-width: 0; }
  .suggestions .etiquette { margin-bottom: 8px; }
  .cartes { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 8px; }
  .sugg {
    display: flex; flex-direction: column; gap: 7px; text-align: left; border: 0; cursor: pointer; color: inherit;
    padding: 11px 12px; border-radius: 14px; background: var(--panel); box-shadow: inset 0 0 0 1px var(--line);
    transition: box-shadow .25s, transform .3s var(--ease); animation: apparait .45s var(--ease) both; animation-delay: calc(var(--i) * 70ms);
  }
  .sugg:hover { transform: translateY(-2px); box-shadow: inset 0 0 0 1px var(--line-2), 0 14px 30px -18px rgba(0, 0, 0, .9); }
  .sugg.on { box-shadow: inset 0 0 0 1.5px var(--volt), 0 0 30px -10px var(--volt-glow); }
  .haut { display: flex; align-items: center; gap: 9px; }
  .haut img { width: 38px; height: 38px; border-radius: 10px; }
  .haut b { display: block; font-size: 13.5px; }
  .haut small { font-size: 11px; color: var(--ink-3); }
  .note { margin-left: auto; font-style: normal; font-size: 18px; font-weight: 700; color: var(--volt); }
  .jauge { height: 4px; border-radius: 4px; background: var(--panel-3); overflow: hidden; }
  .jauge i { display: block; height: 100%; background: var(--volt); transform-origin: left; transition: transform .8s var(--ease); }
  .raison { font-size: 11px; color: var(--ink-2); line-height: 1.35; }
  .raison.v { color: var(--volt); } .raison.r { color: var(--red); }

  /* Au-dessus du panneau du build : la liste des résultats déborde dessus. */
  .explorer { position: relative; z-index: 10; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; animation: apparait .4s var(--ease) .05s both; }
  .recherche { position: relative; display: flex; align-items: center; gap: 8px; padding: 0 12px; height: 40px; min-width: 260px; border-radius: 12px; background: var(--panel); box-shadow: inset 0 0 0 1px var(--line-2); color: var(--ink-3); }
  .recherche :global(svg) { width: 16px; height: 16px; flex: none; }
  .recherche:focus-within { box-shadow: inset 0 0 0 1px var(--volt-line), 0 0 24px -10px var(--volt-glow); }
  .recherche input { flex: 1; border: 0; outline: 0; background: transparent; color: var(--ink); font: inherit; font-size: 13.5px; user-select: text; }
  .recherche input::placeholder { color: var(--ink-3); }
  .resultats { position: absolute; left: 0; right: 0; top: 46px; z-index: 30; padding: 5px; border-radius: 12px; background: var(--panel-3); box-shadow: inset 0 0 0 1px var(--line-2), 0 20px 50px -12px rgba(0, 0, 0, .9); animation: apparait .2s var(--ease) both; }
  .resultats button { width: 100%; display: flex; align-items: center; gap: 10px; padding: 6px 8px; border: 0; border-radius: 8px; background: transparent; color: var(--ink); font-size: 13px; font-weight: 600; cursor: pointer; text-align: left; }
  .resultats button:hover { background: rgba(255, 255, 255, .06); }
  .resultats img { width: 28px; height: 28px; border-radius: 7px; }
  .onglets-draft { display: inline-flex; gap: 2px; padding: 4px; border-radius: 12px; background: var(--panel); box-shadow: inset 0 0 0 1px var(--line); justify-self: start; }
  .onglets-draft button { border: 0; background: transparent; padding: 6px 14px; border-radius: 8px; color: var(--ink-2); font-size: 12.5px; font-weight: 700; cursor: pointer; transition: background-color .25s, color .25s; }
  .onglets-draft button.on { background: var(--volt); color: var(--volt-ink); }
  .roles { display: inline-flex; gap: 2px; padding: 4px; border-radius: 12px; background: var(--panel); box-shadow: inset 0 0 0 1px var(--line); }
  .roles button { border: 0; background: transparent; padding: 6px 11px; border-radius: 8px; color: var(--ink-2); font-size: 12px; font-weight: 600; cursor: pointer; transition: background-color .25s, color .25s; }
  .roles button.on { background: var(--volt); color: var(--volt-ink); }
  .choisis { display: grid; justify-items: center; gap: 12px; padding: 60px 0; color: var(--ink-3); }
  .choisis .rond { width: 56px; height: 56px; display: grid; place-items: center; border-radius: 18px; background: var(--panel); box-shadow: inset 0 0 0 1px var(--line); }
  .choisis :global(svg) { width: 24px; height: 24px; }

  @media (max-width: 1150px) {
    .draft { grid-template-columns: 190px minmax(0, 1fr); }
    .eux { grid-column: 1 / -1; grid-row: 2; }
    .eux ul { grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); }
  }
</style>
