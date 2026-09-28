<script>
  import { fenetre } from './api.js';

  let { etape, compte } = $props();
  const TEXTE = {
    hors: 'Client LoL fermé', menus: 'Client LoL détecté', file: "En file d'attente", selection: 'Sélection des champions',
    chargement: 'Chargement de la partie', en_jeu: 'En jeu', fin: 'Fin de partie',
  };
</script>

<header class="barre" data-tauri-drag-region>
  <span class="logo" data-tauri-drag-region>
    <svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="#d6ff3f" /><path d="M11.6 12.2a4.4 4.4 0 1 1 6.2 4c-1.2.55-1.8 1.45-1.8 2.7v1" fill="none" stroke="#0a0c02" stroke-width="3.2" stroke-linecap="round" /><circle cx="16" cy="24.6" r="1.9" fill="#0a0c02" /></svg>
    On lance&nbsp;?
  </span>
  <span class="statut" class:actif={etape !== 'hors'} data-tauri-drag-region>
    <span class="point"></span>{TEXTE[etape] ?? etape}{#if compte && etape !== 'hors'}<span class="dim">&nbsp;· {compte.nom}#{compte.tag}</span>{/if}
  </span>
  <span class="ctl">
    <button onclick={() => fenetre('reduire')} aria-label="Réduire"><i class="moins"></i></button>
    <button onclick={() => fenetre('agrandir')} aria-label="Agrandir"><i class="carre"></i></button>
    <button class="fermer" onclick={() => fenetre('fermer')} aria-label="Fermer"><i class="croix"></i></button>
  </span>
</header>

<style>
  .barre { flex: none; height: 42px; display: flex; align-items: center; gap: 18px; padding-left: 16px; border-bottom: 1px solid var(--line); background: rgba(255, 255, 255, .012); }
  .logo { display: inline-flex; align-items: center; gap: 9px; font-stretch: 115%; font-weight: 800; font-size: 14px; }
  .logo svg { width: 20px; height: 20px; }
  .statut { display: inline-flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--ink-3); margin-left: auto; }
  .point { width: 7px; height: 7px; border-radius: 50%; background: var(--ink-3); }
  .statut.actif { color: var(--ink-2); }
  .statut.actif .point { background: var(--volt); box-shadow: 0 0 10px var(--volt); }
  .ctl { display: flex; align-self: stretch; }
  .ctl button { width: 46px; border: 0; background: transparent; position: relative; cursor: pointer; transition: background-color .15s; }
  .ctl button:hover { background: rgba(255, 255, 255, .07); }
  .ctl .fermer:hover { background: #c42b1c; }
  i { position: absolute; left: 50%; top: 50%; translate: -50% -50%; }
  .moins { width: 10px; height: 1px; background: var(--ink-2); }
  .carre { width: 9px; height: 9px; border: 1px solid var(--ink-2); }
  .croix::before, .croix::after { content: ""; position: absolute; left: -6px; top: 0; width: 12px; height: 1px; background: var(--ink-2); transform: rotate(45deg); }
  .croix::after { transform: rotate(-45deg); }
</style>
