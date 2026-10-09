-- Mimic Party : on imite un son de référence au micro ; l'app note la ressemblance et les autres votent.
-- Déroulé d'une manche : chacun s'entraîne et envoie son imitation en secret (record), puis chacun passe
-- au micro à tour de rôle devant tout le monde avec sa note révélée à la fin (stage), puis vote, puis résultats.
--
-- Fichiers audio dans le stockage Supabase (bucket public « mimic ») :
--   sounds/…  la bibliothèque de sons de référence, alimentée depuis l'app ;
--   takes/…   les imitations enregistrées pendant les parties.
-- Les tables ne sont pas accessibles avec la clé anon : tout passe par les fonctions mm_*.

/* ---------- stockage ---------- */
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mimic', 'mimic', true, 3145728, array['audio/*'])
on conflict (id) do update
  set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Envoi de fichiers seulement dans sounds/ et takes/ ; lecture publique par lien ; ni modification ni suppression.
drop policy if exists "mimic : envoi des sons" on storage.objects;
create policy "mimic : envoi des sons" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'mimic' and (storage.foldername(name))[1] in ('sounds', 'takes'));

/* ---------- tables ---------- */
create table if not exists public.mm_sounds (
  id         bigserial primary key,
  title      text not null,
  path       text not null,
  duration   real not null,
  added_by   text not null,
  hidden     boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.mm_lobby (
  player  text primary key,
  token   uuid not null,
  seen_at timestamptz not null default now()
);

create table if not exists public.mm_games (
  id               bigserial primary key,
  status           text not null,
  players          text[] not null,
  sounds           bigint[] not null,
  round            int not null default 1,
  stage_order      text[],
  stage_index      int not null default 0,
  phase_started_at timestamptz not null default now(),
  winner           text,
  aborted          boolean not null default false,
  created_by       text not null,
  created_at       timestamptz not null default now(),
  ended_at         timestamptz
);

create table if not exists public.mm_seats (
  game_id bigint not null references public.mm_games (id) on delete cascade,
  player  text not null,
  token   uuid not null,
  primary key (game_id, player)
);

create table if not exists public.mm_takes (
  game_id    bigint not null references public.mm_games (id) on delete cascade,
  round      int not null,
  player     text not null,
  path       text not null,
  score      int not null check (score between 0 and 100),
  duration   real not null default 0,
  created_at timestamptz not null default now(),
  primary key (game_id, round, player)
);

create table if not exists public.mm_votes (
  game_id bigint not null references public.mm_games (id) on delete cascade,
  round   int not null,
  voter   text not null,
  target  text not null,
  primary key (game_id, round, voter)
);

-- Mises à niveau si une version précédente du script a déjà été lancée.
alter table public.mm_games add column if not exists stage_order text[];
alter table public.mm_games add column if not exists stage_index int not null default 0;
alter table public.mm_takes add column if not exists duration real not null default 0;
alter table public.mm_games drop constraint if exists mm_games_status_check;
alter table public.mm_games add constraint mm_games_status_check check (status in ('record', 'stage', 'vote', 'results', 'ended'));
drop function if exists public.mm_to_vote(bigint);
drop function if exists public.mm_submit_take(uuid, int, text, int);

alter table public.mm_sounds enable row level security;
alter table public.mm_lobby enable row level security;
alter table public.mm_games enable row level security;
alter table public.mm_seats enable row level security;
alter table public.mm_takes enable row level security;
alter table public.mm_votes enable row level security;
revoke all on public.mm_sounds, public.mm_lobby, public.mm_games, public.mm_seats, public.mm_takes, public.mm_votes
  from anon, authenticated;

/* ---------- fonctions internes ---------- */

create or replace function public.mm_players()
returns text[]
language sql
immutable
as $$ select array['matias', 'raphs', 'raphg', 'sofiane', 'mathieu', 'paco'] $$;

-- Points d'une imitation : la note de l'app (sur 10) + 3 points par vote reçu.
create or replace function public.mm_points(p_game bigint, p_round int, p_player text)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select round(score / 10.0)::int from public.mm_takes where game_id = p_game and round = p_round and player = p_player), 0)
       + 3 * (select count(*)::int from public.mm_votes where game_id = p_game and round = p_round and target = p_player);
