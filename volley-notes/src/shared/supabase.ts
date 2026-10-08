import { createClient } from '@supabase/supabase-js';

// Client Supabase commun à tous les jeux de la Mobut App.
// Noms VITE_* (configuration manuelle) ou NEXT_PUBLIC_* (intégration Supabase de Vercel).
const env = import.meta.env;
const url = (env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL) as string | undefined;
const key = (env.VITE_SUPABASE_ANON_KEY ||
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) as string | undefined;

/** null quand les variables Supabase ne sont pas renseignées. */
export const supabase = url && key ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } }) : null;
