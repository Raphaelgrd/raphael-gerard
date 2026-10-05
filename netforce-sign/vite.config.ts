import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * En-têtes de production (vercel.json) réappliqués à `npm run preview`, règle par règle comme sur Vercel,
 * pour tester dans les mêmes conditions. L'URL Supabase locale est ajoutée à connect-src.
 */
function productionHeaders(supabaseUrl?: string): Plugin {
  const conf = JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8'));
  const rules = (conf.headers as { source: string; headers: { key: string; value: string }[] }[]).map((r) => ({
    re: new RegExp(`^${r.source}$`),
    headers: r.headers,
  }));
  return {
    name: 'production-headers',
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '/').split('?')[0];
        for (const rule of rules) {
          if (!rule.re.test(path)) continue;
          for (const { key, value } of rule.headers) {
            if (key === 'Strict-Transport-Security') continue;
            let v = value;
            if (key === 'Content-Security-Policy' && supabaseUrl && !supabaseUrl.includes('supabase.co')) {
              v = v.replace('connect-src', `connect-src ${supabaseUrl}`);
            }
            res.setHeader(key, v);
          }
        }
        next();
      });
    },
  };
}

/**
 * Manifeste du complément Outlook, généré avec l'adresse publique du site :
 * APP_URL si défini, sinon le domaine de production Vercel.
 */
function outlookManifest(): Plugin {
  const base = (
    process.env.APP_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'https://localhost:4173')
  ).replace(/\/$/, '');
  const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
  return {
    name: 'outlook-manifest',
    generateBundle() {
      const xml = readFileSync(new URL('./outlook/manifest.template.xml', import.meta.url), 'utf8')
        .replaceAll('{{BASE}}', base)
        .replaceAll('{{VERSION}}', `${pkg.version}.0`);
      this.emitFile({ type: 'asset', fileName: 'outlook-manifest.xml', source: xml });
    },
  };
}

export default defineConfig(({ mode }) => ({
  base: './',
  build: {
    rollupOptions: {
      input: {
        main: new URL('./index.html', import.meta.url).pathname,
        taskpane: new URL('./taskpane.html', import.meta.url).pathname,
      },
    },
  },
  plugins: [
    react(),
    outlookManifest(),
    productionHeaders(loadEnv(mode, process.cwd(), '').VITE_SUPABASE_URL || loadEnv(mode, process.cwd(), '').NEXT_PUBLIC_SUPABASE_URL),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Netforce Sign',
        short_name: 'NF Sign',
        description: 'Signature et cachet de documents PDF et Word, directement sur votre appareil.',
        lang: 'fr',
        theme_color: '#ffffff',
        background_color: '#ffffff',
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
}));
