import { readFileSync } from 'node:fs';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/** En-têtes de production (vercel.json), réappliqués à `npm run preview` pour tester dans les mêmes conditions. */
function productionHeaders(supabaseUrl?: string): Record<string, string> {
  const conf = JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8'));
  const headers: Record<string, string> = {};
  for (const h of conf.headers[0].headers) headers[h.key] = h.value;
  delete headers['Strict-Transport-Security'];
  if (supabaseUrl && !supabaseUrl.includes('supabase.co')) {
    headers['Content-Security-Policy'] = headers['Content-Security-Policy'].replace('connect-src', `connect-src ${supabaseUrl}`);
  }
  return headers;
}

export default defineConfig(({ mode }) => ({
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
  // NEXT_PUBLIC_SUPABASE_* : variables créées par l'intégration Supabase de Vercel (publiques par nature).
  envPrefix: ['VITE_', 'NEXT_PUBLIC_SUPABASE_'],
  server: { host: '0.0.0.0', port: 5173 },
  preview: { headers: productionHeaders(loadEnv(mode, process.cwd(), '').VITE_SUPABASE_URL || loadEnv(mode, process.cwd(), '').NEXT_PUBLIC_SUPABASE_URL) },
}));
