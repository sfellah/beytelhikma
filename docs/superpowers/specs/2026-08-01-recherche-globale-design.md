# Recherche globale : Ctrl+F, et trois sections avant les passages

*2026-08-01*

## Le problème

`/search` ne cherche que dans le texte des livres **installés**. Un lecteur qui
tape le nom d'un auteur, ou le nom d'un cursus, n'y trouve rien — et rien ne le
lui dit : l'écran répond « aucun résultat dans vos livres », ce qui est vrai et
inutile. Le catalogue se cherche ailleurs, depuis `/explore`, derrière un
raccourci que personne ne devine (`Ctrl+Entrée` dans la barre haute).

Deuxième défaut, de cadence : l'écran attend `searchLibrary`, qui ouvre chaque
livre installé l'un après l'autre. Pendant ce temps rien ne s'affiche, alors que
les réponses du catalogue sont à quelques millisecondes.

Troisième, de raccourci : `Ctrl+F` est le geste universel pour « chercher », et
l'application ne l'écoute que dans le lecteur.

## Ce qu'on construit

### 1. `Ctrl+F` ouvre la recherche

`src/renderer/js/shell.js` portait un écouteur global pour `Ctrl+K` qui visait
le champ de la barre haute. Le raccourci devient `Ctrl+F`, et l'indice `<kbd>`
de la barre haute l'annonce : `Ctrl+K` ne répond plus. Un indice qui nomme une
autre touche que celle qui est écoutée est pire que pas d'indice — il s'apprend,
et ce qu'il apprend est faux.

Le lecteur garde son `Ctrl+F` : il pose son propre écouteur sur `document` et
appelle `preventDefault()`. Comme `document` bulle avant `window`, shell n'a
qu'à sortir si `event.defaultPrevented`. Il n'y a donc **aucune liste d'écrans à
tenir à jour** — c'est la seule forme qui ne dérive pas quand un futur écran
voudra son propre `Ctrl+F`.

Le lecteur ne monte pas la coquille : son champ de barre haute est détaché, et
`searchField?.isConnected` suffirait à lui seul. Les deux gardes coexistent
parce qu'elles ne disent pas la même chose : l'une dit « il n'y a pas de champ »,
l'autre « quelqu'un a déjà répondu ».

### 2. `/search` devient l'écran de recherche générale

Cinq sections, dans cet ordre :

| Section  | Source                                | Forme |
| -------- | ------------------------------------- | ----- |
| Auteurs  | `getAuthors({ text, limit: 6 })`      | petite — pastilles, `total` SQL, lien `/authors?text=…` |
| Cursus   | `getCurricula()`, filtré côté vue     | petite — lignes nom + avancement, lien `/curricula` |
| Livres   | `exploreBooks({ text, limit: 12 })`   | grande — grille de `bookCard`, `total` SQL, lien `/explore?text=…` |
| Passages | `searchLibrary` (inchangé)            | grande — extraits groupés par livre |
| Notes    | `getAnnotations` (inchangé)           | liste |

Les décomptes affichés viennent de SQL (`total`), jamais de `rows.length` —
c'est la règle de pagination du projet, et un « voir les 6 auteurs » quand il y
en a 113 serait exactement le défaut qu'elle interdit. Les cursus font
exception, et légitimement : la liste entière tient en mémoire, sept entrées, le
compte filtré **est** le total.

**Les cursus se filtrent dans la vue, pas au repository.** Leurs noms vivent
dans `locales/*.js` (`curriculum.<id>.name`) ; le processus principal ne les a
pas et ne doit pas les avoir. Le filtre compare le terme au nom et à l'indice,
normalisés par `normalizeArabic` de `src/shared/arabic.js` — la même
normalisation que les colonnes du catalogue, sinon une recherche avec voyelles
trouverait les livres et pas les cursus.

Le cursus est rendu en **ligne compacte** — nom, avancement, étapes — et non
avec la carte à rayon de `/curricula`. Une petite section n'a pas la place d'un
rayon, et sortir `curriculumCard` dans un composant partagé pour l'y écraser
serait un refactor que rien ne demande ici.

### 3. Deux cadences

Un terme lance deux vagues indépendantes, toutes deux gardées par le même
`#token` :

- **catalogue** — auteurs, cursus, livres, en parallèle. Débounce 250 ms.
  Trois requêtes SQLite : elles reviennent tout de suite et se peignent seules.
- **plein texte** — passages et notes. Part en même temps, remplit ses deux
  sections quand elle arrive, avec son propre `loadingView`.

Chaque vague porte son propre état vide, et chacun est honnête sur son domaine :
« rien dans le catalogue » et « rien dans vos livres installés » sont deux
réponses différentes, qu'un état vide unique confondrait.

Le débounce descend de 450 à 250 ms : il ne protège plus le balayage lent seul,
il gouverne aussi trois requêtes légères, et 450 ms de latence sur celles-ci se
sentent à la frappe.

### 4. La barre haute

`Entrée` mène désormais à `/search`, `Ctrl+Entrée` à `/explore`. C'est
l'inverse d'aujourd'hui, et c'est ce que le reste du changement impose : le
champ ne peut pas envoyer par défaut vers l'écran de facettes quand l'écran
général existe. Le bouton compact de la barre change de destination et de
libellé en conséquence — il mène aux filtres.

## Ce qui ne change pas

Le repository ne gagne aucune méthode : `getAuthors`, `exploreBooks`,
`getCurricula`, `searchLibrary` et `getAnnotations` existent tous et rendent
déjà ce qu'il faut. Les deux listes de parité (`METHODS`, `REPOSITORY_METHODS`)
sont donc intactes.

`/explore` garde son rôle : les facettes, les tranches, la sélection par lot.
C'est l'écran de filtres, et le lien depuis `/search` y mène avec le terme.

## Tests

- **Statique, comme le thème et les polices** : `shell.js` lit `defaultPrevented`
  avant d'agir sur `Ctrl+F`, et `reader.js` appelle `preventDefault()` sur son
  propre `Ctrl+F`. Sans cette vérification, les deux recherches s'ouvriraient
  ensemble et le défaut ne se verrait qu'au clavier — c'est-à-dire tard.
- `test/no-hardcoded-strings.test.js` : les nouvelles chaînes passent par `t()`.
- `test/locale.test.js` : parité `ar` ↔ `en` sur les clés ajoutées.

## Captures

`src/main/capture.js` photographie `/search` après avoir tapé un terme. La
campagne attend maintenant qu'une section de catalogue soit montée, pas
seulement le champ : sinon l'image serait prise pendant le balayage et ne
montrerait que le chargement.
