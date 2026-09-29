<script>
  // Les counters d'un champion à un poste, façon u.gg : qui le bat, qui perd
  // contre lui, qui gagne la lane (écart d'or à 15 min). Patch en cours ou les
  // 3 derniers réunis. Un clic sur un champion ouvre ses propres counters.
  import { untrack } from 'svelte';
  import * as api from '../api.js';
  import { dd } from '../ddragon.svelte.js';
  import { nomPatch, nomPoste } from '../format.js';
  import Icone from '../Icone.svelte';

  let { champion, role = null, onchoisir = () => {} } = $props();

  let patchs = $state(Number(localStorage.getItem('counters-patchs')) === 3 ? 3 : 1);
  $effect(() => { try { localStorage.setItem('counters-patchs', String(patchs)); } catch {} });

  let d = $state(null);
  let chargement = $state(false);
  let erreur = $state(null);
  $effect(() => {
    const c = champion, r = role, p = patchs;
    if (!c) return;
    chargement = true;
    erreur = null;
    untrack(() => api.counters(c, r, p))
      .then((x) => { if (c === champion && p === patchs) d = x; })
      .catch((e) => (erreur = String(e)))
      .finally(() => (chargement = false));
  });

  const nom = $derived(dd.champion(champion).nom);
  const peu = (n) => n < 30;
  const pct = (x) => `${(x * 100).toFixed(1).replace('.', ',')} %`;
  const nf = new Intl.NumberFormat('fr-FR');
  const or = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${nf.format(Math.abs(n))}`;
  // Barre de winrate lisible : 40 % → vide, 60 % → pleine.
  const barreWr = (w) => Math.max(0.04, Math.min(1, (w - 0.4) / 0.2));
  const maxGd = $derived(Math.max(200, ...(d?.lane ?? []).map((l) => Math.abs(l.gd15))));
  const mince = $derived(d && (d.parties < 300 || d.duels < 10));
  const COLONNES = [
    { cle: 'meilleurs', ton: 'v', icone: 'check', titre: (n) => `Meilleurs picks contre ${n}`, aide: (n) => `Ils gagnent le plus souvent contre ${n}, sur toute la partie.` },
    { cle: 'pires', ton: 'r', icone: 'alerte', titre: (n) => `Pires picks contre ${n}`, aide: (n) => `Ils perdent le plus souvent contre ${n}.` },
    { cle: 'lane', ton: 'b', icone: 'courbe', titre: (n) => `Gagnent la lane contre ${n}`, aide: (n) => `Plus gros écart d'or à 15 min face à ${n}.` },
  ];
</script>

