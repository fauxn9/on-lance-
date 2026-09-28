import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  // WebView2 est un Chromium récent : pas besoin de transpiler pour de vieux navigateurs.
  build: { target: 'chrome120', outDir: 'dist', emptyOutDir: true },
});
