import { defineConfig } from 'vite';

// La Mobut App : une page d'accueil et une page par jeu.
// Pour ajouter un jeu : un dossier <jeu>/index.html, son code dans src/<jeu>/, une ligne ici et une dans src/hub/games.ts.
export default defineConfig({
  base: '/',
  build: {
    rollupOptions: {
      input: {
        hub: new URL('./index.html', import.meta.url).pathname,
        volley: new URL('./volley/index.html', import.meta.url).pathname,
        'qui-de-nous': new URL('./qui-de-nous/index.html', import.meta.url).pathname,
        imposteur: new URL('./imposteur/index.html', import.meta.url).pathname,
      },
    },
  },
  // NEXT_PUBLIC_SUPABASE_* : variables créées par l'intégration Supabase de Vercel (publiques par nature).
  envPrefix: ['VITE_', 'NEXT_PUBLIC_SUPABASE_'],
  server: { host: '0.0.0.0', port: 5174 },
});
