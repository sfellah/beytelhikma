# CLAUDE.md

Guidance pour Claude Code sur ce projet.

## Projet

**Beyt El Hikma** — application mobile Flutter/Dart de bibliothèque numérique et de lecture de livres. Multilingue : arabe (RTL), français et anglais (LTR). Voir `README.md` pour l'objectif complet et la structure cible.

## Commandes

```bash
cd beyelhikma
flutter pub get          # dépendances
flutter run              # lancer l'app
flutter test             # tests
flutter analyze          # lint / analyse statique
dart format lib test     # formatage
```

## Architecture (règles à respecter)

Séparation stricte en trois couches — ne jamais les mélanger :

- **`lib/models/`** — classes de données immuables reflétant l'API (Book, Author, Category, Edition, Volume, Cover, BookFile). `fromJson`/`toJson`, champs nullables tolérés (l'API peut renvoyer des données incomplètes).
- **`lib/repositories/`** — interface abstraite `BookRepository` + implémentations `MockBookRepository` (actuelle) et `ApiBookRepository` (future). **L'UI ne dépend que de l'interface**, jamais d'une implémentation concrète.
- **`lib/screens/` + `lib/widgets/`** — UI. Chaque écran gère explicitement 4 états : `loading / success / empty / error`.

Données mockées dans `lib/services/mock/` : réalistes, conformes à la structure future de l'API, avec latence simulée et cas d'erreur.

## Écrans principaux

1. `screens/home/` — accueil + bibliothèque (sections dynamiques, recherche, pagination/lazy-loading).
2. `screens/book_detail/` — fiche livre (éditions, volumes, métadonnées manquantes gérées).
3. `screens/reader/` — lecteur (chapitres, progression, réglages police/thème).

Maquettes HTML de référence dans `ui-examples/` (`book-info.html`, `reader.html`) — s'en inspirer pour le design des écrans Flutter.

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
