# Le thème sort du lecteur et devient celui de l'application

**Date** : 2026-07-31
**Portée** : `apps/desktop/` uniquement. L'alignement du client Flutter reste au reste-à-faire.

## Le problème

Les trois ambiances — `رق إفتراضي`, `أبيض ناصع`, `الوضع الليلي` — ne teintent que `.reader`. Quitter un livre en pleine nuit renvoie sur un accueil blanc. Le réglage existe, il est déjà persisté dans `user.sqlite` sous `reader.theme` ; ce qui manque, c'est sa portée.

Deux dettes s'y ajoutent :

- `views/settings.js` porte sa propre liste de thèmes, **périmée** : `paper` / `sepia` / `night`, alors que le lecteur expose `paper` / `white` / `night`. Choisir `بني` dans les réglages écrit une clé qu'aucune règle CSS ne lit. Deux copies d'une même liste ont dérivé — c'est la raison d'être de la refonte en un propriétaire unique.
- Les pastilles de thème vivent dans le groupe `القراءة`, dont la description dit `تُطبَّق عند فتح كتاب جديد`. Un thème d'application s'applique à l'instant : la phrase deviendrait fausse.

## Ce qu'on livre

Un thème unique, global, choisi soit depuis la barre du lecteur, soit depuis un groupe `المظهر` dans les réglages, appliqué immédiatement à tout l'écran et repris au démarrage suivant sans éclair de couleur.

## Architecture

### 1. Les jetons portent le thème

`styles/tokens.css` gagne deux blocs de surcharge posés sur `:root`, sélectionnés par un attribut sur `<html>` :

```css
:root[data-theme='white'] { … }
:root[data-theme='night'] { … }
```

`paper` **n'a pas de bloc**. C'est le `:root` actuel : le fond parchemin est l'identité du projet, il reste le défaut et non un cas particulier. Un thème sans bloc est donc un thème valide — le test de parité (§7) en tient compte.

Ce qui bascule : surfaces, encre, contours, teinte des ombres, voiles. Les familles émeraude / sable / graphite gardent leur rôle sémantique, mais **les rôles s'échangent en nuit** : `--primary` prend la valeur de `--primary-fixed-dim` (`#95d3ba`), sinon l'émeraude `#003527` disparaît sur fond graphite. Même échange pour `--secondary` et `--tertiary`, et pour `--error`.

Les ombres du thème clair sont teintées émeraude à 4–10 % d'opacité (`--shadow-*`) : invisibles sur fond sombre. En nuit elles passent au noir, plus opaques.

`--highlight-strength`, `--quote-strength` et `--mark-strength` quittent `.reader` pour les jetons : leurs valeurs de base (`42%` / `26%` / `55%`) sont déclarées dans `:root` — donc valables pour `paper` et `white`, qui n'ont rien à en dire — et seul le bloc `night` les redéclare. Ce sont les seules variables proprement liées à la lecture qu'un thème doive encore dicter : une pastille de surlignage claire sur graphite mange l'encre.

Un seul jeton naît dans `:root` pour ce lot : `--mark-color: #e8cf9a`, le fond de recherche (§2).

Valeurs de nuit :

| Jeton | Valeur |
| --- | --- |
| `--surface`, `--background` | `#1a1c1a` |
| `--surface-dim` | `#121412` |
| `--surface-bright` | `#353834` |
| `--surface-container-lowest` | `#0e100e` |
| `--surface-container-low` | `#1f221f` |
| `--surface-container` | `#232622` |
| `--surface-container-high` | `#2d302c` |
| `--surface-container-highest`, `--surface-variant` | `#383b37` |
| `--inverse-surface` | `#e6e3de` |
| `--inverse-on-surface` | `#2d302c` |
| `--on-surface` | `#e6e3de` |
| `--on-surface-variant` | `#b2b2ae` |
| `--outline` | `#8b938d` |
| `--outline-variant` | `rgb(230 227 222 / 16%)` |
| `--primary` | `#95d3ba` |
| `--on-primary` | `#002117` |
| `--primary-container` | `#0b513d` |
| `--on-primary-container` | `#b0f0d6` |
| `--inverse-primary` | `#003527` |
| `--secondary` | `#d7c3b0` |
| `--on-secondary` | `#241a0e` |
| `--secondary-container` | `#524436` |
| `--on-secondary-container` | `#f4dfcb` |
| `--tertiary` | `#c7c7c2` |
| `--on-tertiary` | `#2d2f2c` |
| `--tertiary-container` | `#444542` |
| `--on-tertiary-container` | `#e3e3de` |
| `--error` | `#ffb4ab` |
| `--on-error` | `#690005` |
| `--error-container` | `#93000a` |
| `--on-error-container` | `#ffdad6` |
| `--emerald-veil` | `rgb(149 211 186 / 12%)` |
| `--gold-veil` | `rgb(215 195 176 / 22%)` |
| `--teal-veil` | `rgb(199 199 194 / 10%)` |
| `--mark-color` | `#8a7440` |
| `--shadow-sm` | `0 4px 12px rgb(0 0 0 / 28%)` |
| `--shadow-md` | `0 20px 20px rgb(0 0 0 / 34%)` |
| `--shadow-lg` | `0 24px 48px rgb(0 0 0 / 44%)` |
| `--highlight-strength` / `--quote-strength` / `--mark-strength` | `26%` / `20%` / `34%` |

