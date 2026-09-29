<script>
  // Écran de chargement (brique 5) : les deux équipes face à face, voie par
  // voie, comme l'écran du jeu. Les fiches se remplissent au fil de l'analyse
  // du serveur (rangs, maîtrises, duos, forme).
  import * as api from './api.js';
  import { partie } from './partie.svelte.js';
  import { coach, objectifTexte } from './coach.svelte.js';
  import { COULEUR_TIER, duree as formatDuree, nomFile, nomPoste, rangDepuisEchelle } from './format.js';
  import Fiche from './partie/Fiche.svelte';
  import Icone from './Icone.svelte';

  let { client } = $props();

  const POSTES = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
  const ETAPES = [['rangs', 'Rangs'], ['maitrises', 'Maîtrises'], ['duos', 'Duos'], ['forme', 'Forme']];
  const COULEURS_DUO = ['#ffc857', '#c77dff', '#4fd1c5', '#ff8a4d', '#ff7ac6', '#8fd3ff'];

  const d = $derived(partie.donnees);
  const enPartie = $derived(client.etape === 'chargement' || client.etape === 'en_jeu');
  const moi = $derived(d?.joueurs.find((j) => j.moi));
  const monCamp = $derived(moi?.equipe ?? d?.joueurs[0]?.equipe);
  const nous = $derived(d?.joueurs.filter((j) => j.equipe === monCamp) ?? []);
  const eux = $derived(d?.joueurs.filter((j) => j.equipe !== monCamp) ?? []);
  const faille = $derived(d?.map === 11 && nous.length === 5 && eux.length === 5 && [...nous, ...eux].every((j) => j.poste));
  const maVoie = $derived(faille && moi ? POSTES.indexOf(moi.poste) : -1);

  function moyenne(equipe) {
    const l = equipe.map((j) => j.rang?.ladder).filter((x) => x != null);
    return l.length >= 2 ? rangDepuisEchelle(l.reduce((s, x) => s + x, 0) / l.length) : null;
  }
  const moyNous = $derived(moyenne(nous));
  const moyEux = $derived(moyenne(eux));
  const duos = (equipe) => new Set(equipe.map((j) => j.duo?.groupe).filter(Boolean)).size;

  const couleur = (j) => (j.duo ? COULEURS_DUO[(j.duo.groupe - 1) % COULEURS_DUO.length] : null);
  const partenaires = (j) => (j.duo ? d.joueurs.filter((x) => x !== j && x.duo?.groupe === j.duo.groupe).map((x) => x.riotId?.split('#')[0] ?? '?') : []);
  let survol = $state(null);

  // Titre et chrono selon le moment de la partie.
  const titre = $derived(client.etape === 'chargement' ? 'La partie se lance' : client.etape === 'en_jeu' ? 'Partie en cours' : 'Dernière partie');
  // Chrono en jeu : l'horloge du jeu lui-même (même si l'app a été ouverte en
  // pleine partie), relue toutes les 30 s, et qui avance entre deux lectures.
  let maintenant = $state(Date.now());
  let repere = $state(null); // { jeu: secondes de jeu, a: Date.now() de la lecture }
  $effect(() => {
    if (client.etape !== 'en_jeu') { repere = null; return; }
    const lire = () => api.tempsDeJeu().then((s) => { if (s != null) repere = { jeu: s, a: Date.now() }; }).catch(() => {});
    lire();
    const t = setInterval(() => (maintenant = Date.now()), 1000);
    const r = setInterval(lire, 30_000);
    return () => { clearInterval(t); clearInterval(r); };
  });
  const chrono = $derived(client.etape === 'en_jeu' && repere ? formatDuree(Math.max(0, Math.floor(repere.jeu + (maintenant - repere.a) / 1000))) : null);

  // Un éclat traverse le plateau quand la dernière info arrive (une fois).
  let balaye = $state(false);
  let avant = null;
  $effect(() => {
    const cle = d ? `${d.gameId}:${d.complet}` : null;
    if (avant && d?.complet && avant === `${d.gameId}:false`) {
      balaye = true;
      setTimeout(() => (balaye = false), 1400);
    }
    avant = cle;
  });

  // Le focus du moment, rappelé pendant le chargement (sur la Faille).
  const focus = $derived(enPartie && d?.map === 11 ? coach.donnees?.focus : null);

  const secondes = (ms) => (ms / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
</script>

{#if d}
  <header class="tete">
    <div>
      <p class="kicker mono">{nomFile(d.queue)}{chrono ? ` · ${chrono}` : ''}</p>
      <h1>{titre}</h1>
    </div>
    {#if focus}
      <div class="rappel" title={focus.conseil}>
        <span class="ico"><Icone nom="cible" /></span>
        <span class="txt"><small>Ton focus · {focus.titre}</small><b>{objectifTexte(focus)}</b></span>
      </div>
    {/if}
    <div class="analyse" class:fini={d.complet}>
      <ol aria-label="Analyse des joueurs">
        {#each ETAPES as [cle, nom], k}
          <li class:ok={d.etapes[cle]} style:--k={k}>
            <span class="coche">{#if d.etapes[cle]}<Icone nom="check" />{/if}</span>{nom}
          </li>
        {/each}
      </ol>
      <p class="mono temps">
        {#if d.complet}Analysé en <b>{secondes(d.duree)} s</b>{:else}Analyse… {secondes(d.duree)} s{/if}
      </p>
    </div>
  </header>

  {#if d.erreur}<p class="alerte"><Icone nom="alerte" />{d.erreur} Les infos déjà reçues restent affichées.</p>{/if}

  <div class="plateau" class:balaye class:faille>
    <section class="camp nous" aria-label="Ton équipe">
      <header class="entete">
        <span class="pastille"></span><b>Ton équipe</b>
        {#if moyNous}<span class="moy">Rang moyen <b style:color={COULEUR_TIER[moyNous.tier]}>{moyNous.nom}</b></span>{/if}
        {#if duos(nous)}<span class="moy">{duos(nous) > 1 ? `${duos(nous)} groupes` : 'Un duo'}</span>{/if}
      </header>
      <div class="rangee">
        {#each nous as j, i (`${j.riotId}:${j.championId}`)}
          <Fiche {j} etapes={d.etapes} cote="nous" {i} couleurDuo={couleur(j)} partenaires={partenaires(j)} eclaire={survol != null && j.duo?.groupe === survol} onsurvol={(g) => (survol = g)} />
        {/each}
      </div>
    </section>

    {#if faille}
      <div class="voies" aria-hidden="true">
        {#each POSTES as p, k}
          <span class:mienne={k === maVoie}>{nomPoste(p)}{#if k === maVoie}<em>ton duel</em>{/if}</span>
        {/each}
      </div>
    {:else}
      <div class="contre" aria-hidden="true"><span>contre</span></div>
    {/if}

    <section class="camp eux" aria-label="Équipe adverse">
      <div class="rangee">
        {#each eux as j, i (`${j.riotId}:${j.championId}`)}
          <Fiche {j} etapes={d.etapes} cote="eux" i={i + 3} couleurDuo={couleur(j)} partenaires={partenaires(j)} eclaire={survol != null && j.duo?.groupe === survol} onsurvol={(g) => (survol = g)} />
        {/each}
      </div>
      <header class="entete">
        <span class="pastille"></span><b>En face</b>
        {#if moyEux}<span class="moy">Rang moyen <b style:color={COULEUR_TIER[moyEux.tier]}>{moyEux.nom}</b></span>{/if}
        {#if duos(eux)}<span class="moy">{duos(eux) > 1 ? `${duos(eux)} groupes` : 'Un duo'}</span>{/if}
      </header>
    </section>
  </div>
  {#if !enPartie}
    <p class="note dim">Partie terminée. Elle reste ici jusqu'à la prochaine ; le détail arrive dans l'historique.</p>
  {/if}
{:else if enPartie}
  <header class="tete">
    <div>
      <p class="kicker mono">{client.etape === 'chargement' ? 'Écran de chargement' : 'En jeu'}</p>
      <h1>On cherche ta partie…</h1>
    </div>
  </header>
  <p class="dim sous">{partie.erreur ?? "Riot met parfois quelques secondes à publier une partie qui démarre."}</p>
  <div class="plateau fantome" aria-hidden="true">
    {#each [0, 1] as c}
      <div class="rangee">{#each [0, 1, 2, 3, 4] as i}<span class="squelette carte-vide" style:--i={i + c * 5}></span>{/each}</div>
      {#if c === 0}<div class="contre"><span>contre</span></div>{/if}
    {/each}
  </div>
{:else}
  <section class="vide">
    <div class="cartes-deco" aria-hidden="true">
      {#each [0, 1, 2, 3, 4] as i}<span style:--i={i}></span>{/each}
    </div>
    <h1>Aucune partie en cours.</h1>
    <p>Lance une partie : pendant l'écran de chargement, cet onglet s'ouvre tout seul avec les 10 joueurs analysés. Rang, maîtrise du champion, forme récente, duos.</p>
    <p class="mono dim petit">Tout arrive avant la fin du chargement. Gratuit, évidemment.</p>
  </section>
{/if}

<style>
  .tete { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 14px; animation: apparait .4s var(--ease) both; }
  .kicker { font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: var(--volt); margin-bottom: 4px; }
  h1 { font-stretch: 122%; font-weight: 900; font-size: 28px; letter-spacing: -.03em; }
  .sous { font-size: 13px; margin: -6px 0 16px; }

  /* Le focus du coach : discret, entre le titre et l'analyse. */
  .rappel {
    flex: 0 1 auto; min-width: 0; margin-right: auto; display: flex; align-items: center; gap: 10px; padding: 7px 14px 7px 8px; border-radius: 12px;
    background: var(--volt-soft); box-shadow: inset 0 0 0 1px var(--volt-line); animation: apparait .5s var(--ease) .3s both;
  }
  .rappel .ico { width: 26px; height: 26px; flex: none; display: grid; place-items: center; border-radius: 8px; background: var(--volt); color: var(--volt-ink); }
  .rappel .ico :global(svg) { width: 15px; height: 15px; stroke-width: 2.4; }
  .rappel .txt { display: grid; min-width: 0; }
  .rappel small, .rappel b { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .rappel small { font-size: 10.5px; color: var(--volt); font-weight: 650; }
  .rappel b { font-size: 12.5px; }
  .analyse { display: grid; justify-items: end; gap: 6px; }
  .analyse ol { display: flex; gap: 4px; padding: 4px; border-radius: 12px; background: var(--panel); box-shadow: inset 0 0 0 1px var(--line); }
  .analyse li { display: flex; align-items: center; gap: 6px; padding: 5px 10px 5px 6px; border-radius: 8px; font-size: 12px; font-weight: 600; color: var(--ink-3); transition: color .3s, background-color .3s; }
  .analyse li.ok { color: var(--ink); background: rgba(255, 255, 255, .04); }
  .coche { width: 16px; height: 16px; display: grid; place-items: center; border-radius: 50%; box-shadow: inset 0 0 0 1.5px var(--line-2); transition: background-color .3s, box-shadow .3s; }
  .ok .coche { background: var(--volt); box-shadow: 0 0 12px -2px var(--volt-glow); color: var(--volt-ink); animation: coche .45s cubic-bezier(.34, 1.56, .64, 1); }
  .coche :global(svg) { width: 11px; height: 11px; stroke-width: 3.5; }
  @keyframes coche { from { transform: scale(.3); } }
  .temps { font-size: 11px; color: var(--ink-3); }
  .fini .temps b { color: var(--volt); }

  .alerte { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; font-size: 12.5px; color: var(--gold); }
  .alerte :global(svg) { width: 16px; height: 16px; }

  /* La hauteur des fiches suit celle de la fenêtre : les deux camps tiennent
     à l'écran sans défiler, sauf dans une toute petite fenêtre. */
  .plateau { --haut-fiche: clamp(214px, calc((100vh - 300px) / 2), 300px); position: relative; display: grid; gap: 8px; }
  .rangee { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; }
  .entete { display: flex; align-items: center; gap: 10px; font-size: 12.5px; }
  .nous .entete { margin-bottom: 8px; }
  .eux .entete { margin-top: 8px; }
  .pastille { width: 8px; height: 8px; border-radius: 50%; background: var(--blue); box-shadow: 0 0 10px var(--blue); }
  .eux .pastille { background: var(--red); box-shadow: 0 0 10px var(--red); }
  .moy { color: var(--ink-3); font-size: 12px; }
  .moy b { font-weight: 700; }
  .entete b + .moy { margin-left: auto; }
  .moy + .moy::before { content: "·"; margin-right: 10px; color: var(--line-2); }

  .voies { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; }
  .voies span { position: relative; display: flex; align-items: center; justify-content: center; gap: 6px; height: 20px; font-size: 10.5px; font-weight: 750; letter-spacing: .14em; text-transform: uppercase; color: var(--ink-3); }
  .voies span::before, .voies span::after { content: ""; flex: 1; height: 1px; background: linear-gradient(90deg, transparent, var(--line-2)); }
  .voies span::after { background: linear-gradient(-90deg, transparent, var(--line-2)); }
  .voies span.mienne { color: var(--volt); }
  .voies span.mienne::before { background: linear-gradient(90deg, transparent, var(--volt-line)); }
  .voies span.mienne::after { background: linear-gradient(-90deg, transparent, var(--volt-line)); }
  .voies em { font-style: normal; font-weight: 600; letter-spacing: .02em; text-transform: none; font-size: 10.5px; opacity: .8; }
  .contre { display: flex; align-items: center; gap: 12px; height: 20px; font-size: 10.5px; font-weight: 750; letter-spacing: .2em; text-transform: uppercase; color: var(--ink-3); }
  .contre::before, .contre::after { content: ""; flex: 1; height: 1px; background: var(--line-2); }

  /* Fin de l'analyse : un éclat traverse le plateau, une seule fois. */
  .plateau::after {
    content: ""; position: absolute; inset: -10px; pointer-events: none; opacity: 0;
    background: linear-gradient(100deg, transparent 35%, rgba(var(--volt-rgb), .09) 48%, rgba(var(--volt-rgb), .16) 50%, rgba(var(--volt-rgb), .09) 52%, transparent 65%);
    transform: translateX(-70%);
  }
  .plateau.balaye::after { animation: balaye 1.3s var(--ease) forwards; }
  @keyframes balaye { 0% { opacity: 1; transform: translateX(-70%); } 100% { opacity: 1; transform: translateX(70%); } }

  .fantome .carte-vide { display: block; height: var(--haut-fiche); border-radius: 16px; animation: apparait .5s var(--ease) backwards; animation-delay: calc(var(--i) * 50ms); }
  .fantome .carte-vide::after { animation-iteration-count: 6; }
  .fantome .contre { margin: 4px 0; }

  .note { margin-top: 12px; font-size: 12px; }

  .vide { position: relative; min-height: 460px; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 12px; }
  .vide h1 { font-size: 32px; }
  .vide p { color: var(--ink-2); max-width: 50ch; font-size: 14px; }
  .vide .petit { font-size: 12px; color: var(--ink-3); }
  .cartes-deco { position: relative; width: 250px; height: 130px; margin-bottom: 10px; }
  .cartes-deco span {
    position: absolute; left: 50%; bottom: 0; width: 64px; height: 108px; margin-left: -32px; border-radius: 12px;
    background: linear-gradient(180deg, var(--panel-3), var(--panel)); box-shadow: inset 0 0 0 1px var(--line-2), 0 16px 30px -18px rgba(0, 0, 0, .9);
    transform-origin: 50% 160%; transform: rotate(calc((var(--i) - 2) * 11deg));
    animation: eventail .8s var(--ease) backwards; animation-delay: calc(var(--i) * 70ms);
  }
  .cartes-deco span:nth-child(3) { background: linear-gradient(180deg, color-mix(in srgb, var(--volt) 12%, var(--panel)), var(--panel)); box-shadow: inset 0 0 0 1px var(--volt-line), 0 0 40px -12px var(--volt-glow); z-index: 1; }
  @keyframes eventail { from { transform: rotate(0deg) translateY(20px); opacity: 0; } }

  /* Fenêtre basse : en-tête compact et cartes un peu plus courtes, pour que
     les deux équipes tiennent sans défiler. */
  @media (max-height: 720px) {
    .tete { margin-bottom: 8px; }
    h1 { font-size: 22px; }
    .kicker { margin-bottom: 2px; }
    .plateau { --haut-fiche: clamp(176px, calc((100vh - 276px) / 2), 300px); gap: 4px; }
    .nous .entete { margin-bottom: 4px; }
    .eux .entete { margin-top: 4px; }
  }

  @media (max-width: 1100px) {
    .rangee, .voies { gap: 8px; }
    .analyse li { padding: 5px 8px 5px 5px; font-size: 11.5px; }
  }
</style>
