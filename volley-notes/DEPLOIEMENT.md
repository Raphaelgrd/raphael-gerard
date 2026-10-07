# Mise en ligne de Notes Volley

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
- **L'onglet « Auto-notes »** : chacun peut se noter lui-même, à part. Ces notes ont leur propre classement, comparé à la moyenne donnée par les autres, et ne comptent jamais dans le classement général. Pour supprimer une auto-note, ouvre la table `self_votes` dans Supabase (**Table Editor**).
- **Les coulisses** s'ouvrent avec l'adresse suivie de `#coulisses` (par exemple `https://notes-volley.vercel.app/#coulisses`). Connecte-toi avec ton compte admin pour voir :
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
