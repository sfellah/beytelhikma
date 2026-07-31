# CLAUDE.md

Guidance pour Claude Code sur ce projet.

## Projet

**Beyt El Hikma** — application mobile Flutter/Dart de bibliothèque numérique et de lecture de livres. Multilingue : arabe (RTL), français et anglais (LTR). Voir `README.md` pour l'objectif complet et la structure cible.

Deux implémentations coexistent, mêmes bases et mêmes règles : `beytelhikma/` (Flutter, référence) et `beytelhikma-electron/` (portage bureau Electron, voir son `README.md`).

## Commandes

```bash
cd beytelhikma
flutter pub get          # dépendances
flutter run              # lancer l'app
flutter test             # tests
flutter analyze          # lint / analyse statique
dart format lib test     # formatage

python tools/gen_sample_data.py   # (depuis la racine) régénère les bases d'exemple
python tools/gen_brand_assets.py  # (depuis la racine) régénère les assets de marque depuis logo.png

# import du corpus Shamela 4 (depuis la racine)
python tools/import_shamela.py                    # 3 livres par catégorie -> dist/shamela/
python tools/import_shamela.py --all --jobs 8     # les 8 589 livres (~60 Go)
python tools/import_shamela.py --dry-run          # afficher la sélection
cd tools && python -m unittest discover -s shamela/tests -t .   # tests de l'importeur

# chaîne bibliothèque : importe, publie, vérifie, nettoie (depuis la racine)
python tools/release_library.py --dry-run     # dit ce qui serait publié
python tools/release_library.py               # tout, dans l'ordre
python tools/release_library.py --skip-import # republier sans réimporter

# chaîne application (depuis beytelhikma-electron/)
npm run seed          # récupère la graine de catalogue depuis le bucket
npm run release:win   # tests + graine + installeur NSIS et portable

# publication des livres vers S3 — MinIO ou AWS (depuis la racine)
export MINIO_ACCESS_KEY=… MINIO_SECRET_KEY=…          # ou AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
python tools/publish_minio.py --bucket beytelhikma --set-anonymous-policy   # une seule fois
python tools/publish_minio.py --bucket beytelhikma --dry-run
python tools/publish_minio.py --bucket beytelhikma

# AWS S3 : `--endpoint aws` (ou vide) au lieu de l'URL MinIO ; région dans AWS_REGION
python tools/publish_minio.py --endpoint aws --region eu-west-1 --bucket <bucket> --set-anonymous-policy

# publier le catalogue seul (rapide : ne recompresse pas les livres)
python tools/publish_minio.py --endpoint aws --bucket <bucket> --catalog-only
```

## Architecture (règles à respecter)

**Local-first, pas d'API.** La source de vérité est SQLite, conformément à `DATAMODEL.md` :

| Base                       | Rôle                                      | Accès          |
| -------------------------- | ----------------------------------------- | -------------- |
| `catalog.sqlite`           | catalogue (œuvres, éditions, auteurs)     | lecture seule  |
| `books/<edition_id>.sqlite` | contenu d'un livre (pages, volumes, toc)  | lecture seule  |
| `user.sqlite`              | bibliothèque, progression, réglages       | lecture/écriture |

**Le catalogue est local, les livres se téléchargent.** `catalog.sqlite` est copié depuis la bibliothèque source au premier accès : l'exploration marche donc hors ligne. Les fichiers de livres, eux, ne sont plus copiés automatiquement — `AppDatabase.book()` exige un fichier installé et lève `BookNotInstalledError` sinon. C'est `src/main/download-manager.js` (portage Electron) qui les installe depuis le bucket : `GET` HTTP anonyme reprenable par en-tête `Range`, décompression zstd en flux, SHA-256 vérifié, `rename` atomique. Voir `docs/superpowers/specs/2026-07-31-minio-book-lifecycle-design.md`.

**Le catalogue ne porte aucun hôte.** `book_releases.object_key` (schéma **2**, ex-`download_url`) contient une clé relative — `books/<edition_id>/<content_version>/book.sqlite.zst` — que le client colle derrière le réglage `distribution.base_url`. La règle tient en une ligne : **la présence de `://` marque un absolu**. C'est elle qui garde `asset://` (dans `assets/sample`) et `local://` (dans `dist/shamela`) utilisables hors ligne, et qui fait qu'un catalogue publié à l'ancienne, avec des URL complètes, continue de fonctionner.

