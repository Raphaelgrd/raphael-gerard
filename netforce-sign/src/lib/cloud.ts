import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import type { Asset, DocKind, Kind } from '../types';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Sans configuration Supabase, l'app fonctionne en mode local (tout reste sur l'appareil). */
export const cloudEnabled = !!(url && key);

// Lien d'invitation ou de réinitialisation : on note le type avant que supabase-js ne nettoie l'URL.
const hashParams = new URLSearchParams(window.location.hash.slice(1));
export const authLinkType = hashParams.get('type') as 'invite' | 'recovery' | null;
export const authLinkError = hashParams.get('error_description');

export const supabase: SupabaseClient | null = cloudEnabled
  ? createClient(url!, key!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
    })
  : null;

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  role: 'admin' | 'member';
}

export interface LogEntry {
  id: number;
  user_id: string | null;
  document_name: string;
  document_kind: DocKind;
  export_format: DocKind;
  page_count: number | null;
  signature_count: number;
  stamp_count: number;
  created_at: string;
}

const db = () => {
  if (!supabase) throw new Error('Supabase non configuré');
  return supabase;
};

/** Traduit les erreurs Supabase les plus courantes. */
export function frError(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? String(e);
  if (/invalid login credentials/i.test(msg)) return 'E-mail ou mot de passe incorrect.';
  if (/email not confirmed/i.test(msg)) return "Adresse e-mail non confirmée. Vérifiez votre boîte de réception.";
  if (/password should be at least|weak password/i.test(msg)) return 'Mot de passe trop court : 8 caractères minimum.';
  if (/same.*password|different from the old/i.test(msg)) return "Le nouveau mot de passe doit être différent de l'ancien.";
  if (/rate limit|too many/i.test(msg)) return 'Trop de tentatives. Patientez quelques minutes.';
  if (/failed to fetch|network/i.test(msg)) return 'Connexion impossible. Vérifiez votre réseau.';
  if (/row-level security|permission denied/i.test(msg)) return "Action non autorisée pour votre compte.";
  return msg;
}

export async function getSession(): Promise<Session | null> {
  const { data } = await db().auth.getSession();
  return data.session;
}

export async function signIn(email: string, password: string) {
  const { error } = await db().auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw error;
}

export async function signOut() {
  await db().auth.signOut();
}

export async function sendPasswordReset(email: string) {
  const redirectTo = window.location.origin + window.location.pathname;
  const { error } = await db().auth.resetPasswordForEmail(email.trim(), { redirectTo });
  if (error) throw error;
}

export async function setPassword(password: string, fullName?: string) {
  const { error } = await db().auth.updateUser({ password });
  if (error) throw error;
  if (fullName?.trim()) {
    const { data } = await db().auth.getUser();
    if (data.user) await db().from('profiles').update({ full_name: fullName.trim() }).eq('id', data.user.id);
  }
}

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await db().from('profiles').select('id, email, full_name, role').eq('id', userId).maybeSingle();
  if (error) throw error;
  return data as Profile | null;
}

export async function updateFullName(userId: string, fullName: string) {
  const { error } = await db().from('profiles').update({ full_name: fullName.trim() }).eq('id', userId);
  if (error) throw error;
}

/** Signature personnelle + cachet de l'entreprise. */
export async function fetchAssets(userId: string): Promise<Record<Kind, Asset | null>> {
  const { data, error } = await db()
    .from('assets')
    .select('scope, owner, kind, data_url, ratio')
    .or(`scope.eq.company,owner.eq.${userId}`);
  if (error) throw error;
  const pick = (kind: Kind) => {
    const rows = (data ?? []).filter((r) => r.kind === kind);
    // La version personnelle prime sur celle de l'entreprise (cas d'une signature), l'inverse pour le cachet.
    const row =
      kind === 'stamp'
        ? rows.find((r) => r.scope === 'company') ?? rows.find((r) => r.scope === 'user')
        : rows.find((r) => r.scope === 'user');
    return row ? { src: row.data_url as string, ratio: row.ratio as number } : null;
  };
  return { signature: pick('signature'), stamp: pick('stamp') };
}

export async function saveCloudAsset(kind: Kind, asset: Asset) {
  const scope = kind === 'stamp' ? 'company' : 'user';
  const { error } = await db().rpc('save_asset', {
    p_scope: scope,
    p_kind: kind,
    p_data_url: asset.src,
    p_ratio: asset.ratio,
  });
  if (error) throw error;
}

export async function logSignature(entry: {
  document_name: string;
  document_kind: DocKind;
  export_format: DocKind;
  document_sha256: string | null;
  page_count: number;
  signature_count: number;
  stamp_count: number;
}) {
  const { error } = await db().from('signature_log').insert(entry);
  if (error) throw error;
}

export async function fetchHistory(limit = 100): Promise<{ entries: LogEntry[]; names: Map<string, string> }> {
  const { data, error } = await db()
    .from('signature_log')
    .select('id, user_id, document_name, document_kind, export_format, page_count, signature_count, stamp_count, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  const ids = [...new Set((data ?? []).map((d) => d.user_id).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: profiles } = await db().from('profiles').select('id, email, full_name').in('id', ids);
    for (const p of profiles ?? []) names.set(p.id, p.full_name || p.email);
  }
  return { entries: (data ?? []) as LogEntry[], names };
}

export async function sha256(bytes: ArrayBuffer): Promise<string | null> {
  try {
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}
