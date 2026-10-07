import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // NEXT_PUBLIC_SUPABASE_* : variables créées par l'intégration Supabase de Vercel (publiques par nature).
  envPrefix: ['VITE_', 'NEXT_PUBLIC_SUPABASE_'],
  server: { host: '0.0.0.0', port: 5174 },
});