Les alias de lecture (`--page`, `--ink`, `--rule`, `--deep-emerald`…) sont définis en `var(…)` dans `:root` : ils suivent sans être redéclarés.

Valeurs de `white` — le thème est un aplatissement du clair, pas une seconde palette :

| Jeton | Valeur |
| --- | --- |
| `--surface`, `--background`, `--surface-bright` | `#ffffff` |
| `--surface-dim` | `#ececec` |
| `--surface-container-low` | `#f7f7f7` |
| `--surface-container` | `#f2f2f2` |
| `--surface-container-high` | `#ebebeb` |
| `--surface-container-highest`, `--surface-variant` | `#e5e5e5` |
| `--on-surface` | `#131315` |
| `--outline-variant` | `#d4d4d4` |
| `--gold-veil` | `rgb(244 223 203 / 40%)` |

Les forces de surlignage de `white` sont celles de `paper` : rien à redéclarer.

### 2. Les couleurs en dur

L'audit des trois feuilles hors jetons donne un seul vrai coupable :

- `views.css` — `#e8cf9a`, fond de `.reader__match` et `.reader__result mark`. Devient `var(--mark-color)`, déclaré dans `:root` et assombri en nuit.
- `components.css` — `#f6f1e6` et `#f3e9d7` **restent en dur** : ce sont l'encre et le carton des couvertures composées, un objet imprimé. Un livre ne passe pas en mode nuit. Un commentaire le dit sur place, pour qu'un futur passage de tokenisation ne les emporte pas.
- `views.css` — les deux `#000` d'un `mask-image` sont des alphas de masque, pas des couleurs.

Les valeurs `#e6e3de`, `#b2b2ae`, `#404944`, `#1a1c1a`, `#131315` disparaissent d'elles-mêmes : elles vivent dans les règles `.reader--white` / `.reader--night` qui sont supprimées (§4).

### 3. Un seul propriétaire : `js/theme.js`

Nouveau module, seul à connaître les thèmes.

```js
export const THEMES = [
  { key: 'paper', label: 'رق إفتراضي', swatch: '#fbf8fc', dot: '#1b1b1e' },
  { key: 'white', label: 'أبيض ناصع', swatch: '#ffffff', dot: '#131315' },
  { key: 'night', label: 'الوضع الليلي', swatch: '#1a1c1a', dot: '#e6e3de' },
];

export function resolveTheme(stored) { … }   // pur : replie sur 'paper'
export function applyTheme(key) { … }        // dataset + miroir localStorage
export function setTheme(key) { … }          // applyTheme + setSetting('app.theme')
export function currentTheme() { … }
export function initTheme() { … }            // lecture synchrone du miroir
```

Les swatches sont alignés sur les jetons réels. Ceux de `reader.js` mentaient : `paper` annonçait `#fbf9f4` quand `--surface` vaut `#fbf8fc`, `night` annonçait `#14150f` quand `.reader--night` peignait `#1a1c1a`.

`resolveTheme` est **pure et sans DOM** : c'est ce qui rend le module testable dans un dépôt sans infrastructure de rendu.

Le module est chargé dans `<head>` avant `app.js` :

```html
<script type="module" src="js/theme.js"></script>
```

Pas de script inline : le CSP de `index.html` est `script-src 'self'`, un bootstrap inline demanderait un hash à recalculer à chaque édition.

### 4. Le lecteur cesse de porter son thème

`views/reader.js` :

