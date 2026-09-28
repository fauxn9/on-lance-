import './app.css';
import { mount } from 'svelte';

// Une seule interface pour deux fenêtres : l'app, et l'overlay en jeu
// (fenêtre « overlay », ou `?overlay` dans le navigateur pour la démo).
const estOverlay = '__TAURI_INTERNALS__' in window
  ? window.__TAURI_INTERNALS__.metadata?.currentWindow?.label === 'overlay'
  : new URLSearchParams(location.search).has('overlay');

if (estOverlay) {
  document.documentElement.classList.add('overlay');
  // Démo dans le navigateur : un décor chargé à la place du jeu, pour juger la lisibilité.
  if (!('__TAURI_INTERNALS__' in window)) document.body.style.background = '#1a1f16 url(https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Sett_0.jpg) center / cover';
  import('./Overlay.svelte').then(({ default: Overlay }) => mount(Overlay, { target: document.getElementById('app') }));
} else {
  import('./App.svelte').then(({ default: App }) => mount(App, { target: document.getElementById('app') }));
}
