-- L'Imposteur : jeu en ligne pour les 6 de la bande.
--
-- Une seule partie à la fois. Tout le monde reçoit le même mot secret, sauf l'imposteur
-- qui ne connaît que la catégorie. Chacun donne un indice à son tour, puis tout le monde vote.
-- Si l'imposteur est démasqué, il peut encore gagner en devinant le mot.
--
-- Les tables ne sont pas accessibles avec la clé anon : tout passe par les fonctions imp_*.
-- Chaque appareil a un jeton secret (uuid). Le mot n'est renvoyé qu'aux jetons des civils
-- de la partie (imp_my_card) ; l'état public (imp_state) ne le révèle qu'à la fin.

create table if not exists public.imp_words (
  id       serial primary key,
  category text not null,
  word     text not null,
  unique (category, word)
);

create table if not exists public.imp_lobby (
  player  text primary key,
  token   uuid not null,
  seen_at timestamptz not null default now()
);

create table if not exists public.imp_games (
  id               bigserial primary key,
  status           text not null check (status in ('clues', 'vote', 'guess', 'ended')),
  category         text not null,
  word             text not null,
  imposter         text not null,
  players          text[] not null,
  rounds           int not null,
  turn             int not null default 0,
  turn_started_at  timestamptz not null default now(),
  phase_started_at timestamptz not null default now(),
  accused          text,
  caught           boolean,
  guess            text,
  stolen           boolean,
  winner           text check (winner in ('civils', 'imposteur')),
  aborted          boolean not null default false,
  created_by       text not null,
  created_at       timestamptz not null default now(),
  ended_at         timestamptz
);

create table if not exists public.imp_seats (
  game_id bigint not null references public.imp_games (id) on delete cascade,
  player  text not null,
  token   uuid not null,
  primary key (game_id, player)
);

