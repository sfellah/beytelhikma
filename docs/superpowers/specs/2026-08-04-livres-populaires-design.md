# Les livres populaires

Vingt-trois éditions choisies à la main, un badge sur leur carte, un carrousel
en accueil, et une case à cocher qui restreint la recherche à elles seules.

## Pourquoi

Le corpus fait 8 568 éditions. Un lecteur qui arrive n'a aucun moyen de savoir
par où commencer : l'accueil lui propose ses propres livres, des cursus, des
disciplines et des siècles — tout cela suppose qu'il sache déjà ce qu'il
cherche. Les ouvrages de référence d'une bibliothèque islamique sont pourtant
un ensemble stable et connu, que personne ne conteste : les deux Sahih, les
quatre Sunan, Fath al-Bari, Lisan al-Arab. Les nommer, c'est répondre à la
première question qu'on pose à une bibliothèque.

## Où vit la liste

`apps/desktop/src/shared/popular.js`, et nulle part ailleurs.

C'est la règle de `curricula.js`, pour la même raison : une sélection est une
**opinion**, pas une donnée du corpus. Au catalogue, elle obligerait à monter
`schema_version` et à republier 8 589 manifestes pour corriger un seul choix
d'édition. Ici, elle suit la version de l'application.

```js
export const POPULAR_EDITION_IDS = [ /* 23 identifiants, chacun commenté */ ];
export function resolvePopular(knownEditionIds); // { ids, missing }
export function isPopular(editionId);            // Set, jamais un balayage
```

`isPopular` est appelée une fois par carte dessinée — un écran d'exploration en
monte cinquante. Un `Array.includes` sur vingt-trois entrées passerait
inaperçu aujourd'hui et deviendrait un défaut le jour où la liste grandit ;
le `Set` est construit une fois, au chargement du module.

`resolvePopular` rend aussi `missing`, comme `resolveCurriculum` : sur les cinq
livres d'exemple aucun `sh-*` ne répond, la section s'efface, et c'est une
réponse — pas une panne. Le mobile régénère `shared/` par `prepare-www.mjs` :
il n'y a rien à porter.

## La liste, et le choix de l'édition

Le catalogue porte jusqu'à dix-neuf éditions d'une même œuvre — dix-neuf pour
`صحيح مسلم`, onze pour `فتح الباري`. Choisir l'œuvre ne suffit donc pas :
c'est l'édition qui est publiée, téléchargée et lue. Le critère retenu est
l'impression **de référence**, celle dont la numérotation est citée : la
Sultaniyya pour al-Bukhari, ʿAbd al-Baqi pour Muslim et Ibn Maja, Bashar
ʿAwwad pour al-Tirmidhi.

| Domaine | Éditions |
| --- | --- |
| Hadith | `sh-1458` صحيح البخاري - ط السلطانية · `sh-1481` صحيح مسلم - ت عبد الباقي · `sh-1480` سنن أبي داود - ت محيي الدين عبد الحميد · `sh-2859` سنن الترمذي - ت بشار · `sh-797` سنن النسائي - ط المصرية · `sh-1095` سنن ابن ماجه - ت عبد الباقي · `sh-6193` مسند أحمد - ط الرسالة · `sh-6494` موطأ مالك - ت الأعظمي |
| Commentaire | `sh-1455` فتح الباري بشرح البخاري - ط السلفية |
| Usage quotidien | `sh-1637` رياض الصالحين · `sh-5413` بلوغ المرام |
| Tafsir | `sh-2994` تفسير ابن كثير - ت السلامة · `sh-2839` تفسير الطبري - ت التركي · `sh-5614` تفسير القرطبي |
| Fiqh | `sh-2437` المغني · `sh-1618` المجموع شرح المهذب · `sh-5841` بداية المجتهد |
| Fatawa | `sh-2561` مجموع الفتاوى |
| Langue | `sh-1462` لسان العرب |
| Histoire et sira | `sh-1785` البداية والنهاية - ت التركي · `sh-3974` سير أعلام النبلاء · `sh-3519` تاريخ الطبري · `sh-188` زاد المعاد |

Les vingt-trois sont vérifiés dans le catalogue publié : présents, `is_hidden`
à zéro, avec une publication active. Ils pèsent 272 Mo compressés au total, et
**rien n'est téléchargé automatiquement** — la sélection recommande, elle
n'installe pas.

Quatre d'entre eux sont déjà des étapes de cursus (`sh-1637`, `sh-5413`,
`sh-2437`). Le recoupement est voulu : les deux listes répondent à deux
questions différentes — « par quoi commencer à apprendre » et « quels sont les
ouvrages de référence » — et un livre peut être les deux.

## Le pont

`getPopularBooks()` dans `book-repository.js` : la projection `SUMMARY_SELECT`
avec un `IN (?,…)` de vingt-trois paramètres, rendue `{ rows, total }` comme
toute lecture qui peut dépasser un écran.

L'ordre est **réappliqué côté JS** après la requête. `ORDER BY` ne sait pas
exprimer une suite écrite à la main, et la trier par titre effacerait
l'intention : les deux Sahih viennent d'abord parce qu'ils viennent d'abord.
C'est la contrainte de `#titleOrder`, dans l'autre sens.

