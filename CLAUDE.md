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

# publication des livres vers S3 — MinIO ou AWS (depuis la racine)
export MINIO_ACCESS_KEY=… MINIO_SECRET_KEY=…          # ou AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
python tools/publish_minio.py --bucket beytelhikma --set-anonymous-policy   # une seule fois
python tools/publish_minio.py --bucket beytelhikma --dry-run
python tools/publish_minio.py --bucket beytelhikma

# AWS S3 : `--endpoint aws` (ou vide) au lieu de l'URL MinIO ; région dans AWS_REGION
python tools/publish_minio.py --endpoint aws --region eu-west-1 --bucket <bucket> --set-anonymous-policy
```

## Architecture (règles à respecter)

**Local-first, pas d'API.** La source de vérité est SQLite, conformément à `DATAMODEL.md` :

| Base                       | Rôle                                      | Accès          |
| -------------------------- | ----------------------------------------- | -------------- |
| `catalog.sqlite`           | catalogue (œuvres, éditions, auteurs)     | lecture seule  |
| `books/<edition_id>.sqlite` | contenu d'un livre (pages, volumes, toc)  | lecture seule  |
| `user.sqlite`              | bibliothèque, progression, réglages       | lecture/écriture |

**Le catalogue est local, les livres se téléchargent.** `catalog.sqlite` est copié depuis la bibliothèque source au premier accès : l'exploration marche donc hors ligne. Les fichiers de livres, eux, ne sont plus copiés automatiquement — `AppDatabase.book()` exige un fichier installé et lève `BookNotInstalledError` sinon. C'est `src/main/download-manager.js` (portage Electron) qui les installe depuis le bucket : `GET` HTTP anonyme reprenable par en-tête `Range`, décompression zstd en flux, SHA-256 vérifié, `rename` atomique. Voir `docs/superpowers/specs/2026-07-31-minio-book-lifecycle-design.md`.

Une `download_url` de schéma non HTTP (`asset://` dans `assets/sample`, `local://` dans `dist/shamela`) fait installer le livre par simple copie depuis la bibliothèque source : les deux jeux de données restent utilisables sans bucket, et les tests tournent sans réseau.

**Le bucket de distribution : public par politique, jamais par ACL.** `configure_bucket` de `tools/publish_minio.py` pose la configuration complète en une fois — ACL désactivées (`BucketOwnerEnforced`), blocage d'accès public levé pour les *politiques* seulement (`BlockPublicAcls` et `IgnorePublicAcls` restent vrais), politique de `s3:GetObject` sur `books/*` **et rien d'autre**, chiffrement SSE-S3, CORS `GET`/`HEAD` exposant `Content-Range` et `Accept-Ranges`, purge des multipart abandonnés à 7 jours. Ouvrir le bucket entier exposerait `catalog.sqlite` ; le listing anonyme doit répondre 403.

Les objets partent avec `Cache-Control: public, max-age=31536000, immutable` : la `content_version` étant dans le chemin, aucune clé ne change jamais de contenu. Un réglage que le serveur n'implémente pas (MinIO ne couvre pas toute l'API S3) est signalé et sauté, sans empêcher la politique de lecture publique d'être posée.

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

Reste à faire : alignement du client Flutter sur le téléchargement, l'exploration et les annotations.

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
