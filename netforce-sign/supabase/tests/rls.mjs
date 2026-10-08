// Vérifie les règles d'accès sur un Supabase local : `npx supabase start` puis `node supabase/tests/rls.mjs`.
// Crée deux comptes de test (un admin, un membre). À ne jamais lancer sur le projet de production.
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
// Clés de démonstration publiques du Supabase local (identiques sur toutes les installations locales).
const ANON =
  process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE =
  process.env.SUPABASE_SERVICE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

if (!/127\.0\.0\.1|localhost/.test(URL)) {
  console.error('Ce script ne doit tourner que sur un Supabase local.');
  process.exit(1);
}

const opts = { auth: { persistSession: false } };
const service = createClient(URL, SERVICE, opts);
const PASSWORD = 'MotDePasse2026';
let fails = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra && !cond ? ` — ${extra}` : ''}`);
  if (!cond) fails++;
};

// Domaine des comptes de test autorisé (la table n'est accessible qu'en service).
await service.from('signup_allowlist').upsert({ entry: 'netforce.test' });

for (const [email, full_name] of [
  ['admin@netforce.test', 'Admin Test'],
  ['agent@netforce.test', 'Agent Test'],
]) {
  const { error } = await service.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { full_name } });
  if (error && !/already/i.test(error.message)) throw error;
}
await service.from('profiles').update({ role: 'admin' }).eq('email', 'admin@netforce.test');

const login = async (email) => {
  const c = createClient(URL, ANON, opts);
  const { data, error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return { c, id: data.user.id };
};
const A = await login('admin@netforce.test');
const M = await login('agent@netforce.test');
const anon = createClient(URL, ANON, opts);
const png = 'data:image/png;base64,iVBORw0KGgo=';

// Comptes
const su = await anon.auth.signUp({ email: 'intrus@exemple.com', password: PASSWORD });
check('inscription hors entreprise refusée', !!su.error, 'inscription acceptée');
const inv = await service.auth.admin.createUser({ email: 'pirate@exemple.com', password: PASSWORD, email_confirm: true });
check('aucun compte hors liste, même créé en service', !!inv.error);
const ok = await anon.auth.signUp({
  email: `nouveau${Date.now()}@NETFORCE.test`,
  password: PASSWORD,
  options: { data: { full_name: 'Nouveau Membre' } },
});
check(
  "inscription libre avec l'adresse de l'entreprise, confirmation par e-mail",
  !ok.error && !!ok.data.user?.identities?.length && !ok.data.session,
  ok.error?.message,
);
const np = await service.from('profiles').select('full_name, role').eq('id', ok.data.user?.id).single();
check('le nouveau compte est un membre, avec son nom', np.data?.full_name === 'Nouveau Membre' && np.data?.role === 'member');
const list = await anon.from('signup_allowlist').select('*');
const list2 = await (await login('agent@netforce.test')).c.from('signup_allowlist').select('*');
check('la liste des adresses autorisées est privée', !list.data?.length && !list2.data?.length);

const p = await M.c.from('profiles').select('full_name, role').eq('id', M.id).single();
check('profil créé automatiquement avec le nom', ['Agent Test', 'Agent Renommé'].includes(p.data?.full_name) && p.data?.role === 'member');
await M.c.from('profiles').update({ role: 'admin' }).eq('id', M.id);
const p2 = await service.from('profiles').select('role').eq('id', M.id).single();
check('un membre ne peut pas se promouvoir admin', p2.data.role === 'member');
const rn = await M.c.from('profiles').update({ full_name: 'Agent Renommé' }).eq('id', M.id).select();
check('un membre peut changer son nom', rn.data?.[0]?.full_name === 'Agent Renommé', rn.error?.message);
const other = await M.c.from('profiles').update({ full_name: 'Pirate' }).eq('id', A.id).select();
check("un membre ne peut pas renommer quelqu'un d'autre", !other.data?.length);

// Cachet de l'entreprise
const ms = await M.c.rpc('save_asset', { p_scope: 'company', p_kind: 'stamp', p_data_url: png, p_ratio: 1 });
check('un membre ne peut pas modifier le cachet', !!ms.error);
const as = await A.c.rpc('save_asset', { p_scope: 'company', p_kind: 'stamp', p_data_url: png, p_ratio: 1 });
check("l'admin enregistre le cachet", !as.error, as.error?.message);
const as2 = await A.c.rpc('save_asset', { p_scope: 'company', p_kind: 'stamp', p_data_url: png, p_ratio: 1.5 });
check("l'admin remplace le cachet sans doublon", !as2.error && as2.data?.ratio === 1.5, as2.error?.message);
const mupd = await M.c.from('assets').update({ ratio: 9 }).eq('scope', 'company').select();
check('un membre ne peut pas modifier le cachet en direct', !mupd.data?.length);

// Signatures et cachets personnels
for (const u of [A, M]) {
  const r = await u.c.rpc('save_asset', { p_scope: 'user', p_kind: 'signature', p_data_url: png, p_ratio: 3 });
  check('chacun enregistre sa signature', !r.error, r.error?.message);
}
const mst = await M.c.rpc('save_asset', { p_scope: 'user', p_kind: 'stamp', p_data_url: png, p_ratio: 2 });
check('un membre enregistre son propre cachet', !mst.error, mst.error?.message);
const ast = await A.c.from('assets').select('owner').eq('scope', 'user').eq('kind', 'stamp');
check("le cachet d'un membre reste privé", !ast.data?.some((r) => r.owner === M.id));
const r2 = await M.c.rpc('save_asset', { p_scope: 'user', p_kind: 'signature', p_data_url: png, p_ratio: 4 });
check('la signature est remplacée', !r2.error && r2.data?.ratio === 4, r2.error?.message);
const seen = await M.c.from('assets').select('scope, owner, kind');
check(
  'un membre voit le cachet commun et les siens, rien d’autre',
  seen.data?.length === 3 && seen.data.every((r) => r.scope === 'company' || r.owner === M.id),
  JSON.stringify(seen.data),
);
const forged = await M.c.from('assets').insert({ scope: 'user', owner: A.id, kind: 'signature', data_url: png, ratio: 1 });
check("impossible d'écrire la signature d'un autre", !!forged.error);
const bad = await M.c.rpc('save_asset', { p_scope: 'user', p_kind: 'signature', p_data_url: 'javascript:alert(1)', p_ratio: 3 });
check('contenu autre que PNG refusé', !!bad.error);
const anonRead = await anon.from('assets').select('*');
check('non connecté : aucune donnée lisible', !anonRead.data?.length);

// Historique
const entry = {
  document_name: 'contrat.pdf',
  document_kind: 'pdf',
  export_format: 'pdf',
  document_sha256: 'a'.repeat(64),
  page_count: 2,
  signature_count: 2,
  stamp_count: 1,
};
const li = await M.c.from('signature_log').insert(entry);
check('un membre journalise ses signatures', !li.error, li.error?.message);
await A.c.from('signature_log').insert({ ...entry, document_name: 'admin.docx', document_kind: 'docx' });
const forgedLog = await M.c.from('signature_log').insert({ ...entry, user_id: A.id });
check("impossible de journaliser au nom d'un autre", !!forgedLog.error);
const mh = await M.c.from('signature_log').select('user_id');
check('un membre ne voit que son historique', mh.data?.length >= 1 && mh.data.every((e) => e.user_id === M.id));
const ah = await A.c.from('signature_log').select('user_id');
check("l'admin voit l'historique de toute l'équipe", new Set(ah.data?.map((e) => e.user_id)).size === 2);
await M.c.from('signature_log').delete().eq('user_id', M.id);
await M.c.from('signature_log').update({ document_name: 'falsifié' }).eq('user_id', M.id);
const still = await service.from('signature_log').select('document_name').eq('user_id', M.id);
check("l'historique ne peut être ni effacé ni modifié", still.data.length >= 1 && still.data.every((e) => e.document_name === 'contrat.pdf'));

console.log(fails ? `\n${fails} échec(s)` : '\nToutes les règles sont respectées.');
process.exit(fails ? 1 : 0);
