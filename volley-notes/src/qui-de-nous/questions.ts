// Les questions du jeu. Pour en changer : modifie le texte, ajoute ou retire des lignes.
// L'`id` relie les réponses déjà données à la question : garde-le quand tu corriges juste le texte,
// mets-en un nouveau (lettres minuscules, chiffres, - ou _) pour une vraie nouvelle question.
export const QUESTIONS: { id: string; text: string }[] = [
  { id: 'q1', text: 'Qui de nous est le plus susceptible d’arriver en retard ?' },
  { id: 'q2', text: 'Qui de nous survivrait le plus longtemps sur une île déserte ?' },
  { id: 'q3', text: 'Qui de nous deviendra riche en premier ?' },
  { id: 'q4', text: 'Qui de nous est le plus mauvais perdant ?' },
  { id: 'q5', text: 'Qui de nous raconte les pires blagues ?' },
  { id: 'q6', text: 'Qui de nous serait le meilleur président ?' },
  { id: 'q7', text: 'Qui de nous passe le plus de temps sur son téléphone ?' },
  { id: 'q8', text: 'Qui de nous est le plus fiable en cas de galère ?' },
];

// Les 6 joueurs sont communs à toute la Mobut App : src/shared/players.ts.
export { PLAYERS } from '../shared/players';
