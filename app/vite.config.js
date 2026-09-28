import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  // Le Rust compile dans target/ : le surveiller fait planter Vite sur des
  // fichiers verrouillés par Windows, et ne sert à rien.
  server: { port: 1420, strictPort: true, watch: { ignored: ['**/target/**', '**/src-tauri/**', '**/crates/**'] } },
  // WebView2 est un Chromium récent : pas besoin de transpiler pour de vieux navigateurs.
  build: { target: 'chrome120', outDir: 'dist', emptyOutDir: true },
});
