-- Netforce Sign : comptes d'équipe, signatures, cachet de l'entreprise, historique.
-- Les documents eux-mêmes ne sont jamais stockés : seul leur nom et leur empreinte SHA-256 sont journalisés.
-- Script rejouable : il peut être exécuté plusieurs fois sans erreur (il complète ce qui manque).

-- ---------------------------------------------------------------------------
-- Profils
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'member' check (role in ('admin', 'member')),
  created_at timestamptz not null default now()
);

-- Un profil est créé automatiquement pour chaque compte.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles where id = (select auth.uid()) and role = 'admin'
  );
$$;

alter table public.profiles enable row level security;

-- Toute l'équipe voit les noms (affichés dans l'historique).
drop policy if exists "profiles: lecture équipe" on public.profiles;
create policy "profiles: lecture équipe" on public.profiles
  for select to authenticated using (true);

-- Chacun peut modifier son nom, jamais son rôle (le rôle se change depuis le tableau de bord Supabase).
drop policy if exists "profiles: modifier le sien" on public.profiles;
create policy "profiles: modifier le sien" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (full_name) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Signatures (personnelles) et cachet (commun à l'entreprise)
-- ---------------------------------------------------------------------------

create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('user', 'company')),
  owner uuid references auth.users (id) on delete cascade,
  kind text not null check (kind in ('signature', 'stamp')),
  data_url text not null check (data_url like 'data:image/png;base64,%' and length(data_url) <= 4000000),
  ratio real not null check (ratio > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null default auth.uid(),
  constraint assets_owner_scope check ((scope = 'user') = (owner is not null))
);

create unique index if not exists assets_user_kind on public.assets (owner, kind) where scope = 'user';
create unique index if not exists assets_company_kind on public.assets (kind) where scope = 'company';

alter table public.assets enable row level security;

drop policy if exists "assets: lecture" on public.assets;
create policy "assets: lecture" on public.assets
  for select to authenticated
  using (scope = 'company' or owner = (select auth.uid()));

drop policy if exists "assets: ajout" on public.assets;
create policy "assets: ajout" on public.assets
  for insert to authenticated
  with check (
    (scope = 'user' and owner = (select auth.uid()))
    or (scope = 'company' and (select public.is_admin()))
  );

drop policy if exists "assets: modification" on public.assets;
create policy "assets: modification" on public.assets
  for update to authenticated
  using ((scope = 'user' and owner = (select auth.uid())) or (scope = 'company' and (select public.is_admin())))
  with check ((scope = 'user' and owner = (select auth.uid())) or (scope = 'company' and (select public.is_admin())));

drop policy if exists "assets: suppression" on public.assets;
create policy "assets: suppression" on public.assets
  for delete to authenticated
  using ((scope = 'user' and owner = (select auth.uid())) or (scope = 'company' and (select public.is_admin())));

revoke all on public.assets from anon;

-- Enregistre (ou remplace) une signature personnelle ou le cachet de l'entreprise.
-- security invoker : les règles RLS ci-dessus s'appliquent.
create or replace function public.save_asset(p_scope text, p_kind text, p_data_url text, p_ratio real)
returns public.assets
language plpgsql
security invoker
set search_path = ''
as $$
declare
  result public.assets;
begin
  if p_scope = 'company' then
    insert into public.assets (scope, owner, kind, data_url, ratio)
    values ('company', null, p_kind, p_data_url, p_ratio)
    on conflict (kind) where scope = 'company'
    do update set data_url = excluded.data_url, ratio = excluded.ratio, updated_at = now(), updated_by = auth.uid()
    returning * into result;
  else
    insert into public.assets (scope, owner, kind, data_url, ratio)
    values ('user', auth.uid(), p_kind, p_data_url, p_ratio)
    on conflict (owner, kind) where scope = 'user'
    do update set data_url = excluded.data_url, ratio = excluded.ratio, updated_at = now(), updated_by = auth.uid()
    returning * into result;
  end if;
  return result;
end;
$$;

revoke execute on function public.save_asset(text, text, text, real) from public, anon;
grant execute on function public.save_asset(text, text, text, real) to authenticated;

-- ---------------------------------------------------------------------------
-- Historique des signatures (journal en ajout seul)
-- ---------------------------------------------------------------------------

create table if not exists public.signature_log (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null default auth.uid(),
  document_name text not null check (length(document_name) <= 300),
  document_kind text not null check (document_kind in ('pdf', 'docx')),
  export_format text not null check (export_format in ('pdf', 'docx')),
  document_sha256 text check (document_sha256 ~ '^[0-9a-f]{64}$'),
  page_count int check (page_count >= 0),
  signature_count int not null default 0 check (signature_count >= 0),
  stamp_count int not null default 0 check (stamp_count >= 0),
  created_at timestamptz not null default now()
);

create index if not exists signature_log_user_created on public.signature_log (user_id, created_at desc);
create index if not exists signature_log_created on public.signature_log (created_at desc);

alter table public.signature_log enable row level security;

drop policy if exists "log: ajout du sien" on public.signature_log;
create policy "log: ajout du sien" on public.signature_log
  for insert to authenticated
  with check (user_id = (select auth.uid()));

-- Chacun voit son historique ; un administrateur voit celui de toute l'équipe.
drop policy if exists "log: lecture" on public.signature_log;
create policy "log: lecture" on public.signature_log
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

revoke all on public.signature_log from anon;
revoke update, delete on public.signature_log from authenticated;