- `.reader` ne reçoit plus `reader--${theme}`. Ses 198 déclarations `--reader-*` dérivent déjà de `var(--page)`, `var(--ink)`, `var(--rule-strong)`, `var(--primary)` : elles suivent le thème global sans être touchées.
- Les règles `.reader--white` et `.reader--night` sont supprimées de `views.css` ; leur contenu est déjà couvert par les blocs de jetons.
- `.reader--night` posait `--reader-accent: var(--primary-fixed-dim)`. En nuit, `--primary` **vaut** `#95d3ba` : le défaut `--reader-accent: var(--primary)` donne la même chose. Rien à conserver.
- La constante `THEMES` locale est supprimée au profit de l'import.
- `#setTheme(key)` devient un appel à `setTheme(key)` de `theme.js` ; il garde la mise à jour de la classe `is-active` des pastilles.
- `#prefs.theme` disparaît de l'état du lecteur : le thème n'est plus une préférence de lecture. `size`, `font` et `mode` restent.

### 5. Réglages

`views/settings.js` :

- Nouveau groupe `المظهر`, **avant** `القراءة`, description `يُطبَّق فورًا على كل الشاشات`. Il porte les mêmes pastilles à swatch que le lecteur — même contrôle, un seul rendu, extrait dans un composant partagé `components/theme-choices.js`.
- La constante `THEMES` locale et son entrée `sepia` sont supprimées.
- `القراءة` garde taille et police ; sa description `تُطبَّق عند فتح كتاب جديد` redevient exacte.

### 6. Persistance et démarrage

Source de vérité : `user.sqlite`, clé `app.theme`.

La lecture replie une fois sur l'ancienne `reader.theme` — `prefs['app.theme'] ?? prefs['reader.theme']` — pour qu'un choix déjà fait survive à la bascule. `reader.theme` n'est plus jamais écrite. Aucune migration de schéma : `settings` est une table clé/valeur, `user_version` ne bouge pas.

Miroir de peinture : `localStorage['beytelhikma.theme']`.

Séquence de démarrage :

1. `theme.js` s'exécute, lit le miroir **synchroniquement**, pose `data-theme` sur `<html>`. Le CSS s'applique avant que `app.js` ne rende quoi que ce soit.
2. `app.js` démarre le routeur.
3. `settings()` résout par IPC ; si `app.theme` diffère du miroir, on applique et on re-miroite.

Sans ce miroir, `user.sqlite` arrive après le premier rendu : ouvrir l'application en nuit donnerait un éclair blanc de plusieurs centaines de millisecondes. Au soir, c'est précisément ce qu'on voulait éviter.

Le miroir n'est **jamais** interrogé comme vérité. S'il manque, s'il porte une clé inconnue, ou si `localStorage` lève, on peint `paper` et l'étape 3 corrige.

### 7. Tests

`test/theme.test.js`, en `node --test` comme le reste :

- `resolveTheme` : clé connue rendue telle quelle ; clé inconnue (`'sepia'`), `undefined`, `null`, chaîne vide → `'paper'`.
- **Parité jetons** : le test lit `styles/tokens.css` et vérifie que chaque clé de `THEMES` autre que `paper` a un bloc `:root[data-theme='<clé>']`, et que `paper` n'en a pas. Même idiome que `book-cover.test.js`, qui lit le fichier Dart pour comparer les palettes — c'est faute d'un tel test que les listes de `reader.js` et `settings.js` avaient divergé.
- **Unicité de la liste** : le test échoue si la chaîne `sepia` reparaît dans `views/reader.js` ou `views/settings.js`, et si l'un des deux redéclare un tableau `THEMES`.

Aucun test de DOM : le dépôt n'a pas d'infrastructure de rendu, et `applyTheme` n'est que deux affectations.

## Vérification manuelle

1. Ouvrir l'application, choisir `الوضع الليلي` dans `/settings` : accueil, bibliothèque, exploration, téléchargements, notes et réglages passent en graphite.
2. Ouvrir un livre : le lecteur est déjà en nuit, sans transition.
3. Depuis la barre du lecteur, revenir à `رق إفتراضي` puis quitter le livre : l'accueil est en parchemin.
4. Fermer et rouvrir l'application en nuit : aucun éclair blanc au démarrage.
5. Surligner un passage en nuit dans les quatre teintes : le texte reste lisible sur chacune.
6. Chercher un terme dans un livre en nuit : le fond de correspondance se voit sans effacer l'encre.

## Hors périmètre

- Le client Flutter. Le portage Electron est déjà en avance sur le téléchargement, l'exploration et les annotations ; ce lot ne creuse pas l'écart d'un cran de plus qu'il ne faut, et l'alignement reste noté au reste-à-faire de `CLAUDE.md`.
- Un thème « suivre le système » (`prefers-color-scheme`). Il ajouterait un état `auto` à persister et à réconcilier avec un clic manuel, pour un confort que trois pastilles couvrent déjà.
- La police et la taille : elles restent des préférences de lecture, pas d'application.
- Les couvertures composées : objets imprimés, elles gardent leur palette en toute ambiance.