$$;

create or replace function public.mm_lock_current(p_token uuid, out game_id bigint, out me text)
language plpgsql
security definer
set search_path = public
as $$
begin
  select g.id into game_id from public.mm_games g order by g.id desc limit 1 for update;
  if game_id is null then
    raise exception 'aucune partie';
  end if;
  select s.player into me from public.mm_seats s where s.game_id = mm_lock_current.game_id and s.token = p_token;
  if me is null then
    raise exception 'tu ne joues pas dans cette partie';
  end if;
end;
$$;

-- Fin de l'enregistrement : passage au micro dans un ordre tiré au hasard (ou résultats si personne n'a envoyé).
create or replace function public.mm_to_stage(p_game bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.mm_games;
  order_ text[];
begin
  select * into g from public.mm_games where id = p_game;
  select array_agg(player order by random()) into order_ from public.mm_takes where game_id = p_game and round = g.round;
  update public.mm_games
  set status = case when order_ is null then 'results' else 'stage' end,
      stage_order = order_, stage_index = 0, phase_started_at = now()
  where id = p_game;
end;
$$;

-- Durée d'un passage au micro : marche jusqu'au micro (2 s), l'imitation, puis la note (3 s).
create or replace function public.mm_stage_length(p_duration real)
returns interval
language sql
immutable
as $$ select make_interval(secs => 2 + coalesce(p_duration, 0) + 3) $$;

/* ---------- fonctions appelées par le site ---------- */

create or replace function public.mm_heartbeat(p_token uuid, p_player text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_token is null or not (p_player = any (public.mm_players())) then
    raise exception 'joueur inconnu';
  end if;
  delete from public.mm_lobby where token = p_token and player <> p_player;
  insert into public.mm_lobby (player, token, seen_at) values (p_player, p_token, now())
  on conflict (player) do update set token = excluded.token, seen_at = now();
end;
$$;

-- Ajoute un son à la bibliothèque (le fichier a déjà été envoyé dans sounds/).
create or replace function public.mm_add_sound(p_player text, p_title text, p_path text, p_duration real)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  t text := trim(coalesce(p_title, ''));
  new_id bigint;
begin
  if not (p_player = any (public.mm_players())) then
    raise exception 'joueur inconnu';
  end if;
  if length(t) < 1 or length(t) > 60 then
    raise exception 'titre entre 1 et 60 caractères';
  end if;
  if p_path !~ '^sounds/[A-Za-z0-9._-]{1,80}$' then
    raise exception 'fichier invalide';
  end if;
  if p_duration is null or p_duration < 0.3 or p_duration > 15 then
    raise exception 'le son doit durer entre 0,3 et 15 secondes';
  end if;
  if (select count(*) from public.mm_sounds) >= 500 then
    raise exception 'bibliothèque pleine';
  end if;
  insert into public.mm_sounds (title, path, duration, added_by) values (t, p_path, p_duration, p_player) returning id into new_id;
  return new_id;
end;
$$;

-- Retire un son de la bibliothèque (le fichier reste dans le stockage).
create or replace function public.mm_hide_sound(p_id bigint)
returns void
language sql
security definer
set search_path = public
as $$ update public.mm_sounds set hidden = true where id = p_id $$;

create or replace function public.mm_sounds_list()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'path', path, 'duration', duration, 'addedBy', added_by)
                            order by created_at desc), '[]'::jsonb)
  from public.mm_sounds where not hidden;
$$;

-- Lance une partie : 2 à 6 joueurs présents, 1 à 10 manches tirées au hasard dans la bibliothèque.
create or replace function public.mm_start(p_token uuid, p_players text[], p_rounds int)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  me text;
  cur public.mm_games;
  n int;
  picked bigint[];
  new_id bigint;
