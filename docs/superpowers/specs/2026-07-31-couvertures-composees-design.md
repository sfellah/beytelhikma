# Couvertures composées : forme, famille, patine

Date : 2026-07-31
Portée : `beytelhikma-electron/` et `beytelhikma/`. Aucun changement au modèle de
données : ni `tools/_common.py`, ni les bases générées, ni le schéma catalogue.

## 1. Objectif

Aucun livre du corpus n'a d'image de couverture. `editions.cover_url` existe au
schéma mais les deux générateurs y écrivent `None` (`tools/gen_sample_data.py:604`,
`tools/shamela/catalogdb.py:151`), et rien ne prévoit de la remplir. La couverture
est donc, et restera, **composée à l'affichage**.

Aujourd'hui elle l'est pauvrement : un dégradé tiré au hasard parmi cinq, choisi
par un hachage de `edition_id`. Deux conséquences.

1. **La couverture ne dit rien.** Deux livres côte à côte ont des couleurs
   différentes sans que cette différence porte de sens. Un rayonnage de trente
   vignettes est un bruit coloré.
2. **Les deux clients divergent déjà.** Les palettes de `cover.js:9-15` et de
   `cover_image.dart:20-26` n'ont pas les mêmes valeurs, et les fonctions de
   hachage non plus (`char * 31` contre `String.hashCode`). Un même livre n'a pas
   la même reliure sur les deux clients, et aucun test ne s'en plaint.

Ce document remplace le tirage aléatoire par une composition à trois canaux,
tous dérivés de données que le catalogue fournit déjà.

## 2. Décisions

| Décision | Raison |
| --- | --- |
| **La forme de l'objet décide de la mise en page.** | C'est le canal le plus visible ; il doit porter ce qu'on veut savoir *avant* d'ouvrir. Un متن de douze pages et une موسوعة en vingt tomes ne doivent pas se ressembler. Données présentes à **100 %** : `page_count` 397/397, `volume_count`, `book_type_label`. |
| **La famille de la catégorie décide de la matière** (teinte, motif). | `categoryLabel` arrive déjà jusqu'à la carte, des deux côtés — `bookSummary()` le projette, `BookSummary.categoryLabel` le porte. |
| **Le siècle de l'auteur décide de la patine**, en variable continue. | Il reste lisible sans casser la régularité de la grille, et surtout **l'absence de date cesse d'être un style**. Les 29 % d'éditions sans `death_year_hijri` prennent une patine médiane, qui ne se remarque pas. |
| **Le siècle ne décide plus de la mise en page.** | Version précédente de ce document. Trois défauts : le canal le plus bruyant servait l'information la moins actionnable ; une bande sur cinq (`typographic`, 29 %) n'était pas une valeur mais un trou, un style dont le sens était « on ne sait pas » ; et le siècle est déjà une facette de premier plan dans `/explore`. |
| **Regroupement en 9 familles, par libellé normalisé.** | Les 40 catégories de `dist/shamela` ne se distinguent pas visuellement à 40 teintes ; et les `category_id` ne concordent pas entre les deux jeux de données (id 1 = `العقيدة` côté Shamela, `التفسير` côté échantillon). Un style indexé par `category_id` serait faux sur l'un des deux. Le libellé, lui, est stable. |
| **Aucune notion de région.** | Vérifié sur les 322 auteurs de `dist/shamela` : une heuristique sur les nisbas géographiques (أندلسي، بغدادي، نيسابوري…) n'en reconnaît que 8 %. Le catalogue stocke des noms courts — `ابن حزم`, `الزمخشري`, `الماوردي` — d'où la nisba est absente. L'axe régional n'est pas dérivable de ces données. |
| **Les tables vivent dans le code partagé, pas au schéma.** | Le modèle de données ne bouge pas : pas de bump de version catalogue, pas de ré-import des 8 589 livres. Le coût est un test de parité de plus à tenir entre les deux clients. |

## 3. Les trois canaux

### 3.1 Mise en page, par forme d'objet

```
forme(bookType, volumeCount, pageCount) =
  bookType existe et != 'كتاب'  -> 'document'
  volumeCount > 1               -> 'compendium'
  0 < pageCount <= 120          -> 'treatise'
  pageCount > 400               -> 'tome'
  sinon                         -> 'book'
```

La richesse de la reliure suit le poids de l'objet — c'est ce qui rend la règle
lisible sans légende. Répartition mesurée sur les 397 éditions de
`dist/shamela` ; les seuils 120 et 400 ont été choisis pour qu'aucune mise en
page ne devienne anecdotique.

