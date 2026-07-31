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

# publication des livres vers MinIO (depuis la racine)
export MINIO_ACCESS_KEY=… MINIO_SECRET_KEY=…
python tools/publish_minio.py --bucket beytelhikma --set-anonymous-policy   # une seule fois
python tools/publish_minio.py --bucket beytelhikma --dry-run
python tools/publish_minio.py --bucket beytelhikma
```

## Architecture (règles à respecter)

**Local-first, pas d'API.** La source de vérité est SQLite, conformément à `DATAMODEL.md` :

| Base                       | Rôle                                      | Accès          |
| -------------------------- | ----------------------------------------- | -------------- |
| `catalog.sqlite`           | catalogue (œuvres, éditions, auteurs)     | lecture seule  |
| `books/<edition_id>.sqlite` | contenu d'un livre (pages, volumes, toc)  | lecture seule  |
| `user.sqlite`              | bibliothèque, progression, réglages       | lecture/écriture |

**Le catalogue est local, les livres se téléchargent.** `catalog.sqlite` est copié depuis la bibliothèque source au premier accès : l'exploration marche donc hors ligne. Les fichiers de livres, eux, ne sont plus copiés automatiquement — `AppDatabase.book()` exige un fichier installé et lève `BookNotInstalledError` sinon. C'est `src/main/download-manager.js` (portage Electron) qui les installe depuis MinIO : `GET` HTTP anonyme reprenable par en-tête `Range`, décompression zstd en flux, SHA-256 vérifié, `rename` atomique. Voir `docs/superpowers/specs/2026-07-31-minio-book-lifecycle-design.md`.

Une `download_url` de schéma non HTTP (`asset://` dans `assets/sample`, `local://` dans `dist/shamela`) fait installer le livre par simple copie depuis la bibliothèque source : les deux jeux de données restent utilisables sans MinIO, et les tests tournent sans réseau.

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

Les quatre teintes de surlignage sortent des jetons du projet (`HIGHLIGHTS` dans `views/reader.js`) et se posent à opacité variable selon l'ambiance (`--highlight-strength`) : une pastille claire sur fond de nuit mangerait l'encre. Le fond de recherche porte la classe `reader__match` et **jamais** le sélecteur `.reader__page mark` — celui-ci l'emportait par spécificité sur `.reader__highlight` et repeignait en jaune toutes les couleurs choisies.

**Deux modes de lecture** (`reader.mode`, persisté) : `page`, une page imprimée par écran, et `scroll`, un fil continu. Le fil ne garde qu'une tranche bornée de pages autour de la lecture — sql.js charge déjà le livre entier en mémoire. Une annotation s'ancre sur la page qui porte la sélection, pas sur la page « courante » : en fil continu, ce n'est pas la même.

Les outils de la barre haute s'accrochent par `data-tool` : les infobulles portent leur raccourci et changent, l'attribut est le contrat que `src/main/capture.js` et les tests suivent.

**Attention : le build sql.js embarqué ne contient pas FTS5**, seulement FTS4 (la chaîne `fts5` est absente de `sql-wasm.wasm`). `catalog_fts` et `pages_fts` sont donc illisibles depuis Electron — le pipeline continue de les produire pour le client Flutter, mais ce portage ne les interroge jamais. La recherche s'appuie à la place sur :

- les colonnes normalisées déjà présentes au schéma, `pages.body_search` et `toc.title_normalized`, interrogées en `LIKE` ;
- un index mémoire des titres, auteurs et éditeurs, normalisé par `src/shared/arabic.js`.

`src/shared/arabic.js` est le **reflet exact** de `normalize_ar` de `tools/_common.py` : c'est ce contrat qui a produit les colonnes normalisées. `test/arabic.test.js` porte une table de parité — sans elle, les deux implémentations divergeraient en silence et la recherche se dégraderait sans qu'aucun test n'échoue.

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