begin
  select player into me from public.mm_lobby where token = p_token;
  if me is null then
    raise exception 'rejoins le salon d''abord';
  end if;
  perform pg_advisory_xact_lock(hashtext('mm_start'));
  select * into cur from public.mm_games order by id desc limit 1;
  if cur.id is not null and cur.status <> 'ended' then
    raise exception 'une partie est déjà en cours';
  end if;
  n := coalesce(array_length(p_players, 1), 0);
  if n < 2 or n > 6
     or (select count(distinct x) from unnest(p_players) x) <> n
     or exists (select 1 from unnest(p_players) x where not (x = any (public.mm_players())))
     or not (me = any (p_players)) then
    raise exception 'choisis entre 2 et 6 joueurs, toi compris';
  end if;
  if exists (
    select 1 from unnest(p_players) x
    where not exists (select 1 from public.mm_lobby l where l.player = x and l.seen_at > now() - interval '60 seconds')
  ) then
    raise exception 'un des joueurs n''est plus dans le salon';
  end if;
  if p_rounds is null or p_rounds < 1 or p_rounds > 10 then
    raise exception 'entre 1 et 10 manches';
  end if;
  select array_agg(id) into picked from (select id from public.mm_sounds where not hidden order by random() limit p_rounds) s;
  if picked is null then
    raise exception 'ajoute d''abord des sons dans la bibliothèque';
  end if;

  insert into public.mm_games (status, players, sounds, created_by) values ('record', p_players, picked, me) returning id into new_id;
  insert into public.mm_seats (game_id, player, token)
  select new_id, l.player, l.token from public.mm_lobby l where l.player = any (p_players);
  return new_id;
end;
$$;

-- Envoie son imitation pour la manche en cours (le fichier a déjà été envoyé dans takes/<partie>/).
create or replace function public.mm_submit_take(p_token uuid, p_round int, p_path text, p_score int, p_duration real)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.mm_games;
  me text;
begin
  select l.me into me from public.mm_lock_current(p_token) l;
  select * into g from public.mm_games order by id desc limit 1;
  if g.status <> 'record' or g.round <> p_round then
    raise exception 'ce n''est plus le moment d''enregistrer';
  end if;
  if p_path !~ ('^takes/' || g.id || '/[A-Za-z0-9._-]{1,80}$') then
    raise exception 'fichier invalide';
  end if;
  if p_score is null or p_score < 0 or p_score > 100 then
    raise exception 'note invalide';
  end if;
  if p_duration is null or p_duration < 0 or p_duration > 20 then
    raise exception 'durée invalide';
  end if;
  insert into public.mm_takes (game_id, round, player, path, score, duration) values (g.id, g.round, me, p_path, p_score, p_duration)
  on conflict (game_id, round, player) do update
    set path = excluded.path, score = excluded.score, duration = excluded.duration, created_at = now();
  if (select count(*) from public.mm_takes where game_id = g.id and round = g.round) = array_length(g.players, 1) then
    perform public.mm_to_stage(g.id);
  end if;
end;
$$;

