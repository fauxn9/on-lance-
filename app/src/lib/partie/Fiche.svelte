<script>
  // Une fiche de l'écran de chargement : le portrait du champion comme dans le
  // jeu, et par-dessus ce qu'il faut savoir du joueur. Chaque ligne a trois
  // états : en route (squelette), connue, ou indisponible.
  import { inclinaison } from '../actions.js';
  import { dd } from '../ddragon.svelte.js';
  import { ilYa, kda, nomRang } from '../format.js';

  let { j, etapes, cote, i = 0, couleurDuo = null, partenaires = [], eclaire = false, onsurvol = () => {} } = $props();

  const champ = $derived(dd.champion(j.championId));
  const nom = $derived(j.riotId?.split('#')[0] || 'Joueur');
  const tag = $derived(j.riotId?.split('#')[1] ?? '');

  const parties = $derived(j.rang ? j.rang.wins + j.rang.losses : 0);
  const wr = $derived(parties ? Math.round((100 * j.rang.wins) / parties) : null);

  const m = $derived(j.maitrise);
  const experience = $derived(
    !m ? null
      : m.otp ? { ton: 'v', texte: 'OTP', aide: `${Math.round(m.part * 100)} % de toute sa maîtrise est sur ${champ.nom}.` }
      : m.points === 0 ? { ton: 'r', texte: '1re fois', aide: `Aucun point de maîtrise sur ${champ.nom}.` }
      : m.points < 10000 ? { ton: 'o', texte: 'Peu joué', aide: `Moins de 10 000 points sur ${champ.nom}.` }
      : null,
  );
  const points = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace('.', ',')} M` : n >= 1000 ? `${Math.round(n / 1000)} k` : String(n));

  const f = $derived(j.forme);
  const serie = $derived.by(() => {
    if (!f?.parties.length) return null;
    const v = f.parties.filter((p) => p.win).length;
    if (f.serie?.n >= 3) return { ton: f.serie.victoire ? 'v' : 'r', texte: `${f.serie.n} ${f.serie.victoire ? 'V' : 'D'} d'affilée` };
    return { ton: '', texte: `${v}V · ${f.parties.length - v}D` };
  });
  const aideForme = $derived.by(() => {
    if (!f?.parties.length) return '';
    const s = f.parties.reduce((t, p) => ({ k: t.k + p.k, d: t.d + p.d, a: t.a + p.a }), { k: 0, d: 0, a: 0 });
    return `${f.parties.length} dernières parties, de la plus récente à la plus ancienne. KDA ${kda(s.k, s.d, s.a)}. ${f.surChampion} sur ${champ.nom}.`;
  });
</script>

<article
  class="fiche {cote}" class:moi={j.moi} class:eclaire class:bot={j.bot} class:duo={j.duo}
  style:--i={i} style:--duo={couleurDuo}
  use:inclinaison={5}
  onpointerenter={() => j.duo && onsurvol(j.duo.groupe)}
  onpointerleave={() => j.duo && onsurvol(null)}