La résolution vit dans `src/shared/distribution.js`, et nulle part ailleurs. Le réglage précédent, `minio.base_url`, ne remplaçait que l'origine en gardant le chemin stocké : il cassait entre un bucket virtual-hosted (`/books/…`) et un path-style (`/bucket/books/…`), précisément le cas qu'il prétendait couvrir.

`tools/publish_minio.py` est le **seul** composant à connaître la disposition du bucket. Il construit les clés, les écrit dans le catalogue, puis publie `catalog/<catalog_version>/catalog.sqlite.zst` et un pointeur `catalog/latest.json`. Changer la hiérarchie plus tard ne casse donc aucune application déjà installée.

**Le bucket de distribution : public par politique, jamais par ACL.** `configure_bucket` pose la configuration complète en une fois — ACL désactivées (`BucketOwnerEnforced`), blocage d'accès public levé pour les *politiques* seulement (`BlockPublicAcls` et `IgnorePublicAcls` restent vrais), `s3:GetObject` sur `books/*` et `catalog/*` **et rien d'autre**, chiffrement SSE-S3, CORS `GET`/`HEAD` exposant `Content-Range` et `Accept-Ranges`, purge des multipart abandonnés à 7 jours. Ouvrir le bucket entier autoriserait le listing anonyme, qui doit répondre 403.

