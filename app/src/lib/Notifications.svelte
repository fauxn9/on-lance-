<script>
  import { fly, fade } from 'svelte/transition';
  import { backOut } from 'svelte/easing';
  import { flip } from 'svelte/animate';
  import { fermer, notifications } from './notifications.svelte.js';
  import Compteur from './Compteur.svelte';
  import { nomRang, signe } from './format.js';
  import Icone from './Icone.svelte';
</script>

<div class="pile" aria-live="polite">
  {#each notifications as n (n.id)}
    <div
      class="note {n.ton ?? ''}"
      role="status"
      in:fly={{ x: 60, duration: 550, easing: backOut }}
      out:fade={{ duration: 180 }}
      animate:flip={{ duration: 300 }}
    >
      {#if n.type === 'partie'}
        {#if n.rang}<img class="embleme" src="/rangs/{n.rang.tier.toLowerCase()}.webp" alt="" />{/if}
        <div class="texte">
          <p class="titre">{n.titre}</p>
          {#if n.delta != null}
            <p class="delta mono"><Compteur valeur={n.delta} format={(v) => `${signe(Math.round(v))} PL`} duree={1400} /></p>
          {/if}
          {#if n.rang}<p class="sous">{nomRang(n.rang.tier, n.rang.division)} · {n.rang.lp} PL</p>{:else if n.texte}<p class="sous">{n.texte}</p>{/if}
        </div>
      {:else}
        <span class="ico"><Icone nom={n.icone ?? 'check'} /></span>
        <div class="texte">
          <p class="titre">{n.titre}</p>
          {#if n.texte}<p class="sous">{n.texte}</p>{/if}
        </div>
      {/if}
      <button class="x" onclick={() => fermer(n.id)} aria-label="Fermer la notification">×</button>
      <span class="temps" style:animation-duration="{n.duree}ms"></span>
    </div>
  {/each}
</div>

<style>
  .pile { position: fixed; right: 18px; bottom: 18px; z-index: 50; display: flex; flex-direction: column; gap: 10px; width: 330px; pointer-events: none; }
  .note {
    position: relative; overflow: hidden; pointer-events: auto; display: flex; align-items: center; gap: 14px;
    padding: 14px 40px 16px 16px; border-radius: 16px; background: #12161d;
    box-shadow: inset 0 0 0 1px var(--line-2), 0 24px 60px -18px rgba(0, 0, 0, .9);
  }
  .note.victoire { background: linear-gradient(120deg, rgba(var(--volt-rgb), .14), #12161d 55%); box-shadow: inset 0 0 0 1px var(--volt-line), 0 24px 60px -18px rgba(0, 0, 0, .9), 0 0 40px -12px var(--volt-glow); }
  .note.defaite { background: linear-gradient(120deg, rgba(255, 77, 106, .14), #12161d 55%); box-shadow: inset 0 0 0 1px rgba(255, 77, 106, .35), 0 24px 60px -18px rgba(0, 0, 0, .9); }
  .embleme { width: 64px; height: auto; flex: none; filter: drop-shadow(0 6px 14px rgba(0, 0, 0, .6)); animation: pose .9s var(--ease) both; }
  @keyframes pose { from { transform: scale(.4) rotate(-12deg); opacity: 0; } 60% { transform: scale(1.1) rotate(3deg); opacity: 1; } to { transform: none; } }
  .titre { font-weight: 750; font-size: 14px; font-stretch: 108%; }
  .victoire .titre, .victoire .delta { color: var(--volt); }
  .defaite .titre, .defaite .delta { color: var(--red); }
  .delta { font-size: 26px; font-weight: 700; line-height: 1.1; letter-spacing: -.02em; }
  .sous { font-size: 12px; color: var(--ink-2); margin-top: 2px; }
  .ico { width: 34px; height: 34px; flex: none; border-radius: 10px; display: grid; place-items: center; background: var(--volt-soft); color: var(--volt); box-shadow: inset 0 0 0 1px var(--volt-line); }
  .ico :global(svg) { width: 17px; height: 17px; }
  .x { position: absolute; top: 8px; right: 8px; width: 26px; height: 26px; border: 0; border-radius: 8px; background: transparent; color: var(--ink-3); font-size: 18px; line-height: 1; cursor: pointer; }
  .x:hover { background: rgba(255, 255, 255, .06); color: var(--ink); }
  .temps { position: absolute; left: 0; bottom: 0; height: 2px; width: 100%; background: currentColor; opacity: .5; color: var(--ink-3); transform-origin: left; animation: temps linear forwards; }
  .victoire .temps { color: var(--volt); }
  .defaite .temps { color: var(--red); }
  @keyframes temps { from { transform: scaleX(1); } to { transform: scaleX(0); } }
</style>