create table if not exists public.imp_clues (
  id         bigserial primary key,
  game_id    bigint not null references public.imp_games (id) on delete cascade,
  player     text not null,
  round      int not null,
  text       text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.imp_votes (
  game_id bigint not null references public.imp_games (id) on delete cascade,
  voter   text not null,
  target  text not null,
  primary key (game_id, voter)
);

alter table public.imp_words enable row level security;
alter table public.imp_lobby enable row level security;
alter table public.imp_games enable row level security;
alter table public.imp_seats enable row level security;
alter table public.imp_clues enable row level security;
alter table public.imp_votes enable row level security;
revoke all on public.imp_words, public.imp_lobby, public.imp_games, public.imp_seats, public.imp_clues, public.imp_votes
  from anon, authenticated;

-- Mots de départ. Pour en ajouter : insert into public.imp_words (category, word) values ('Sport', 'Rugby');
insert into public.imp_words (category, word) values
  ('Sport', 'Volley'), ('Sport', 'Tennis'), ('Sport', 'Natation'), ('Sport', 'Boxe'), ('Sport', 'Ski'),
  ('Nourriture', 'Pizza'), ('Nourriture', 'Sushi'), ('Nourriture', 'Kebab'), ('Nourriture', 'Raclette'), ('Nourriture', 'Croissant'),
  ('Animal', 'Requin'), ('Animal', 'Girafe'), ('Animal', 'Pingouin'), ('Animal', 'Chameau'), ('Animal', 'Araignée'),
  ('Lieu', 'Plage'), ('Lieu', 'Aéroport'), ('Lieu', 'Hôpital'), ('Lieu', 'Cinéma'), ('Lieu', 'Boulangerie'),
  ('Objet', 'Parapluie'), ('Objet', 'Brosse à dents'), ('Objet', 'Guitare'), ('Objet', 'Miroir'), ('Objet', 'Trottinette'),
  ('Métier', 'Pompier'), ('Métier', 'Pilote'), ('Métier', 'Dentiste'), ('Métier', 'Magicien'), ('Métier', 'Arbitre'),
  ('Film / série', 'Titanic'), ('Film / série', 'Harry Potter'), ('Film / série', 'Star Wars'), ('Film / série', 'Le Roi Lion'), ('Film / série', 'Prison Break'),
  ('Pays', 'Japon'), ('Pays', 'Brésil'), ('Pays', 'Égypte'), ('Pays', 'Canada'), ('Pays', 'Italie')
on conflict (category, word) do nothing;

/* ---------- fonctions internes ---------- */

create or replace function public.imp_players()
returns text[]
language sql
immutable
as $$ select array['matias', 'raphs', 'raphg', 'sofiane', 'mathieu', 'paco'] $$;

-- Mot comparé sans majuscules, accents ni espaces superflus.
create or replace function public.imp_norm(p text)
returns text
language sql
immutable
as $$
  select regexp_replace(
    translate(lower(trim(coalesce(p, ''))), 'àâäáãéèêëíìîïóòôöõúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'),
    '[^a-z0-9]+', '', 'g')
$$;

-- Passe au joueur suivant, ou au vote quand tout le monde a donné ses indices.
create or replace function public.imp_advance(p_game bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.imp_games;
begin
  select * into g from public.imp_games where id = p_game;
  if g.turn + 1 >= array_length(g.players, 1) * g.rounds then
    update public.imp_games set turn = g.turn + 1, status = 'vote', phase_started_at = now() where id = p_game;
  else
    update public.imp_games set turn = g.turn + 1, turn_started_at = now() where id = p_game;
  end if;
end;
$$;

-- Dépouille les votes : un accusé unique, sinon (égalité) l'imposteur s'en sort.
create or replace function public.imp_resolve(p_game bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.imp_games;
  top_target text;
  top_count int;
  ties int;
begin
  select * into g from public.imp_games where id = p_game;
  select target, count(*) into top_target, top_count
  from public.imp_votes where game_id = p_game group by target order by count(*) desc limit 1;
  select count(*) into ties from (
    select target from public.imp_votes where game_id = p_game group by target having count(*) = top_count
  ) t;
  if top_target is not null and ties = 1 then
    if top_target = g.imposter then
      update public.imp_games set accused = top_target, caught = true, status = 'guess', phase_started_at = now() where id = p_game;
      return;
    end if;
    update public.imp_games set accused = top_target, caught = false, status = 'ended', winner = 'imposteur', ended_at = now() where id = p_game;
  else
    update public.imp_games set accused = null, caught = false, status = 'ended', winner = 'imposteur', ended_at = now() where id = p_game;
  end if;
end;
$$;

-- Partie en cours (la plus récente), verrouillée jusqu'à la fin de l'appel, et la place du jeton dans cette partie.
drop function if exists public.imp_lock_current(uuid);
create function public.imp_lock_current(p_token uuid, out game_id bigint, out me text)
language plpgsql
security definer
set search_path = public
as $$
begin
  select g.id into game_id from public.imp_games g order by g.id desc limit 1 for update;
  if game_id is null then
    raise exception 'aucune partie';
  end if;
  select s.player into me from public.imp_seats s where s.game_id = imp_lock_current.game_id and s.token = p_token;
  if me is null then
    raise exception 'tu ne joues pas dans cette partie';
  end if;
end;
$$;

/* ---------- fonctions appelées par le site ---------- */

-- Signale que ce joueur est dans le salon (appelée toutes les quelques secondes).
create or replace function public.imp_heartbeat(p_token uuid, p_player text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_token is null or not (p_player = any (public.imp_players())) then
    raise exception 'joueur inconnu';
  end if;
  -- Un appareil ne tient qu'une place : s'il change de nom, l'ancienne est libérée.
  delete from public.imp_lobby where token = p_token and player <> p_player;
  insert into public.imp_lobby (player, token, seen_at) values (p_player, p_token, now())
  on conflict (player) do update set token = excluded.token, seen_at = now();
end;
$$;

create or replace function public.imp_leave(p_token uuid)
returns void
language sql
security definer
set search_path = public
as $$ delete from public.imp_lobby where token = p_token $$;

-- Lance une partie avec les joueurs choisis (3 à 6, présents dans le salon).
create or replace function public.imp_start(p_token uuid, p_players text[], p_rounds int)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  me text;
  cur public.imp_games;
  n int;
  chosen record;
  order_ text[];
  new_id bigint;
begin
  select player into me from public.imp_lobby where token = p_token;
  if me is null then
    raise exception 'rejoins le salon d''abord';
  end if;
  perform pg_advisory_xact_lock(hashtext('imp_start'));
  select * into cur from public.imp_games order by id desc limit 1;
  if cur.id is not null and cur.status <> 'ended' then
    raise exception 'une partie est déjà en cours';
  end if;

  n := coalesce(array_length(p_players, 1), 0);
  if n < 3 or n > 6
     or (select count(distinct x) from unnest(p_players) x) <> n
     or exists (select 1 from unnest(p_players) x where not (x = any (public.imp_players())))
     or not (me = any (p_players)) then
    raise exception 'choisis entre 3 et 6 joueurs, toi compris';
  end if;
  if exists (
    select 1 from unnest(p_players) x
    where not exists (select 1 from public.imp_lobby l where l.player = x and l.seen_at > now() - interval '60 seconds')
  ) then
    raise exception 'un des joueurs n''est plus dans le salon';
  end if;
  if p_rounds is null or p_rounds < 1 or p_rounds > 3 then
    raise exception 'nombre de tours invalide';
  end if;

  -- Un mot pas sorti dans les 20 dernières parties si possible.
  select category, word into chosen from public.imp_words w
  where w.word not in (select word from public.imp_games order by id desc limit 20)
  order by random() limit 1;
  if chosen is null then
    select category, word into chosen from public.imp_words order by random() limit 1;
  end if;
  if chosen is null then
    raise exception 'aucun mot dans imp_words';
  end if;

  select array_agg(x order by random()) into order_ from unnest(p_players) x;

  insert into public.imp_games (status, category, word, imposter, players, rounds, created_by)
  values ('clues', chosen.category, chosen.word, order_[1 + floor(random() * n)::int], order_, p_rounds, me)
  returning id into new_id;

  insert into public.imp_seats (game_id, player, token)
  select new_id, l.player, l.token from public.imp_lobby l where l.player = any (order_);

  return new_id;
end;
$$;

-- Le rôle de cet appareil dans la partie en cours : le mot pour les civils, rien pour l'imposteur.
create or replace function public.imp_my_card(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'gameId', g.id,
    'player', s.player,
    'imposter', s.player = g.imposter,
    'category', g.category,
    'word', case when s.player = g.imposter then null else g.word end
  )
  from (select * from public.imp_games order by id desc limit 1) g
  join public.imp_seats s on s.game_id = g.id and s.token = p_token;
$$;

-- Donne son indice (un mot ou une courte expression) quand c'est son tour.
create or replace function public.imp_clue(p_token uuid, p_text text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.imp_games;
  me text;
  n int;
  t text := trim(coalesce(p_text, ''));
begin
  select l.me into me from public.imp_lock_current(p_token) l;
  select * into g from public.imp_games order by id desc limit 1;
  if g.status <> 'clues' then
    raise exception 'ce n''est plus le moment des indices';
  end if;
  n := array_length(g.players, 1);
  if g.players[(g.turn % n) + 1] <> me then
    raise exception 'ce n''est pas ton tour';
  end if;
  if length(t) < 1 or length(t) > 30 then
    raise exception 'indice entre 1 et 30 caractères';
  end if;
  insert into public.imp_clues (game_id, player, round, text) values (g.id, me, g.turn / n + 1, t);
  perform public.imp_advance(g.id);
end;
$$;

-- Passe le tour d'un joueur qui ne répond pas (au bout de 45 secondes).
create or replace function public.imp_skip_turn(p_token uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.imp_games;
  me text;
  n int;
begin
  select l.me into me from public.imp_lock_current(p_token) l;
  select * into g from public.imp_games order by id desc limit 1;
  if g.status <> 'clues' then
    raise exception 'ce n''est plus le moment des indices';
  end if;
  if now() - g.turn_started_at < interval '45 seconds' then
    raise exception 'attends encore un peu';
  end if;
  n := array_length(g.players, 1);
  insert into public.imp_clues (game_id, player, round, text) values (g.id, g.players[(g.turn % n) + 1], g.turn / n + 1, '(tour passé)');
  perform public.imp_advance(g.id);
end;
$$;

-- Vote (modifiable tant que tout le monde n'a pas voté).
create or replace function public.imp_vote(p_token uuid, p_target text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.imp_games;
  me text;
begin
  select l.me into me from public.imp_lock_current(p_token) l;
  select * into g from public.imp_games order by id desc limit 1;
  if g.status <> 'vote' then
    raise exception 'ce n''est pas le moment de voter';
  end if;
  if not (p_target = any (g.players)) or p_target = me then
    raise exception 'vote invalide';
  end if;
  insert into public.imp_votes (game_id, voter, target) values (g.id, me, p_target)
  on conflict (game_id, voter) do update set target = excluded.target;
  if (select count(*) from public.imp_votes where game_id = g.id) = array_length(g.players, 1) then
    perform public.imp_resolve(g.id);
  end if;
end;
$$;

-- Clôt le vote sans attendre les absents (au moins la moitié des votes).
create or replace function public.imp_close_vote(p_token uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.imp_games;
  me text;
begin
  select l.me into me from public.imp_lock_current(p_token) l;
  select * into g from public.imp_games order by id desc limit 1;
  if g.status <> 'vote' then
    raise exception 'ce n''est pas le moment de voter';
  end if;
  if (select count(*) from public.imp_votes where game_id = g.id) * 2 < array_length(g.players, 1) then
    raise exception 'il faut au moins la moitié des votes';
  end if;
  perform public.imp_resolve(g.id);
end;
$$;

-- L'imposteur démasqué tente de deviner le mot.
create or replace function public.imp_guess(p_token uuid, p_guess text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.imp_games;
  me text;
  ok boolean;
begin
  select l.me into me from public.imp_lock_current(p_token) l;
  select * into g from public.imp_games order by id desc limit 1;
  if g.status <> 'guess' or me <> g.imposter then
    raise exception 'seul l''imposteur démasqué peut deviner';
  end if;
  ok := public.imp_norm(p_guess) <> '' and public.imp_norm(p_guess) = public.imp_norm(g.word);
  update public.imp_games
  set guess = left(trim(coalesce(p_guess, '')), 40), stolen = ok, status = 'ended',
      winner = case when ok then 'imposteur' else 'civils' end, ended_at = now()
  where id = g.id;
end;
$$;

-- Si l'imposteur ne devine pas dans la minute, les civils gagnent.
create or replace function public.imp_end_guess(p_token uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.imp_games;
  me text;
begin
  select l.me into me from public.imp_lock_current(p_token) l;
  select * into g from public.imp_games order by id desc limit 1;
  if g.status <> 'guess' then
    raise exception 'rien à terminer';
  end if;
  if now() - g.phase_started_at < interval '60 seconds' then
    raise exception 'laisse-lui une minute';
  end if;
  update public.imp_games set stolen = false, status = 'ended', winner = 'civils', ended_at = now() where id = g.id;
end;
$$;

-- Abandonne la partie en cours (elle ne compte pas dans les scores).
create or replace function public.imp_abort(p_token uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.imp_games;
  me text;
begin
  select l.me into me from public.imp_lock_current(p_token) l;
  select * into g from public.imp_games order by id desc limit 1;
  if g.status = 'ended' then
    return;
  end if;
  update public.imp_games set status = 'ended', aborted = true, ended_at = now() where id = g.id;
end;
$$;

-- État public : salon, partie en cours ou dernière partie, scores.
-- Le mot et l'imposteur ne sont révélés qu'à la fin (l'imposteur dès qu'il est démasqué).
create or replace function public.imp_state()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with g as (select * from public.imp_games order by id desc limit 1),
  wins as (
    select imposter as player, 2 as pts from public.imp_games where status = 'ended' and not aborted and winner = 'imposteur'
    union all
    select p, 1 from public.imp_games, unnest(players) p
    where status = 'ended' and not aborted and winner = 'civils' and p <> imposter
  )
  select jsonb_build_object(
    'now', now(),
    'lobby', coalesce((select jsonb_agg(player order by player) from public.imp_lobby where seen_at > now() - interval '40 seconds'), '[]'::jsonb),
    'scores', coalesce((select jsonb_object_agg(player, total) from (select player, sum(pts) total from wins group by player) s), '{}'::jsonb),
    'played', (select count(*) from public.imp_games where status = 'ended' and not aborted),
    'game', (
      select jsonb_build_object(
        'id', g.id,
        'status', g.status,
        'category', g.category,
        'players', to_jsonb(g.players),
        'rounds', g.rounds,
        'turn', g.turn,
        'current', case when g.status = 'clues' then g.players[(g.turn % array_length(g.players, 1)) + 1] end,
        'turnStartedAt', g.turn_started_at,
        'phaseStartedAt', g.phase_started_at,
        'createdBy', g.created_by,
        'clues', coalesce((select jsonb_agg(jsonb_build_object('player', c.player, 'round', c.round, 'text', c.text) order by c.id)
                           from public.imp_clues c where c.game_id = g.id), '[]'::jsonb),
        'voters', coalesce((select jsonb_agg(v.voter) from public.imp_votes v where v.game_id = g.id), '[]'::jsonb),
        'votes', case when g.status in ('guess', 'ended') then
                   coalesce((select jsonb_agg(jsonb_build_object('voter', v.voter, 'target', v.target)) from public.imp_votes v where v.game_id = g.id), '[]'::jsonb) end,
        'accused', case when g.status in ('guess', 'ended') then g.accused end,
        'caught', case when g.status in ('guess', 'ended') then g.caught end,
        'imposter', case when g.status = 'ended' or (g.status = 'guess' and g.caught) then g.imposter end,
        'word', case when g.status = 'ended' then g.word end,
        'guess', case when g.status = 'ended' then g.guess end,
        'stolen', case when g.status = 'ended' then g.stolen end,
        'winner', case when g.status = 'ended' then g.winner end,
        'aborted', g.aborted
      ) from g
    )
  );
$$;

-- Les fonctions internes ne sont pas appelables depuis le site.
revoke all on function public.imp_players(), public.imp_norm(text), public.imp_advance(bigint), public.imp_resolve(bigint),
  public.imp_lock_current(uuid) from public, anon, authenticated;

revoke all on function public.imp_heartbeat(uuid, text), public.imp_leave(uuid), public.imp_start(uuid, text[], int),
  public.imp_my_card(uuid), public.imp_clue(uuid, text), public.imp_skip_turn(uuid), public.imp_vote(uuid, text),
  public.imp_close_vote(uuid), public.imp_guess(uuid, text), public.imp_end_guess(uuid), public.imp_abort(uuid),
  public.imp_state() from public;
grant execute on function public.imp_heartbeat(uuid, text), public.imp_leave(uuid), public.imp_start(uuid, text[], int),
  public.imp_my_card(uuid), public.imp_clue(uuid, text), public.imp_skip_turn(uuid), public.imp_vote(uuid, text),
  public.imp_close_vote(uuid), public.imp_guess(uuid, text), public.imp_end_guess(uuid), public.imp_abort(uuid),
  public.imp_state() to anon, authenticated;
