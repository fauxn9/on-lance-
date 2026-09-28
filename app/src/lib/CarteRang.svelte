<script>
  import { onMount } from 'svelte';
  import { inclinaison } from './actions.js';
  import Compteur from './Compteur.svelte';
  import { COULEUR_TIER, nomRang } from './format.js';

  let { titre, rang } = $props();
  const haut = $derived(rang && ['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(rang.tier));
  const parties = $derived(rang ? rang.victoires + rang.defaites : 0);
  const winrate = $derived(parties ? (100 * rang.victoires) / parties : 0);

  // La barre part de zéro à l'affichage, puis suit les PL en direct.
  let monte = $state(false);
  onMount(() => requestAnimationFrame(() => (monte = true)));
</script>

<section class="carte rang" style:--tier={rang ? COULEUR_TIER[rang.tier] : 'var(--ink-3)'} use:inclinaison={6}>
  <span class="reflet" aria-hidden="true"></span>
  <div class="texte">
    <p class="etiquette">{titre}</p>
    {#if rang}
      <p class="nom">{nomRang(rang.tier, rang.division)}</p>
      {#if !haut}
        <div class="barre" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={rang.lp} aria-label="Points de ligue">
          <span style:transform="scaleX({monte ? Math.min(100, rang.lp) / 100 : 0})"></span>
        </div>
      {/if}
      <p class="stats">
        <Compteur classe="mono lp" valeur={rang.lp} format={(v) => `${Math.round(v)} PL`} />
        <span class="mono"><Compteur valeur={rang.victoires} />V <Compteur valeur={rang.defaites} />D</span>
        <Compteur classe="mono {winrate >= 50 ? 'v' : ''}" valeur={winrate} format={(v) => `${Math.round(v)} %`} />
      </p>
    {:else}
      <p class="nom non">Non classé</p>
      <p class="stats dim">Pas encore de partie classée cette saison.</p>
    {/if}
  </div>
  {#if rang}
    <img class="embleme" src="/rangs/{rang.tier.toLowerCase()}.webp" alt="Emblème {nomRang(rang.tier)}" />
  {/if}
</section>

<style>
  .rang {
    --rx: 0deg; --ry: 0deg; --gx: 50%; --gy: 0%;
    position: relative; overflow: hidden; display: flex; align-items: center; gap: 10px; min-height: 132px;
    transform: perspective(900px) rotateX(var(--rx)) rotateY(var(--ry));
    transition: transform .5s var(--ease), box-shadow .3s;
    animation: apparait .6s var(--ease) both;
  }
  .rang:hover { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--tier) 40%, transparent), 0 20px 50px -24px color-mix(in srgb, var(--tier) 60%, transparent); transition: transform .12s linear, box-shadow .3s; }
  .rang::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 3px; background: var(--tier); }
  .reflet { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(420px circle at var(--gx) var(--gy), color-mix(in srgb, var(--tier) 16%, transparent), transparent 55%); opacity: .7; transition: opacity .3s; }
  .texte { position: relative; flex: 1; min-width: 0; }
  .nom { font-stretch: 118%; font-weight: 850; font-size: 23px; letter-spacing: -.02em; margin: 6px 0 12px; color: var(--tier); text-shadow: 0 0 30px color-mix(in srgb, var(--tier) 35%, transparent); white-space: nowrap; }
  .nom.non { color: var(--ink-2); font-size: 20px; text-shadow: none; }
  .barre { height: 6px; border-radius: 6px; background: var(--panel-3); overflow: hidden; }
  .barre span { display: block; height: 100%; border-radius: 6px; background: linear-gradient(90deg, color-mix(in srgb, var(--tier) 60%, #000), var(--tier)); box-shadow: 0 0 12px color-mix(in srgb, var(--tier) 60%, transparent); transform-origin: left; transition: transform 1.2s var(--ease) .15s; }
  .stats { display: flex; gap: 12px; margin-top: 10px; font-size: 12.5px; color: var(--ink-2); white-space: nowrap; }
  .stats :global(.lp) { color: var(--ink); font-weight: 700; }
  .embleme {
    position: relative; width: 104px; height: auto; flex: none; margin-right: -6px;
    filter: drop-shadow(0 10px 18px rgba(0, 0, 0, .55)) drop-shadow(0 0 18px color-mix(in srgb, var(--tier) 30%, transparent));
    transform: translateZ(30px) translate(calc(var(--ry) * -0.6), calc(var(--rx) * 0.6));
    animation: emerge .9s var(--ease) .1s both;
  }
  @keyframes emerge { from { opacity: 0; transform: scale(.7) translateY(10px); } }
</style>
