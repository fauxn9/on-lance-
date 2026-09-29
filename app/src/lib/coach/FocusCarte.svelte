<script>
  // La carte « Focus du moment » de l'Accueil : ce que tu travailles, ton
  // objectif, et si tu l'as tenu ces dernières parties.
  import { coach, objectifTexte } from '../coach.svelte.js';
  import Suivi from './Suivi.svelte';

  let { onvoir = () => {} } = $props();
  const c = $derived(coach.donnees);
  const f = $derived(c?.focus);
  const tenues = $derived(f ? f.suivi.slice(-10).filter((s) => s.tenu).length : 0);
</script>

<section class="carte focus">
  <div class="titre-carte">
    <p class="etiquette">Focus du moment</p>
    <button class="lien" onclick={onvoir}>Ton coach <span aria-hidden="true">→</span></button>
  </div>
  {#if !c}
    <span class="squelette l1"></span><span class="squelette l2"></span>
  {:else if !c.pret}
    <p class="dim texte">Le coach apprend ta façon de jouer : <b>{c.parties}</b> partie{c.parties > 1 ? 's' : ''} analysée{c.parties > 1 ? 's' : ''} sur les {c.besoin} dont il a besoin à ton poste.</p>
  {:else if !f}
    <p class="texte">Rien à corriger en ce moment : tu es dans la moitié haute de ton rang partout. Continue.</p>
  {:else}
    <p class="metrique">{f.titre}</p>
    <p class="objectif"><span class="tag v">Objectif</span>{objectifTexte(f)}</p>
    <Suivi suivi={f.suivi.slice(-10)} cible={f.cible} />
    <p class="bilan">
      {#if f.serie >= 2}<b class="v">{f.serie} parties tenues d'affilée</b>
      {:else}<span class="dim">Tenu sur {tenues} de tes {Math.min(10, f.suivi.length)} dernières parties</span>{/if}
    </p>
  {/if}
</section>

<style>
  .focus { display: grid; gap: 8px; align-content: start; }
  .focus .titre-carte { margin-bottom: 2px; }
  .metrique { font-stretch: 115%; font-weight: 800; font-size: 18px; letter-spacing: -.01em; }
  .objectif { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--ink-2); flex-wrap: wrap; }
  .bilan { font-size: 12px; }
  .texte { font-size: 12.5px; line-height: 1.45; }
  .l1 { height: 22px; width: 60%; } .l2 { height: 46px; }
  .squelette::after { animation-iteration-count: 6; }
</style>
