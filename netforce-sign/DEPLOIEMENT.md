# Mise en ligne de Netforce Sign

Durée : environ 20 minutes. Deux comptes gratuits sont nécessaires : **Supabase** (comptes et base de données) et **Vercel** (hébergement du site).

À la fin, l'équipe ouvre une adresse du type `https://netforce-sign.vercel.app`, se connecte, et ajoute l'app à l'écran d'accueil du téléphone.

---

## Raccourci : l'intégration Supabase de Vercel

Sur l'écran de déploiement Vercel, le bloc **Supabase → Add** crée la base et renseigne les variables tout seul (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, que l'app reconnaît). Choisissez une région **Europe**.
Dans ce cas, sautez la création du projet et la récupération des clés. Ouvrez ensuite la base depuis Vercel (**Storage → Supabase → Open in Supabase**) et faites quand même les étapes **1.2 et 1.3** (scripts SQL, création de compte), puis les étapes 3 à 6.

## 1. Créer la base de données (Supabase)

1. Créez un compte sur https://supabase.com, puis **New project**.
   - Nom : `netforce-sign`
   - Région : **Europe** (Paris `eu-west-3` ou Francfort `eu-central-1`)
   - Notez le mot de passe de la base dans un gestionnaire de mots de passe.
2. Une fois le projet prêt : menu **SQL Editor** → **New query**. Collez **tout** le contenu du fichier
   `netforce-sign/supabase/migrations/20261005000000_init.sql`, puis cliquez **Run**. Le message attendu est « Success. No rows returned ».
   Recommencez avec `netforce-sign/supabase/migrations/20261008000000_self_signup.sql` (création de compte réservée aux adresses de l'entreprise).
3. Menu **Authentication → Sign In / Providers** :
   - activez **Allow new users to sign up** : chacun crée son compte depuis l'app ;
   - laissez **Email** activé, avec **Confirm email** activé : l'adresse est vérifiée par un lien envoyé par e-mail.

   Seules les adresses de la liste `signup_allowlist` peuvent créer un compte (au départ : `nexstun.com`). Pour en ajouter, dans **SQL Editor** :
   ```sql
   insert into public.signup_allowlist (entry) values ('netforce-defense.com');   -- tout un domaine
   insert into public.signup_allowlist (entry) values ('prenom.nom@gmail.com');   -- une seule adresse
   ```
   La règle vaut aussi pour les invitations et les comptes créés depuis le tableau de bord.
4. Menu **Project Settings → API Keys** : notez
   - la **Project URL** (`https://xxxx.supabase.co`) ;
   - la clé publique : **anon / publishable**. Ne copiez jamais la clé *service_role / secret* dans l'app.

## 2. Mettre le site en ligne (Vercel)

1. Créez un compte sur https://vercel.com avec **Continue with GitHub**.
2. **Add New… → Project**, choisissez le dépôt `raphael-gerard`.
3. Réglages :
   - **Root Directory** : `netforce-sign`
   - **Environment Variables** :
     - `VITE_SUPABASE_URL` = la Project URL
     - `VITE_SUPABASE_ANON_KEY` = la clé anon / publishable
4. **Deploy**. Vercel donne une adresse, par exemple `https://netforce-sign.vercel.app`.
   Vercel met en ligne la branche principale (`main`) : le code doit y être fusionné. Chaque modification poussée sur `main` est ensuite remise en ligne automatiquement.
5. Facultatif : **Settings → Domains** pour utiliser une adresse comme `sign.netforce-defense.com`.

## 3. Relier les deux

Dans Supabase, menu **Authentication → URL Configuration** :
- **Site URL** : l'adresse Vercel (ex. `https://netforce-sign.vercel.app`)
- **Redirect URLs** : ajoutez la même adresse.

Sans ce réglage, les liens d'invitation et de mot de passe oublié ne mènent pas à l'app.

## 4. Créer votre compte administrateur

1. Supabase → **Authentication → Users → Add user → Create new user** : votre e-mail, un mot de passe, cochez **Auto Confirm User**.
2. **SQL Editor**, exécutez (avec votre e-mail) :
   ```sql
   update public.profiles set role = 'admin' where email = 'vous@netforce-defense.com';
   ```
3. Connectez-vous sur le site, puis importez votre signature et votre cachet (cartes « Signature » et « Cachet » → Ajouter).

## 5. L'équipe

Chaque collègue ouvre le site → **Créer un compte** → nom, e-mail professionnel, mot de passe. Il reçoit un e-mail, clique sur le lien : son compte est actif.
Il ajoute ensuite **sa propre signature et son propre cachet**, que lui seul voit et utilise. Un cachet commun importé auparavant par un administrateur reste proposé à ceux qui n'ont pas encore le leur.

La session reste ouverte sur chaque appareil : pas besoin de se reconnecter, sauf après « Se déconnecter ». Dans Supabase, **Authentication → Sessions**, laissez **Time-box user sessions** et **Inactivity timeout** désactivés (réglages par défaut).

- Inviter quelqu'un reste possible : **Authentication → Users → Add user → Send invitation**.
- Pour donner les droits d'administrateur à quelqu'un : même requête SQL qu'à l'étape 4.
- Pour retirer un accès : supprimez l'utilisateur dans **Authentication → Users**. Les lignes d'historique sont conservées et apparaissent alors comme « Utilisateur supprimé ».

> L'envoi d'e-mails intégré à Supabase est limité à quelques messages par heure. C'est suffisant pour une petite équipe ; au-delà, configurez un SMTP dans **Authentication → Emails → SMTP Settings**.

## 6. Installer l'app sur le téléphone

**iPhone (Safari obligatoire)** : ouvrez l'adresse du site → bouton **Partager** → **Sur l'écran d'accueil** → **Ajouter**.

**Android (Chrome)** : ouvrez l'adresse → menu **⋮** → **Installer l'application** (ou **Ajouter à l'écran d'accueil**).

**PC (Chrome / Edge)** : icône d'installation à droite de la barre d'adresse.

Sur iPhone, l'app de l'écran d'accueil ne partage pas la session de Safari. Après avoir cliqué sur le lien de confirmation ou d'invitation (qui s'ouvre dans Safari), il faut **se connecter une fois dans l'app installée**.

---

## Ce qui est stocké en ligne

| Donnée | Stockée | Qui la voit |
|---|---|---|
| Documents PDF / Word | **Jamais** : ils restent sur l'appareil | — |
| Signature | Oui (image) | Son propriétaire uniquement |
| Cachet | Oui (image) | Son propriétaire uniquement |
| Historique : nom du fichier, date, format, nombre de signatures, empreinte SHA-256 | Oui, non modifiable et non effaçable depuis l'app | Chacun voit le sien ; les admins voient tout |

L'empreinte SHA-256 permet de prouver plus tard qu'un fichier donné est bien celui qui a été signé, sans conserver le fichier.

## Bon à savoir

- **Projet Supabase gratuit** : il se met en pause après 7 jours sans aucune utilisation. Il suffit de le réactiver depuis le tableau de bord ; l'offre payante supprime cette limite.
- **Hors connexion** : l'app installée s'ouvre et signe sans réseau, avec la signature et le tampon mémorisés lors de la dernière connexion. L'historique ne s'enregistre qu'avec une connexion.
- **Tester les règles d'accès** (développeurs) : `npx supabase start` puis `node supabase/tests/rls.mjs`.
