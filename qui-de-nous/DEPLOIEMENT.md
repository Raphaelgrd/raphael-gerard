# Mise en ligne de Qui de nous ?

Une question s'affiche, chacun classe les 6 du 1er au 6e en touchant leurs têtes dans l'ordre. L'onglet **Résultats** donne le verdict du groupe pour chaque question (position moyenne) et le classement de chacun.

Durée : environ 10 minutes si Notes Volley est déjà en ligne : on réutilise le même projet Supabase.

## 1. Base de données (Supabase)

1. Ouvre ton projet Supabase (celui de Notes Volley convient, les tables ne se mélangent pas).
2. **SQL Editor → New query**, colle tout le contenu de `qui-de-nous/supabase/migrations/20261008000000_init.sql`, puis **Run**. Le message attendu est « Success. No rows returned ».

## 2. Site (Vercel)

1. Sur https://vercel.com : **Add New… → Project**, choisis à nouveau le dépôt `raphael-gerard`.
2. **Root Directory** : `qui-de-nous`. Donne un nom au projet, par exemple `qui-de-nous`.
3. **Environment Variables** : les mêmes que pour Notes Volley
   - `VITE_SUPABASE_URL` = la Project URL
   - `VITE_SUPABASE_ANON_KEY` = la clé anon / publishable

   Tu les retrouves dans le projet Vercel de Notes Volley, **Settings → Environment Variables** (ou dans Supabase, **Project Settings → API Keys**). Autre solution : **Storage → Connect** et choisis la même base Supabase.
4. **Deploy**. Si tu ajoutes les variables après le premier déploiement, fais **Deployments → ⋯ → Redeploy**.

Vercel publie la branche `main` : le code doit y être fusionné.

## Changer les questions

Tout est dans `qui-de-nous/src/questions.ts` :
- pour corriger le texte d'une question, change `text` et garde son `id` : les réponses déjà données restent ;
- pour une nouvelle question, ajoute une ligne avec un nouvel `id` (minuscules, chiffres, `-` ou `_`) ;
- retirer une ligne cache la question ; ses anciennes réponses restent dans la base sans s'afficher.

Les noms et les lettres sur les têtes sont dans le même fichier. Les `id` des joueurs doivent rester ceux du script SQL.

## Bon à savoir

- Pas de compte : les réponses sont liées au téléphone et au navigateur. On peut refaire ses classements depuis le même appareil.
- Les classements de chacun sont visibles par tous dans **Résultats**, l'écran d'accueil le dit.
- Pour supprimer des réponses : Supabase → **Table Editor** → table `qdn_answers`.
