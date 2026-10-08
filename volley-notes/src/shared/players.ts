// Les 6 de la bande, communs à tous les jeux de la Mobut App.
// `short` : les lettres affichées sur les têtes, différentes pour chacun.
// Les `id` sont repris dans les scripts SQL : ne pas les changer.
export const PLAYERS: { id: string; name: string; short: string; color: string }[] = [
  { id: 'matias', name: 'Matias', short: 'MA', color: '#e2543d' },
  { id: 'raphs', name: 'Raph.S', short: 'RS', color: '#2f7fd8' },
  { id: 'raphg', name: 'Raph.G', short: 'RG', color: '#1f9e74' },
  { id: 'sofiane', name: 'Sofiane', short: 'SO', color: '#c2409a' },
  { id: 'mathieu', name: 'Mathieu', short: 'MT', color: '#e09a1a' },
  { id: 'paco', name: 'Paco', short: 'PA', color: '#7a55d6' },
];

export const playerName = (id: string) => PLAYERS.find((p) => p.id === id)?.name ?? id;
