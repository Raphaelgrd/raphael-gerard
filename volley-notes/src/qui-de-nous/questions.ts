// Les questions du jeu. Pour en changer : modifie le texte, ajoute ou retire des lignes.
// L'`id` relie les réponses déjà données à la question : garde-le quand tu corriges juste le texte,
// mets-en un nouveau (lettres minuscules, chiffres, - ou _) pour une vraie nouvelle question.
// Mettre à true pour dévoiler les résultats dans l'onglet « Résultats ».
export const RESULTS_VISIBLE = false;

export const QUESTIONS: { id: string; text: string }[] = [
  { id: 'm1', text: 'Qui de nous peut se faire arnaquer facilement ?' },
  { id: 'm2', text: 'Qui de nous part au Brésil ?' },
  { id: 'm3', text: 'Qui de nous pourrait frapper sa mère pour 1000 € ?' },
  { id: 'm4', text: 'Qui de nous est le diable ou quoi ?' },
  { id: 'm5', text: 'Qui de nous bz un arbre à chat ?' },
  { id: 'm6', text: 'Qui de nous est le plus drôle ?' },
  { id: 'm7', text: 'Qui de nous est un traître et va quitter le Mobut en premier ?' },
  { id: 'm8', text: 'Qui de nous s’habille le mieux ?' },
  { id: 'm9', text: 'Qui de nous est le plus propre ?' },
  { id: 'm10', text: 'Qui de nous est le plus bête ?' },
  { id: 'm11', text: 'Qui de nous flop le plus ?' },
  { id: 'm12', text: 'Qui de nous serait le plus susceptible de bien la prendre par derrière ?' },
  { id: 'm13', text: 'Qui de nous a des goûts de merde en matière de meufs ?' },
  { id: 'm14', text: 'Qui de nous aimerait se faire attacher au lit ?' },
  { id: 'm15', text: 'Qui de nous est le plus gentil ?' },
  { id: 'm16', text: 'Qui de nous est le plus chauffant ?' },
  { id: 'm17', text: 'Qui de nous parle le plus dans le dos des autres ?' },
  { id: 'm18', text: 'Qui de nous est le plus susceptible ?' },
  { id: 'm19', text: 'Qui de nous pourrait voir des prostituées ?' },
  { id: 'm20', text: 'Qui de nous a des idées politiques limite limite ?' },
  { id: 'm21', text: 'Qui de nous va finir clochard ?' },
  { id: 'm22', text: 'Qui de nous a le plus subi sur les questions ?' },
];

// Les 6 joueurs sont communs à toute la Mobut App : src/shared/players.ts.
export { PLAYERS } from '../shared/players';
