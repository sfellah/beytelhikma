# Site de téléchargement et notes de version — design

**Date :** 2026-08-01
**État :** implémenté (site, chaînes CI/CD) ; mise à jour automatique de l'application à câbler

## Le problème

L'application n'avait aucun chemin vers ses utilisateurs. Pas de dépôt distant,
pas de tag, pas de CI : `npm run release:win` produisait un `.exe` sur une
machine, et rien ne le distribuait. Il fallait donc trois choses d'un coup — un
dépôt, une chaîne de publication reproductible, et une page où récupérer le
binaire et lire ce qui a changé.

## Les décisions

| Décision | Retenu | Pourquoi |
| --- | --- | --- |
| Dépôt | `sfellah/beytelhikma`, **privé d'abord** | Trois findings de sécurité connus restent ouverts ; publier le code et des binaires avant de les corriger n'est pas défendable. `gh repo edit --visibility public` est une commande, l'inverse ne dépublie rien. |
| Licence | AGPL-3.0 | Copyleft fort, cohérent avec un travail patrimonial. |
| Build | GitHub Actions sur tag `v*` | Reproductible ; la version publiée ne dépend plus d'un poste. |
| Plateformes | Windows x64, Linux x64 | macOS exige signature Developer ID et notarisation — un coût qui n'achète rien tant que personne ne le demande. |
| Hébergement | GitHub Pages | Statique, gratuit, déployé par le même dépôt. Cohérent avec une application local-first. |
| Données de la page | JSON figé au build | Une page instantanée, sans limite de débit, qui ne dépend pas d'un tiers pour afficher son bouton principal. |
| Notes | `CHANGELOG.{ar,fr,en}.md` à la main | Les commits (`feat(i18n): le lecteur passe par t()`) sont écrits pour des développeurs, en français seulement. |
| Outillage | HTML/CSS/JS + générateur Node sans dépendance | Le projet n'a aucun bundler ; en acquérir un pour trois pages serait une chaîne de plus à tenir. |
| Langues du site | `ar`, `fr`, `en` | Le site n'est pas l'application : `shared/locale.js` écarte le français pour l'interface, une page d'accueil peut le parler. |

## Les deux parcours

**Visiteur.** `/` sert une bascule de langue — redirection depuis
`navigator.languages`, trois liens visibles sans JavaScript. Puis `/<langue>/`
(accueil), `/<langue>/download/`, `/<langue>/releases/`.

**Mainteneur.** Écrire les notes dans les trois `CHANGELOG`, `npm version`,
`git push --tags`. Le reste est automatique ; la relecture de la Release publiée
est la seule étape humaine restante.

## Architecture

```
site/
  config.mjs          le seul module qui connaisse un hôte, un dépôt, un chemin
  build.mjs           le générateur ; ne parle jamais au réseau
  release-notes.mjs   le corps de la Release GitHub, depuis les CHANGELOG
  serve.mjs           relecture locale, servie sous BASE_PATH comme Pages
  lib/                changelog · releases · html · theme-css
  locales/            ar.mjs fr.mjs en.mjs — mêmes clés, test à l'appui
  templates/          layout · home · download · releases (modules JS)
  styles/site.css     surcouche ; toute couleur vient de tokens.css
  assets/             icons.svg · site.js · redirect.js · shots/
  test/               43 tests, node --test
.github/workflows/    ci.yml · release.yml · site.yml
CHANGELOG.{ar,fr,en}.md
```

### Ce qui n'est jamais recopié

`tokens.css`, les polices, la marque et les captures viennent de
`beytelhikma-electron/src/renderer/`, copiés **au build**. Un test compare
`dist/styles/tokens.css` à la source, octet pour octet. C'est la leçon du thème
`sepia` : deux copies d'une liste finissent par diverger, et la panne ne se voit
qu'à l'écran.

L'ambiance nuit va plus loin : `lib/theme-css.mjs` **extrait** le bloc
`:root[data-theme='night']` de `tokens.css` et le ré-émet sous
`@media (prefers-color-scheme: dark)`. Recopier les valeurs aurait créé une
seconde palette ; les dériver garantit qu'elles ne peuvent pas diverger. Le
sélecteur `:root:not([data-theme])` laisse un choix explicite l'emporter, si un
sélecteur d'ambiance est ajouté plus tard.

L'interpolation et la conversion des chiffres passent par
`shared/translate.js`, celui de l'application. Son argument de locale ne connaît
que `ar` et `en` : le français s'y ramène à `en`, ce qui est exact — il veut les
mêmes chiffres. C'est le seul point de contact, et il évite de recopier la table
des dix caractères arabes-indiens.

## Le contrat de données

`site/dist/releases.json`, écrit au build à partir de **deux sources
distinctes** :

- **les binaires** viennent de l'API GitHub. La page ne devine jamais une URL.
  Deviner `…/releases/latest/download/Beyt El Hikma Setup ${version}.exe`
  marcherait jusqu'au jour où `artifactName` change dans `package.json` — et ce
  jour-là le bouton principal renverrait un 404 sans qu'aucun test n'échoue ;
