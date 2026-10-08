-- Qui de nous ? : pour chaque question, chacun classe les 6 joueurs du 1er au 6e.
--
-- Les visiteurs (clé anon) n'ont aucun accès direct à la table : ils passent par
-- qdn_submit, qdn_my_answers et qdn_all_answers. Chaque appareil répond avec un
-- jeton secret (uuid) gardé dans le navigateur, qui permet de modifier ses réponses.
-- Les classements sont publics, mais les jetons ne sont jamais renvoyés.
-- Ce script peut tourner dans le même projet Supabase que Notes Volley.

create table if not exists public.qdn_answers (
  token       uuid not null,
  voter       text not null,
  question_id text not null,
  ranking     jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (token, question_id)
);

alter table public.qdn_answers enable row level security;
revoke all on public.qdn_answers from anon, authenticated;

-- Enregistre ou remplace le classement de cet appareil pour une question.
create or replace function public.qdn_submit(p_token uuid, p_voter text, p_question text, p_ranking jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  players text[] := array['matias', 'raphs', 'raphg', 'sofiane', 'mathieu', 'paco'];
begin
  if p_token is null then
    raise exception 'jeton manquant';
  end if;
  if p_voter is null or not (p_voter = any (players)) then
    raise exception 'joueur inconnu';
  end if;
  if p_question is null or p_question !~ '^[a-z0-9_-]{1,40}$' then
    raise exception 'question invalide';
  end if;
  -- Le classement doit contenir les 6 joueurs, chacun une seule fois.
  if p_ranking is null or jsonb_typeof(p_ranking) <> 'array'
     or jsonb_array_length(p_ranking) <> array_length(players, 1)
     or exists (select 1 from jsonb_array_elements(p_ranking) e where jsonb_typeof(e) <> 'string')
     or (select array_agg(x order by x) from jsonb_array_elements_text(p_ranking) x)
        <> (select array_agg(x order by x) from unnest(players) x) then
    raise exception 'classement invalide';
  end if;

  -- Garde-fou contre le spam.
  if not exists (select 1 from public.qdn_answers where token = p_token and question_id = p_question)
     and (select count(*) from public.qdn_answers) >= 3000 then
    raise exception 'trop de réponses';
  end if;

  insert into public.qdn_answers (token, voter, question_id, ranking)
  values (p_token, p_voter, p_question, p_ranking)
  on conflict (token, question_id) do update
    set voter = excluded.voter,
        ranking = excluded.ranking,
        updated_at = now();
end;
$$;

-- Les réponses de cet appareil (pour reprendre ou modifier).
create or replace function public.qdn_my_answers(p_token uuid)
returns table (voter text, question_id text, ranking jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select voter, question_id, ranking
  from public.qdn_answers
  where token = p_token;
$$;

-- Toutes les réponses, publiques, sans les jetons (remplacés par une empreinte courte).
create or replace function public.qdn_all_answers()
returns table (id text, voter text, question_id text, ranking jsonb, updated_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select left(md5(token::text), 12), voter, question_id, ranking, updated_at
  from public.qdn_answers
  order by updated_at;
$$;

revoke all on function public.qdn_submit(uuid, text, text, jsonb) from public;
revoke all on function public.qdn_my_answers(uuid) from public;
revoke all on function public.qdn_all_answers() from public;
grant execute on function public.qdn_submit(uuid, text, text, jsonb) to anon, authenticated;
grant execute on function public.qdn_my_answers(uuid) to anon, authenticated;
grant execute on function public.qdn_all_answers() to anon, authenticated;
