# Interface bilingue arabe / anglais — conception

*2026-08-01 — phase 1 de deux. La phase 2 (`2026-08-01-reglages-et-polices-design.md`)
refond l'écran des réglages et le choix des polices, et dépend de celle-ci.*

## Ce qu'on résout

L'application n'a **aucune infrastructure i18n** : pas de `app.locale`, pas de
catalogue de chaînes, aucune fonction de traduction. 520 chaînes arabes sont
écrites en dur dans les 34 fichiers du renderer, et `dir="rtl"` est posé
globalement sans jamais dériver d'une locale.

`CLAUDE.md` annonce pourtant trois locales — `ar`, `fr`, `en`. On en retient
**deux** : `ar` et `en`. Le français est écarté ; rien dans le code ne le
préparera, et l'ajouter plus tard ne coûtera qu'un fichier de chaînes de plus.

## Le principe

**La locale de l'interface décide de trois choses, et de rien d'autre :** les
mots, la direction de l'interface, et la forme des chiffres.

Elle ne décide pas de la direction du contenu. Le corpus est arabe — les 8 568
éditions sont en arabe, et le resteront. Une page de livre est donc toujours
rendue en RTL, y compris quand l'interface est en anglais. C'est la règle déjà
écrite dans `CLAUDE.md` : *direction de l'interface = locale de l'app,
direction du contenu = langue du livre*. Cette phase la rend vraie.

**Il n'y a pas de réglage de chiffres.** Les chiffres arabes-indiens sont une
propriété de la langue arabe, pas un goût séparé : un lecteur anglophone n'a
aucune raison de vouloir `٤٢`, et un lecteur arabophone n'a aucune raison de
vouloir `42`. Un réglage distinct aurait produit quatre combinaisons dont deux
n'ont aucun sens.

## Modules

### `src/shared/locale.js` — la liste, et rien d'autre

Sur le modèle exact de `src/shared/theme.js`, et pour la même raison : une
liste dupliquée finit par diverger, et c'est déjà arrivé une fois sur ce projet
(le thème `sepia` que proposaient les réglages et qu'aucune règle CSS ne
lisait plus).

```js
export const LOCALES = [
  { key: 'ar', label: 'العربية', dir: 'rtl', digits: 'arab' },
  { key: 'en', label: 'English', dir: 'ltr', digits: 'latn' },
];
export const DEFAULT_LOCALE = 'ar';
export function resolveLocale(stored) { … }   // replie sur le défaut
export function localeDir(key) { … }
```

Sans DOM, sans `window` : donc importable depuis `node --test`.

### `src/shared/digits.js` — la conversion, seule

```js
export function toArabicDigits(text) { … }    // 0-9 → ٠-٩
export function formatNumber(value, locale) { … }
```

Une table de dix caractères, `U+0660`–`U+0669`. Pas d'`Intl.NumberFormat` :
son `ar` produit aussi des séparateurs de milliers arabes (`٬`) et un signe
décimal (`٫`) que rien dans l'interface n'attend, et son comportement varie
avec la version d'ICU embarquée dans Electron. Une table est prévisible et
testable.

La conversion s'applique **au rendu**, jamais au stockage. Aucune valeur
arabe-indienne n'entre dans `user.sqlite`, ne part vers le bucket, ni ne sert
de clé.

### `src/renderer/js/i18n.js` — le catalogue et `t()`

```js
export function t(key, params) { … }
export function setLocale(key) { … }
export async function syncLocale() { … }
export function currentLocale() { … }
```

`t()` est **synchrone**. Le catalogue est importé statiquement, pas chargé par
`fetch` : la CSP est `default-src 'none'` et les vues se montent sans `await`.

Les chaînes vivent dans `src/renderer/js/locales/ar.js` et `en.js`, en objets
plats à clés pointées (`settings.language.title`). Un objet plat parce que
c'est ce qui rend le test de parité trivial.

**Chiffres et interpolation.** `t()` reçoit les nombres bruts et les formate
lui-même selon la locale courante :

```js
t('reader.page', { page: 42, total: 350 })
// ar → « الصفحة ٤٢ من ٣٥٠ »      en → « Page 42 of 350 »
```

C'est ce qui garantit qu'aucun appelant ne peut oublier la conversion. Un
nombre qui traverse `t()` est converti ; un nombre écrit directement dans le
DOM ne l'est pas — et c'est ce que le test de garde ci-dessous interdit.

### Peinture au démarrage

`locale.js` côté renderer copie le mécanisme de `theme.js`, miroir
`localStorage` compris (`beytelhikma.locale`), et pour la même raison : les
réglages arrivent par IPC **après** le premier rendu. Sans miroir, une
interface anglaise s'ouvrirait en RTL arabe puis basculerait — un saut visible
à chaque lancement, pire que l'éclair blanc qu'évitait déjà le thème.