Les objets partent en `Cache-Control: public, max-age=31536000, immutable` : la version étant dans le chemin, aucune clé ne change jamais de contenu. **Sauf le pointeur, qui part en `no-cache`** — c'est le seul objet du bucket qui change sous une clé fixe, et le mettre en cache un an tuerait la mise à jour en silence : tout marcherait le premier jour, plus rien ensuite. `test_le_pointeur_n_est_jamais_mis_en_cache` existe pour ça. Un réglage que le serveur n'implémente pas (MinIO ne couvre pas toute l'API S3) est signalé et sauté, sans empêcher la politique de lecture publique d'être posée.

**La mise à jour du catalogue se propose, ne s'impose pas.** Au démarrage, `src/main/catalog-updater.js` lit le pointeur et compare. Cinq branches de décision sur six sont **silencieuses** : hors ligne, pointeur illisible, `schema_version` trop récent, déjà à jour, version refusée. Une application hors ligne a déjà tout ce qu'il lui faut pour explorer — lui afficher une alerte serait du bruit. `fetchPointer` ne lève donc jamais : il rend `null`, et `decideUpdate` en tire une décision. Toute branche silencieuse rend `pointer: null`, pour qu'aucun appelant ne puisse installer ce qu'on vient de refuser. Un refus est retenu **par version** (`distribution.declined_catalog_version`) : refuser la 2 ne fait pas taire la 3.

L'installation vérifie le SHA-256 **avant** le `rename`, qui est le dernier geste : une coupure à n'importe quel point laisse l'ancien catalogue intact et lisible.

**Une mise à jour de catalogue ne supprime jamais un fichier de livre.** `#syncInstalledLibrary` purgeait `books/` dès que la source changeait ; avec un catalogue qui se met à jour seul, ce serait tout retélécharger. La réconciliation se fait par édition, à la lecture : `downloaded_books.release_id` comparé au `release_id` actif donne `hasNewerRelease`. Une édition disparue du catalogue n'est pas dessinable (ni titre ni auteur) mais son fichier reste ; `getLibrary` en rend le compte dans `orphans` plutôt que de la faire disparaître en silence. Les ancres de surlignage sont posées sur le texte rendu : une réédition peut les déplacer, ce doit donc rester un choix de l'utilisateur.

Voir `docs/superpowers/specs/2026-07-31-source-distribution-configurable-design.md`.

**Le jeu d'exemple a deux copies**, `beytelhikma/assets/sample` et `beytelhikma-electron/assets/sample` : les tests Electron lisent la seconde sans passer par le client Flutter. `gen_sample_data.py` écrit les deux (`MIRROR_DIRS`). Elle était recopiée à la main, donc elle dérivait — un renommage de colonne l'a laissée au schéma 1 et la suite Electron a échoué loin de sa cause.

Les bases d'exemple (5 livres, 3 à 5 pages) sont produites par `tools/gen_sample_data.py` : ne jamais les éditer à la main, modifier le générateur.

**Le DDL vit dans `tools/_common.py`** (`BOOK_SCHEMA`, `CATALOG_SCHEMA`), importé à la fois par `gen_sample_data.py` et par l'importeur Shamela : une seule source de vérité, donc aucune dérive possible entre les données d'exemple et les données réelles. `tools/shamela/tests/test_pipeline.py::SchemaParityTest` échoue si ce n'est plus le cas.

`tools/import_shamela.py` transforme le corpus Shamela 4 (`C:\shamela-data`, 8 589 livres) vers `dist/shamela/` (non versionné), au même schéma. L'app le consomme via `AppDatabase.withRoot(Directory('.../dist/shamela'))`. Voir `tools/notebooks/01_un_livre_vers_sqlite.ipynb` pour la transformation d'un livre commentée étape par étape.

Séparation stricte en trois couches — ne jamais les mélanger :

- **`lib/models/`** — classes de données immuables reflétant le schéma SQLite (BookSummary, BookDetail, Author, BookCategory, Volume, BookPage, TocEntry, ReadingProgress, LibraryEntry). `fromMap`/`toJson`, champs nullables tolérés (les données source sont incomplètes).
- **`lib/repositories/`** — interface `BookRepository` + implémentation `SqliteBookRepository`. **L'UI ne dépend que de l'interface**, injectée par `RepositoryScope` ; les erreurs remontent en `RepositoryException`.
- **`lib/screens/` + `lib/widgets/`** — UI. Chaque écran gère explicitement 4 états : `loading / success / empty / error` (voir `AsyncView`).

## Écrans principaux

1. `screens/home/` — accueil (reprise de lecture, nouveautés, disciplines, auteur en vedette) ; `screens/library/` — livres installés.
2. `screens/book_detail/` — fiche livre (métadonnées présentes uniquement, volumes, sommaire hiérarchique).
3. `screens/reader/` — lecteur : une page imprimée par écran, balayage RTL, sélection de texte (`SelectionArea`), taille de police réglable (boutons, pincement, feuille de réglages), ambiances ورقي/بني/ليلي, progression écrite dans `user.sqlite`.

Le rendu du contenu passe par `lib/utils/arabic_html_parser.dart` (HTML minimal → blocs typés → `TextSpan`) : pas de WebView, pas de `flutter_html`, afin de garder le contrôle sur la typographie arabe et la sélection.

Maquettes HTML de référence dans `ui-examples/` (`home.html`, `mylibrary.html`, `book-info.html`, `reader.html`) — s'en inspirer pour le design des écrans Flutter.

## État par implémentation

Le portage Electron est en avance sur le client Flutter. Écrans livrés côté Electron : accueil, bibliothèque, fiche livre, lecteur, auteurs, **exploration** (`/explore`), **téléchargements** (`/downloads`, file + table paginée de tout le catalogue avec taille, pages, statut, suppression par lot), **collections** (`/collection/:id`), **recherche transversale** (`/search`), **mes notes** (`/notes`), **réglages** (`/settings`).

**Annotations.** `user.sqlite` porte les trois tables de `DATAMODEL.md` — `bookmarks`, `highlights`, `notes` — depuis la version de schéma **2**. La migration est additive et rejouée à l'ouverture des deux côtés (`AppDatabase.#migrateUser` en Electron, `onUpgrade` en Flutter) : les deux clients doivent lire le même `user_version`, sinon ils ne peuvent plus partager une racine de bibliothèque. Un surlignage s'ancre sur des décalages du texte rendu **et** sur le passage avec son contexte : les décalages seuls ne survivraient pas à une réédition (voir `src/renderer/js/annotations.js`).

Les quatre teintes de surlignage sortent des jetons du projet (`HIGHLIGHTS` dans `views/reader.js`) et se posent à opacité variable selon l'ambiance (`--highlight-strength`, déclarée dans `tokens.css` et abaissée par le thème nuit) : une pastille claire sur fond de nuit mangerait l'encre. Le fond de recherche porte la classe `reader__match` et **jamais** le sélecteur `.reader__page mark` — celui-ci l'emportait par spécificité sur `.reader__highlight` et repeignait en jaune toutes les couleurs choisies.

**Deux modes de lecture** (`reader.mode`, persisté) : `page`, une page imprimée par écran, et `scroll`, un fil continu. Le fil ne garde qu'une tranche bornée de pages autour de la lecture — sql.js charge déjà le livre entier en mémoire. Une annotation s'ancre sur la page qui porte la sélection, pas sur la page « courante » : en fil continu, ce n'est pas la même.

Les outils de la barre haute s'accrochent par `data-tool` : les infobulles portent leur raccourci et changent, l'attribut est le contrat que `src/main/capture.js` et les tests suivent.

**Le thème est celui de l'application, pas celui du lecteur.** Les trois ambiances — `paper`, `white`, `night` — se posent sur `<html>` par `data-theme`, et `styles/tokens.css` en tire toute la palette : `:root[data-theme='night']` échange les rôles (`--primary` prend la teinte claire, sinon l'émeraude `#003527` disparaît sur graphite) et passe les ombres au noir. `paper` **n'a pas de bloc** — c'est le `:root` de base, le parchemin est le défaut et non un cas particulier.

