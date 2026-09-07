import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  root: 'apps/web',
  plugins: [react(), VitePWA({
    strategies: 'injectManifest', srcDir: 'src', filename: 'sw.ts',
    injectRegister: false,
    manifest: {
      id: '/', name: 'Vault Terminal — личный блокнот', short_name: 'Vault Terminal',
      description: 'Записывай сейчас. Организуй потом. Сохраняй всё.',
      lang: 'ru', start_url: '/', scope: '/', display: 'standalone',
      background_color: '#0a0e0b', theme_color: '#0a0e0b',
      icons: [192, 512].map(size => ({src: `/icon-${size}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'any maskable'}))
    },
    injectManifest: { globPatterns: ['**/*.{js,css,html,svg,png,woff2}'] }
  })],
  server: { host: 'localhost', port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:8787' } },
  build: { outDir: '../../dist/web', emptyOutDir: true },
});