Le miroir n'est jamais la vérité : `syncLocale()` réconcilie avec
`user.sqlite` dès que les réglages répondent.

Ordre de chargement dans `index.html`, avant `app.js` :

```html
<script type="module" src="js/theme.js"></script>
<script type="module" src="js/i18n.js"></script>
```

Pas de script inline — la CSP est `script-src 'self'`.

## Stockage

`app.locale` dans la table `settings` de `user.sqlite`, valeurs `ar` ou `en`.

**Aucune migration de schéma.** `settings` est une table clé/valeur ; une clé
nouvelle n'est pas un changement de schéma. `user_version` reste à **2**.

## Direction

| Élément | Direction | Source |
|---|---|---|
| `<html dir>` | locale | `localeDir(locale)` |
| coque, navigation, réglages | héritée | — |
| page de livre, sommaire, titres d'œuvres | `rtl` | posée explicitement |
| chemins, URL, sha256 | `ltr` | posée explicitement |

Le contenu porte donc **toujours** son `dir`, même quand il coïncide avec
celui de l'interface. Une direction implicite est une direction qui casse le
jour où l'interface change, et la coïncidence en mode `ar` masquerait le bug
jusqu'à la première bascule vers `en`.

Les alignements restent en propriétés logiques (`margin-inline-start`,
`text-align: start`) — c'est déjà la règle du projet, et la bascule `en` est ce
qui la vérifie pour de bon.

## Chiffres : ce qui est converti, ce qui ne l'est pas

**Converti** — tout ce qui se lit : numéros de page, compteurs de résultats,
nombre de livres, tailles, pourcentages de téléchargement, années hijri,
siècles de la frise, statistiques de l'accueil.

**Jamais converti** — tout ce qui se rapporte ou se copie : `about.storageRoot`,
`about.librarySource`, l'URL du bucket, le sha256, `schemaVersion`,
`catalog_version`. Ces valeurs partent dans un rapport de bug ou une barre
d'adresse ; les écrire en `٢` les rendrait inutilisables. Elles passent par
`copyField`, qui porte déjà `dir="ltr"`.

## Tests

`test/i18n.test.js`

1. **Parité des catalogues** — `ar` et `en` portent exactement les mêmes clés.
   Une clé d'un seul côté produit une interface trouée qui ne se voit qu'en
   changeant de langue.
2. **Aucune clé vide** et aucune valeur qui reste égale à sa clé.
3. **Interpolation** — chaque `{param}` d'une chaîne `ar` existe dans son
   homologue `en`, et réciproquement.
4. **Chiffres** — `formatNumber(42, 'ar') === '٤٢'`, `formatNumber(42, 'en')
   === '42'`, et `formatNumber(0, 'ar') === '٠'`.
5. **Repli** — `resolveLocale('fr')`, `resolveLocale(null)`,
   `resolveLocale('')` rendent tous `ar`.

`test/no-hardcoded-strings.test.js` — le test de garde

Balaie `src/renderer/js/**/*.js` et échoue sur toute chaîne littérale
contenant un caractère du bloc `U+0600`–`U+06FF`, hors `locales/ar.js`.

Sans lui, la prochaine vue écrite réintroduira de l'arabe en dur et personne
ne s'en apercevra tant que l'interface restera en arabe. C'est le même
mécanisme de garde que `test/theme.test.js`, qui interdit à une vue de
redéclarer `THEMES`.

## Étapes

L'extraction se fait **vue par vue**, chaque vue étant un commit qui laisse
`npm test` vert. 34 fichiers d'un coup ne se relisent pas.

1. `shared/locale.js`, `shared/digits.js` et leurs tests — aucun appelant.
2. `renderer/js/i18n.js`, catalogues vides, miroir, `<html dir>`.
3. Ligne « اللغة / Language » dans l'écran de réglages **actuel** — sans
   refonte, juste de quoi basculer et voir le résultat. La refonte est la
   phase 2.
4. Extraction, une vue par commit, en commençant par la coque et la
   navigation (les chaînes les plus vues), en finissant par `/settings`
   (celles que la phase 2 réécrira).
5. Activation du test de garde, une fois l'extraction finie.

## Ce qu'on ne fait pas

- **Pas de français.** Deux locales, et un troisième fichier de chaînes le jour
  où on le voudra.
- **Pas de détection de la langue système.** Le défaut est `ar` : c'est une
  bibliothèque arabe, et un utilisateur anglophone bascule une fois.
- **Pas de traduction du contenu.** Titres d'œuvres, auteurs, catégories,
  pages : tout vient du catalogue et reste arabe. Seule la coque parle deux
  langues.
- **Pas de pluriels.** L'arabe en a six ; les rares chaînes concernées seront
  écrites pour éviter la question (« ٤٢ • كتاب » plutôt qu'une forme accordée).
  Introduire un moteur de pluriels pour trois chaînes serait du coût sans
  usage.
