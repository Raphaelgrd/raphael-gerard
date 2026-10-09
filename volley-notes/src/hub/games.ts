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
  {
    href: '/toboggan/',
    name: 'Toboggan',
    tagline: 'Course de boules en 3D : descends le plus vite et pousse les autres dans le vide.',
    color: '#1f8fe0',
    mark: '3D',
  },
  {
    href: '/liars-bar/',
    name: "Liar's Bar",
    tagline: 'Pose tes cartes, bluffe, crie « Menteur ! »… et prie pour que le revolver fasse clic.',
    color: '#1f4a35',
    mark: 'R?',
  },
  {
    href: '/mimic/',
    name: 'Mimic Party',
    tagline: 'Imite le son au micro : l’app note la ressemblance, les potes votent pour la meilleure imitation.',
    color: '#ff5c8a',
    mark: 'MIC',
  },
];

