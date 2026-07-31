# CLAUDE.md

Guidance pour Claude Code sur ce projet.

## Projet

**Beyt El Hikma** — application mobile Flutter/Dart de bibliothèque numérique et de lecture de livres. Multilingue : arabe (RTL), français et anglais (LTR). Voir `README.md` pour l'objectif complet et la structure cible.

## Commandes

```bash
cd beytelhikma
flutter pub get          # dépendances
flutter run              # lancer l'app
flutter test             # tests
flutter analyze          # lint / analyse statique
dart format lib test     # formatage

python tools/gen_sample_data.py   # (depuis la racine) régénère les bases d'exemple
```

## Architecture (règles à respecter)

**Local-first, pas d'API.** La source de vérité est SQLite, conformément à `DATAMODEL.md` :

| Base                       | Rôle                                      | Accès          |
| -------------------------- | ----------------------------------------- | -------------- |
| `catalog.sqlite`           | catalogue (œuvres, éditions, auteurs)     | lecture seule  |
| `books/<edition_id>.sqlite` | contenu d'un livre (pages, volumes, toc)  | lecture seule  |
| `user.sqlite`              | bibliothèque, progression, réglages       | lecture/écriture |

Tant que le pipeline de téléchargement n'existe pas, catalogue et livres sont embarqués dans `beytelhikma/assets/sample/` puis copiés au premier accès par `AppDatabase` — le reste du code lit déjà des fichiers *installés*, comme il le fera avec le CDN. Les bases d'exemple (5 livres, 3 à 5 pages) sont produites par `tools/gen_sample_data.py` : ne jamais les éditer à la main, modifier le générateur.

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

## Hors périmètre v1

Recherche (FTS5 est déjà indexé dans les bases, non exposé) et gestionnaire de téléchargement.

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
