# Accueil : disciplines et siècles

Deux sections de l'accueil Electron débordent et ne disent presque rien :
`disciplinesSection` et `erasSection` dans `src/renderer/js/views/home.js`.

Ce que montrent les données réelles (`dist/shamela`, 397 éditions visibles) :

- **40 catégories** portent au moins un livre. La grille les dessine toutes,
  plus une tuile « المزيد » : 41 tuiles sur un écran d'accueil.
- **114 éditions sur 397 — 29 %** n'ont aucun auteur daté. Elles n'apparaissent
  nulle part dans la section des siècles, et rien ne le dit.
- Le siècle le mieux fourni (8ᵉ, 39 livres) écrase le plus maigre (1ᵉʳ, 1 livre),
  dont la barre tombe sous le `min-width: 12px` et cesse de porter une valeur.

La portée est le portage Electron seul. Le client Flutter n'a pas d'équivalent
de la section des siècles ; son alignement reste au reste à faire.

## Disciplines — « التخصصات العلمية »

Six tuiles au lieu de quarante-et-une, et un lien de repli.

### Données

Nouvelle méthode `getTopCategories({ limit = 6, sample = 3 })` rendant
`{ rows, total }` :

- `total` est le `COUNT(*)` SQL des catégories non vides — **jamais**
  `rows.length`. C'est la règle de pagination du projet : un décompte affiché
  vient de SQL. Le lien de repli annonce ٤٠, pas ٦.
- `rows` est triée par `book_count DESC, sort_order` : un top-6 tiré du
  `sort_order` du catalogue ne serait pas un top.
- chaque ligne porte `{ categoryId, label, bookCount, share, books }` où
  `share` rapporte `bookCount` au nombre d'éditions visibles.
- `books` est l'échantillon de trois couvertures. Il est lu par une requête
  `LIMIT 3` **par catégorie retenue**, soit six requêtes, plutôt que par une
  fonction de fenêtrage. Le build sql.js embarqué est déjà pris en défaut sur
  FTS5 ; on ne parie pas dessus pour économiser cinq requêtes sur une base
  déjà chargée en mémoire.

La projection de l'échantillon se limite à ce que `coverStyle()` consomme :
titre, `book_type_label`, `page_count`, `volume_count`, `category_id`, le
libellé de catégorie et `death_year_hijri`. Les trois canaux de la couverture
composée, et rien de plus.

La méthode s'inscrit dans **les deux** listes — `METHODS` de
`src/preload/preload.cjs` et `REPOSITORY_METHODS` de `book-repository.js`.
Une méthode ajoutée d'un seul côté ne casse rien au démarrage : elle échoue au
premier clic. `test/repository.test.js` porte le test de parité.

### Rendu

```
.discipline
  .discipline__stack     trois mini-couvertures, décalées et légèrement rotées
  .discipline__bubble    icône `categoryIcon(label)`
  .discipline__label     الحديث
  .discipline__count     ٣٩ كتابًا · ١٠٪
```

La teinte de la bulle ne vient plus de `BUBBLES[index % 3]` — un cycle de trois
couleurs indexé par la position dans la liste, donc sans rapport avec ce que la
tuile désigne. Elle vient de `coverFamily(category.label)` puis de
`COVER_FAMILIES`, dans `src/shared/book-cover.js` : la bulle de حديث porte la
teinte des couvertures de حديث, et les trois vignettes ne jurent plus avec leur
fond. Les classes `--teal`, `--gold`, `--emerald` disparaissent avec la table.

C'est la table existante, pas une seconde palette. Deux copies d'une même liste,
c'est la panne qu'a déjà produite le thème `sepia` que plus aucune règle CSS ne
lisait.

Le repli est un lien texte sous la grille, `تصفّح ٤٠ فنًّا`, vers `#/explore` —
écran déjà paginé et déjà porteur d'une facette `categories`. La tuile
`discipline--more`, qui pointait `#/library` et ne proposait donc aucun parcours
par discipline, disparaît.

## Siècles — « المكتبة عبر القرون »

La grille est conservée, l'ordre reste chronologique et complet. Trois défauts
sont corrigés.

**L'axe est continu.** `getEras()` ne rend que les siècles peuplés ; la vue
comble du premier au dernier. Un siècle absent devient une cellule
`.era--empty` : filet pointillé, opacité basse, non cliquable, « لا شيء بعد ».
Sur `assets/sample` — siècles ٢ ٣ ٤ ٦ ٩ — trois trous apparaissent. Sans eux, la
frise prétend à une continuité qu'elle n'a pas.

**L'échelle est honnête.** La hauteur suit `√(count / max)` et non le rapport
brut. Le 1ᵉʳ siècle passe de 2,5 % — écrasé sur le plancher de 12 px, donc muet
— à 16 %. L'ordre des siècles reste lisible, la barre cesse de mentir.

**La cellule se date.** `القرن الرابع`, puis la plage `٣٠١–٤٠٠ هـ`, puis
`٣٣ كتابًا`. La plage se calcule à l'affichage ; elle n'est stockée nulle part.

**L'axe se termine par ce qu'il ne sait pas dater.** Une cellule
`.era--undated` mène à `#/undated` et annonce les ١١٤ éditions dont aucun auteur
n'a d'année de décès. Elle ne porte pas de barre : elle n'a pas de position sur
l'axe. Sans elle, 29 % du corpus serait absent d'une section qui se présente
comme une vue d'ensemble.

### Portée `undated`

`BOOK_SCOPES` gagne une entrée `undated` : les éditions visibles dont aucun
auteur n'a de `death_year_hijri` renseignée. La route `'/undated'` réutilise
`collectionView`, l'écran de liste générique déjà paginé ; `#title` et
`#subtitle` de `library.js` gagnent leur branche.

`getUndatedCount()` rend le décompte affiché sur l'accueil — compté par SQL,
comme le reste.

## Tests

Dans `test/repository.test.js`, sur `assets/sample` :

- `getTopCategories` : `total` vient de SQL et vaut le nombre de catégories non
  vides, indépendamment de `limit` ; l'échantillon plafonne à trois livres et
  chacun appartient bien à sa catégorie ; l'ordre est décroissant par volume.
- `getUndatedCount` : la somme des `bookCount` de `getEras`, plus le décompte
  non daté, encadre le nombre d'éditions visibles — l'égalité stricte ne tient
  pas, une édition à plusieurs auteurs pouvant compter dans deux siècles.
- `getBooksIn({ scope: 'undated' })` : `total` égale `getUndatedCount`, et
  aucune ligne rendue n'a d'`authorDeathYear`.

La parité `METHODS` / `REPOSITORY_METHODS` est déjà couverte : les deux
nouvelles méthodes y tombent sans test supplémentaire.
