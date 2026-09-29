<script>
  // Le debrief d'après-partie (brique 7) : ta partie comparée aux joueurs de
  // ton rang à ton poste, l'écart avec ton adversaire direct minute par
  // minute, tes morts sur la carte, et trois choses à retenir.
  import { untrack } from 'svelte';
  import * as api from './api.js';
  import { onde } from './actions.js';
  import { dd } from './ddragon.svelte.js';
  import { duree, ilYa, kda, nomFile, nomPoste, signe, un } from './format.js';
  import Compteur from './Compteur.svelte';
  import Courbe from './apres/Courbe.svelte';
  import CarteMorts from './apres/CarteMorts.svelte';
  import Icone from './Icone.svelte';

  let { matchId = null, revision = 0, onchoisir = () => {} } = $props();

  let liste = $state([]);
  let chargeListe = $state(true);
  $effect(() => {
    revision;
    untrack(() => api.parties(null, 'toutes'))
      .then((r) => (liste = r.matches.slice(0, 10)))
      .catch(() => {})
      .finally(() => (chargeListe = false));
  });
  const courant = $derived(matchId ?? liste[0]?.matchId ?? null);

  let d = $state(null);
  let chargement = $state(false);
  let erreur = $state(null);
  let essai = $state(0);
  $effect(() => {
    const id = courant;
    essai;
    if (!id) return;
    chargement = true;
    erreur = null;
    untrack(() => api.debrief(id))
      .then((r) => { if (id === courant) d = r; })
      .catch((e) => { if (id === courant) erreur = String(e); })
      .finally(() => { if (id === courant) chargement = false; });
  });

  let onglet = $state('or');
  const ONGLETS = [['or', 'Or', 'PO'], ['xp', 'XP', 'XP'], ['cs', 'CS', 'CS']];
  const mesure = (cle) => d?.mesures?.find((m) => m.cle === cle);
  const champ = $derived(d ? dd.champion(d.moi.championId, d.moi.championName) : null);
  const face = $derived(d?.face ? dd.champion(d.face.championId, d.face.championName) : null);
  const issue = $derived(!d ? '' : d.remake ? 'remake' : d.win ? 'victoire' : 'defaite');
  const k = (n) => (n >= 1000 ? `${un(n / 1000)}k` : String(n));
  const nf = new Intl.NumberFormat('fr-FR');
  const ecart = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${nf.format(Math.abs(Math.round(v)))}`;

  // Le pire moment de la courbe choisie, pour la légende.
  const creux = $derived.by(() => {
    const v = d?.courbes?.[onglet];
    if (!v?.length) return null;
    let i = 0;
    v.forEach((x, j) => { if (x < v[i]) i = j; });
    return v[i] < 0 ? { minute: i, valeur: v[i] } : null;
  });
  const unite = $derived(ONGLETS.find((o) => o[0] === onglet)[2]);

  const TUILES = [
    { cle: 'morts', nom: 'KDA', val: (d) => `${d.moi.kills}/${d.moi.deaths}/${d.moi.assists}`, sous: (d) => `${kda(d.moi.kills, d.moi.deaths, d.moi.assists)} KDA`, phrase: 'moins de morts que' },
    { cle: 'csm', nom: 'CS/min', nombre: (d) => d.moi.csm, format: (v) => un(v), val: (d) => un(d.moi.csm), sous: (d) => `${d.moi.cs} CS`, phrase: 'mieux que' },
    { cle: 'degats', nom: 'Dégâts', nombre: (d) => d.moi.degats, format: (v) => k(Math.round(v)), val: (d) => k(d.moi.degats), sous: () => 'aux champions', phrase: 'mieux que' },
    { cle: 'vision', nom: 'Vision', nombre: (d) => d.moi.vision, format: (v) => String(Math.round(v)), val: (d) => String(d.moi.vision), sous: (d) => `${un(d.moi.vision / d.minutes)}/min`, phrase: 'mieux que' },
    { cle: 'kp', nom: 'Participation', nombre: (d) => d.moi.kp * 100, format: (v) => `${Math.round(v)} %`, val: (d) => `${Math.round(d.moi.kp * 100)} %`, sous: () => 'aux kills', phrase: 'mieux que' },
    { cle: 'objectifs', nom: 'Objectifs', val: (d) => `${d.objectifs.moi}/${d.objectifs.equipe}`, sous: () => 'de ton équipe', phrase: 'mieux que' },
  ];
  const NOMS_OBJ = { dragon: 'Dragon', ancien: 'Dragon ancien', baron: 'Baron', heraut: 'Héraut', larves: 'Larves', atakhan: 'Atakhan', monstre: 'Monstre épique' };
</script>

{#if !chargeListe && !liste.length}
  <section class="vide">
    <span class="rond"><Icone nom="courbe" /></span>
    <h1>Pas encore de partie à analyser.</h1>
    <p>Joue une partie : à la fin, ton debrief s'ouvre ici tout seul. Écart avec ton adversaire, tes morts sur la carte, et trois choses à retenir.</p>
  </section>
{:else}
  <nav class="choix" aria-label="Choisir une partie">
    {#each liste as m, i (m.matchId)}
      {@const c = dd.champion(m.championId, m.championName)}
      <button
        class="puce {m.remake ? 'remake' : m.win ? 'victoire' : 'defaite'}" class:on={m.matchId === courant}
        onclick={() => onchoisir(m.matchId)} use:onde style:--i={i}
        title="{c.nom} · {m.win ? 'Victoire' : 'Défaite'} · {ilYa(m.gameStart)}"
      >
        {#if c.icone}<img src={c.icone} alt={c.nom} />{/if}
      </button>
    {/each}
  </nav>

  {#if erreur && !chargement}
    <div class="carte erreur">
      <Icone nom="alerte" />
      <p>{erreur}</p>
      <button class="bouton" onclick={() => essai++} use:onde>Réessayer</button>
    </div>
  {:else if !d || (chargement && d?.matchId !== courant)}
    <div class="squelettes" aria-busy="true">
      <span class="squelette s-banniere"></span>
      <div class="s-tuiles">{#each Array(6) as _}<span class="squelette"></span>{/each}</div>
      <div class="s-grille"><span class="squelette"></span><span class="squelette"></span></div>
      <p class="dim mono analyse">Analyse de la partie…</p>
    </div>
  {:else}
    {#key d.matchId}
      <header class="banniere {issue}">
        {#if champ.splash}<img class="splash" src={champ.splash} alt="" />{/if}
        <span class="voile"></span>
        <div class="gauche">
          {#if champ.icone}<img class="portrait" src={champ.icone} alt="" />{/if}
          <div>
            <p class="kicker mono">{nomFile(d.queue)} · {ilYa(d.debut)}</p>
            <h1>{d.remake ? 'Remake' : d.win ? 'Victoire' : 'Défaite'}</h1>
            <p class="tags">
              <span class="tag">{duree(d.duree)}</span>
              <span class="tag">{champ.nom}{d.moi.role ? ` · ${nomPoste(d.moi.role)}` : ''}</span>
              {#if d.lp != null}<span class="tag" class:v={d.lp > 0} class:r={d.lp < 0}>{signe(d.lp)} PL</span>{/if}
            </p>
          </div>
        </div>
        {#if d.groupe}
          <p class="groupe">
            <small>Comparé aux joueurs</small>
            <b>{d.groupe.nom} · {nomPoste(d.groupe.poste)}</b>
            {#if !d.groupe.propre}<small class="dim">ton rang manque encore de parties</small>{/if}
          </p>
        {/if}
      </header>

      <section class="tuiles">
        {#each TUILES as t, i}
          {@const m = mesure(t.cle)}
          <div class="tuile" style:--i={i}>
            <small class="etiquette">{t.nom}</small>
            {#if t.nombre}<b class="mono"><Compteur valeur={t.nombre(d)} format={t.format} /></b>{:else}<b class="mono">{t.val(d)}</b>{/if}
            <small class="sous">{t.sous(d)}</small>
            {#if m}
              <span class="barre" class:bien={m.mieuxQue >= 0.5}><i style:transform="scaleX({m.mieuxQue})"></i></span>
              <small class="rang">{t.phrase} <Compteur valeur={m.mieuxQue * 100} format={(v) => `${Math.round(v)} %`} /></small>
            {/if}
          </div>
        {/each}
      </section>
      {#if d.groupe && !d.mesures.length}
        <p class="note dim">Les repères de ton rang se construisent : la comparaison apparaîtra dès qu'assez de parties seront analysées.</p>
      {/if}

      <div class="grille">
        <section class="carte ecart">
          <div class="titre-carte">
            <p class="etiquette">
              {#if face}Écart avec
                {#if face.icone}<img src={face.icone} alt="" />{/if}<b>{face.nom}</b>
              {:else}Pas d'adversaire direct dans ce mode{/if}
            </p>
            {#if face}
              <div class="onglets" role="tablist">
                {#each ONGLETS as [id, nom]}
                  <button role="tab" aria-selected={onglet === id} class:on={onglet === id} onclick={() => (onglet = id)}>{nom}</button>
                {/each}
              </div>
            {/if}
          </div>
          {#if face && d.courbes[onglet]?.length > 2}
            <Courbe valeurs={d.courbes[onglet]} morts={d.morts} {unite} />
            <p class="legende">
              {#if creux}<span class="r mono">{creux.minute} min</span> ton plus gros retard : {ecart(creux.valeur)} {unite}.{:else}<span class="v">Jamais derrière {face.nom}.</span>{/if}
              <span class="dim">Points rouges : tes morts.</span>
            </p>
          {:else if !face}
            <p class="dim vide-courbe">En ARAM et dans les modes sans poste, il n'y a pas de duel à suivre.</p>
          {/if}
        </section>

        <section class="carte retenir">
          <div class="titre-carte">
            <p class="etiquette">À retenir</p>
            {#if d.ia}<span class="tag ia" title="Les faits viennent des règles d'On lance ?, la formulation d'une IA.">formulé par IA</span>{/if}
          </div>
          {#each d.retenir as r, i}
            <p class="conseil" class:positif={r.ton === 'v'} style:--i={i}><span class="n mono">{i + 1}</span>{r.texte}</p>
          {:else}
            <p class="dim">{d.remake ? 'Partie écourtée : rien à retenir.' : 'Rien de marquant cette partie : ni gros écart, ni erreur qui coûte.'}</p>
          {/each}
        </section>
      </div>

      <section class="carte morts">
        <div class="titre-carte">
          <p class="etiquette">Tes morts</p>
          {#if d.objectifs.equipe}<span class="dim obj-resume">Présent sur <b>{d.objectifs.moi}</b> des <b>{d.objectifs.equipe}</b> objectifs de ton équipe</span>{/if}
        </div>
        <CarteMorts morts={d.morts} />
        {#if d.objectifs.liste.length}
          <div class="frise" aria-label="Objectifs de la partie">
            <span class="axe"></span>
            {#each d.objectifs.liste as o}
              <span class="obj" class:nous={o.nous} style:left="{Math.min(98, (o.t / 1000 / d.duree) * 100)}%" title="{NOMS_OBJ[o.genre] ?? o.genre} à {Math.floor(o.t / 60000)} min, {o.nous ? 'pour ton équipe' : "pour l'adversaire"}"></span>
            {/each}
            {#each d.morts as m}
              <span class="mort-frise" style:left="{Math.min(98, (m.t / 1000 / d.duree) * 100)}%"></span>
            {/each}
          </div>
          <p class="legende-frise dim"><i class="c nous"></i>objectif pris par ton équipe <i class="c eux"></i>par l'adversaire <i class="c mort"></i>ta mort</p>
        {/if}
      </section>
    {/key}
  {/if}
{/if}

<style>
  .choix { display: flex; gap: 6px; margin-bottom: 14px; flex-wrap: wrap; }
  .puce { position: relative; width: 38px; height: 38px; padding: 0; border: 0; border-radius: 11px; cursor: pointer; background: var(--panel); box-shadow: inset 0 0 0 1px var(--line); transition: transform .25s var(--ease), box-shadow .25s; animation: apparait .35s var(--ease) both; animation-delay: calc(var(--i) * 30ms); }
  .puce img { width: 100%; height: 100%; border-radius: 11px; opacity: .6; transition: opacity .25s; }
  .puce::after { content: ""; position: absolute; left: 8px; right: 8px; bottom: -4px; height: 2px; border-radius: 2px; background: var(--ink-3); }
  .puce.victoire::after { background: var(--volt); } .puce.defaite::after { background: var(--red); }
  .puce:hover { transform: translateY(-2px); } .puce:hover img, .puce.on img { opacity: 1; }
  .puce.on { box-shadow: inset 0 0 0 2px var(--volt), 0 0 18px -6px var(--volt-glow); }

  .banniere { position: relative; overflow: hidden; display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; min-height: 138px; padding: 18px 20px; border-radius: 18px; margin-bottom: 12px; background: var(--panel); box-shadow: inset 0 0 0 1px var(--line); animation: apparait .45s var(--ease) both; }
  .splash { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: 50% 22%; opacity: .5; animation: zoom 1.4s var(--ease) both; }
  @keyframes zoom { from { transform: scale(1.08); opacity: 0; } }
  .voile { position: absolute; inset: 0; background: linear-gradient(90deg, rgba(6, 7, 9, .92) 25%, rgba(6, 7, 9, .45) 70%, rgba(6, 7, 9, .7)); }
  .banniere.victoire { box-shadow: inset 3px 0 0 var(--volt), inset 0 0 0 1px var(--line); }
  .banniere.defaite { box-shadow: inset 3px 0 0 var(--red), inset 0 0 0 1px var(--line); }
  .gauche { position: relative; display: flex; align-items: center; gap: 16px; }
  .portrait { width: 64px; height: 64px; border-radius: 16px; box-shadow: 0 0 0 2px rgba(255, 255, 255, .12); }
  .kicker { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--ink-3); margin-bottom: 2px; }
  h1 { font-stretch: 122%; font-weight: 900; font-size: 32px; letter-spacing: -.03em; line-height: 1.05; }
  .victoire h1 { color: var(--volt); } .defaite h1 { color: var(--red); }
  .tags { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
  .groupe { position: relative; display: grid; justify-items: end; text-align: right; font-size: 12px; }
  .groupe small { color: var(--ink-3); } .groupe b { font-size: 13.5px; }

  .tuiles { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 8px; margin-bottom: 12px; }
  .tuile { display: grid; gap: 2px; align-content: start; padding: 12px; border-radius: 14px; background: var(--panel); box-shadow: inset 0 0 0 1px var(--line); animation: apparait .45s var(--ease) both; animation-delay: calc(80ms + var(--i) * 45ms); }
  .tuile b { font-size: 20px; font-weight: 700; letter-spacing: -.02em; }
  .sous { font-size: 11px; color: var(--ink-3); }
  .barre { height: 4px; border-radius: 4px; background: var(--panel-3); overflow: hidden; margin-top: 8px; }
  .barre i { display: block; height: 100%; background: var(--red); transform-origin: left; transition: transform 1s var(--ease); }
  .barre.bien i { background: var(--volt); }
  .rang { font-size: 10.5px; color: var(--ink-2); }
  .note { font-size: 12px; margin: -4px 0 12px; }

  .grille { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr); gap: 12px; margin-bottom: 12px; }
  .ecart .etiquette { display: flex; align-items: center; gap: 6px; }
  .ecart .etiquette img { width: 20px; height: 20px; border-radius: 6px; }
  .ecart .etiquette b { color: var(--ink); text-transform: none; letter-spacing: 0; font-size: 12.5px; }
  .onglets { display: inline-flex; gap: 2px; padding: 3px; border-radius: 10px; background: var(--bg-2); box-shadow: inset 0 0 0 1px var(--line); }
  .onglets button { border: 0; background: transparent; color: var(--ink-3); font-size: 11.5px; font-weight: 700; padding: 4px 10px; border-radius: 7px; cursor: pointer; transition: background-color .2s, color .2s; }
  .onglets button.on { background: var(--volt); color: var(--volt-ink); }
  .legende { margin-top: 8px; font-size: 12px; color: var(--ink-2); display: flex; gap: 10px; flex-wrap: wrap; }
  .vide-courbe { font-size: 12.5px; padding: 30px 0; }

  .retenir { display: grid; align-content: start; gap: 10px; }
  .retenir .titre-carte { margin-bottom: 0; }
  .tag.ia { font-size: 10px; color: var(--ink-3); }
  .conseil { display: flex; gap: 10px; font-size: 13.5px; line-height: 1.45; animation: apparait .45s var(--ease) both; animation-delay: calc(250ms + var(--i) * 90ms); }
  .n { flex: none; width: 24px; height: 24px; display: grid; place-items: center; border-radius: 8px; font-size: 12px; font-weight: 800; background: var(--red-soft); color: var(--red); box-shadow: inset 0 0 0 1px rgba(255, 77, 106, .3); }
  .positif .n { background: var(--volt-soft); color: var(--volt); box-shadow: inset 0 0 0 1px var(--volt-line); }

  .morts { container-type: inline-size; }
  .obj-resume { font-size: 12px; } .obj-resume b { color: var(--ink); }
  .frise { position: relative; height: 22px; margin-top: 14px; }
  .axe { position: absolute; left: 0; right: 0; top: 10px; height: 2px; border-radius: 2px; background: var(--panel-3); }
  .obj { position: absolute; top: 5px; width: 11px; height: 11px; translate: -50% 0; rotate: 45deg; border-radius: 2px; background: var(--red); box-shadow: 0 0 0 2px var(--panel); }
  .obj.nous { background: var(--blue); }
  .mort-frise { position: absolute; top: 3px; width: 2px; height: 16px; translate: -50% 0; background: var(--red); opacity: .6; }
  .legende-frise { display: flex; align-items: center; gap: 6px; font-size: 11px; margin-top: 4px; }
  .c { width: 9px; height: 9px; display: inline-block; border-radius: 2px; margin-left: 6px; }
  .c.nous { background: var(--blue); rotate: 45deg; } .c.eux { background: var(--red); rotate: 45deg; } .c.mort { width: 2px; height: 11px; background: var(--red); }

  .erreur { display: flex; align-items: center; gap: 12px; color: var(--gold); }
  .erreur :global(svg) { width: 18px; height: 18px; flex: none; }
  .erreur p { flex: 1; font-size: 13px; }

  .squelettes { display: grid; gap: 12px; }
  .squelettes .squelette::after { animation-iteration-count: 8; }
  .s-banniere { height: 138px; border-radius: 18px; }
  .s-tuiles { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; }
  .s-tuiles span { height: 96px; border-radius: 14px; }
  .s-grille { display: grid; grid-template-columns: 1.55fr 1fr; gap: 12px; }
  .s-grille span { height: 280px; border-radius: 14px; }
  .analyse { font-size: 12px; }

  .vide { min-height: 440px; display: grid; place-content: center; justify-items: center; text-align: center; gap: 12px; }
  .vide .rond { width: 60px; height: 60px; display: grid; place-items: center; border-radius: 18px; background: var(--panel); box-shadow: inset 0 0 0 1px var(--line); color: var(--volt); }
  .vide :global(svg) { width: 26px; height: 26px; }
  .vide h1 { font-size: 28px; }
  .vide p { color: var(--ink-2); max-width: 48ch; }

  @media (max-width: 1100px) {
    .tuiles, .s-tuiles { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .grille { grid-template-columns: minmax(0, 1fr); }
  }
</style>
