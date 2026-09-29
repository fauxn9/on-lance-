<script>
  // Ton coach : le focus du moment (une habitude repérée sur tes dernières
  // parties, un objectif chiffré, un conseil), ton suivi partie par partie,
  // la suite à travailler et tes points forts.
  import { coach, chargerCoach, groupeTexte, objectifTexte, posteTexte } from '../coach.svelte.js';
  import { ilYa } from '../format.js';
  import Icone from '../Icone.svelte';
  import Suivi from './Suivi.svelte';

  let { onpartie = null } = $props();

  const c = $derived(coach.donnees);
  const f = $derived(c?.focus);
  const poste = $derived(posteTexte(c?.role));
  const groupe = $derived(groupeTexte(c));
  const depuis = $derived(!f ? '' : Date.now() - f.depuis < 3600e3 ? 'tout juste' : `depuis ${ilYa(f.depuis).replace('il y a ', '')}`);
  const reste = $derived(f ? Math.max(1, 5 - f.serie) : 0);
</script>

{#if coach.erreur && !c}
  <div class="carte erreur"><Icone nom="alerte" /><p>{coach.erreur}</p><button class="bouton" onclick={chargerCoach}>Réessayer</button></div>
{:else if !c}
  <div class="attente"><span class="squelette a"></span><span class="squelette b"></span></div>
{:else if !c.pret}
  <section class="vide">
    <span class="rond"><Icone nom="cible" /></span>
    <h2>Le coach apprend ta façon de jouer.</h2>
    <p>
      Il lui faut au moins {c.besoin} parties sur la Faille à ton poste principal pour repérer tes habitudes :
      <b>{c.parties}</b> pour l'instant. Tes parties récentes sont analysées en fond, et chaque nouvelle partie compte.
    </p>
    <span class="progression" role="progressbar" aria-valuemin="0" aria-valuemax={c.besoin} aria-valuenow={c.parties}>
      <i style:transform="scaleX({Math.min(1, c.parties / c.besoin)})"></i>
    </span>
  </section>
{:else}
  {#if c.valide}
    <div class="valide">
      <span class="coche"><Icone nom="check" /></span>
      <p>
        <b>Focus « {c.valide.titre} » validé.</b> Tenu sur tes 5 dernières parties : c'est acquis.
        {#if f}On passe au suivant : {f.titre.toLowerCase()}.{/if}
      </p>
    </div>
  {/if}

  {#if f}
    <section class="carte focus">
      <div class="gauche">
        <p class="kicker mono">Focus du moment · {depuis}</p>
        <h2>{f.titre}</h2>
        <p class="pourquoi">
          Sur <b>{f.souvent} de tes {f.parties} dernières parties</b> {poste}, tu es dans le quart le plus bas des {groupe}.
          Toi : <b>{f.valeurTexte}</b>.
        </p>
        <div class="objectif">
          <span class="etiquette">Objectif</span>
          <b>{objectifTexte(f)}</b>
          <small>La moitié des {groupe} y arrive.</small>
        </div>
        <p class="conseil"><Icone nom="cible" /><span>{f.conseil}</span></p>
      </div>
      <div class="droite">
        <p class="etiquette">Partie après partie</p>
        <Suivi suivi={f.suivi} cible={f.cible} grand onchoisir={onpartie} />
        <p class="legende"><i class="t"></i>tenu <i class="r"></i>raté <i class="l"></i>objectif</p>
        <p class="serie">
          {#if f.serie >= 1}<b class="v">{f.serie === 1 ? 'Tenu sur ta dernière partie.' : `${f.serie} parties tenues d'affilée.`}</b>
            Encore {reste} partie{reste > 1 ? 's' : ''} comme ça et le focus est validé.
          {:else if f.suivi.length}Raté sur ta dernière partie. Garde-le en tête dès le chargement de la prochaine : on te le rappelle.
          {:else}Ta prochaine partie {poste} sera la première du suivi.{/if}
        </p>
      </div>
    </section>
  {:else}
    <section class="carte bravo">
      <span class="coche"><Icone nom="check" /></span>
      <div>
        <h2>Rien à corriger en ce moment.</h2>
        <p>Sur tes {c.parties} dernières parties {poste}, rien ne te met régulièrement dans le quart le plus bas des {groupe}. Continue comme ça.</p>
      </div>
    </section>
  {/if}

  <div class="deux">
    <section class="carte">
      <p class="etiquette">Ensuite, à travailler</p>
      {#each c.autres as a}
        <div class="point">
          <div class="ligne"><b>{a.titre}</b><small class="mono">mieux que {Math.round(a.mieuxQue * 100)} %</small></div>
          <span class="jauge" aria-hidden="true"><i style:transform="scaleX({Math.max(0.03, a.mieuxQue)})"></i></span>
          <small>Toi : {a.valeur} · visé : {a.cible}</small>
        </div>
      {:else}
        <p class="dim petit">Rien d'autre qui revienne souvent. Concentre-toi sur le focus.</p>
      {/each}
    </section>
    <section class="carte">
      <p class="etiquette">Tes points forts</p>
      {#each c.forts as a}
        <div class="point fort">
          <div class="ligne"><b>{a.titre}</b><small class="mono">mieux que {Math.round(a.mieuxQue * 100)} %</small></div>
          <span class="jauge" aria-hidden="true"><i style:transform="scaleX({a.mieuxQue})"></i></span>
          <small>Toi : {a.valeur}</small>
        </div>
      {:else}
        <p class="dim petit">Pas encore de point fort qui ressorte nettement. Ça viendra.</p>
      {/each}
    </section>
  </div>
  <p class="note dim">
    Calculé sur tes {c.parties} dernières parties {poste}, comparées aux {groupe}. Un seul focus à la fois :
    il est validé quand tu le tiens sur tes 5 dernières parties, et le suivant prend sa place.
  </p>
{/if}

<style>
  h2 { font-stretch: 120%; font-weight: 900; font-size: 26px; letter-spacing: -.02em; line-height: 1.1; }
  .kicker { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--volt); }
  .valide {
    display: flex; align-items: center; gap: 12px; padding: 12px 16px; margin-bottom: 12px; border-radius: 14px;
    background: linear-gradient(90deg, rgba(214, 255, 63, .14), var(--panel) 70%); box-shadow: inset 0 0 0 1px var(--volt-line), 0 0 40px -18px var(--volt-glow);
    font-size: 13.5px; line-height: 1.45; animation: apparait .5s var(--ease) both;
  }
  .coche { width: 30px; height: 30px; flex: none; display: grid; place-items: center; border-radius: 50%; background: var(--volt); color: var(--volt-ink); animation: coche .6s cubic-bezier(.34, 1.56, .64, 1) .2s backwards; }
  .coche :global(svg) { width: 17px; height: 17px; stroke-width: 3; }
  @keyframes coche { from { transform: scale(0) rotate(-30deg); } }
  .focus {
    display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 28px; padding: 22px; margin-bottom: 12px;
    box-shadow: inset 3px 0 0 var(--volt), inset 0 0 0 1px var(--line); animation: apparait .45s var(--ease) both;
  }
  .gauche { display: grid; gap: 12px; align-content: start; }
  .pourquoi { font-size: 13.5px; line-height: 1.5; color: var(--ink-2); }
  .pourquoi b { color: var(--ink); }
  .objectif { display: grid; gap: 3px; padding: 12px 14px; border-radius: 12px; background: var(--volt-soft); box-shadow: inset 0 0 0 1px var(--volt-line); }
  .objectif .etiquette { color: var(--volt); }
  .objectif b { font-size: 17px; }
  .objectif small { font-size: 11.5px; color: var(--ink-3); }
  .conseil { display: flex; gap: 10px; font-size: 13.5px; line-height: 1.5; }
  .conseil :global(svg) { width: 17px; height: 17px; flex: none; margin-top: 2px; color: var(--volt); }
  .droite { display: grid; gap: 10px; align-content: start; }
  .legende { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--ink-3); }
  .legende i { width: 10px; height: 10px; border-radius: 3px; margin-left: 6px; }
  .legende i:first-child { margin-left: 0; }
  .legende .t { background: var(--volt); }
  .legende .r { background: rgba(255, 77, 106, .45); }
  .legende .l { width: 14px; height: 0; border-top: 1.5px dashed rgba(214, 255, 63, .7); border-radius: 0; }
  .serie { font-size: 13px; line-height: 1.5; color: var(--ink-2); }
  .serie b { color: var(--volt); }
  .bravo { display: flex; gap: 14px; align-items: flex-start; margin-bottom: 12px; padding: 20px; }
  .bravo .coche { margin-top: 2px; }
  .bravo p { color: var(--ink-2); margin-top: 6px; line-height: 1.5; }
  .deux { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .point { display: grid; gap: 5px; padding: 11px 0; box-shadow: inset 0 -1px 0 var(--line); }
  .point:last-child { box-shadow: none; padding-bottom: 0; }
  .ligne { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
  .point b { font-size: 13.5px; }
  .point small { font-size: 11.5px; color: var(--ink-3); }
  .jauge { position: relative; height: 4px; border-radius: 4px; background: var(--panel-3); overflow: hidden; }
  .jauge::after { content: ''; position: absolute; left: 50%; top: 0; bottom: 0; width: 1.5px; background: var(--ink-3); }
  .jauge i { display: block; height: 100%; background: var(--red); transform-origin: left; animation: jauge .7s var(--ease) .15s backwards; }
  .fort .jauge i { background: var(--volt); }
  @keyframes jauge { from { transform: scaleX(0); } }
  .petit { font-size: 12px; }
  .note { font-size: 11.5px; margin-top: 12px; line-height: 1.5; }
  .attente { display: grid; gap: 12px; }
  .attente .a { height: 260px; border-radius: 16px; }
  .attente .b { height: 160px; border-radius: 16px; }
  .attente .squelette::after { animation-iteration-count: 6; }
  .vide { min-height: 380px; display: grid; place-content: center; justify-items: center; text-align: center; gap: 12px; }
  .vide .rond { width: 58px; height: 58px; display: grid; place-items: center; border-radius: 18px; background: var(--panel); box-shadow: inset 0 0 0 1px var(--line); color: var(--volt); }
  .vide .rond :global(svg) { width: 24px; height: 24px; }
  .vide p { color: var(--ink-2); max-width: 54ch; line-height: 1.5; }
  .progression { width: 220px; height: 5px; border-radius: 5px; background: var(--panel-3); overflow: hidden; margin-top: 4px; }
  .progression i { display: block; height: 100%; background: var(--volt); transform-origin: left; transition: transform .6s var(--ease); }
  .erreur { display: flex; align-items: center; gap: 12px; color: var(--gold); }
  .erreur :global(svg) { width: 18px; height: 18px; }
  .erreur p { flex: 1; }

  @media (max-width: 900px) {
    .focus { grid-template-columns: 1fr; gap: 20px; }
    .deux { grid-template-columns: 1fr; }
  }
</style>
