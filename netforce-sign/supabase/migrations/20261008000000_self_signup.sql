-- Netforce Sign : création de compte libre, réservée aux adresses de l'entreprise.
-- Chaque membre a désormais sa propre signature et son propre cachet (aucun changement de table nécessaire).
-- Script rejouable : il peut être exécuté plusieurs fois sans erreur.

-- Adresses autorisées à créer un compte : un domaine entier (« nexstun.com ») ou une adresse précise (« prenom@gmail.com »).
create table if not exists public.signup_allowlist (
  entry text primary key check (entry = lower(entry) and entry !~ '\s'),
  created_at timestamptz not null default now()
);

alter table public.signup_allowlist enable row level security;
revoke all on public.signup_allowlist from anon, authenticated;

insert into public.signup_allowlist (entry) values ('nexstun.com') on conflict do nothing;

-- Refuse tout nouveau compte (inscription, invitation, création depuis le tableau de bord) hors de la liste.
create or replace function public.check_signup_allowed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  addr text := lower(coalesce(new.email, ''));
begin
  if not exists (
    select 1 from public.signup_allowlist
    where entry = addr or entry = split_part(addr, '@', 2)
  ) then
    raise exception 'Adresse e-mail non autorisée : %', addr using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists check_signup_allowed on auth.users;
create trigger check_signup_allowed
  before insert on auth.users
  for each row execute function public.check_signup_allowed();
