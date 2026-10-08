# Mise en ligne de la Mobut App

La Mobut App regroupe les jeux de la bande sur une seule adresse :
- `/` : le menu des jeux ;
- `/volley/` : Notes Volley ;
- `/qui-de-nous/` : Qui de nous ?
- `/imposteur/` : L'Imposteur (en ligne)

À la première ouverture, la Mobut App demande « Qui es-tu ? » et retient la réponse sur ce téléphone. Tous les jeux s'en servent (lien « Ce n'est pas moi » sur l'accueil pour changer). Les 6 joueurs sont définis une seule fois dans `src/shared/players.ts`.

Tous les jeux partagent le même projet Vercel (Root Directory `volley-notes`) et le même projet Supabase.

## Ajouter un jeu

1. Crée `<jeu>/index.html` (copie celui d'un jeu existant) et son code dans `src/<jeu>/`.
2. Ajoute une ligne dans `vite.config.ts` (`input`) et une dans `src/hub/games.ts` (la tuile du menu).
3. Si le jeu enregistre des données, ajoute son script dans `supabase/migrations/` et lance-le dans Supabase.

## L'Imposteur

Script à lancer une fois dans Supabase : `supabase/migrations/20261009000000_imposteur.sql`.

- Le salon montre qui a la page ouverte. N'importe qui lance la partie avec 3 à 6 présents.
- Le mot n'est envoyé qu'aux téléphones des civils : l'imposteur ne peut pas le lire, même en fouillant.
- Pour ajouter des mots : dans Supabase, **SQL Editor** →
  `insert into public.imp_words (category, word) values ('Sport', 'Rugby'), ('Lieu', 'Gare');`
- Pour remettre les scores à zéro : `delete from public.imp_games;`
- Les téléphones se mettent à jour toutes les 2 à 3 secondes (et tout de suite quand Supabase Realtime est actif).

## Qui de nous ?

Les questions et les initiales des joueurs sont dans `src/qui-de-nous/questions.ts`. Pour corriger une question, change son texte et garde son `id` ; pour une nouvelle question, mets un nouvel `id`.

---


Durée : environ 15 minutes. Il faut deux comptes gratuits : **Supabase** (la base de données) et **Vercel** (l'hébergement du site).

À la fin, tu envoies une adresse du type `https://notes-volley.vercel.app` à tes potes. Ils n'ont besoin d'aucun compte : ils choisissent leur nom et notent.

---

## 1. Créer la base de données (Supabase)

1. Crée un compte sur https://supabase.com, puis **New project**.
   - Nom : `notes-volley`
   - Région : **Europe** (Paris `eu-west-3` ou Francfort `eu-central-1`)
2. Une fois le projet prêt, ouvre **SQL Editor → New query**, colle **tout** le contenu de
   `volley-notes/supabase/migrations/20261007000000_init.sql`, puis clique **Run**. Le message attendu est « Success. No rows returned ».
   Fais de même avec `volley-notes/supabase/migrations/20261007120000_public_votes.sql` (onglet public « Détails »)
   puis `volley-notes/supabase/migrations/20261007140000_self_votes.sql` (onglet « Auto-notes »), dans cet ordre.
   Pour Qui de nous ? : `volley-notes/supabase/migrations/20261008000000_qui_de_nous.sql`.
3. Ouvre **Authentication → Sign In / Providers** et désactive **Allow new users to sign up**. Comme ça, personne d'autre ne peut se créer de compte admin.
4. Ouvre **Project Settings → API Keys** et note :
   - la **Project URL** (`https://xxxx.supabase.co`) ;
   - la clé publique **anon / publishable**. Ne mets jamais la clé *service_role / secret* dans le site.

## 2. Créer ton compte admin

1. Ouvre **Authentication → Users → Add user → Create new user** : ton e-mail et un mot de passe, puis coche **Auto Confirm User**.
2. Dans **SQL Editor**, exécute la requête suivante en remplaçant l'e-mail par le tien :
   ```sql
   insert into public.admins (email) values ('ton-email@exemple.com');
   ```

## 3. Mettre le site en ligne (Vercel)

1. Sur https://vercel.com, connecte-toi avec **Continue with GitHub**.
2. Clique **Add New… → Project** et choisis le dépôt `raphael-gerard`.
3. Réglages :
   - **Root Directory** : `volley-notes`
   - **Environment Variables** :
     - `VITE_SUPABASE_URL` = la Project URL
     - `VITE_SUPABASE_ANON_KEY` = la clé anon / publishable
4. Clique **Deploy**. Vercel donne une adresse, par exemple `https://notes-volley.vercel.app`.
   Vercel publie la branche `main`, donc le code doit y être fusionné. Chaque modification poussée sur `main` est ensuite remise en ligne automatiquement.

> Raccourci : sur l'écran de déploiement, le bloc **Supabase → Add** de Vercel crée la base et remplit les variables tout seul. Dans ce cas, fais quand même les étapes 1.2, 1.3 et 2 depuis **Storage → Supabase → Open in Supabase**.

## 4. Utilisation

- **Tes potes** : envoie-leur l'adresse du site. Chacun choisit son nom, note les 5 autres joueurs et envoie. Il peut revenir modifier ses notes depuis le même téléphone et le même navigateur.
- **Le classement** est public et se met à jour à chaque vote. Il ne montre que des moyennes.
- **L'onglet « Détails »** est public lui aussi : tout le monde y voit qui a mis quelle note et tous les commentaires. L'écran de vote le signale avant qu'on note.
- **La rubrique « Commentaires »** : une fiche repliable par joueur, avec les commentaires reçus rangés par geste (et ses commentaires sur lui-même à la fin). Des boutons permettent de n'afficher qu'un geste.
- **L'onglet « Auto-notes »** : chacun peut se noter lui-même, à part. Ces notes ont leur propre classement, comparé à la moyenne donnée par les autres, et ne comptent jamais dans le classement général. Pour supprimer une auto-note, ouvre la table `self_votes` dans Supabase (**Table Editor**).
- **Les coulisses** s'ouvrent avec l'adresse suivie de `/volley/#coulisses` (par exemple `https://notes-volley.vercel.app/volley/#coulisses`). Connecte-toi avec ton compte admin pour voir :
  - qui a voté, et quand ;
  - le tableau votant × joueur noté, avec le détail en touchant une case ;
  - tous les commentaires ;
  - un bouton **Supprimer** pour retirer un vote en double ou un faux vote.

## Bon à savoir

- Personne n'a de compte : un vote est lié au téléphone et au navigateur qui l'a envoyé. Quelqu'un qui change de téléphone ou vide son navigateur crée un nouveau vote. Ce vote apparaît en double dans les coulisses, et tu peux y supprimer l'ancien.
- Rien n'empêche quelqu'un de choisir le nom d'un autre. Les coulisses signalent quand plusieurs votes portent le même nom.
- La base accepte au plus 60 votes, pour limiter le spam si le lien circule.
- Pour changer la liste des joueurs, il faut modifier `PLAYERS` dans `src/main.ts` **et** la liste `players` de la fonction `submit_vote` dans le script SQL, puis relancer ce script dans Supabase.

## Lancer en local

```bash
cd volley-notes
npm install
# crée un fichier .env.local avec VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY
npm run dev
```