La liste vit dans `src/shared/theme.js`, seule ; `src/renderer/js/theme.js` porte la peinture et la persistance, `components/theme-choices.js` le seul rendu des pastilles. Un thème choisi depuis le lecteur ou depuis `/settings` est le même. C'est de deux copies de la liste qu'était née la panne précédente : les réglages proposaient un `sepia` qu'aucune règle CSS ne lisait plus. `test/theme.test.js` interdit qu'une vue redéclare `THEMES`, vérifie que chaque clé a son bloc de jetons, et que les pastilles annoncent la vraie valeur de `--surface`.

Source de vérité : `app.theme` dans `user.sqlite`, avec repli une fois sur l'ancienne `reader.theme`. Un miroir `localStorage` est lu **en synchrone** au démarrage (`theme.js` est chargé avant `app.js`) : `user.sqlite` arrive par IPC après le premier rendu, et sans lui ouvrir l'application en nuit donnerait un éclair blanc. Le miroir n'est jamais interrogé comme vérité — `syncTheme()` réconcilie. Pas de script inline : le CSP est `script-src 'self'`.

Le lecteur ne porte plus d'ambiance : ses variables `--reader-*` dérivent des jetons et suivent seules. Seules `--highlight-strength`, `--quote-strength` et `--mark-strength` restent dictées par le thème, et la campagne de captures pose la nuit par les pastilles réelles (`shootNightTheme`) avant de revenir au parchemin — une ambiance qu'aucune image ne montre est une ambiance qui dérive.

**Pagination : un écran ne montre jamais tout, et ne prétend jamais le contraire.** Le corpus fait 8 589 livres et plusieurs milliers d'auteurs. Toute lecture qui peut en ramener plus d'un écran renvoie `{ rows, total }` — `getAuthors`, `getBooksIn`, `getLibrary`, `getCollectionBooks`, `getAnnotations`, `getManagedBooks`, `exploreBooks`. La règle qui compte : **un décompte affiché vient de SQL, jamais de `rows.length`.** Un `limit` sans `total` faisait dire à l'écran des auteurs « ٢٠٠ مؤلفًا » quand il y en a 113 — ou 8 000. `getAuthorStats` et `getEras` existent pour cette raison.

Deux conséquences de forme :

- `getLibrary` filtre les lignes de `downloaded_books` qui ne sont plus au catalogue. `saveProgress` accepte n'importe quel `edition_id` et pose une ligne « installée » : sans ce filtre, le total promettrait des pages que la jointure ne saurait pas remplir.
- Le tri par titre ne peut pas se faire en SQL : le titre vit dans `catalog.sqlite`, l'installation dans `user.sqlite`, deux instances sql.js qu'aucun `ORDER BY` ne traverse. L'ordre est donc lu une fois côté catalogue (`#titleOrder`, gardé pour la session) et l'on y pioche ce qui est installé — un `IN (?,?,…)` de plusieurs milliers de paramètres, SQLite le refuserait.

**L'accueil échantillonne, et le dit.** `getTopCategories` rend six disciplines sur les quarante peuplées, avec le vrai `total` : c'est lui qu'annonce le lien de repli, jamais `rows.length`. Sa teinte vient de `coverFamily()` puis de `COVER_FAMILIES` — la bulle d'une discipline porte la couleur des couvertures de cette discipline, et il n'existe pas de seconde palette à tenir à jour.

