# Exploration du catalogue : recherche, filtres, sélection, téléchargement

Date : 2026-07-31
Portée : `beytelhikma-electron/`. Ni le schéma des bases, ni `tools/`, ni le client Flutter ne sont modifiés.

Suite de `2026-07-31-minio-book-lifecycle-design.md`, qui a rendu les livres
téléchargeables. Ce document décrit l'écran qui permet de **trouver** quoi
télécharger.

## 1. Objectif

La route `/explore` affiche aujourd'hui un texte d'attente. Le catalogue est
pourtant entièrement local et interrogeable : 8 589 éditions sur le corpus
complet, 40 catégories, un index `catalog_fts` déjà peuplé.

L'écran doit permettre de partir de 8 589 livres et d'arriver à une poignée
qu'on installe, en combinant une recherche texte et sept filtres.

## 2. Aucune modification de schéma

**Ni `catalog.sqlite` ni `books/<id>.sqlite` ne changent.** `tools/_common.py`
n'est pas touché, aucun réimport n'est nécessaire, `SchemaParityTest` continue
de passer. Deux choix rendent cela possible.

**Le statut d'installation ne peut pas se joindre en SQL.** `catalog.sqlite` et
`user.sqlite` sont deux instances sql.js distinctes : pas de `JOIN` entre elles,
pas d'`ATTACH` sur une base en mémoire. Le filtre `الحالة` lit donc d'abord les
`edition_id` installés dans `user.sqlite`, puis les passe en paramètres liés au
catalogue — `edition_id IN (…)` ou `NOT IN (…)`. La liste des installés reste
courte par nature (l'utilisateur télécharge un sous-ensemble), quel que soit le
sens du filtre.

**Les noms d'auteurs et d'éditeurs sont indexés en mémoire, pas en SQL.** Un
`LIKE` sur `authors.full_name_ar` échoue dès que la hamza diffère de la source,
et la colonne n'est pas normalisée. Plutôt que d'ajouter une colonne au schéma,
l'application charge une fois la liste des auteurs et des éditeurs, l'indexe
avec `normalizeArabic()`, et filtre là. Quelques milliers de chaînes tiennent
sans effort en mémoire.

Effet de bord utile : cela contourne aussi le fait que `catalog_fts.author_names`
n'est pas normalisé. Une recherche texte résout les auteurs correspondants en
mémoire et ajoute leurs `author_id` à la clause `WHERE`.

## 3. Filtres

Sept facettes, plus la recherche texte.

| Facette | Source | Cardinalité (corpus complet) | Widget |
| --- | --- | --- | --- |
| التخصص | `categories` | 40 | liste à cases + compteur |
| النوع | `editions.book_type_label` | 5 | liste à cases + compteur |
| القرن | `authors.death_year_hijri` | ~15 | liste à cases + compteur |
| الحالة | `user.sqlite` | 2 | liste à cases + compteur |
| سنة النشر | `editions.publication_year` | plage 1959-2023 | deux champs (de / à) |
| المؤلف | `authors` | milliers | champ à autocomplétion |
| الناشر | `editions.publisher_ar` | centaines | champ à autocomplétion |

**Sémantique : ET entre facettes, OU à l'intérieur d'une facette.**
« تخصص = فقه مالكي OU فقه شافعي » ET « قرن = 7 » ET « الحالة = غير مُنزَّل ».

Requête envoyée par le rendu :

```js
{
  text: 'ابن خلدون',              // FTS5, optionnel
  categories: [12, 15],           // OU interne
  authors: ['a-0042'],
  centuries: [7, 8],
  types: ['كتاب'],
  publishers: ['دار الفكر'],
  years: { from: 1990, to: 2010 },
  status: 'installed' | 'missing' | null,
  sort: 'title' | 'recent' | 'pages' | 'size',
  offset: 0,
  limit: 40,
}
```

L'autocomplétion se déclenche à deux caractères, cherche sur le nom normalisé,
renvoie les vingt valeurs les plus fournies avec leur compte. Les valeurs
choisies restent en puces au-dessus du champ. Antirebond de 200 ms sur la frappe.

## 4. Compteurs de facettes

Les compteurs concernent les quatre facettes à liste — التخصص, النوع, القرن,
الحالة. La plage d'années n'en a pas, et les champs à autocomplétion affichent
le leur dans les suggestions.

Le compteur d'une valeur se calcule **avec tous les autres filtres appliqués,
mais sans le sien**. Sans cette règle, cocher « فقه مالكي » ferait tomber toutes
ses sœurs à zéro et il deviendrait impossible d'en ajouter une seconde.

Les valeurs à zéro sont grisées, jamais masquées : voir qu'une combinaison est
vide vaut mieux que voir une liste qui rétrécit sans explication.

Coût : une requête d'agrégation par facette à chaque changement. Le catalogue
complet pèse une cinquantaine de mégaoctets en mémoire pour 8 589 lignes — les
agrégats sont sous la milliseconde. Pas de cache, pas d'index supplémentaire.

## 5. Recherche texte et normalisation

`catalog_fts` contient `title_ar`, `title_normalized`, `author_names` et
`bibliography_text`. Seule `title_normalized` est passée par `normalize_ar` de
`tools/_common.py`.

Il faut donc une fonction `normalizeArabic()` en JavaScript **reflétant
exactement** la Python. Le rendu en a besoin pour l'autocomplétion, le processus
principal pour la requête : le module vit dans `src/shared/arabic.js` et est
importé des deux côtés (`../../shared/arabic.js` depuis `src/renderer/js/`).

Contrat, transcrit du Python :

1. `String.prototype.normalize('NFC')`
2. suppression des harakāt : `/[ؐ-ًؚ-ٰٟۖ-ۭ]/g`
   — ce sont les plages exactes de `HARAKAT`, vérifiées par énumération des
   points de code, et non transcrites à vue
3. suppression du tatweel `ـ`
4. `/[أإآٱ]/g → ا`
5. `ى → ي`
6. `ة → ه`
7. `/\s+/g → ' '`, puis `trim()`

Table de parité, produite par `normalize_ar` :

| Entrée | Sortie |
| --- | --- |
| `أَحْمَد` | `احمد` |
| `إبراهيم` | `ابراهيم` |
| `آل عمران` | `ال عمران` |
| `ٱلكتاب` | `الكتاب` |
| `مُقَدِّمَة ابن خَلْدُون` | `مقدمه ابن خلدون` |
| `الرسالة` | `الرساله` |
| `عائشة` | `عائشه` |
| `ىسير` | `يسير` |
| `ابـــن تيمية` | `ابن تيميه` |
| `  فقه   مالكي  ` | `فقه مالكي` |
| `الشافعيّة` | `الشافعيه` |

La requête FTS cherche les deux formes — `MATCH '<normalisé>* OR <brut>*'` — de
sorte que `title_normalized` réponde à la première et `title_ar` à la seconde.

## 6. Module `src/main/catalog-query.js`

`book-repository.js` fait déjà sept cents lignes. Un constructeur de requêtes
inséré dedans le rendrait illisible. Nouveau module, **sans accès base**, donc
testable seul :

- `buildWhere(query, { installedIds }) -> { sql, params }`
- `buildFacetQuery(query, facetKey, { installedIds }) -> { sql, params }`
- `SORTS` — liste blanche ; un tri inconnu retombe sur `title`

Aucune valeur ne rejoint le SQL par interpolation : tout ressort en paramètres
liés. Les seuls fragments littéraux sont des noms de colonnes issus de la liste
blanche.

`BookRepository` gagne cinq méthodes, exposées par l'IPC existant :
`exploreBooks(query)`, `getFacets(query)`, `suggestValues(facetKey, term)`,
`getSelectionWeight(editionIds)`, `downloadSelection(editionIds)`.

## 7. Écran `/explore`

Le routeur découpe déjà le fragment sur `?` et passe `params.query` ; une vue
peut renvoyer `{ dispose }`. On s'en sert.

**État** en mémoire dans la vue. À chaque changement de filtre, seuls la grille
et les compteurs se redessinent — pas la coque. L'état est recopié dans le
fragment par `history.replaceState`, qui ne déclenche pas `hashchange` :
rechargement et partage de lien fonctionnent sans re-rendu à chaque clic.

Disposition large :

```
الاستكشاف                    [ ⌕ بحث في العناوين والمؤلفين            ]
٨٥٨٩ نتيجة                                        [ الترتيب: العنوان ▾ ]

[فقه مالكي ✕] [القرن ٧ ✕] [غير مُنزَّل ✕]   مسح الكل            [ تحديد ]
┌──────────────┐ ┌────────────────────────────────────────────────┐
│ التخصص       │ │                                                │
│ ☑ فقه مالكي(12)│ │              grille de cartes                  │
│ ☐ فقه شافعي(9)│ │                                                │
│ النوع        │ │                                                │
│ المؤلف  [⌕…] │ │                                                │
│ الناشر  [⌕…] │ │                                                │
│ سنة النشر    │ │                                                │
│ الحالة       │ │                                                │
└──────────────┘ └────────────────────────────────────────────────┘
```

Sous 900 px, le panneau devient un tiroir ouvert par un bouton `تصفية (3)`
portant le nombre de filtres actifs.

Pagination à quarante, bouton `عرض المزيد`. Pas de défilement infini : sur
8 589 résultats il rend le retour en arrière impraticable.

La barre du bandeau supérieur, qui répond `البحث غير مفعَّل في هذه النسخة`
depuis le début, renverra vers `#/explore?text=…`.

`bookCard` gagne une option `action: 'download'` qui place une icône de
téléchargement dans le survol déjà présent (`.book-card__overlay`), **sur cet
écran seulement**. Les grilles de l'accueil et de la bibliothèque ne changent
pas : la décision de ne pas les alourdir tient, mais explorer sans pouvoir
installer d'un geste serait absurde.

## 8. Sélection et téléchargement

Un mode sélection, activé par le bouton `تحديد`, pose une case sur chaque carte.
Tant qu'il est actif, cliquer une carte la coche au lieu d'ouvrir sa fiche : un
clic ne fait jamais deux choses différentes selon le contexte.

```
[ تحديد ]  →  [ ٧ محدد • ٥٤ م.ب ]  [ تحديد كل الصفحة ]  [ ⭳ تنزيل المحدد ]  [ إلغاء ]
```

- La sélection est un ensemble d'`edition_id`, **conservé d'une page et d'un
  filtre à l'autre** : on filtre, on coche, on refiltre, on coche encore, puis on
  télécharge le tout.
- Le poids cumulé se met à jour à chaque coche : `SUM(compressed_size)` sur les
  identifiants sélectionnés, livres déjà installés exclus.
- Un livre déjà installé a sa case désactivée.
- `تنزيل المحدد` demande confirmation avec le nombre et le poids, met en file,
  puis vide la sélection.
- Quitter le mode sélection vide la sélection.

La file séquentielle existante absorbe la charge ; `/downloads` montre
l'avancement ; chaque livre reste annulable individuellement.

La modale de suppression et celle-ci partagent la même mécanique : on extrait
`src/renderer/js/components/modal.js` (`confirmDialog({ title, message,
actions })`), et `confirm-delete.js` devient un appelant mince. Deuxième
consommateur, donc extraction justifiée — pas de refactorisation gratuite.

## 9. Tests

`test/arabic.test.js` — la table de parité de la section 5, cas par cas. Sans
elle, les implémentations Python et JavaScript divergent en silence et la
recherche se dégrade sans qu'aucun test n'échoue.

`test/catalog-query.test.js` — le constructeur pur :

- ET entre facettes, OU à l'intérieur d'une facette ;
- requête vide → catalogue entier, aucune clause parasite ;
- plage d'années ouverte d'un seul côté ;
- statut `installed` et `missing`, avec une liste d'installés vide ;
- tri hors liste blanche → retombe sur `title` ;
- **aucune valeur interpolée** : chaque valeur ressort dans `params`.

`test/repository.test.js` — contre les données d'exemple :

- filtrer par catégorie renvoie le compte attendu ;
- le compteur d'une facette ignore son propre filtre ;
- la recherche trouve avec et sans diacritiques ;
- `suggestValues('authors', 'احمد')` trouve un auteur écrit `أحمد` ;
- `downloadSelection` met N livres en file et ignore ceux déjà installés.

## 10. Hors périmètre

- **Collections personnelles.** Les tables `collections` et `collection_books`
  existent dans `user.sqlite` mais ne servent à rien. Les créer, les nommer, y
  ranger des livres est une fonctionnalité à part entière.
- **Regroupement par œuvre.** `works` est en 1:1 avec `editions` (120 pour 120,
  aucune œuvre à plusieurs éditions), car l'importeur dérive `work_id` de
  `book_id`. Le regroupement n'afficherait rien de plus.
- **Filtres sur `edition_relations`.** La table est vide dans le `dist/shamela`
  actuel : `catalogdb.py` ne pose `part_of` et `same_group` que si les livres
  apparentés sont importés ensemble, ce qui n'arrive pas à trois livres par
  catégorie. Construire un filtre sur une table vide donnerait du code
  invérifiable.
- **Filtre de langue.** Le catalogue ne contient que de l'arabe.
- **Recherche dans le contenu des livres.** C'est un autre index, situé dans
  chaque `books/<id>.sqlite`, et un autre écran.