| Clé | Part | Ce qu'on voit |
| --- | --- | --- |
| `treatise` | 30 % | Le titre est la couverture : centré, grand, filet court, motif réduit à une ombre. |
| `book` | 27 % | Dégradé, trame de famille discrète, double filet or, titre en haut, auteur en bas. |
| `tome` | 13 % | Panneau géométrique plein encadré de filets, titre dans un bandeau en bas. |
| `compendium` | 21 % | Médaillon `شمسة` à 16 branches, titre dans un cartouche à filets, double encadrement. |
| `document` | 9 % | Contraste inversé : fond parchemin, encre sombre, couleur de famille reportée sur le dos de reliure (côté `inline-start`, donc à droite en RTL — un livre arabe se relie à droite). |

Une pagination absente donne `book` et non `treatise` : un métn se déclare par sa
brièveté, il ne se déduit pas d'une donnée manquante.

`document` l'emporte sur tout le reste, y compris sur une pagination ou un
nombre de tomes qui le contrediraient : une مجلة en neuf volumes reste une
revue, et la montrer comme une somme serait mentir sur ce qu'on va ouvrir.

### 3.2 Matière, par famille

Neuf familles, obtenues en normalisant `categoryLabel` par `normalizeArabic`
puis en consultant une table constante. Libellé inconnu ou absent : famille
`amma`.

| Famille | Catégories `dist/shamela` | Teintes | Géométrie |
| --- | --- | --- | --- |
| `quran` | التفسير, علوم القرآن وأصول التفسير, التجويد والقراءات | `#062b22` → `#0e4a3a` | girih, étoile à 8 branches |
| `aqida` | العقيدة, الفرق والردود | `#101a33` → `#22345c` | entrelacs |
| `hadith` | كتب السنة, شروح الحديث, التخريج والأطراف, العلل والسؤلات الحديثية, علوم الحديث | `#2e2013` → `#5c4425` | entrelacs, arcs croisés |
| `fiqh` | أصول الفقه, علوم الفقه والقواعد الفقهية, المنطق, les quatre écoles, الفقه العام, مسائل فقهية, السياسة الشرعية والقضاء, الفرائض والوصايا, الفتاوى | `#1e2a12` → `#3f5423` | trame octogonale |
| `raqaiq` | الرقائق والآداب والأذكار | `#2a1836` → `#4c2f5e` | arabesque florale |
| `tarikh` | السيرة النبوية, التاريخ, التراجم والطبقات, الأنساب, البلدان والرحلات | `#3a2a12` → `#6b5119` | kufique carré |
| `lugha` | كتب اللغة, الغريب والمعاجم, النحو والصرف | `#12303a` → `#24525f` | grille carrée |
| `adab` | الأدب, العروض والقوافي, الشعر ودواوينه, البلاغة | `#3a1418` → `#6b2a2f` | arabesque florale |
| `amma` | الجوامع, فهارس الكتب والأدلة, الطب, كتب عامة, علوم أخرى, **et tout libellé inconnu** | `#1f2120` → `#414442` | grille carrée |

Les sept catégories de `assets/sample` — التفسير, الحديث, الفقه, اللغة, التاريخ,
الأدب, التصوف — entrent dans la même table : elles tombent respectivement dans
`quran`, `hadith`, `fiqh`, `lugha`, `tarikh`, `adab`, `raqaiq`. C'est ce que
gagne l'indexation par libellé plutôt que par identifiant.

### 3.3 Patine, par siècle

```
âge(deathYearHijri) =
  date absente  -> 0.5
  sinon         -> borné à [0, 1] de (15 - siècle) / 14

teintes = famille assombrie de 0.22 × âge
dorure  = 0.30 + 0.22 × âge
```

0 pour le plus récent, 1 pour le plus ancien. Une variable continue et non une
tranche : c'est ce qui fait qu'une date absente peut se placer au milieu de
l'échelle sans avoir de style à elle. Le siècle se calcule comme partout ailleurs
dans le projet — `(année - 1) / 100 + 1`, division entière — afin que la patine
d'un livre concorde avec le siècle sous lequel `/explore` le range
(`src/main/catalog-query.js`).

## 4. Electron

### 4.1 `src/shared/book-cover.js` (nouveau)

Module pur, sans DOM, testable seul. Il expose :

```js
export function coverShape(book)               // -> 'treatise' | 'book' | …
export function coverFamily(categoryLabel)     // -> 'quran' | … | 'amma'
export function coverAge(deathYearHijri)       // -> 0..1
export function coverStyle(book)               // -> { shape, family, age, from, to, gilt, pattern }
```

