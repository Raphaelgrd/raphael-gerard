-- Liar's Bar (mode cartes) : jeu en ligne pour 2 à 6 joueurs.
--
-- Chaque manche : une carte de table (Roi, Dame ou As), 5 cartes par joueur vivant.
-- À son tour, on pose 1 à 3 cartes face cachée en prétendant qu'elles sont de la carte de table
-- (le Joker compte pour n'importe laquelle), ou on accuse le joueur précédent de mentir.
-- Le perdant de l'accusation tire avec son revolver : 6 chambres, 1 balle, position secrète.
-- Le dernier vivant gagne.
--
-- Les tables ne sont pas accessibles avec la clé anon : tout passe par les fonctions lb_*.
-- Les mains ne sont renvoyées qu'au jeton de leur propriétaire (lb_my_hand) ; les cartes
-- posées ne sont montrées qu'après une accusation, et les balles qu'à la fin.

create table if not exists public.lb_lobby (
  player  text primary key,
  token   uuid not null,
  seen_at timestamptz not null default now()
);

create table if not exists public.lb_games (
  id               bigserial primary key,
  status           text not null check (status in ('play', 'reveal', 'ended')),
  players          text[] not null, -- ordre autour de la table
  round            int not null default 0,
  table_rank       text,
  turn_player      text,
  turn_started_at  timestamptz not null default now(),
  phase_started_at timestamptz not null default now(),
  round_starter    text,
  last_player      text,
  last_cards       text[],
  pile             int not null default 0,
  reveal           jsonb,
  winner           text,
  aborted          boolean not null default false,
  created_by       text not null,
  created_at       timestamptz not null default now(),
  ended_at         timestamptz
);

create table if not exists public.lb_seats (
  game_id bigint not null references public.lb_games (id) on delete cascade,
  player  text not null,
  token   uuid not null,
  seat    int not null,
  alive   boolean not null default true,
  bullet  int not null, -- chambre de la balle (1 à 6)
  shots   int not null default 0,
  cards   text[] not null default '{}',
  primary key (game_id, player)
);

alter table public.lb_lobby enable row level security;
alter table public.lb_games enable row level security;
alter table public.lb_seats enable row level security;
revoke all on public.lb_lobby, public.lb_games, public.lb_seats from anon, authenticated;

/* ---------- fonctions internes ---------- */

create or replace function public.lb_players()
returns text[]
language sql
immutable
as $$ select array['matias', 'raphs', 'raphg', 'sofiane', 'mathieu', 'paco'] $$;

-- Joueur suivant après `p_from` : le prochain vivant qui a encore des cartes,
-- sinon le prochain vivant tout court (il ne pourra qu'accuser).
create or replace function public.lb_next_after(p_game bigint, p_from text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  with g as (select array_length(players, 1) n from public.lb_games where id = p_game),
  f as (select seat from public.lb_seats where game_id = p_game and player = p_from)
  select coalesce(
    (select s.player from public.lb_seats s, g, f
     where s.game_id = p_game and s.alive and s.player <> p_from and cardinality(s.cards) > 0
     order by (s.seat - f.seat + g.n) % g.n limit 1),
    (select s.player from public.lb_seats s, g, f
     where s.game_id = p_game and s.alive and s.player <> p_from
     order by (s.seat - f.seat + g.n) % g.n limit 1)
  );
$$;

-- Nouvelle manche : paquet mélangé, 5 cartes par vivant, nouvelle carte de table.
create or replace function public.lb_deal(p_game bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
  per_rank int;
  deck text[];
  r record;
  i int := 0;
  starter text;
begin
  select count(*) into n from public.lb_seats where game_id = p_game and alive;
  per_rank := ceil((5 * n - 2) / 3.0)::int; -- assez de cartes pour 5 par joueur
  select array_agg(card order by random()) into deck from (
    select rk as card from unnest(array['K', 'Q', 'A']) rk cross join generate_series(1, per_rank)
    union all
    select 'J' from generate_series(1, 2)
  ) d;
  for r in select player from public.lb_seats where game_id = p_game and alive order by seat loop
    update public.lb_seats set cards = deck[i * 5 + 1 : i * 5 + 5] where game_id = p_game and player = r.player;
    i := i + 1;
  end loop;
  update public.lb_seats set cards = '{}' where game_id = p_game and not alive;

  select round_starter into starter from public.lb_games where id = p_game;
  if starter is null or not exists (select 1 from public.lb_seats where game_id = p_game and player = starter and alive) then
    select player into starter from public.lb_seats where game_id = p_game and alive order by random() limit 1;
  end if;

  update public.lb_games set
    status = 'play', round = round + 1,
    table_rank = (array['K', 'Q', 'A'])[1 + floor(random() * 3)::int],
    turn_player = starter, turn_started_at = now(), phase_started_at = now(),
    last_player = null, last_cards = null, pile = 0, reveal = null
  where id = p_game;
end;
$$;

-- Partie en cours (la plus récente), verrouillée, et la place du jeton dans cette partie.
create or replace function public.lb_lock_current(p_token uuid, out game_id bigint, out me text)
language plpgsql
security definer
set search_path = public
as $$
begin
  select g.id into game_id from public.lb_games g order by g.id desc limit 1 for update;
  if game_id is null then
    raise exception 'aucune partie';
  end if;
  select s.player into me from public.lb_seats s where s.game_id = lb_lock_current.game_id and s.token = p_token;
  if me is null then
    raise exception 'tu ne joues pas dans cette partie';
  end if;
end;
$$;

-- Le perdant d'une accusation tire. Renvoie vrai s'il meurt.
create or replace function public.lb_shoot(p_game bigint, p_player text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  dead boolean;
begin
  update public.lb_seats set shots = shots + 1, alive = (shots + 1 < bullet)
  where game_id = p_game and player = p_player
  returning not alive into dead;
  return dead;
end;
$$;

/* ---------- fonctions appelées par le site ---------- */

create or replace function public.lb_heartbeat(p_token uuid, p_player text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_token is null or not (p_player = any (public.lb_players())) then
    raise exception 'joueur inconnu';
  end if;
  delete from public.lb_lobby where token = p_token and player <> p_player;
  insert into public.lb_lobby (player, token, seen_at) values (p_player, p_token, now())
  on conflict (player) do update set token = excluded.token, seen_at = now();
end;
$$;

create or replace function public.lb_leave(p_token uuid)
returns void
language sql
security definer
set search_path = public
as $$ delete from public.lb_lobby where token = p_token $$;

-- Lance une partie avec les joueurs choisis (2 à 6, présents dans le salon).
create or replace function public.lb_start(p_token uuid, p_players text[])
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  me text;
  cur public.lb_games;
  n int;
  order_ text[];
  new_id bigint;
begin
  select player into me from public.lb_lobby where token = p_token;
  if me is null then
    raise exception 'rejoins le salon d''abord';
  end if;
  perform pg_advisory_xact_lock(hashtext('lb_start'));
  select * into cur from public.lb_games order by id desc limit 1;
  if cur.id is not null and cur.status <> 'ended' then
    raise exception 'une partie est déjà en cours';
  end if;

  n := coalesce(array_length(p_players, 1), 0);
  if n < 2 or n > 6
     or (select count(distinct x) from unnest(p_players) x) <> n
     or exists (select 1 from unnest(p_players) x where not (x = any (public.lb_players())))
     or not (me = any (p_players)) then
    raise exception 'choisis entre 2 et 6 joueurs, toi compris';
  end if;
  if exists (
    select 1 from unnest(p_players) x
    where not exists (select 1 from public.lb_lobby l where l.player = x and l.seen_at > now() - interval '60 seconds')
  ) then
    raise exception 'un des joueurs n''est plus dans le salon';
  end if;

  select array_agg(x order by random()) into order_ from unnest(p_players) x;
  insert into public.lb_games (status, players, created_by) values ('play', order_, me) returning id into new_id;
  insert into public.lb_seats (game_id, player, token, seat, bullet)
  select new_id, l.player, l.token, array_position(order_, l.player), 1 + floor(random() * 6)::int
  from public.lb_lobby l where l.player = any (order_);
  perform public.lb_deal(new_id);
  return new_id;
end;
$$;

-- Ma main dans la partie en cours.
create or replace function public.lb_my_hand(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('gameId', g.id, 'round', g.round, 'player', s.player, 'alive', s.alive, 'cards', to_jsonb(s.cards))
  from (select * from public.lb_games order by id desc limit 1) g
  join public.lb_seats s on s.game_id = g.id and s.token = p_token;
$$;

-- Pose 1 à 3 cartes (positions dans la main, à partir de 0), annoncées comme la carte de table.
create or replace function public.lb_play(p_token uuid, p_cards int[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.lb_games;
  me text;
  hand text[];
  n int;
  chosen text[];
  rest text[];
begin
  select l.me into me from public.lb_lock_current(p_token) l;
  select * into g from public.lb_games order by id desc limit 1;
  if g.status <> 'play' or g.turn_player <> me then
    raise exception 'ce n''est pas ton tour';
  end if;
  select cards into hand from public.lb_seats where game_id = g.id and player = me;
  n := coalesce(array_length(p_cards, 1), 0);
  if n < 1 or n > 3
     or (select count(distinct x) from unnest(p_cards) x) <> n
     or exists (select 1 from unnest(p_cards) x where x < 0 or x >= cardinality(hand)) then
    raise exception 'choisis 1 à 3 cartes de ta main';
  end if;
  select array_agg(hand[i + 1] order by i) into chosen from unnest(p_cards) i;
  select coalesce(array_agg(hand[i] order by i), '{}') into rest
  from generate_subscripts(hand, 1) i where not ((i - 1) = any (p_cards));

  update public.lb_seats set cards = rest where game_id = g.id and player = me;
  update public.lb_games set last_player = me, last_cards = chosen, pile = pile + n where id = g.id;
  update public.lb_games set turn_player = public.lb_next_after(g.id, me), turn_started_at = now() where id = g.id;
end;
$$;

-- Accuse le joueur précédent de mentir : on retourne ses cartes et le perdant tire.
create or replace function public.lb_call(p_token uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.lb_games;
  me text;
  liar boolean;
  loser text;
  died boolean;
  alive_left int;
  last_one text;
  shots_now int;
begin
  select l.me into me from public.lb_lock_current(p_token) l;
  select * into g from public.lb_games order by id desc limit 1;
  if g.status <> 'play' or g.turn_player <> me then
    raise exception 'ce n''est pas ton tour';
  end if;
  if g.last_player is null then
    raise exception 'personne n''a encore posé de cartes';
  end if;
  liar := exists (select 1 from unnest(g.last_cards) c where c <> g.table_rank and c <> 'J');
  loser := case when liar then g.last_player else me end;
  died := public.lb_shoot(g.id, loser);
  select shots into shots_now from public.lb_seats where game_id = g.id and player = loser;
  select count(*) into alive_left from public.lb_seats where game_id = g.id and alive;

  update public.lb_games set
    status = case when alive_left <= 1 then 'ended' else 'reveal' end,
    phase_started_at = now(),
    reveal = jsonb_build_object(
      'caller', me, 'accused', g.last_player, 'cards', to_jsonb(g.last_cards), 'tableRank', g.table_rank,
      'liar', liar, 'loser', loser, 'died', died, 'shots', shots_now
    ),
    round_starter = case when died then public.lb_next_after(g.id, loser) else loser end,
    winner = case when alive_left <= 1 then (select player from public.lb_seats where game_id = g.id and alive limit 1) end,
    ended_at = case when alive_left <= 1 then now() end
  where id = g.id;
  if alive_left <= 1 then
    select player into last_one from public.lb_seats where game_id = g.id and alive limit 1;
    update public.lb_games set winner = last_one where id = g.id;
  end if;
end;
$$;

-- Manche suivante, après avoir laissé quelques secondes pour voir le résultat.
create or replace function public.lb_next_round(p_token uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.lb_games;
  me text;
begin
  select l.me into me from public.lb_lock_current(p_token) l;
  select * into g from public.lb_games order by id desc limit 1;
  if g.status <> 'reveal' then
    return; -- déjà relancée par un autre téléphone
  end if;
  if now() - g.phase_started_at < interval '4 seconds' then
    raise exception 'attends la fin de la révélation';
  end if;
  perform public.lb_deal(g.id);
end;
$$;

-- Joue à la place d'un joueur qui ne répond plus (au bout de 40 secondes).
create or replace function public.lb_force(p_token uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.lb_games;
  me text;
  idle text;
  idle_token uuid;
  hand text[];
begin
  select l.me into me from public.lb_lock_current(p_token) l;
  select * into g from public.lb_games order by id desc limit 1;
  if g.status <> 'play' then
    raise exception 'rien à forcer';
  end if;
  if now() - g.turn_started_at < interval '40 seconds' then
    raise exception 'attends encore un peu';
  end if;
  idle := g.turn_player;
  select token, cards into idle_token, hand from public.lb_seats where game_id = g.id and player = idle;
  if cardinality(hand) > 0 then
    perform public.lb_play(idle_token, array[floor(random() * cardinality(hand))::int]);
  else
    perform public.lb_call(idle_token);
  end if;
end;
$$;

create or replace function public.lb_abort(p_token uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.lb_games;
  me text;
begin
  select l.me into me from public.lb_lock_current(p_token) l;
  select * into g from public.lb_games order by id desc limit 1;
  if g.status = 'ended' then
    return;
  end if;
  update public.lb_games set status = 'ended', aborted = true, ended_at = now() where id = g.id;
end;
$$;

-- État public : salon, partie en cours ou dernière partie, victoires.
create or replace function public.lb_state()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with g as (select * from public.lb_games order by id desc limit 1)
  select jsonb_build_object(
    'now', now(),
    'lobby', coalesce((select jsonb_agg(player order by player) from public.lb_lobby where seen_at > now() - interval '40 seconds'), '[]'::jsonb),
    'wins', coalesce((select jsonb_object_agg(winner, n) from (
               select winner, count(*) n from public.lb_games where status = 'ended' and not aborted and winner is not null group by winner) w), '{}'::jsonb),
    'played', (select count(*) from public.lb_games where status = 'ended' and not aborted),
    'game', (
      select jsonb_build_object(
        'id', g.id,
        'status', g.status,
        'players', to_jsonb(g.players),
        'round', g.round,
        'tableRank', g.table_rank,
        'turn', case when g.status = 'play' then g.turn_player end,
        'turnStartedAt', g.turn_started_at,
        'phaseStartedAt', g.phase_started_at,
        'lastPlayer', g.last_player,
        'lastCount', coalesce(cardinality(g.last_cards), 0),
        'pile', g.pile,
        'reveal', g.reveal,
        'winner', g.winner,
        'aborted', g.aborted,
        'seats', (select jsonb_agg(jsonb_build_object(
                    'player', s.player, 'alive', s.alive, 'shots', s.shots, 'cards', cardinality(s.cards),
                    'bullet', case when g.status = 'ended' then s.bullet end) order by s.seat)
                  from public.lb_seats s where s.game_id = g.id)
      ) from g
    )
  );
$$;

revoke all on function public.lb_players(), public.lb_next_after(bigint, text), public.lb_deal(bigint),
  public.lb_lock_current(uuid), public.lb_shoot(bigint, text) from public, anon, authenticated;

revoke all on function public.lb_heartbeat(uuid, text), public.lb_leave(uuid), public.lb_start(uuid, text[]),
  public.lb_my_hand(uuid), public.lb_play(uuid, int[]), public.lb_call(uuid), public.lb_next_round(uuid),
  public.lb_force(uuid), public.lb_abort(uuid), public.lb_state() from public;
grant execute on function public.lb_heartbeat(uuid, text), public.lb_leave(uuid), public.lb_start(uuid, text[]),
  public.lb_my_hand(uuid), public.lb_play(uuid, int[]), public.lb_call(uuid), public.lb_next_round(uuid),
  public.lb_force(uuid), public.lb_abort(uuid), public.lb_state() to anon, authenticated;
