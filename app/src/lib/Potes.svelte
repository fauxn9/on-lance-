<script>
  // Entre potes (brique 8) : groupes, classement de la semaine, fil des
  // vannes, palmarès, et le salon Discord du groupe.
  import { onMount, untrack } from 'svelte';
  import * as api from './api.js';
  import { onde } from './actions.js';
  import { notifier } from './notifications.svelte.js';
  import Icone from './Icone.svelte';
  import Classement from './potes/Classement.svelte';
  import Fil from './potes/Fil.svelte';

  let { revision = 0 } = $props();

  let groupes = $state(null);
  let actif = $state(Number(localStorage.getItem('groupe-actif')) || null);
  let d = $state(null);
  let erreur = $state(null);
  let moi = $state(null);

  async function chargerGroupes() {
    try {
      groupes = (await api.potes('GET', '/groupes')).groupes;
      if (!groupes.some((g) => g.id === actif)) actif = groupes[0]?.id ?? null;
      erreur = null;
    } catch (e) {
      erreur = String(e);
      groupes ??= [];
    }
  }
  async function chargerDetail() {
    if (!actif) { d = null; return; }
    try {
      d = await api.potes('GET', `/groupes/${actif}`);
    } catch (e) {
      notifier({ titre: 'Groupe indisponible', texte: String(e), icone: 'alerte' });
    }
  }
  onMount(() => {
    api.identite().then((r) => (moi = r)).catch(() => {});
    chargerGroupes();
  });
  $effect(() => {
    const id = actif;
    revision;
    try { if (id) localStorage.setItem('groupe-actif', String(id)); } catch {}
    untrack(chargerDetail);
  });

  // ---------------------------------------------------------------- créer / rejoindre
  let nom = $state('');
  let code = $state('');
  let occupe = $state(false);
  async function creer() {
    if (nom.trim().length < 2 || occupe) return;
    occupe = true;
    try {
      const { id } = await api.potes('POST', '/groupes', { nom: nom.trim() });
      nom = '';
      actif = id;
      await chargerGroupes();
      notifier({ titre: 'Groupe créé', texte: 'Copie le code et envoie-le à tes potes.', icone: 'check' });
    } catch (e) {
      notifier({ titre: 'Création impossible', texte: String(e), icone: 'alerte' });
    } finally {
      occupe = false;
    }
  }
  async function rejoindre() {
    if (code.trim().length < 4 || occupe) return;
    occupe = true;
    try {
      const r = await api.potes('POST', '/groupes/rejoindre', { code: code.trim() });
      code = '';
      actif = r.id;
      await chargerGroupes();
      notifier({ titre: 'Bienvenue dans le groupe', texte: 'Ta prochaine partie compte pour le classement.', icone: 'check' });
    } catch (e) {
      notifier({ titre: 'Code refusé', texte: String(e), icone: 'alerte' });
    } finally {
      occupe = false;
    }
  }

  // ---------------------------------------------------------------- réglages
  let reglages = $state(false);
  let webhook = $state('');
  let apercu = $state(null);
  let pseudo = $state('');
  $effect(() => { if (moi) pseudo = untrack(() => pseudo) || moi.pseudo; });

  async function action(fn, ok) {
    if (occupe) return;
    occupe = true;
    try {
      await fn();
      if (ok) notifier({ titre: ok, icone: 'check', duree: 3500 });
    } catch (e) {
      notifier({ titre: 'Ça n’a pas marché', texte: String(e), icone: 'alerte' });
    } finally {
      occupe = false;
    }
  }
  const lierDiscord = () => action(async () => {
    await api.potes('POST', `/groupes/${actif}/discord`, { webhook: webhook.trim() });
    webhook = '';
    await Promise.all([chargerGroupes(), chargerDetail()]);
  }, 'Salon Discord lié');
  const delierDiscord = () => action(async () => {
    await api.potes('DELETE', `/groupes/${actif}/discord`);
    await Promise.all([chargerGroupes(), chargerDetail()]);
  }, 'Salon Discord délié');
  const basculerChambrage = () => action(async () => {
    await api.potes('POST', `/groupes/${actif}/reglages`, { chambrage: !d.groupe.chambrage });
    await chargerDetail();
  });
  const voirApercu = () => action(async () => {
    apercu = { chargement: true };
    apercu = await api.potes('POST', `/groupes/${actif}/apercu`);
  });
  const renommer = () => action(async () => {
    moi = await api.identite(pseudo.trim());
    await chargerDetail();
  }, 'Pseudo changé');
  const quitter = () => action(async () => {
    await api.potes('POST', `/groupes/${actif}/quitter`);
    actif = null;
    reglages = false;
    await chargerGroupes();
  });
  let confirmeQuitter = $state(false);

  async function copierCode() {
    try {
      await navigator.clipboard.writeText(d.groupe.code);
      notifier({ titre: 'Code copié', texte: 'Tes potes le collent dans l’onglet Potes, « Rejoindre ».', icone: 'check', duree: 4000 });
    } catch {}
  }

  async function reagir(e, type) {
    const avant = { reactions: { ...e.reactions }, maReaction: e.maReaction };
    if (e.maReaction) e.reactions[e.maReaction] = Math.max(0, (e.reactions[e.maReaction] ?? 1) - 1);
    if (type) e.reactions[type] = (e.reactions[type] ?? 0) + 1;
    e.maReaction = type;
    try {
      await api.potes('POST', `/fil/${e.id}/reaction`, { type });
    } catch {
      Object.assign(e, avant);
    }
  }

  // Fin de la semaine : « 4 j 7 h », « 5 h 12 min ».
  let maintenant = $state(Date.now());
  onMount(() => {
    const t = setInterval(() => (maintenant = Date.now()), 60_000);
    return () => clearInterval(t);
  });
  const reste = $derived.by(() => {
    if (!d) return '';
    const m = Math.max(0, (d.semaine.fin - maintenant) / 60000);
    const j = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
    return j ? `${j} j ${h} h` : `${h} h ${Math.floor(m % 60)} min`;
  });
