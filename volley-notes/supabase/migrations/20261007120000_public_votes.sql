-- Détail public des votes : tout le monde voit qui a mis quelle note et quels commentaires.
-- Le jeton secret de chaque appareil n'est jamais renvoyé : on expose seulement une empreinte
-- courte qui sert d'identifiant d'affichage.
create or replace function public.get_all_votes()
returns table (id text, voter text, ratings jsonb, notes jsonb, updated_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select left(md5(token::text), 12), voter, ratings, notes, updated_at
  from public.votes
  order by updated_at;
$$;

revoke all on function public.get_all_votes() from public;
grant execute on function public.get_all_votes() to anon, authenticated;