>
  {#if champ.portrait}<img class="art" src={champ.portrait} alt="" decoding="async" />{/if}
  <span class="voile" aria-hidden="true"></span>
  <span class="reflet" aria-hidden="true"></span>

  <div class="coins">
    <span class="sorts">
      {#each j.sorts as s}{@const x = dd.sort(s)}{#if x}<img src={x.icone} alt={x.nom} title={x.nom} />{/if}{/each}
    </span>
    {#if dd.rune(j.runes?.cle)}
      {@const cle = dd.rune(j.runes.cle)}
      {@const sous = dd.rune(j.runes.sousStyle)}
      <span class="runes" title="{cle.nom}{sous ? ` · ${sous.nom}` : ''}">
        <img class="cle" src={cle.icone} alt={cle.nom} />
        {#if sous}<img class="sous" src={sous.icone} alt="" />{/if}
      </span>
    {/if}
  </div>

  {#if j.pote}
    <span class="pote" class:eux={cote === 'eux'} title="{j.pote}, de ton groupe de potes{cote === 'eux' ? ', est en face' : ''}">
      {cote === 'eux' ? 'Pote en face' : 'Ton pote'}
    </span>
  {/if}
  {#if j.duo}
    <span class="ruban" title="Joue avec {partenaires.join(', ') || 'un coéquipier'} : {j.duo.ensemble} de ses 20 dernières parties ensemble.">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></svg>
      Duo
    </span>
  {/if}

  <div class="bas">
    <p class="champ">{champ.nom}</p>
    <p class="qui">
      <b title={j.riotId}>{nom}</b>{#if tag}<small>#{tag}</small>{/if}
      {#if j.moi}<span class="toi">Toi</span>{/if}
    </p>

    {#if j.bot}
      <p class="ia">Contrôlé par l'IA</p>
    {:else}
      <div class="ligne rang">
        {#if 'rang' in j}
          {#if j.rang}
            <img class="embleme" src="/rangs/{j.rang.tier.toLowerCase()}.webp" alt="" />
            <span class="rang-texte" title="{j.rang.wins} victoires, {j.rang.losses} défaites cette saison{j.rang.file === 'RANKED_FLEX_SR' ? ' (Flex)' : ''}.">
              <b>{nomRang(j.rang.tier, j.rang.division)}</b>
              <small class="mono">{j.rang.lp} PL · <span class:v={wr >= 55} class:r={wr < 45}>{wr} %</span> <span class="dim nb">{parties} p.</span></small>
            </span>
          {:else}
            <span class="embleme vide"></span>
            <span class="rang-texte"><b class="dim">Non classé</b><small class="dim">cette saison</small></span>
          {/if}
        {:else if etapes.rangs}
          <span class="indispo">Rang indisponible</span>
        {:else}
          <span class="squelette s-embleme"></span><span class="squelette s-texte"></span>
        {/if}
      </div>

      <div class="ligne maitrise" title={m?.derniere ? `Maîtrise ${m.niveau}, ${m.points.toLocaleString('fr-FR')} points. Joué ${ilYa(m.derniere)}.` : ''}>
        {#if m}
          <span class="niv mono">M{m.niveau}</span>
          <span class="pts mono">{points(m.points)}</span>
          {#if experience}<span class="tag {experience.ton}" title={experience.aide}>{experience.texte}</span>{/if}
        {:else if etapes.maitrises}
          <span class="indispo">Maîtrise indisponible</span>
        {:else}
          <span class="squelette s-court"></span>
        {/if}
      </div>

      <div class="ligne forme" title={aideForme}>
        {#if f}
          {#if f.parties.length}
            <span class="barres" aria-label="Forme récente">
              {#each f.parties as p, k}<i class:v={p.win} style:--k={k}></i>{/each}
            </span>
            <small class="serie {serie.ton}">{serie.texte}</small>
          {:else}
            <small class="dim">Pas de partie récente</small>
          {/if}
        {:else}
          <span class="squelette s-forme"></span>
        {/if}
      </div>
    {/if}
  </div>
</article>

<style>
  .fiche {
    --rx: 0deg; --ry: 0deg; --gx: 50%; --gy: 0%;
    --equipe: var(--blue);
    position: relative; isolation: isolate; overflow: hidden; min-width: 0; container-type: inline-size;
    height: var(--haut-fiche, 262px); border-radius: 16px; background: var(--panel);
    box-shadow: inset 0 0 0 1px var(--line), inset 0 -2px 0 var(--equipe);
    transform: perspective(900px) rotateX(var(--rx)) rotateY(var(--ry));
    transition: transform .5s var(--ease), box-shadow .3s, filter .3s;
    /* Distribution des cartes : chaque camp arrive de son côté. « backwards »
       et pas « both » : une fois posée, la carte rend la main à l'inclinaison. */
    animation: distribue .75s var(--ease) backwards; animation-delay: calc(var(--i) * 60ms);
  }
  .eux { --equipe: var(--red); }
  @keyframes distribue { from { opacity: 0; transform: perspective(900px) translateY(var(--dy, -26px)) rotateX(var(--ax, -16deg)) scale(.94); } }
  .eux { --dy: 26px; --ax: 16deg; }
  .fiche:hover { transition: transform .12s linear, box-shadow .3s; box-shadow: inset 0 0 0 1px var(--line-2), inset 0 -2px 0 var(--equipe), 0 22px 44px -24px rgba(0, 0, 0, .9); }
  .fiche.moi { box-shadow: inset 0 0 0 1.5px var(--volt), 0 0 36px -14px var(--volt-glow); }
  .fiche.eclaire { box-shadow: inset 0 0 0 1.5px var(--duo), 0 0 34px -12px var(--duo); }

  .art {
    position: absolute; inset: 0 0 auto 0; z-index: -2; width: 100%; height: 118%;
    object-fit: cover; object-position: 50% 0;
    transition: transform .8s var(--ease);
    animation: art .9s var(--ease) backwards; animation-delay: calc(var(--i) * 60ms + 120ms);
  }
  @keyframes art { from { opacity: 0; transform: scale(1.12); } }
  .fiche:hover .art { transform: scale(1.04) translateY(-2%); }
  .voile {
    position: absolute; inset: 0; z-index: -1; pointer-events: none;
    background:
      linear-gradient(180deg, rgba(6, 7, 9, .55) 0, transparent 22%, transparent 30%, rgba(10, 12, 16, .82) 52%, var(--panel) 68%),
      linear-gradient(0deg, color-mix(in srgb, var(--equipe) 14%, transparent), transparent 30%);
  }
  .bot .art { filter: grayscale(.8) brightness(.7); }
  .reflet { position: absolute; inset: 0; z-index: -1; pointer-events: none; background: radial-gradient(260px circle at var(--gx) var(--gy), rgba(255, 255, 255, .07), transparent 60%); opacity: 0; transition: opacity .3s; }
  .fiche:hover .reflet { opacity: 1; }

  .coins { position: absolute; top: 9px; left: 9px; right: 9px; display: flex; justify-content: space-between; align-items: flex-start; }
  .sorts { display: grid; gap: 3px; }
  .sorts img { width: 22px; height: 22px; border-radius: 6px; box-shadow: 0 0 0 1px rgba(0, 0, 0, .6), 0 4px 10px rgba(0, 0, 0, .5); }
  .runes { position: relative; width: 34px; height: 34px; border-radius: 50%; background: rgba(6, 7, 9, .72); box-shadow: inset 0 0 0 1px var(--line-2); }
  .runes .cle { width: 34px; height: 34px; }
  .runes .sous { position: absolute; right: -3px; bottom: -3px; width: 17px; height: 17px; padding: 2px; border-radius: 50%; background: var(--bg); box-shadow: 0 0 0 1px var(--line-2); }

  .ruban {
    position: absolute; top: 48px; left: 0; display: inline-flex; align-items: center; gap: 5px;
    padding: 3px 9px 3px 8px; border-radius: 0 999px 999px 0; background: var(--duo); color: #0a0c02;
    font-size: 10.5px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase;
    box-shadow: 0 6px 16px -6px var(--duo); animation: ruban .5s var(--ease) backwards .15s;
  }
  .ruban svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 2.6; stroke-linecap: round; }
  @keyframes ruban { from { transform: translateX(-100%); } }

  .pote {
    position: absolute; top: 48px; right: 0; padding: 3px 8px 3px 9px; border-radius: 999px 0 0 999px;
    background: var(--volt); color: var(--volt-ink); font-size: 10.5px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase;
    box-shadow: 0 6px 16px -6px var(--volt-glow); animation: ruban-d .5s var(--ease) backwards .2s;
  }
  .pote.eux { background: var(--red); color: #fff; box-shadow: 0 6px 16px -6px rgba(255, 77, 106, .7); }
  @keyframes ruban-d { from { transform: translateX(100%); } }
  .bas { position: absolute; left: 0; right: 0; bottom: 0; display: grid; gap: 6px; padding: 0 12px 12px; }
  .champ { font-size: 10px; font-weight: 750; letter-spacing: .16em; text-transform: uppercase; color: color-mix(in srgb, var(--equipe) 75%, white); text-shadow: 0 1px 8px rgba(0, 0, 0, .8); }
  .moi .champ { color: var(--volt); }
  .qui { display: flex; align-items: baseline; gap: 3px; min-width: 0; margin-top: -4px; }
  .qui b { font-size: 14px; font-weight: 750; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; text-shadow: 0 1px 10px rgba(0, 0, 0, .8); }
  .qui small { font-size: 11px; color: var(--ink-3); white-space: nowrap; }
  .toi { margin-left: auto; align-self: center; padding: 1px 7px; border-radius: 999px; background: var(--volt); color: var(--volt-ink); font-size: 10px; font-weight: 800; }
  .ia { font-size: 12px; color: var(--ink-3); }

  .ligne { display: flex; align-items: center; gap: 7px; min-height: 18px; min-width: 0; }
  /* Chaque info glisse en place au moment où elle arrive du serveur. */
  .ligne > * { animation: apparait .45s var(--ease) backwards; }
  .rang { min-height: 34px; }
  .embleme { width: 34px; height: 34px; object-fit: contain; flex: none; margin: -2px -2px -2px -4px; filter: drop-shadow(0 3px 8px rgba(0, 0, 0, .6)); animation: embleme .6s cubic-bezier(.34, 1.56, .64, 1) backwards; }
  @keyframes embleme { from { transform: scale(.4) rotate(-12deg); opacity: 0; } }
  .embleme.vide { width: 24px; height: 24px; margin: 0 3px 0 1px; border-radius: 50%; box-shadow: inset 0 0 0 1.5px var(--line-2); animation: none; }
  .rang-texte { display: grid; min-width: 0; line-height: 1.2; }
  .rang-texte b { font-size: 12.5px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .rang-texte small { font-size: 10.5px; color: var(--ink-2); white-space: nowrap; }
  .indispo { font-size: 11px; color: var(--ink-3); }

  .niv { padding: 1px 6px; border-radius: 6px; font-size: 10.5px; font-weight: 700; color: var(--ink-2); background: rgba(255, 255, 255, .06); box-shadow: inset 0 0 0 1px var(--line); }
  .pts { font-size: 11.5px; color: var(--ink-2); }
  .maitrise .tag { margin-left: auto; font-size: 10px; padding: 1px 7px; font-weight: 750; }
  .tag.o { color: var(--gold); box-shadow: inset 0 0 0 1px rgba(255, 200, 87, .35); background: rgba(255, 200, 87, .08); }

  .barres { display: flex; gap: 3px; align-items: flex-end; height: 14px; }
  .barres i { width: 6px; height: 14px; border-radius: 2px; background: var(--red); opacity: .85; transform-origin: bottom; animation: barre .45s var(--ease) backwards; animation-delay: calc(var(--k) * 50ms); }
  .barres i.v { background: var(--volt); }
  @keyframes barre { from { transform: scaleY(0); } }
  .serie { font-size: 11px; font-weight: 650; color: var(--ink-2); white-space: nowrap; }
  .serie.v { color: var(--volt); } .serie.r { color: var(--red); }

  /* Squelettes : l'éclat ne passe que quelques fois (pas de boucle infinie,
     elle coûte de la RAM sans GPU). */
  .squelette { display: block; border-radius: 6px; }
  .squelette::after { animation-iteration-count: 8; }
  .s-embleme { width: 28px; height: 28px; border-radius: 50%; flex: none; }
  .s-texte { width: 70%; height: 22px; }
  .s-court { width: 55%; height: 14px; }
  .s-forme { width: 45%; height: 14px; }

  /* Petite fenêtre : le nombre de parties passe dans l'infobulle. */
  @container (max-width: 190px) {
    .nb { display: none; }
    .bas { padding: 0 10px 10px; }
  }

  /* Fenêtre basse : sorts côte à côte, le texte garde sa place. */
  @media (max-height: 720px) {
    .sorts { display: flex; }
    .ruban, .pote { top: 36px; }
    .bas { gap: 4px; }
  }

  @media (prefers-reduced-motion: reduce) {
    .fiche, .art, .embleme, .barres i, .ruban { animation: none; }
  }
</style>