- **les notes** viennent des `CHANGELOG.<langue>.md`. Le corps de la Release
  GitHub en est *dérivé* par `release-notes.mjs`, jamais l'inverse : GitHub
  n'offre qu'un champ de texte, il ne peut pas porter trois langues séparément.

Les empreintes SHA-512 sont extraites des manifestes d'`electron-updater`
(`latest.yml`, `latest-linux.yml`) que le workflow télécharge. Pas de dépendance
YAML pour trois clés : un format qui changerait ferait disparaître les
empreintes de la page sans casser les liens, qui viennent de l'API.

### Trois échecs de build volontaires

1. **Une version absente d'un CHANGELOG.** Un repli sur une autre langue
   afficherait du français sur une page arabe — la dérive silencieuse que le
   projet interdit partout ailleurs.
2. **Une plateforme requise sans artefact.** Un bouton qui pointe vers rien est
   pire qu'un bouton absent : il se découvre chez l'utilisateur.
3. **Un tag qui ne correspond pas à `package.json`.** L'installeur serait nommé
   d'une version et publié sous une autre.

## La page sans JavaScript

Toutes les plateformes sont rendues au build, visibles et cliquables. `site.js`
ne fait que remonter et marquer celle du visiteur, et retenir la langue lue. Un
bouton de téléchargement qui n'existerait qu'après exécution d'un script serait
une page de téléchargement qui ne télécharge rien le jour où le script échoue.

Deux détails de détection : Android se présente comme Linux — proposer une
AppImage à un téléphone serait un lien mort déguisé en recommandation ; et
aucune architecture n'est devinée, la seule cible publiée étant x86-64.

## Ce que les maquettes ont perdu

`ui-examples/site-home.html` et `site-download.html` ont fourni la structure :
héros avec capture encadrée, grille bento, frise verticale des versions, encart
de spécifications. Leur palette Tailwind était déjà celle de `tokens.css`, valeur
pour valeur.

Ont été retirés : Tailwind par CDN, Google Fonts, Material Symbols et les images
`googleusercontent` — quatre appels à des tiers sur une page qui présente une
application hors ligne. Un test vérifie qu'aucune ressource externe ne revient.

Ont aussi été retirés trois arguments **faux** : la synchronisation cloud, la
« version navigateur » et les applications mobiles à venir. L'application est
locale, de bureau, sans compte.

Les icônes sont un sprite SVG local, inséré dans la page. Pas de logos de
marque : Windows et Linux sont désignés par un portable et un terminal, les mots
à côté portant déjà le sens.

## Les trois workflows

**`ci.yml`** — push et PR : les deux suites, en parallèle et indépendantes.

**`release.yml`** — sur tag `v*` : `guard` (tag = version, notes dans les trois
langues, suites vertes) → `build` en matrice Windows/Linux
(`npm ci`, `npm run seed`, `electron-builder --publish always`) → `publish` (corps
depuis les CHANGELOG, sortie de brouillon) → `verify` : relecture **sans
identifiants**. Une publication qui réussit derrière un jeton et échoue sans lui
est un échec qui ne se voit qu'en production — le projet applique déjà cette
règle au bucket. Tant que le dépôt est privé, cette étape le dit en avertissement
plutôt que de faire semblant de vérifier.

**`site.yml`** — appelé par la publication, et déclenché seul par un push sur
`site/`. Séparé exprès : une coquille dans une page ne doit pas réclamer une
nouvelle version de l'application.

Le nombre de livres annoncé vient de `assets/catalog-seed.json`, écrit par
`scripts/fetch-seed.mjs` depuis le pointeur du bucket — le même fichier qui dit
ce que l'installeur embarque. La page ne peut donc pas promettre un corpus que
l'application n'a pas.

## Ce qui reste

1. **Les trois findings de sécurité**, avant toute bascule en public :
   `will-navigate` absent de `main.js` ; `edition_id` non validé avant
   `path.join` ; catalogue installé sans vérification de son SHA-256. Le
   troisième transforme la mise à jour en canal de distribution non authentifié.
2. **La mise à jour automatique de l'application.** `publish` est configuré et
   les workflows produisent déjà `latest.yml` et les blockmaps ; le câblage
   d'`electron-updater` reste à écrire. Il doit copier `catalog-updater.js` :
   on propose, on n'impose pas, les branches muettes restent muettes, et un refus
   est retenu par version. Deux pièges : la cible **portable** ne peut pas se
   mettre à jour, le **`.deb`** non plus — seul l'AppImage le peut.
3. **La signature Windows.** Sans certificat, SmartScreen affiche
   « Windows a protégé votre ordinateur » à chaque installation. La page le dit
   et donne l'empreinte ; un certificat OV coûte ~300 €/an.
4. **Le domaine.** `BASE_PATH` vaut `/beytelhikma/` ; avec un domaine propre il
   devient `/` et rien d'autre ne bouge.
5. **Les droits sur le corpus Shamela**, à regarder avant de rendre le dépôt
   public.