`coverStyle` rend les teintes **déjà patinées** : ni le CSS ni le widget n'ont
de calcul de couleur à faire, et les deux clients ne peuvent pas dériver sur
l'arrondi. `coverFamily` normalise par `normalizeArabic` de `src/shared/arabic.js`
— la même fonction que la recherche, donc les mêmes règles de dépouillement
(hamza, tā' marbūṭa, diacritiques). Le fichier vit dans `src/shared/` et non dans
`src/renderer/js/` parce qu'il est le pendant exact du fichier Dart : c'est là
que vit déjà `arabic.js`, pour la même raison.

### 4.2 `src/renderer/js/components/cover.js`

`cover(book, opts)` conserve sa signature. Il appelle `coverStyle(book)`, pose
`class="cover cover--<shape> cover--<family>"` et les variables `--cover-from`,
`--cover-to`, `--cover-gilt`, puis compose les nœuds propres à la reliure.

Les motifs sont des `<pattern>` SVG. Ils sont définis **une seule fois** dans un
`<svg>` caché injecté au premier appel, et chaque couverture ne porte qu'un
`<rect fill="url(#cover-pat-<pattern>)">`. Une grille de trente vignettes ne
duplique donc pas trente fois la géométrie.

`h()` de `dom.js` utilise `document.createElement` : il ne peut pas produire de
nœuds SVG, qui exigent `createElementNS`. On ajoute `svg(tag, props, …children)`
à `dom.js`, strictement parallèle à `h()`, plutôt que de compliquer `h()` avec
une table de balises.

### 4.3 `src/renderer/styles/components.css`

`.cover` garde son rôle de socle (proportion 2/3, rayon, ombre, débordement
masqué) et déclare `container-type: inline-size` : la même couverture sert de
vignette de rayonnage (~90 px), de carte de grille (~190 px) et de couverture de
fiche (~345 px), le titre suit donc la largeur par `clamp(…, cqw, …)`.

Cinq blocs `.cover--treatise`, `--book`, `--tome`, `--compendium`, `--document`
portent chacun leur mise en page. `.cover--document` est le seul à inverser
l'encre.

### 4.4 `src/main/book-repository.js` et `catalog-query.js`

Les deux projections sommaires gagnent `a.death_year_hijri` et
`e.book_type_label`, et `bookSummary()` gagne `authorDeathYear` et `bookType`.
Ce sont des projections de plus sur des jointures qui existent déjà : ni table,
ni index, ni migration. **Les deux** doivent être modifiées : `/explore` passe par
`catalog-query.js` et non par `SUMMARY_SELECT`, et l'oubli de la seconde faisait
tomber tout l'écran sur le repli.

## 5. Flutter

`lib/utils/book_cover.dart` est le reflet exact de `book-cover.js` : mêmes clés,
mêmes teintes, mêmes seuils. `CoverImage` garde sa branche `Image.network` pour
le jour où une `cover_url` en `http` existera, et remplace son `_placeholder` par
un `switch` sur la forme. Les motifs deviennent des `CustomPainter`, un par
géométrie et non un par famille : deux familles partagent parfois la même trame
et n'en changent que la teinte.

`lib/utils/arabic.dart` (nouveau) porte `normalizeArabic`, requis par la table
par libellé et jusqu'ici absent du client Flutter.

`SqliteBookRepository` ajoute `e.book_type_label` et `a.death_year_hijri` à sa
projection sommaire, et `BookSummary` les champs `bookType` et `authorDeathYear`,
nullables comme le reste.

## 6. Tests

`beytelhikma-electron/test/book-cover.test.js` :

- `coverShape` aux bornes exactes — 120/121 séparent `treatise` de `book`,
  400/401 `book` de `tome` ;
- les quatre libellés qui ne sont pas des livres donnent `document`, y compris
  quand le nombre de tomes le contredit ;
- une pagination absente, nulle ou à zéro donne `book` et jamais `treatise` ;
- `coverAge` : 0 au plus récent, 1 au plus ancien, strictement décroissant sur
  une suite de dates, borné hors échelle, et `PATINA_UNDATED_AGE` sans date ;
- la patine assombrit et dore, sans jamais dépasser `PATINA_DARKEN` ;
- chaque libellé des 40 catégories de `dist/shamela` et des 7 de `assets/sample`
  tombe dans la famille attendue — la table du document, rejouée ;
- un libellé inconnu, `null` ou dénormalisé se résout correctement.

**Test de parité, à l'image de `test/arabic.test.js`.** Le fichier Dart et le
fichier JS portent les mêmes tables ; sans test, ils divergeront comme ont
divergé les palettes actuelles. Le test JS lit `lib/utils/book_cover.dart`, en
extrait les couples `famille → teintes`, les seuils de pagination et les
constantes de patine, et les compare aux siens. Il échoue si l'une des deux
tables bouge seule.

## 7. Hors périmètre

- Toute image de couverture réelle. `cover_url` reste nulle et la branche
  `Image.network` de Flutter reste morte, conservée par précaution.
- Le moindre changement à `tools/_common.py` ou aux bases générées.
- Une colonne `family` au schéma catalogue : rejetée en 2, car elle imposerait un
  ré-import du corpus pour un résultat que la table par libellé donne déjà.
- L'axe régional : non dérivable des données, mesuré à 8 % de reconnaissance.
