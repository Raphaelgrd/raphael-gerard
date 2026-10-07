-- Notes Volley : votes anonymes entre amis, classement public, détail réservé aux admins.
--
-- Accès :
--   * les visiteurs (clé anon) n'ont AUCUN accès direct à la table votes ;
--     ils passent par trois fonctions : submit_vote, get_my_vote, get_ranking ;
--   * chaque appareil vote avec un jeton secret (uuid) gardé dans le navigateur :
--     seul ce jeton permet de relire ou de modifier son vote ;
--   * le classement ne renvoie que des moyennes ;
--   * les comptes listés dans public.admins (connectés par e-mail) lisent et suppriment les votes.

create table if not exists public.votes (
  token      uuid primary key,
  voter      text not null,
  ratings    jsonb not null,
  notes      jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admins (
  email text primary key
);

alter table public.votes  enable row level security;
alter table public.admins enable row level security;

revoke all on public.votes  from anon, authenticated;
revoke all on public.admins from anon, authenticated;

-- Admin = utilisateur connecté dont l'e-mail figure dans public.admins.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admins
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

grant select, delete on public.votes to authenticated;

drop policy if exists "admins lisent les votes" on public.votes;
create policy "admins lisent les votes" on public.votes
  for select to authenticated using (public.is_admin());

drop policy if exists "admins suppriment les votes" on public.votes;
create policy "admins suppriment les votes" on public.votes
  for delete to authenticated using (public.is_admin());

-- Enregistre ou remplace le vote lié au jeton, après validation complète.
create or replace function public.submit_vote(p_token uuid, p_voter text, p_ratings jsonb, p_notes jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  players text[] := array['matias', 'raphael1', 'raphael2', 'sofiane', 'mathieu', 'paco'];
  cats    text[] := array['serve', 'set', 'hit', 'receive', 'block', 'defense'];
  t text;
  c text;
  v jsonb;
  n record;
  e record;
begin
  if p_token is null then
    raise exception 'jeton manquant';
  end if;
  if p_voter is null or not (p_voter = any (players)) then
    raise exception 'joueur inconnu';
  end if;
  if p_ratings is null or jsonb_typeof(p_ratings) <> 'object'
     or (select count(*) from jsonb_object_keys(p_ratings)) <> array_length(players, 1) - 1 then
    raise exception 'notes incomplètes';
  end if;

  foreach t in array players loop
    continue when t = p_voter;
    if jsonb_typeof(p_ratings -> t) is distinct from 'object'
       or (select count(*) from jsonb_object_keys(p_ratings -> t)) <> array_length(cats, 1) then
      raise exception 'notes incomplètes pour %', t;
    end if;
    foreach c in array cats loop
      v := p_ratings -> t -> c;
      if v is null or jsonb_typeof(v) <> 'number'
         or (v::text)::numeric not between 0 and 10
         or (v::text)::numeric <> trunc((v::text)::numeric) then
        raise exception 'note invalide pour % / %', t, c;
      end if;
    end loop;
  end loop;

  p_notes := coalesce(p_notes, '{}'::jsonb);
  if jsonb_typeof(p_notes) <> 'object' then
    raise exception 'commentaires invalides';
  end if;
  for n in select key, value from jsonb_each(p_notes) loop
    if n.key = p_voter or not (n.key = any (players)) or jsonb_typeof(n.value) <> 'object' then
      raise exception 'commentaires invalides';
    end if;
    for e in select key, value from jsonb_each(n.value) loop
      if not (e.key = any (cats)) or jsonb_typeof(e.value) <> 'string' or length(e.value #>> '{}') > 500 then
        raise exception 'commentaire invalide';
      end if;
    end loop;
  end loop;

  -- Garde-fou contre le spam : au plus 60 votes au total.
  if not exists (select 1 from public.votes where token = p_token)
     and (select count(*) from public.votes) >= 60 then
    raise exception 'trop de votes';
  end if;

  insert into public.votes (token, voter, ratings, notes)
  values (p_token, p_voter, p_ratings, p_notes)
  on conflict (token) do update
    set voter = excluded.voter,
        ratings = excluded.ratings,
        notes = excluded.notes,
        updated_at = now();
end;
$$;

-- Relit le vote de cet appareil (pour le modifier).
create or replace function public.get_my_vote(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('voter', voter, 'ratings', ratings, 'notes', notes, 'updatedAt', updated_at)
  from public.votes
  where token = p_token;
$$;

-- Classement public : uniquement des moyennes, jamais qui a mis quoi.
create or replace function public.get_ranking()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with r as (
    select t.key as target, c.key as cat, (c.value::text)::numeric as score
    from public.votes v,
         jsonb_each(v.ratings) t,
         jsonb_each(t.value) c
    where t.key <> v.voter
  ),
  per_cat as (
    select target, cat, avg(score) as a, count(*) as n
    from r
    group by target, cat
  ),
  per_player as (
    select target,
           round(avg(a), 2) as overall,
           jsonb_object_agg(cat, round(a, 2)) as cats,
           max(n) as cnt
    from per_cat
    group by target
  )
  select jsonb_build_object(
    'voters', (select count(*) from public.votes),
    'updatedAt', (select max(updated_at) from public.votes),
    'players', coalesce(
      (select jsonb_object_agg(target, jsonb_build_object('overall', overall, 'cats', cats, 'count', cnt)) from per_player),
      '{}'::jsonb
    )
  );
$$;

revoke all on function public.is_admin() from public;
revoke all on function public.submit_vote(uuid, text, jsonb, jsonb) from public;
revoke all on function public.get_my_vote(uuid) from public;
revoke all on function public.get_ranking() from public;

grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.submit_vote(uuid, text, jsonb, jsonb) to anon, authenticated;
grant execute on function public.get_my_vote(uuid) to anon, authenticated;
grant execute on function public.get_ranking() to anon, authenticated;
