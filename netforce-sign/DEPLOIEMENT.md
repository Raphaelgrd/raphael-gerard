# Mise en ligne de Netforce Sign

Durée : environ 20 minutes. Deux comptes gratuits sont nécessaires : **Supabase** (comptes et base de données) et **Vercel** (hébergement du site).

À la fin, l'équipe ouvre une adresse du type `https://netforce-sign.vercel.app`, se connecte, et ajoute l'app à l'écran d'accueil du téléphone.

---

## 1. Créer la base de données (Supabase)

1. Créez un compte sur https://supabase.com, puis **New project**.
   - Nom : `netforce-sign`
   - Région : **Europe** (Paris `eu-west-3` ou Francfort `eu-central-1`)
   - Notez le mot de passe de la base dans un gestionnaire de mots de passe.
2. Une fois le projet prêt : menu **SQL Editor** → **New query**. Collez **tout** le contenu du fichier
   `netforce-sign/supabase/migrations/20261005000000_init.sql`, puis cliquez **Run**. Le message attendu est « Success. No rows returned ».
3. Menu **Authentication → Sign In / Providers** :
   - désactivez **Allow new users to sign up**. Personne ne peut créer de compte seul, c'est vous qui invitez ;
   - laissez **Email** activé.
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
3. Connectez-vous sur le site, puis importez le **tampon de l'entreprise** (carte « Mon cachet » → Importer). Il devient disponible pour toute l'équipe ; seuls les administrateurs peuvent le changer.

## 5. Inviter l'équipe

Supabase → **Authentication → Users → Add user → Send invitation** avec l'e-mail du collègue.
Il reçoit un e-mail, clique sur le lien, choisit son nom et son mot de passe, puis il est connecté.

- Autre méthode : **Create new user** avec un mot de passe provisoire (Auto Confirm), à lui transmettre.
- Pour donner les droits d'administrateur à quelqu'un : même requête SQL qu'à l'étape 4.
- Pour retirer un accès : supprimez l'utilisateur dans **Authentication → Users**. Les lignes d'historique sont conservées et apparaissent alors comme « Utilisateur supprimé ».

> L'envoi d'e-mails intégré à Supabase est limité à quelques messages par heure. C'est suffisant pour une petite équipe ; au-delà, configurez un SMTP dans **Authentication → Emails → SMTP Settings**.

## 6. Installer l'app sur le téléphone

**iPhone (Safari obligatoire)** : ouvrez l'adresse du site → bouton **Partager** → **Sur l'écran d'accueil** → **Ajouter**.

**Android (Chrome)** : ouvrez l'adresse → menu **⋮** → **Installer l'application** (ou **Ajouter à l'écran d'accueil**).

**PC (Chrome / Edge)** : icône d'installation à droite de la barre d'adresse.

Sur iPhone, l'app de l'écran d'accueil ne partage pas la session de Safari. Après avoir choisi son mot de passe via le lien d'invitation (qui s'ouvre dans Safari), il faut **se connecter une fois dans l'app installée**.

---

## Ce qui est stocké en ligne

| Donnée | Stockée | Qui la voit |
|---|---|---|
| Documents PDF / Word | **Jamais** : ils restent sur l'appareil | — |
| Signature | Oui (image) | Son propriétaire uniquement |
| Tampon de l'entreprise | Oui (image) | Toute l'équipe (modifiable par les admins) |
| Historique : nom du fichier, date, format, nombre de signatures, empreinte SHA-256 | Oui, non modifiable et non effaçable depuis l'app | Chacun voit le sien ; les admins voient tout |

L'empreinte SHA-256 permet de prouver plus tard qu'un fichier donné est bien celui qui a été signé, sans conserver le fichier.

## Bon à savoir

- **Projet Supabase gratuit** : il se met en pause après 7 jours sans aucune utilisation. Il suffit de le réactiver depuis le tableau de bord ; l'offre payante supprime cette limite.
- **Hors connexion** : l'app installée s'ouvre et signe sans réseau, avec la signature et le tampon mémorisés lors de la dernière connexion. L'historique ne s'enregistre qu'avec une connexion.
- **Tester les règles d'accès** (développeurs) : `npx supabase start` puis `node supabase/tests/rls.mjs`.