-- Passe au micro sans attendre ceux qui n'ont pas enregistré (après 60 secondes).
create or replace function public.mm_close_record(p_token uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.mm_games;
  me text;
begin
  select l.me into me from public.mm_lock_current(p_token) l;
  select * into g from public.mm_games order by id desc limit 1;
  if g.status <> 'record' then
    return;
  end if;
  if now() - g.phase_started_at < interval '60 seconds' then
    raise exception 'laisse une minute à tout le monde';
  end if;
  perform public.mm_to_stage(g.id);
end;
$$;

-- Passage suivant au micro, une fois le précédent terminé ; après le dernier, vote (ou résultats s'il n'y a qu'une imitation).
create or replace function public.mm_stage_next(p_token uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.mm_games;
  me text;
  dur real;
begin
  select l.me into me from public.mm_lock_current(p_token) l;
  select * into g from public.mm_games order by id desc limit 1;
  if g.status <> 'stage' then
    return;
  end if;
  select duration into dur from public.mm_takes where game_id = g.id and round = g.round and player = g.stage_order[g.stage_index + 1];
  if now() - g.phase_started_at < public.mm_stage_length(dur) then
    return; -- passage pas encore fini (appel en double d'un autre téléphone)
  end if;
  if g.stage_index + 1 < array_length(g.stage_order, 1) then
    update public.mm_games set stage_index = stage_index + 1, phase_started_at = now() where id = g.id;
  else
    update public.mm_games
    set status = case when array_length(g.stage_order, 1) >= 2 then 'vote' else 'results' end, phase_started_at = now()
    where id = g.id;
  end if;
end;
$$;

-- Vote pour la meilleure imitation (pas la sienne), modifiable jusqu'au dernier vote.
create or replace function public.mm_vote(p_token uuid, p_target text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.mm_games;
  me text;
begin
  select l.me into me from public.mm_lock_current(p_token) l;
  select * into g from public.mm_games order by id desc limit 1;
  if g.status <> 'vote' then
    raise exception 'ce n''est pas le moment de voter';
  end if;
  if p_target = me or not exists (select 1 from public.mm_takes where game_id = g.id and round = g.round and player = p_target) then
    raise exception 'vote invalide';
  end if;
  insert into public.mm_votes (game_id, round, voter, target) values (g.id, g.round, me, p_target)
  on conflict (game_id, round, voter) do update set target = excluded.target;
  if (select count(*) from public.mm_votes where game_id = g.id and round = g.round) = array_length(g.players, 1) then
    update public.mm_games set status = 'results', phase_started_at = now() where id = g.id;
  end if;
end;
$$;

-- Clôt le vote sans attendre les absents (au moins la moitié des votes, ou 45 secondes).
create or replace function public.mm_close_vote(p_token uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.mm_games;
  me text;
begin
  select l.me into me from public.mm_lock_current(p_token) l;
  select * into g from public.mm_games order by id desc limit 1;
  if g.status <> 'vote' then
    return;
  end if;
  if (select count(*) from public.mm_votes where game_id = g.id and round = g.round) * 2 < array_length(g.players, 1)
     and now() - g.phase_started_at < interval '45 seconds' then
    raise exception 'attends encore quelques votes';
  end if;
  update public.mm_games set status = 'results', phase_started_at = now() where id = g.id;
end;
$$;

-- Manche suivante, ou fin de partie après la dernière.
create or replace function public.mm_next(p_token uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.mm_games;
  me text;
  best text;
begin
  select l.me into me from public.mm_lock_current(p_token) l;
  select * into g from public.mm_games order by id desc limit 1;
  if g.status <> 'results' then
    return;
  end if;
  if now() - g.phase_started_at < interval '3 seconds' then
    raise exception 'laisse le temps de voir les résultats';
  end if;
  if g.round < array_length(g.sounds, 1) then
    update public.mm_games set round = round + 1, status = 'record', phase_started_at = now() where id = g.id;
  else
    -- Vainqueur : le plus de points ; à égalité, la meilleure somme des notes de l'app.
    select p into best from unnest(g.players) p
    order by (select sum(public.mm_points(g.id, r, p)) from generate_series(1, g.round) r) desc,
             (select coalesce(sum(score), 0) from public.mm_takes t where t.game_id = g.id and t.player = p) desc
    limit 1;
    update public.mm_games set status = 'ended', winner = best, ended_at = now(), phase_started_at = now() where id = g.id;
  end if;
end;
$$;

create or replace function public.mm_abort(p_token uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.mm_games;
  me text;
begin
  select l.me into me from public.mm_lock_current(p_token) l;
  select * into g from public.mm_games order by id desc limit 1;
  if g.status = 'ended' then
    return;
  end if;
  update public.mm_games set status = 'ended', aborted = true, ended_at = now() where id = g.id;
end;
$$;

-- État public. Pendant l'enregistrement on voit seulement qui a envoyé ; pendant le vote on peut écouter
-- les imitations mais pas leurs notes ; tout est montré aux résultats.
create or replace function public.mm_state()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with g as (select * from public.mm_games order by id desc limit 1)
  select jsonb_build_object(
    'now', now(),
    'lobby', coalesce((select jsonb_agg(player order by player) from public.mm_lobby where seen_at > now() - interval '40 seconds'), '[]'::jsonb),
    'wins', coalesce((select jsonb_object_agg(winner, n) from (
               select winner, count(*) n from public.mm_games where status = 'ended' and not aborted and winner is not null group by winner) w), '{}'::jsonb),
    'played', (select count(*) from public.mm_games where status = 'ended' and not aborted),
    'soundCount', (select count(*) from public.mm_sounds where not hidden),
    'game', (
      select jsonb_build_object(
        'id', g.id,
        'status', g.status,
        'players', to_jsonb(g.players),
        'round', g.round,
        'rounds', array_length(g.sounds, 1),
        'phaseStartedAt', g.phase_started_at,
        'stageOrder', to_jsonb(g.stage_order),
        'stageIndex', g.stage_index,
        'winner', g.winner,
        'aborted', g.aborted,
        'sound', (select jsonb_build_object('id', s.id, 'title', s.title, 'path', s.path, 'duration', s.duration)
                  from public.mm_sounds s where s.id = g.sounds[g.round]),
        'takes', coalesce((select jsonb_agg(jsonb_build_object(
                    'player', t.player,
                    'duration', t.duration,
                    -- Pendant les passages au micro : l'imitation se découvre à son tour, la note à la fin du passage.
                    'path', case when g.status = 'record' then null
                                 when g.status = 'stage' then case when array_position(g.stage_order, t.player) - 1 <= g.stage_index then t.path end
                                 else t.path end,
                    'score', case when g.status in ('vote', 'results', 'ended') then t.score
                                  when g.status = 'stage' and (array_position(g.stage_order, t.player) - 1 < g.stage_index
                                       or (array_position(g.stage_order, t.player) - 1 = g.stage_index
                                           and now() - g.phase_started_at >= make_interval(secs => 2 + t.duration))) then t.score end,
                    'votes', case when g.status in ('results', 'ended') then
                               (select count(*) from public.mm_votes v where v.game_id = g.id and v.round = g.round and v.target = t.player) end,
                    'points', case when g.status in ('results', 'ended') then public.mm_points(g.id, g.round, t.player) end
                  ) order by t.created_at) from public.mm_takes t where t.game_id = g.id and t.round = g.round), '[]'::jsonb),
        'voters', coalesce((select jsonb_agg(v.voter) from public.mm_votes v where v.game_id = g.id and v.round = g.round), '[]'::jsonb),
        'totals', (select jsonb_object_agg(p, (select coalesce(sum(public.mm_points(g.id, r, p)), 0)
                                               from generate_series(1, case when g.status in ('results', 'ended') then g.round else g.round - 1 end) r))
                   from unnest(g.players) p)
      ) from g
    )
  );
$$;

revoke all on function public.mm_players(), public.mm_points(bigint, int, text), public.mm_lock_current(uuid),
  public.mm_to_stage(bigint), public.mm_stage_length(real) from public, anon, authenticated;

revoke all on function public.mm_heartbeat(uuid, text), public.mm_add_sound(text, text, text, real), public.mm_hide_sound(bigint),
  public.mm_sounds_list(), public.mm_start(uuid, text[], int), public.mm_submit_take(uuid, int, text, int, real),
  public.mm_close_record(uuid), public.mm_stage_next(uuid), public.mm_vote(uuid, text), public.mm_close_vote(uuid), public.mm_next(uuid),
  public.mm_abort(uuid), public.mm_state() from public;
grant execute on function public.mm_heartbeat(uuid, text), public.mm_add_sound(text, text, text, real), public.mm_hide_sound(bigint),
  public.mm_sounds_list(), public.mm_start(uuid, text[], int), public.mm_submit_take(uuid, int, text, int, real),
  public.mm_close_record(uuid), public.mm_stage_next(uuid), public.mm_vote(uuid, text), public.mm_close_vote(uuid), public.mm_next(uuid),
  public.mm_abort(uuid), public.mm_state() to anon, authenticated;