<section class="counters" aria-busy={chargement}>
  <header class="filtres">
    <div class="seg" role="radiogroup" aria-label="Patchs">
      <button role="radio" aria-checked={patchs === 1} class:on={patchs === 1} onclick={() => (patchs = 1)}>
        Patch {nomPatch(d?.patchs?.[0] ?? '')}
      </button>
      <button role="radio" aria-checked={patchs === 3} class:on={patchs === 3} onclick={() => (patchs = 3)}>3 derniers patchs</button>
    </div>
    <span class="tag" title="Les matchups viennent des parties classées Solo/Duo Émeraude et plus, sur EUW.">Émeraude+ · Solo/Duo</span>
    {#if d}
      <span class="dim mono resume">
        {nom}{d.role ? ` · ${nomPoste(d.role)}` : ''} · {nf.format(d.parties)} parties{patchs === 3 && d.patchs.length > 1 ? ` · ${nomPatch(d.patchs.at(-1))} → ${nomPatch(d.patchs[0])}` : ''}
      </span>
    {/if}
  </header>

  {#if erreur}
    <p class="alerte-ligne"><Icone nom="alerte" />{erreur}</p>
  {:else if d}
    {#if mince}
      <p class="alerte-ligne">
        <Icone nom="alerte" />
        Pas encore beaucoup de parties pour {nom} à ce poste : les chiffres sont indicatifs.
        {#if patchs === 1}<button class="lien" onclick={() => (patchs = 3)}>Voir sur 3 patchs</button>{/if}
      </p>
    {/if}
    <div class="colonnes">
      {#each COLONNES as col, k}
        {@const liste = d[col.cle] ?? []}
        <div class="colonne {col.ton}" style:--k={k}>
          <div class="tete-col">
            <span class="puce-col"><Icone nom={col.icone} /></span>
            <div>
              <b>{col.titre(nom)}</b>
              <small>{col.aide(nom)}</small>
            </div>
          </div>
          <ol>
            {#each liste as l, i (l.championId)}
              {@const c = dd.champion(l.championId)}
              <li style:--i={i}>
                <button onclick={() => onchoisir(l.championId)} title="Voir les counters de {c.nom}">
                  {#if c.icone}<img src={c.icone} alt="" />{:else}<span class="vide"></span>{/if}
                  <span class="qui">
                    <b>{c.nom}</b>
                    <span class="barre"><i style:transform="scaleX({col.cle === 'lane' ? Math.max(0.04, Math.abs(l.gd15) / maxGd) : barreWr(l.winrate)})" class:neg={col.cle === 'lane' && l.gd15 < 0}></i></span>
                  </span>
                  <span class="val">
                    <b class="mono">{col.cle === 'lane' ? `${or(l.gd15)} PO` : pct(l.winrate)}</b>
                    <small class="mono" class:peu={peu(l.games)} title={peu(l.games) ? 'Peu de parties : à prendre avec des pincettes' : ''}>{nf.format(l.games)} parties</small>
                  </span>
                </button>
              </li>
            {:else}
              <li class="rien dim">Pas encore assez de parties.</li>
            {/each}
          </ol>
        </div>
      {/each}
    </div>
    {#if d.lane.length}<p class="note dim">Écart d'or à 15 min : or gagné par l'adversaire direct moins celui de {nom}, en moyenne. Les winrates sont ceux du champion listé face à {nom}.</p>{/if}
  {:else}
    <div class="colonnes">{#each [0, 1, 2] as _}<span class="squelette col-vide"></span>{/each}</div>
  {/if}
</section>

<style>
  .counters { display: grid; gap: 12px; transition: opacity .25s; }
  .counters[aria-busy='true'] { opacity: .65; }
  .filtres { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .seg { display: inline-flex; gap: 2px; padding: 3px; border-radius: 11px; background: var(--panel); box-shadow: inset 0 0 0 1px var(--line); }
  .seg button { border: 0; background: transparent; color: var(--ink-2); font-size: 12px; font-weight: 650; padding: 6px 12px; border-radius: 8px; cursor: pointer; transition: background-color .25s, color .25s; }
  .seg button.on { background: var(--volt); color: var(--volt-ink); }
  .resume { font-size: 11.5px; margin-left: auto; }
  .alerte-ligne { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12.5px; color: var(--gold); }
  .alerte-ligne :global(svg) { width: 15px; height: 15px; flex: none; }

  .colonnes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
  .colonne { --c: var(--volt); --c-soft: var(--volt-soft); border-radius: 16px; background: var(--panel); box-shadow: inset 0 0 0 1px var(--line); overflow: hidden; animation: apparait .45s var(--ease) backwards; animation-delay: calc(var(--k) * 70ms); }
  .colonne.r { --c: var(--red); --c-soft: var(--red-soft); }
  .colonne.b { --c: #4fd1c5; --c-soft: rgba(79, 209, 197, .1); }
  .tete-col { display: flex; gap: 10px; padding: 13px 14px 11px; box-shadow: inset 3px 0 0 var(--c), inset 0 -1px 0 var(--line); }
  .puce-col { width: 28px; height: 28px; flex: none; display: grid; place-items: center; border-radius: 9px; background: var(--c-soft); color: var(--c); }
  .puce-col :global(svg) { width: 15px; height: 15px; }
  .tete-col b { display: block; font-size: 13.5px; }
  .tete-col small { font-size: 11px; color: var(--ink-3); line-height: 1.35; }
  ol { display: grid; }
  li { animation: apparait .35s var(--ease) backwards; animation-delay: calc(120ms + var(--i) * 30ms); }
  li button {
    width: 100%; display: grid; grid-template-columns: 32px minmax(0, 1fr) auto; align-items: center; gap: 10px;
    padding: 8px 14px; border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer;
    box-shadow: inset 0 -1px 0 var(--line); transition: background-color .2s;
  }
  li:first-child button { background: linear-gradient(90deg, var(--c-soft), transparent 80%); }
  li button:hover { background: rgba(255, 255, 255, .04); }
  li img, .vide { width: 32px; height: 32px; border-radius: 9px; }
  .vide { background: var(--panel-3); }
  .qui { display: grid; gap: 5px; min-width: 0; }
  .qui b { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .barre { height: 4px; border-radius: 4px; background: var(--panel-3); overflow: hidden; }
  .barre i { display: block; height: 100%; background: var(--c); transform-origin: left; transition: transform .8s var(--ease); }
  .barre i.neg { background: var(--red); }
  .val { display: grid; justify-items: end; line-height: 1.25; }
  .val b { font-size: 13px; color: var(--c); }
  .val small { font-size: 10.5px; color: var(--ink-3); white-space: nowrap; }
  .val small.peu { color: var(--gold); }
  .rien { padding: 16px 14px; font-size: 12px; }
  .note { font-size: 11px; line-height: 1.45; }
  .col-vide { height: 420px; border-radius: 16px; }
  .col-vide::after { animation-iteration-count: 6; }
</style>