La méthode est inscrite dans les **deux** listes — `METHODS` de
`preload.cjs` et `REPOSITORY_METHODS` — sans quoi elle échoue au premier clic
et non au démarrage. Elle est portée dans `repo/catalogue-plus.js` : le compte
passe de 67 à 68 méthodes, et `npm run verify` le tient.

## Le badge

Sur la carte de livre (`components/book-card.js`), et nulle part ailleurs.

La couverture composée porte déjà trois canaux de sens — la forme de l'objet,
la famille de la discipline, la patine du siècle. Le badge est un quatrième
signal, et il ne vient pas du corpus : il vient de nous. Il se pose donc
**à côté** de la couverture, sur la carte, et pas dessus.

Une pastille : l'étoile (`star`, nouvelle entrée d'`icons.js`) et le libellé
`popular.badge`. Aucune teinte neuve — `--primary` sur `--primary-container`,
des jetons seulement, donc la nuit suit sans règle en plus. Le libellé est
lisible par un lecteur d'écran : une pastille muette ne dirait rien à qui ne
voit pas l'étoile.

Ni la fiche du livre, ni le lecteur. Sur la fiche on a déjà décidé d'ouvrir ;
dans le lecteur on est entré. La barre haute du lecteur porte trois groupes
d'outils sur un téléphone, un quatrième signal n'y informe plus.

## Le carrousel d'accueil

Une section neuve, entre l'étagère et les cursus — après ce qui est à soi,
avant ce qu'on propose d'apprendre.

Même forme que la bande des nouveautés : les cartes s'enchaînent
horizontalement, deux chevrons les déplacent. Le piège est connu et documenté —
`test/direction.test.js` interdit `left: step()` et `left: -step()` dans
`home.js`, parce que la bande des nouveautés défilait d'un pas de signe fixe :
juste en RTL, **inerte** en anglais, où « suivant » ne bougeait pas d'un pixel.

Le carrousel ne recopie donc pas ce défilement, il l'**extrait** : un module
commun aux deux bandes, un seul sens de lecture à tenir. Deux copies auraient
rejoué le `sepia` mort et la liste de polices déclarée deux fois.

La lecture est ajoutée au `Promise.all` de `start()` et **n'est pas rattrapée**,
comme celle des cursus : l'accueil échoue d'un bloc pour toutes ses sections,
et excepter celle-ci ferait disparaître un dépôt cassé en silence.

## Le filtre « populaires seulement »

Une case à cocher, deux écrans, un seul `WHERE`.

- `catalog-query.js` : `query.popular` ajoute `e.edition_id IN (…)` dans
  `buildWhere`. Les facettes se recomptent seules — elles passent déjà par ce
  `WHERE`, c'est ce que `buildFacetQuery` fait avec son paramètre `except`.
- `/explore` : `popular=1` dans l'URL (`parseQuery` / `toParams`), et la case
  au-dessus des facettes dans `facet-panel.js`. Ce n'est **pas** une facette :
  une facette porte des valeurs et leurs comptes, celle-ci est un booléen.
- `/search` : la même case, sur la **section livres seulement**. La seconde
  vague — passages et notes — n'est pas touchée. Un passage n'est pas populaire
  ou non ; restreindre le balayage aux vingt-trois donnerait un écran qui ment
  sur ce qu'il a parcouru, et l'annonce « n livres parcourus » deviendrait
  fausse.
- Le mobile porte le même `WHERE` dans `repo/catalogue-plus.js`.

## Le nom

`الأكثر شهرة` / *Popular*. Les clés vivent dans `locales/ar.js` et
`locales/en.js` — `popular.title`, `popular.subtitle`, `popular.badge`,
`popular.filter` — jamais dans le rendu : `test/no-hardcoded-strings.test.js`
interdit tout littéral arabe neuf, et `test/i18n.test.js` échoue sur une clé
que personne ne cite.

## Tests

- `test/popular.test.js` — la liste n'a pas de doublon, chaque identifiant suit
  `^sh-\d+$`, `resolvePopular` écarte l'inconnu et compte ce qui manque,
  `isPopular` s'appuie sur un `Set`, et **aucune vue ne redéclare la liste**
  (la règle de `test/theme.test.js`, qui existe parce que deux copies d'une
  liste ont déjà produit une panne silencieuse).
- `test/repository.test.js` — la parité des deux listes de méthodes couvre
  `getPopularBooks` sans qu'on écrive quoi que ce soit.
- `test/i18n.test.js` — les quatre clés neuves doivent être citées.
- `test/direction.test.js` — étendu au nouveau carrousel.
- `apps/mobile` : `npm run verify` — 68 méthodes.

## Ce qui n'est pas fait

- **Pas d'écran `/popular`.** Il serait `/explore?popular=1` avec un titre, donc
  un second endroit à tenir pour la même requête.
- **Pas de badge sur la fiche ni dans le lecteur.**
- **Pas de tri « par popularité », pas de compteur.** Rien n'est mesuré :
  `tools/stats.py` compte des téléchargements d'installeurs et des lectures de
  pointeur, pas des ouvertures de livre. Un tri l'affirmerait, un compteur
  l'inventerait.
- **Aucun téléchargement automatique.** Vingt-trois livres font 272 Mo
  compressés ; les installer sans qu'on le demande serait une décision prise à
  la place du lecteur.