</script>

{#if groupes === null}
  <div class="chargement"><span class="squelette"></span><span class="squelette"></span></div>
{:else if !groupes.length}
  <section class="accueil">
    <div class="texte">
    <p class="kicker mono">Entre potes</p>
    <h1>Qui carry le groupe cette semaine ?</h1>
    <p class="intro">Monte un groupe avec tes potes : classement des LP de la semaine (remis à zéro chaque lundi), une vanne à chaque fin de partie, et le tout dans votre salon Discord si vous voulez.</p>
    <div class="deux">
      <form class="carte" onsubmit={(e) => { e.preventDefault(); creer(); }}>
        <p class="etiquette">Créer un groupe</p>
        <input bind:value={nom} maxlength="32" placeholder="les bouffons" aria-label="Nom du groupe" />
        <button class="bouton volt" use:onde disabled={occupe || nom.trim().length < 2}>Créer</button>
      </form>
      <form class="carte" onsubmit={(e) => { e.preventDefault(); rejoindre(); }}>
        <p class="etiquette">Rejoindre avec un code</p>
        <input bind:value={code} maxlength="8" placeholder="K7QX2M" class="mono code" aria-label="Code du groupe" />
        <button class="bouton" use:onde disabled={occupe || code.trim().length < 4}>Rejoindre</button>
      </form>
    </div>
    {#if erreur}<p class="erreur">{erreur}</p>{/if}
    </div>
    <!-- Ce qui attend le groupe : un classement, une vanne. -->
    <div class="vitrine" aria-hidden="true">
      <div class="mini">
        <p class="etiquette">les bouffons · cette semaine</p>
        {#each [['pingu', 61, 1], ['toi', 45, 2], ['lune rousse', 40, 3], ['kiwi', -12, 4]] as [p, lp, n], i}
          <div class="mini-ligne" class:toi={p === 'toi'} style:--i={i}>
            <span class="mono">{n}</span><b>{p}</b>
            <span class="mini-barre"><i class:neg={lp < 0} style:--w={Math.abs(lp) / 61}></i></span>
            <span class="mono" class:v={lp > 0} class:r={lp < 0}>{lp > 0 ? '+' : '−'}{Math.abs(lp)}</span>
          </div>
        {/each}
        <p class="mini-bulle">tu passes devant lune rousse et t'es 2e mtn, pingu t'es à 16 LP t'es chaud ?</p>
        <p class="mini-reactions"><span>GG 2</span><span>cheh 1</span></p>
      </div>
    </div>
  </section>
{:else}
  <header class="tete">
    <div>
      <p class="kicker mono">Entre potes · {d?.semaine.nom ?? ''}</p>
      <h1>{d?.groupe.nom ?? groupes.find((g) => g.id === actif)?.nom}</h1>
    </div>
    <div class="actions">
      {#if d}
        <button class="code-groupe" onclick={copierCode} use:onde title="Copier le code d'invitation">
          <span class="mono">{d.groupe.code}</span><Icone nom="copier" />
        </button>
        {#if d.groupe.discord}<span class="tag discord"><Icone nom="discord" />lié à Discord</span>{/if}
      {/if}
      <button class="bouton" class:on={reglages} onclick={() => (reglages = !reglages)} use:onde>Réglages</button>
    </div>
  </header>

  {#if groupes.length > 1 || reglages}
    <nav class="groupes" aria-label="Mes groupes">
      {#each groupes as g}
        <button class:on={g.id === actif} onclick={() => (actif = g.id)}>{g.nom} <span class="dim">{g.membres}</span></button>
      {/each}
    </nav>
  {/if}

  {#if reglages}
    <section class="carte reglages">
      <div class="bloc">
        <p class="etiquette">Salon Discord du groupe</p>
        {#if d?.groupe.discord}
          <p>Les vannes et la couronne du lundi partent dans « {d.groupe.discord.nom} ». <code>/classement</code> y affiche le classement.</p>
          <button class="bouton" onclick={delierDiscord} disabled={occupe}>Délier</button>
        {:else}
          <p class="dim">Sur Discord : paramètres du salon → Intégrations → Webhooks → Nouveau webhook → Copier l'URL, et colle-la ici.</p>
          <form class="ligne" onsubmit={(e) => { e.preventDefault(); lierDiscord(); }}>
            <input bind:value={webhook} placeholder="https://discord.com/api/webhooks/…" aria-label="URL du webhook" />
            <button class="bouton volt" disabled={occupe || !webhook.trim()}>Lier</button>
          </form>
        {/if}
      </div>
      <div class="bloc">
        <p class="etiquette">Chambrage</p>
        <label class="interrupteur-ligne"><input type="checkbox" checked={d?.groupe.chambrage} onchange={basculerChambrage} /><span class="interrupteur"></span>Une vanne à chaque fin de partie</label>
        <button class="bouton" onclick={voirApercu} disabled={occupe}>Aperçu sur ta dernière partie</button>
        {#if apercu}
          <p class="bulle-apercu" class:attente={apercu.chargement}>{apercu.chargement ? 'ça cherche la vanne…' : apercu.texte}</p>
        {/if}
      </div>
      <div class="bloc">
        <p class="etiquette">Ton pseudo dans les groupes</p>
        <form class="ligne" onsubmit={(e) => { e.preventDefault(); renommer(); }}>
          <input bind:value={pseudo} maxlength="20" aria-label="Pseudo" />
          <button class="bouton" disabled={occupe || pseudo.trim().length < 2 || pseudo.trim() === moi?.pseudo}>Changer</button>
        </form>
        {#if moi?.comptes?.length > 1}<p class="dim petit">Comptes réunis : {moi.comptes.map((c) => `${c.gameName}#${c.tagLine}`).join(', ')}</p>{/if}
      </div>
      <div class="bloc">
        <p class="etiquette">Autre groupe</p>
        <form class="ligne" onsubmit={(e) => { e.preventDefault(); rejoindre(); }}>
          <input bind:value={code} maxlength="8" placeholder="code" class="mono code" aria-label="Code du groupe" />
          <button class="bouton" disabled={occupe || code.trim().length < 4}>Rejoindre</button>
        </form>
        <form class="ligne" onsubmit={(e) => { e.preventDefault(); creer(); }}>
          <input bind:value={nom} maxlength="32" placeholder="nom du groupe" aria-label="Nom du groupe" />
          <button class="bouton" disabled={occupe || nom.trim().length < 2}>Créer</button>
        </form>
        {#if confirmeQuitter}
          <p class="quitter">Sûr ? <button class="lien r" onclick={quitter}>Oui, quitter « {d?.groupe.nom} »</button> <button class="lien" onclick={() => (confirmeQuitter = false)}>Non</button></p>
        {:else}
          <button class="lien r" onclick={() => (confirmeQuitter = true)}>Quitter ce groupe</button>
        {/if}
      </div>
    </section>
  {/if}

  {#if d}
    <div class="grille">
      <section class="carte">
        <div class="titre-carte">
          <p class="etiquette">Classement de la semaine</p>
          <span class="dim mono fin">fin dans {reste}</span>
        </div>
        <Classement lignes={d.classement} moi={d.moi} />
        <p class="note dim">LP de Solo/Duo et Flex gagnés depuis lundi, tous tes comptes réunis. À égalité, celui qui a joué le moins de parties passe devant.</p>
        {#if d.historique.length}
          <p class="etiquette palmares-titre">Palmarès</p>
          <ul class="palmares">
            {#each d.historique as h}
              <li><Icone nom="couronne" /><b>{h.gagnant ?? 'personne'}</b><span class="dim">{h.nom}</span>{#if h.gagnant}<span class="mono v">+{h.lp} LP</span>{/if}</li>
            {/each}
          </ul>
        {/if}
      </section>
      <section class="carte">
        <div class="titre-carte"><p class="etiquette">Le fil</p></div>
        <Fil evenements={d.fil} onreagir={reagir} />
      </section>
    </div>
  {:else}
    <div class="chargement"><span class="squelette"></span><span class="squelette"></span></div>
  {/if}
{/if}

<style>
  .kicker { font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: var(--volt); margin-bottom: 4px; }
  h1 { font-stretch: 122%; font-weight: 900; font-size: 28px; letter-spacing: -.03em; }
  .tete { display: flex; align-items: flex-end; justify-content: space-between; gap: 14px; margin-bottom: 14px; animation: apparait .4s var(--ease) both; }
  .actions { display: flex; align-items: center; gap: 8px; }
  .code-groupe { display: inline-flex; align-items: center; gap: 8px; height: 34px; padding: 0 12px; border: 0; border-radius: 10px; cursor: pointer; background: var(--volt-soft); color: var(--volt); box-shadow: inset 0 0 0 1px var(--volt-line); font-size: 14px; font-weight: 800; letter-spacing: .12em; }
  .code-groupe :global(svg) { width: 14px; height: 14px; }
  .tag.discord { gap: 5px; color: #9aa7ff; box-shadow: inset 0 0 0 1px rgba(154, 167, 255, .35); }
  .tag.discord :global(svg) { width: 13px; height: 13px; }
  .bouton.on { background: rgba(255, 255, 255, .1); }

  .groupes { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
  .groupes button { border: 0; cursor: pointer; padding: 6px 12px; border-radius: 999px; background: var(--panel); box-shadow: inset 0 0 0 1px var(--line); color: var(--ink-2); font-size: 12.5px; font-weight: 650; }
  .groupes button.on { background: var(--volt); color: var(--volt-ink); }
  .groupes button.on .dim { color: rgba(10, 12, 2, .6); }

  .reglages { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px 24px; margin-bottom: 12px; animation: apparait .35s var(--ease) both; }
  .bloc { display: grid; gap: 8px; align-content: start; font-size: 12.5px; }
  .bloc p { line-height: 1.45; }
  .bloc > .bouton, .bloc > .lien { justify-self: start; }
  .bloc code { font-family: var(--mono); color: var(--volt); }
  .ligne { display: flex; gap: 6px; }
  input:not([type='checkbox']) { flex: 1; min-width: 0; height: 36px; padding: 0 12px; border: 0; border-radius: 10px; background: var(--bg-2); box-shadow: inset 0 0 0 1px var(--line-2); color: var(--ink); font: inherit; font-size: 13px; outline: 0; user-select: text; }
  input:focus { box-shadow: inset 0 0 0 1px var(--volt-line), 0 0 20px -10px var(--volt-glow); }
  input.code { text-transform: uppercase; letter-spacing: .14em; font-weight: 700; }
  .interrupteur-ligne { display: flex; align-items: center; gap: 10px; cursor: pointer; }
  .interrupteur-ligne input { position: absolute; opacity: 0; pointer-events: none; }
  .interrupteur { width: 34px; height: 20px; border-radius: 999px; background: var(--panel-3); box-shadow: inset 0 0 0 1px var(--line-2); position: relative; transition: background-color .25s; flex: none; }
  .interrupteur::after { content: ""; position: absolute; top: 3px; left: 3px; width: 14px; height: 14px; border-radius: 50%; background: var(--ink-2); transition: transform .3s cubic-bezier(.34, 1.56, .64, 1), background-color .25s; }
  .interrupteur-ligne input:checked + .interrupteur { background: var(--volt-soft); box-shadow: inset 0 0 0 1px var(--volt-line); }
  .interrupteur-ligne input:checked + .interrupteur::after { transform: translateX(14px); background: var(--volt); }
  .bulle-apercu { padding: 9px 13px; border-radius: 4px 14px 14px 14px; background: var(--panel-3); box-shadow: inset 0 0 0 1px var(--volt-line); font-size: 13.5px; animation: apparait .35s var(--ease) both; }
  .bulle-apercu.attente { color: var(--ink-3); }
  .petit { font-size: 11.5px; }
  .quitter { display: flex; gap: 10px; align-items: center; }
  .lien.r { color: var(--red); }

  .grille { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 12px; align-items: start; }
  .fin { font-size: 11.5px; }
  .note { font-size: 11.5px; margin-top: 10px; line-height: 1.45; }
  .palmares-titre { margin: 16px 0 8px; }
  .palmares { display: grid; gap: 4px; }
  .palmares li { display: flex; align-items: center; gap: 8px; font-size: 12.5px; }
  .palmares :global(svg) { width: 14px; height: 14px; color: var(--gold); fill: var(--gold); stroke-width: 1.5; }
  .palmares .mono { margin-left: auto; font-size: 11.5px; }

  .accueil { max-width: 1000px; margin: 30px auto 0; display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 34px; align-items: center; animation: apparait .45s var(--ease) both; }
  .texte { display: grid; gap: 14px; }
  .vitrine { perspective: 1100px; }
  .mini {
    display: grid; gap: 7px; padding: 16px; border-radius: 18px; background: var(--panel); box-shadow: inset 0 0 0 1px var(--line-2), 0 40px 80px -30px rgba(0, 0, 0, .95), 0 0 60px -30px var(--volt-glow);
    transform: rotateY(-12deg) rotateX(6deg) rotate(1.5deg); animation: vitrine 1s var(--ease) .15s backwards;
  }
  @keyframes vitrine { from { opacity: 0; transform: rotateY(-30deg) rotateX(12deg) translateY(30px); } }
  .mini .etiquette { margin-bottom: 4px; }
  .mini-ligne { display: grid; grid-template-columns: 14px minmax(0, 1fr) 70px 38px; align-items: center; gap: 8px; padding: 6px 9px; border-radius: 9px; background: var(--panel-2); font-size: 12.5px; animation: apparait .4s var(--ease) backwards; animation-delay: calc(.5s + var(--i) * 80ms); }
  .mini-ligne .mono { font-size: 11.5px; text-align: right; } .mini-ligne .mono:first-child { color: var(--ink-3); text-align: left; }
  .mini-ligne.toi { background: var(--volt-soft); box-shadow: inset 2px 0 0 var(--volt); } .mini-ligne.toi b { color: var(--volt); }
  .mini-barre { position: relative; height: 6px; }
  .mini-barre i { position: absolute; left: 50%; top: 0; bottom: 0; width: calc(50% * var(--w)); border-radius: 0 4px 4px 0; background: var(--volt); }
  .mini-barre i.neg { left: auto; right: 50%; border-radius: 4px 0 0 4px; background: var(--red); }
  .mini-bulle { margin-top: 6px; padding: 9px 12px; border-radius: 4px 14px 14px 14px; background: var(--panel-3); box-shadow: inset 0 0 0 1px var(--volt-line); font-size: 12.5px; line-height: 1.45; animation: apparait .45s var(--ease) 1s backwards; }
  .mini-reactions { display: flex; gap: 5px; animation: apparait .4s var(--ease) 1.2s backwards; }
  .mini-reactions span { padding: 2px 8px; border-radius: 999px; font-size: 10.5px; font-weight: 700; color: var(--ink-2); box-shadow: inset 0 0 0 1px var(--line-2); }
  .mini-reactions span:first-child { color: var(--volt); background: var(--volt-soft); box-shadow: inset 0 0 0 1px var(--volt-line); }
  .accueil h1 { font-size: 34px; }
  .intro { color: var(--ink-2); font-size: 14.5px; line-height: 1.5; max-width: 60ch; }
  .deux { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 6px; }
  .deux form { display: grid; gap: 10px; }
  .erreur { color: var(--gold); font-size: 12.5px; }
  .chargement { display: grid; grid-template-columns: 1.1fr 1fr; gap: 12px; }
  .chargement .squelette { height: 360px; border-radius: 14px; }
  .chargement .squelette::after { animation-iteration-count: 8; }

  @media (max-width: 900px) {
    .grille, .reglages { grid-template-columns: minmax(0, 1fr); }
  }
  @media (max-width: 1100px) {
    .accueil { grid-template-columns: minmax(0, 1fr) minmax(0, .9fr); gap: 22px; }
  }
</style>
