-- Auto-notes : chacun peut se noter lui-même, à part des votes entre joueurs.
-- Table séparée : ces notes ne comptent jamais dans le classement général.

create table if not exists public.self_votes (
  token      uuid primary key,
  voter      text not null,
  ratings    jsonb not null,
  notes      jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.self_votes enable row level security;
revoke all on public.self_votes from anon, authenticated;
grant select, delete on public.self_votes to authenticated;

drop policy if exists "admins lisent les auto-notes" on public.self_votes;
create policy "admins lisent les auto-notes" on public.self_votes
  for select to authenticated using (public.is_admin());

drop policy if exists "admins suppriment les auto-notes" on public.self_votes;
create policy "admins suppriment les auto-notes" on public.self_votes
  for delete to authenticated using (public.is_admin());

-- Enregistre ou remplace l'auto-note liée au jeton de l'appareil.
create or replace function public.submit_self_vote(p_token uuid, p_voter text, p_ratings jsonb, p_notes jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  players text[] := array['matias', 'raphael1', 'raphael2', 'sofiane', 'mathieu', 'paco'];
  cats    text[] := array['serve', 'set', 'hit', 'receive', 'block', 'defense'];
  c text;
  v jsonb;
  e record;
begin
  if p_token is null then
    raise exception 'jeton manquant';
  end if;
  if p_voter is null or not (p_voter = any (players)) then
    raise exception 'joueur inconnu';
  end if;
  if p_ratings is null or jsonb_typeof(p_ratings) <> 'object'
     or (select count(*) from jsonb_object_keys(p_ratings)) <> array_length(cats, 1) then
    raise exception 'notes incomplètes';
  end if;
  foreach c in array cats loop
    v := p_ratings -> c;
    if v is null or jsonb_typeof(v) <> 'number'
       or (v::text)::numeric not between 0 and 10
       or (v::text)::numeric <> trunc((v::text)::numeric) then
      raise exception 'note invalide pour %', c;
    end if;
  end loop;

  p_notes := coalesce(p_notes, '{}'::jsonb);
  if jsonb_typeof(p_notes) <> 'object' then
    raise exception 'commentaires invalides';
  end if;
  for e in select key, value from jsonb_each(p_notes) loop
    if not (e.key = any (cats)) or jsonb_typeof(e.value) <> 'string' or length(e.value #>> '{}') > 500 then
      raise exception 'commentaire invalide';
    end if;
  end loop;

  -- Garde-fou contre le spam : au plus 60 auto-notes au total.
  if not exists (select 1 from public.self_votes where token = p_token)
     and (select count(*) from public.self_votes) >= 60 then
    raise exception 'trop d''auto-notes';
  end if;

  insert into public.self_votes (token, voter, ratings, notes)
  values (p_token, p_voter, p_ratings, p_notes)
  on conflict (token) do update
    set voter = excluded.voter,
        ratings = excluded.ratings,
        notes = excluded.notes,
        updated_at = now();
end;
$$;

-- Relit l'auto-note de cet appareil (pour la modifier).
create or replace function public.get_my_self_vote(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('voter', voter, 'ratings', ratings, 'notes', notes, 'updatedAt', updated_at)
  from public.self_votes
  where token = p_token;
$$;

-- Toutes les auto-notes, publiques (sans les jetons secrets).
create or replace function public.get_self_votes()
returns table (id text, voter text, ratings jsonb, notes jsonb, updated_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select left(md5(token::text), 12), voter, ratings, notes, updated_at
  from public.self_votes
  order by updated_at;
$$;

revoke all on function public.submit_self_vote(uuid, text, jsonb, jsonb) from public;
revoke all on function public.get_my_self_vote(uuid) from public;
revoke all on function public.get_self_votes() from public;
grant execute on function public.submit_self_vote(uuid, text, jsonb, jsonb) to anon, authenticated;
grant execute on function public.get_my_self_vote(uuid) to anon, authenticated;
grant execute on function public.get_self_votes() to anon, authenticated;