La frise des siècles comble son axe côté vue (`getEras` ne rend que les siècles peuplés ; un siècle vide doit se voir comme vide, pas disparaître) et met les barres en **racine** du rapport au maximum — en rapport brut, un siècle à un livre tombait sous son plancher de pixels et cessait de porter une valeur. Elle se termine par `غير مؤرّخ`, portée `undated` de `BOOK_SCOPES` : 29 % des éditions n'ont aucun auteur daté, et une section qui se donne pour une vue d'ensemble ne peut pas les taire. Voir `docs/superpowers/specs/2026-07-31-accueil-disciplines-et-siecles-design.md`.

Les listes longues sans pagination possible (sommaire d'un livre) se **fenêtrent** côté vue : `TOC_WINDOW` entrées montées, le reste à la demande, plus un champ qui filtre sur le titre normalisé. Le lecteur garde le sommaire entier en mémoire — il lui sert à nommer le chapitre de chaque page — mais n'en dessine qu'une tranche.

**Les méthodes exposées au rendu vivent dans deux listes** — `METHODS` de `src/preload/preload.cjs` et `REPOSITORY_METHODS` de `book-repository.js`. Une méthode ajoutée d'un seul côté ne casse rien au démarrage : elle échoue au premier clic. `test/repository.test.js` porte le test de parité.

**Attention : le build sql.js embarqué ne contient pas FTS5**, seulement FTS4 (la chaîne `fts5` est absente de `sql-wasm.wasm`). `catalog_fts` et `pages_fts` sont donc illisibles depuis Electron — le pipeline continue de les produire pour le client Flutter, mais ce portage ne les interroge jamais. La recherche s'appuie à la place sur :

- les colonnes normalisées déjà présentes au schéma, `pages.body_search` et `toc.title_normalized`, interrogées en `LIKE` ;
- un index mémoire des titres, auteurs et éditeurs, normalisé par `src/shared/arabic.js`.

`src/shared/arabic.js` est le **reflet exact** de `normalize_ar` de `tools/_common.py` : c'est ce contrat qui a produit les colonnes normalisées. `test/arabic.test.js` porte une table de parité — sans elle, les deux implémentations divergeraient en silence et la recherche se dégraderait sans qu'aucun test n'échoue.

**Couvertures.** Aucun livre n'a d'image : `editions.cover_url` est nulle partout et les deux générateurs l'écrivent ainsi. La couverture est composée à l'affichage, sur trois canaux que le catalogue fournit déjà :

- la **forme** de l'objet donne la mise en page parmi cinq — `treatise` (≤ 120 p.), `book`, `tome` (> 400 p.), `compendium` (multi-tomes), `document` (tout `book_type_label` autre que `كتاب`). Données présentes à 100 %, et c'est le canal le plus visible parce que c'est ce qu'on veut savoir avant d'ouvrir ;
- la **famille** de la catégorie donne la teinte et le motif parmi neuf, indexée par `categoryLabel` normalisé et non par `category_id`, qui ne concorde pas entre `assets/sample` et `dist/shamela` ;
- le **siècle** de l'auteur donne la patine, en variable **continue** : plus c'est ancien, plus la teinte fonce et plus la dorure monte. C'est ce qui permet aux 29 % d'éditions sans `death_year_hijri` de prendre une patine médiane au lieu d'un style à part qui signifierait « on ne sait pas ».

Les tables vivent dans `src/shared/book-cover.js` et `lib/utils/book_cover.dart`, en miroir l'une de l'autre ; `test/book-cover.test.js` lit le fichier Dart et compare — c'est faute d'un tel test que les palettes d'origine avaient divergé. Attention : `/explore` passe par `catalog-query.js`, projection distincte de `SUMMARY_SELECT` ; les deux doivent porter `book_type_label` et `death_year_hijri`, sinon l'écran entier tombe sur les replis. Voir `docs/superpowers/specs/2026-07-31-couvertures-composees-design.md`.

La recherche transversale (`BookRepository.searchLibrary`) balaie les livres installés un par un et referme ceux qu'elle a ouverts : sql.js charge chaque livre entièrement en mémoire, un balayage qui laisserait tout ouvert ferait enfler le processus. Le balayage est borné par `maxBooks` et l'écran annonce ce qu'il n'a pas parcouru.

**Le jeu publié actuellement** : 397 éditions (10 livres par catégorie), 182 805 pages, sur `beytelhima-library` en `eu-west-1`. Le catalogue est en `catalog_version` 1, `schema_version` 2.

## Deux chaînes de build

Elles ont deux cadences, deux artefacts, et un seul point de couplage. Voir `docs/superpowers/specs/2026-07-31-chaines-de-build-design.md`.

**Bibliothèque** — `tools/release_library.py`, en local : le corpus source fait ~60 Go sur la machine, aucune CI ne l'aura. Importe, publie, vérifie, nettoie, dans cet ordre.

**La `catalog_version` ne se donne pas à la main.** Elle se déduit de ce qui est en ligne : le pointeur dit la version publiée et son empreinte ; même empreinte, rien n'est republié. `version_suivante()` est une fonction pure, testée sans réseau. Une version qui s'incrémenterait à chaque exécution ferait retélécharger la graine à tous les clients pour un catalogue identique.

**La vérification anonyme est dans la chaîne, pas à côté.** Elle relit le pointeur et un livre *sans identifiants*. Une publication qui réussit derrière des clés et échoue sans elles est un échec qui ne se voit qu'en production.

**Application** — `npm run release:win` : tests, puis `scripts/fetch-seed.mjs`, puis `electron-builder`. Rien ne s'empaquette sur une suite rouge.

La graine (`assets/catalog.sqlite.zst`) est **téléchargée depuis le bucket au moment du build**, jamais copiée de `dist/` : elle est donc par construction celle qui est en ligne, et un installeur ne peut pas promettre des livres que le bucket n'a pas. C'est un artefact, pas une source — ignorée par git, sinon plusieurs Mo de binaire entreraient dans l'historique à chaque publication. `assets/catalog-seed.json` dit ce qui a été embarqué et rend l'étape idempotente.

`fetch-seed` s'arrête sans rien écrire si la source est injoignable ou si le `schema_version` du pointeur dépasse `SUPPORTED_SCHEMA_VERSION`. **Pas de repli sur une graine périmée** : un installeur silencieusement obsolète est pire qu'un build raté, parce que l'erreur se découvre alors chez l'utilisateur.

**Au premier lancement**, `AppDatabase.#plantSeed` décompresse la graine — **seulement si `catalog.sqlite` est absent**. Une mise à jour d'application embarque une graine plus ancienne que le catalogue déjà téléchargé ; l'écraser ferait régresser le catalogue de l'utilisateur à chaque nouvelle version. Dans une application empaquetée, `librarySource` est nul : **aucun livre ne peut venir d'ailleurs que du bucket**, et `asset://` / `local://` ne s'y rencontrent jamais.

`beytelhikma-electron/build/` est le `buildResources` d'electron-builder, pas un dossier de sortie : il porte `icon.ico`, dérivé de `app-icon.png` par `tools/gen_brand_assets.py`. Il n'est donc pas ignorable en bloc — git ne réinclut rien sous un dossier exclu. Ce qui est artefact y est nommé un par un (`build/screenshots/`), et les artefacts d'empaquetage sortent dans `release/`.

Reste à faire : alignement du client Flutter sur le téléchargement, l'exploration, les annotations et la source de distribution — le miroir Dart de `src/shared/distribution.js` n'existe pas encore. Et le catalogue embarqué dans le build (`assets/catalog.sqlite.zst`, ~8 Mo pour le corpus entier) : le chemin de mise à jour depuis le bucket est en place et testé, mais le premier lancement copie toujours le catalogue depuis le dossier source local.

## i18n / RTL (critique)

- Locales : `ar`, `fr`, `en`.
- Direction de **l'interface** = locale de l'app ; direction du **contenu** = langue du livre. Un livre arabe se lit en RTL même si l'UI est en français — utiliser `Directionality` explicitement dans le lecteur et les titres.
- Ne jamais coder en dur des alignements gauche/droite : utiliser `start`/`end` (`EdgeInsetsDirectional`, `AlignmentDirectional`, `TextAlign.start`).
- Polices arabes dédiées (Amiri / Noto Naskh) séparées des polices latines.

## Conventions

- Pas de contenu statique dans l'UI : toute donnée passe par le repository.
- Widgets partagés réutilisables dans `lib/widgets/` (BookCard, CoverImage, LoadingView, ErrorView, EmptyView).
- Nommage fichiers : `snake_case.dart`.
- Respecter `analysis_options.yaml` ; lancer `flutter analyze` avant de conclure une tâche.
