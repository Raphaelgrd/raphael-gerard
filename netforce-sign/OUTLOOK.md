# Bouton « Signer » dans Outlook

Une fois installé, un bouton **Signer** apparaît sur chaque mail reçu :

1. Ouvrez un mail qui contient un PDF ou un Word → cliquez sur **Signer**.
2. Le volet Netforce Sign s'ouvre à droite, avec la pièce jointe chargée. S'il y en a plusieurs, choisissez-la.
3. Signez : **Tout signer** ou un clic par zone, puis ajustez.
4. Cliquez sur **Répondre** ou **Répondre à tous** : la réponse s'ouvre avec le document signé en pièce jointe. Il ne reste qu'à envoyer.

À la première utilisation, connectez-vous une fois dans le volet, avec le même compte que sur l'app.

**Prérequis** : une boîte mail **Microsoft 365 / Exchange Online** (ou Outlook.com).
Le bouton fonctionne dans le nouvel Outlook pour Windows, Outlook pour Mac, Outlook sur le web (outlook.office.com) et Outlook mobile.
La réponse avec pièce jointe automatique demande une version récente d'Outlook. Sur une version ancienne, les boutons **Répondre** n'apparaissent pas, mais **Télécharger PDF / Word** reste disponible.

---

## 1. Vérifier l'adresse du manifeste

Après chaque déploiement, Vercel publie le fichier d'installation du complément :

```
https://VOTRE-SITE.vercel.app/outlook-manifest.xml
```

Ouvrez cette adresse dans un navigateur : toutes les adresses à l'intérieur doivent pointer vers votre site.
Le manifeste reprend automatiquement le domaine de production Vercel. Pour utiliser un autre domaine (ex. `sign.netforce-defense.com`), ajoutez dans Vercel la variable d'environnement `APP_URL=https://sign.netforce-defense.com`, puis redéployez.

## 2. Installer pour toute l'équipe (recommandé)

Il faut un compte **administrateur Microsoft 365**.

1. https://admin.microsoft.com → **Paramètres** → **Applications intégrées**.
2. **Charger des applications personnalisées** → type **Complément Office** → **Fournir un lien vers le fichier manifeste** → collez l'adresse de l'étape 1 → **Valider**.
3. Choisissez les utilisateurs : toute l'organisation, ou un groupe.
4. **Déployer**. Le bouton apparaît dans Outlook de chacun, en général en quelques heures (jusqu'à 24 h).

Les mises à jour de l'app sont automatiques : le bouton charge toujours la dernière version en ligne. Il faut recharger le manifeste dans l'admin uniquement si le fichier `outlook/manifest.template.xml` change (nouveau bouton, nouveau nom…).

## 3. Ou installer pour soi seulement (test)

Si votre organisation l'autorise :

1. Ouvrez https://aka.ms/olksideload : Outlook sur le web s'ouvre sur **Compléments**.
2. **Mes compléments** → **Ajouter un complément personnalisé** → **À partir d'une URL** → collez l'adresse du manifeste.
3. Le complément est disponible dans Outlook sur le web, le nouvel Outlook et Outlook mobile pour ce compte.

## Où trouver le bouton

- **Nouvel Outlook / Outlook web** : dans un mail ouvert, icône **Applications** (ou **…**) en haut du message → **Netforce Sign**. Épinglez-le pour l'avoir en accès direct.
- **Outlook pour Mac / Windows classique** : ruban **Accueil** → groupe **Netforce** → **Signer**.
- **Outlook mobile** : dans un mail ouvert, **…** → **Netforce Sign**.

Le volet peut être épinglé (punaise) : il reste ouvert et suit le mail sélectionné.

## Dépannage

| Problème | Solution |
|---|---|
| Le bouton n'apparaît pas | Attendre la propagation (jusqu'à 24 h après le déploiement admin), puis redémarrer Outlook |
| « Version d'Outlook trop ancienne » | Mettre Outlook à jour, ou utiliser Outlook sur le web |
| Les boutons **Répondre** sont absents | Outlook ne permet pas encore de joindre un fichier depuis un complément : télécharger le document signé et le joindre à la main |
| Le volet reste blanc | Vérifier que l'adresse du manifeste correspond bien au site en ligne (étape 1) |
