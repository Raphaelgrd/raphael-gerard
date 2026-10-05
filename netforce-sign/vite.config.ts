import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Netforce Sign',
        short_name: 'NF Sign',
        description: 'Signature et cachet de documents PDF et Word, directement sur votre appareil.',
        lang: 'fr',
        theme_color: '#0B1733',
        background_color: '#0B1733',
        display: 'standalone',
        start_url: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,mjs,woff2}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
    }),
  ],
  server: { host: '0.0.0.0', port: 5173 },
});
