# Netforce Sign

Application de signature de documents pour PC et mobile. On charge un PDF ou un Word, l'app détecte les zones de signature et de cachet, un clic suffit pour apposer, puis on ajuste à la main et on télécharge en PDF ou en Word.

Tout le traitement se fait **dans le navigateur** : aucun document n'est envoyé sur un serveur.

## Fonctionnalités

- **Import** : PDF et Word `.docx`, par sélection de fichier ou glisser-déposer.
- **Détection automatique** :
  - champs de signature natifs des PDF (formulaires) ;
  - mots-clés FR/EN : *Signature, Signé, Signataire, Lu et approuvé, Bon pour accord, Paraphe, Visa, Cachet, Tampon, Stamp…* ;
  - lignes de pointillés ou de soulignés (`Signature : ________`) : la signature se pose sur la ligne ;
  - « Cachet et signature » : deux zones côte à côte.
- **Un clic** sur une zone pour apposer, ou **« Tout signer »** pour remplir toutes les zones d'un coup. Au survol (sur ordinateur), un aperçu de la signature s'affiche dans la zone.
- **Ajustement** : glisser pour déplacer, tirer le coin pour redimensionner (proportions conservées), flèches du clavier pour un réglage fin, `Suppr` pour effacer, `Ctrl+Z` pour annuler.
- **Placement libre** : « Placer librement » puis clic ou tap n'importe où sur la page.
- **Signature** : dessinée (souris, doigt, stylet avec pression), écrite (3 styles manuscrits) ou importée (photo ou scan, fond blanc rendu transparent).
- **Cachet** : composé (rond ou rectangulaire, encre bleue, rouge ou noire, pré-rempli NETFORCE) ou importé.
- Signature et cachet sont **mémorisés sur l'appareil** pour les prochains documents.
- **Export** :

  | Document d'origine | Export PDF | Export Word |
  |---|---|---|
  | PDF | PDF d'origine conservé (texte sélectionnable) + images apposées | Une page = une image haute définition |
  | Word | Rendu fidèle des pages (images) | `.docx` d'origine **modifiable**, signatures insérées en images ancrées |

- **PWA installable** (« Ajouter à l'écran d'accueil » sur iOS/Android, « Installer » sur Chrome/Edge) et utilisable hors ligne.

## Lancer en local

```bash
cd netforce-sign
npm install
npm run dev        # http://localhost:5173
```

## Build de production

```bash
npm run build      # génère dist/ (site statique)
npm run preview    # sert dist/ en local
```

Le dossier `dist/` est un site statique : il se déploie tel quel sur Netlify, Vercel, GitHub Pages, un serveur interne ou un intranet. L'installation en PWA requiert HTTPS.

## Limites connues

- Les anciens fichiers `.doc` (Word 97-2003) ne sont pas lus : il faut les enregistrer en `.docx`.
- Un PDF scanné (image sans texte) ne permet pas de détecter les zones automatiquement : on utilise le placement libre.
- Le rendu Word dans le navigateur (docx-preview) est très proche de Word sans être identique au pixel près. Dans le `.docx` exporté, chaque signature est ancrée au paragraphe le plus proche : sa position est fidèle, mais elle peut varier légèrement si le texte est retouché ensuite.
- Il s'agit d'une signature **visuelle** (image apposée), pas d'une signature électronique qualifiée eIDAS avec certificat.

## Stack

React 19 + TypeScript + Vite · [pdf.js](https://mozilla.github.io/pdf.js/) (rendu et extraction du texte) · [pdf-lib](https://pdf-lib.js.org/) (écriture PDF) · [docx-preview](https://github.com/VolodymyrBaydalka/docxjs) (rendu Word) · JSZip (modification du `.docx`) · [docx](https://docx.js.org/) · html2canvas · vite-plugin-pwa.

## Organisation du code

```
src/
  App.tsx                 état global, ouverture, placement, export
  components/
    PdfView.tsx           rendu des pages PDF (chargement progressif)
    DocxView.tsx          rendu Word + mise à l'échelle
    PageOverlay.tsx       zones détectées, éléments posés, glisser / redimensionner
    AssetModal.tsx        création de la signature et du cachet
    SignaturePad.tsx      pad de signature tactile
  lib/
    detect.ts             heuristiques de détection (mots-clés, pointillés, dédoublonnage)
    pdf.ts                lecture, détection, export PDF (gère les pages pivotées)
    docx.ts               rendu, détection, export Word (images ancrées) et PDF
    assets.ts             signature écrite, import d'image, générateur de cachet
```
