// Les jeux de la Mobut App, dans l'ordre d'affichage.
// Pour ajouter un jeu : une ligne ici (href = le dossier du jeu, avec / à la fin).
export const GAMES: { href: string; name: string; tagline: string; color: string; mark: string }[] = [
  {
    href: '/volley/',
    name: 'Notes Volley',
    tagline: 'Chacun note les autres de 0 à 10 sur les six gestes. Classement, détails, auto-notes et commentaires.',
    color: '#7a1f4b',
    mark: '10',
  },
  {
    href: '/qui-de-nous/',
    name: 'Qui de nous ?',
    tagline: 'Une question, six têtes : classe-les du 1er au 6e. Le groupe rend son verdict.',
    color: '#4b2fd1',
    mark: '1–6',
  },
  {
    href: '/imposteur/',
    name: "L'Imposteur",
    tagline: 'Tout le monde a le même mot, sauf un. Indices, vote, et démasque l’imposteur en ligne.',
    color: '#c1121f',
    mark: '?',
  },
];

