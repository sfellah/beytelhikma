# Livres populaires — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vingt-trois éditions de référence, choisies à la main, deviennent visibles — un badge sur leur carte, un carrousel en accueil, et une case qui restreint `/explore` et `/search` à elles seules.

**Architecture:** Une liste d'identifiants `sh-*` dans `src/shared/popular.js`, hors du catalogue, sur le modèle exact de `shared/curricula.js`. Le processus principal l'importe pour bâtir un `WHERE`; le rendu l'importe pour poser le badge; le mobile la reçoit par `ctx`, comme `CURRICULA`.

**Tech Stack:** JavaScript ESM sans bundler, `node --test`, sql.js (bureau) et `@capacitor-community/sqlite` (Android), CSS à jetons.

## Global Constraints

- **Aucun littéral arabe neuf sous `src/renderer/js/`** hors `locales/ar.js` — `test/no-hardcoded-strings.test.js`. `src/shared/` est hors périmètre : les commentaires arabes y sont permis (voir `curricula.js`).
- **Toute clé i18n neuve doit être citée par une source** et exister dans `ar.js` **et** `en.js` avec les mêmes paramètres d'interpolation — `test/i18n.test.js`.
- **Une méthode exposée au rendu vit dans deux listes** : `METHODS` de `src/preload/preload.cjs` et `REPOSITORY_METHODS` de `src/main/book-repository.js`. Le mobile en tient une troisième : `METHODS` de `apps/mobile/src/repository.capacitor.js`. Les trois sont comparées (`test/repository.test.js`, `npm run verify`). Le compte passe de **68 à 69**.
- **Aucune valeur ne rejoint le SQL par interpolation** dans `catalog-query.js` : paramètres liés uniquement, les seuls fragments littéraux sont des noms de colonnes de ce fichier.
- **Aucun alignement gauche/droite en dur** : propriétés logiques (`inset-inline-start`, `margin-inline-end`…). Un sens de défilement se déduit de `localeDir(currentLocale())`, jamais d'une constante — `test/direction.test.js`.
- **Aucune liste dupliquée.** `POPULAR_EDITION_IDS` n'est déclarée qu'une fois, dans `src/shared/popular.js`. Le mobile la reçoit, il ne la recopie pas.
- **Aucune teinte en dur** : jetons de `styles/tokens.css` seulement.
- Vérification finale : `npm test` depuis `apps/desktop/`, `npm run verify` depuis `apps/mobile/`.

---

### Task 1 : la liste et ses trois fonctions

**Files:**
- Create: `apps/desktop/src/shared/popular.js`
- Test: `apps/desktop/test/popular.test.js`

**Interfaces:**
- Consumes: rien.
- Produces:
  - `POPULAR_EDITION_IDS: string[]` — vingt-trois identifiants, dans l'ordre d'affichage.
  - `resolvePopular(knownEditionIds: Iterable<string>|Set<string>): { ids: string[], missing: number }`
  - `isPopular(editionId: string): boolean`

- [ ] **Step 1 : écrire le test qui échoue**

Créer `apps/desktop/test/popular.test.js` :

```js
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { POPULAR_EDITION_IDS, isPopular, resolvePopular } from '../src/shared/popular.js';

test('vingt-trois éditions, sans doublon', () => {
  assert.equal(POPULAR_EDITION_IDS.length, 23);
  assert.equal(new Set(POPULAR_EDITION_IDS).size, 23);
});

test('chaque identifiant est une édition du corpus publié', () => {
  // Le point est exclu du motif, comme dans `assertEditionId` : l'admettre
  // laisserait passer `..`, et un identifiant désigne un nom de fichier.
  for (const id of POPULAR_EDITION_IDS) {
    assert.match(id, /^sh-\d+$/, `identifiant hors motif : ${id}`);
  }
});

test('resolvePopular écarte ce que le catalogue ne connaît pas et le compte', () => {
  // Sur les cinq livres d'exemple, aucun `sh-*` ne répond : la section
  // s'efface, comme celle des cursus. C'est une réponse, pas une panne.
  const rien = resolvePopular(new Set());
  assert.deepEqual(rien.ids, []);
  assert.equal(rien.missing, 23);

  const deux = resolvePopular(new Set(['sh-1458', 'sh-1462', 'sh-99999']));
  assert.deepEqual(deux.ids, ['sh-1458', 'sh-1462']);
  assert.equal(deux.missing, 21);
});

test('resolvePopular garde l’ordre de la liste, pas celui de l’argument', () => {
  const { ids } = resolvePopular(['sh-1462', 'sh-1458']);
  assert.deepEqual(ids, ['sh-1458', 'sh-1462']);
});

test('resolvePopular accepte un itérable autant qu’un Set', () => {
  assert.deepEqual(resolvePopular(['sh-1458']).ids, ['sh-1458']);
});

test('isPopular répond en temps constant, pas par balayage', () => {
  assert.equal(isPopular('sh-1458'), true);
  assert.equal(isPopular('sh-99999'), false);
  assert.equal(isPopular(null), false);
  const source = readFileSync(
    fileURLToPath(new URL('../src/shared/popular.js', import.meta.url)),
    'utf8',
  );
  assert.ok(
    /new Set\(POPULAR_EDITION_IDS\)/.test(source),
    'isPopular doit s’appuyer sur un Set construit une fois',
  );
});

test('aucune vue ne redéclare la liste', () => {
  // La règle de `theme.test.js` : deux copies d'une même liste ont déjà produit
  // le thème `sepia` mort et la police orpheline.
  const root = fileURLToPath(new URL('../src/renderer/js', import.meta.url));
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory)) {
      const full = path.join(directory, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.js')) files.push(full);
    }
  };
  walk(root);
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    assert.ok(
      !/POPULAR_EDITION_IDS\s*=/.test(source),
      `${path.relative(root, file)} redéclare POPULAR_EDITION_IDS`,
    );
  }
});
```

- [ ] **Step 2 : lancer le test, vérifier qu'il échoue**

```bash
cd apps/desktop && node --test test/popular.test.js
```

Attendu : ÉCHEC — `Cannot find module .../src/shared/popular.js`.

- [ ] **Step 3 : écrire le module**

Créer `apps/desktop/src/shared/popular.js` :

```js
/**
 * Les ouvrages de référence : une sélection, pas une mesure.
 *
 * Rien n'est compté. `tools/stats.py` compte des téléchargements d'installeurs
 * et des lectures de pointeur, jamais des ouvertures de livre. « Populaire »
 * est donc ici un **choix éditorial** assumé — les deux Sahih, les quatre
 * Sunan, Fath al-Bari, Lisan al-Arab — et non un classement. C'est pour cela
 * qu'il n'existe ni tri « par popularité » ni compteur affiché : l'un
 * l'affirmerait, l'autre l'inventerait.
 *
 * La liste vit ici et nulle part ailleurs, comme celle des cursus et pour la
 * même raison : au catalogue, corriger un seul choix d'édition obligerait à
 * monter `schema_version` et à republier 8 589 manifestes. Ici, elle suit la
 * version de l'application.
 *
 * **Le choix porte sur l'édition, pas sur l'œuvre.** Le catalogue publié porte
 * jusqu'à dix-neuf éditions d'un même livre — dix-neuf pour `صحيح مسلم`, onze
 * pour `فتح الباري`. C'est l'édition qui est publiée, téléchargée et lue : le
 * critère retenu est l'impression **de référence**, celle dont la numérotation
 * est citée.
 *
 * Sur une autre bibliothèque — les cinq livres d'exemple, un import partiel —
 * ces identifiants ne répondent pas : `resolvePopular` les écarte et le dit.
 *
 * Les noms sont dans les catalogues de chaînes (`popular.*`), pas ici.
 */

/** L'ordre est celui de l'affichage : il va du hadith vers la langue et l'histoire. */
export const POPULAR_EDITION_IDS = [
  // — hadith : les six livres, le Muwatta et le Musnad
  'sh-1458', // صحيح البخاري - ط السلطانية
  'sh-1481', // صحيح مسلم - ت عبد الباقي
  'sh-1480', // سنن أبي داود - ت محيي الدين عبد الحميد
  'sh-2859', // سنن الترمذي - ت بشار
  'sh-797', // سنن النسائي - ط المصرية
  'sh-1095', // سنن ابن ماجه - ت عبد الباقي
  'sh-6494', // موطأ مالك - رواية يحيى - ت الأعظمي
  'sh-6193', // مسند أحمد - ط الرسالة
  // — le commentaire le plus consulté après les deux Sahih
  'sh-1455', // فتح الباري بشرح البخاري - ط السلفية
  // — usage quotidien
  'sh-1637', // رياض الصالحين - ت الفحل
  'sh-5413', // بلوغ المرام من أدلة الأحكام - ت الفحل
  // — tafsir
  'sh-2994', // تفسير ابن كثير - ت السلامة
  'sh-2839', // تفسير الطبري جامع البيان - ت التركي
  'sh-5614', // تفسير القرطبي = الجامع لأحكام القرآن
  // — fiqh comparé et usul
  'sh-2437', // المغني لابن قدامة - ت التركي
  'sh-1618', // المجموع شرح المهذب - ط المنيرية
  'sh-5841', // بداية المجتهد ونهاية المقتصد
  // — fatawa
  'sh-2561', // مجموع الفتاوى
  // — langue
  'sh-1462', // لسان العرب
  // — histoire et sira
  'sh-188', // زاد المعاد في هدي خير العباد - ط عطاءات العلم
  'sh-1785', // البداية والنهاية - ت التركي
  'sh-3974', // سير أعلام النبلاء - ط الرسالة
  'sh-3519', // تاريخ الطبري = تاريخ الرسل والملوك
];

/**
 * Construit **une fois**, au chargement du module.
 *
 * `isPopular` est appelée une fois par carte dessinée, et un écran
 * d'exploration en monte quarante. Un `Array.includes` sur vingt-trois entrées
 * passerait inaperçu aujourd'hui et deviendrait un défaut le jour où la liste
 * grandit.
 */
const POPULAR = new Set(POPULAR_EDITION_IDS);

export function isPopular(editionId) {
  return POPULAR.has(editionId);
}

/**
 * Les éditions que le catalogue installé sait ouvrir, **dans l'ordre de la
 * liste**, et le compte de celles qu'il ne connaît pas.
 *
 * L'ordre vient de la liste et non de l'argument : c'est une suite écrite à la
 * main, les deux Sahih viennent d'abord parce qu'ils viennent d'abord.
 *
 * `missing` n'est pas une erreur, c'est un chiffre : sur les cinq livres
 * d'exemple il vaut vingt-trois, et la section s'efface.
 */
export function resolvePopular(knownEditionIds) {
  const known = knownEditionIds instanceof Set ? knownEditionIds : new Set(knownEditionIds);
  const ids = POPULAR_EDITION_IDS.filter((editionId) => known.has(editionId));
  return { ids, missing: POPULAR_EDITION_IDS.length - ids.length };
}
```

- [ ] **Step 4 : relancer le test**

```bash
cd apps/desktop && node --test test/popular.test.js
```

Attendu : RÉUSSITE, 7 tests.

- [ ] **Step 5 : commit**

```bash
git add apps/desktop/src/shared/popular.js apps/desktop/test/popular.test.js
git commit -m "feat(shared): les vingt-trois éditions de référence, dans un seul fichier"
```

---

### Task 2 : `getPopularBooks` de bout en bout

**Files:**
- Modify: `apps/desktop/src/main/book-repository.js` (après `getRecentBooks`, ligne ~925 ; et `REPOSITORY_METHODS`, ligne ~2498)
- Modify: `apps/desktop/src/preload/preload.cjs` (liste `METHODS`)
- Test: `apps/desktop/test/repository.test.js` (ajout)

**Interfaces:**
- Consumes: `POPULAR_EDITION_IDS` de la Task 1.
- Produces: `repository.getPopularBooks({ limit?: number }): Promise<{ rows: BookSummary[], total: number }>`
  — `rows` dans l'ordre de `POPULAR_EDITION_IDS`, restreint à ce que le catalogue porte ; `total` est le nombre d'éditions **trouvées**, pas la longueur de la liste.

- [ ] **Step 1 : écrire le test qui échoue**

Ajouter à la fin de `apps/desktop/test/repository.test.js` :

```js
test('getPopularBooks rend les éditions de référence, dans l’ordre de la liste', async () => {
  const { repository } = await freshRepository();
  const { rows, total } = await repository.getPopularBooks();
  // Le jeu d'exemple ne porte aucun `sh-*` : la réponse est vide, et c'est une
  // réponse — pas une erreur.
  assert.equal(Array.isArray(rows), true);
  assert.equal(total, rows.length);
});

test('getPopularBooks est déclarée des deux côtés du pont', () => {
  assert.ok(REPOSITORY_METHODS.includes('getPopularBooks'));
  assert.ok(PRELOAD_METHODS.includes('getPopularBooks'));
});
```

> **Note pour l'implémenteur :** `freshRepository`, `REPOSITORY_METHODS` et `PRELOAD_METHODS` existent déjà dans ce fichier — repérer les aides du test de parité en haut du fichier et réutiliser exactement les mêmes noms. Si l'aide s'appelle autrement, adopter le nom en place plutôt que d'en créer un.

- [ ] **Step 2 : lancer le test, vérifier qu'il échoue**

```bash
cd apps/desktop && node --test test/repository.test.js
```

Attendu : ÉCHEC — `repository.getPopularBooks is not a function`.

- [ ] **Step 3 : implémenter**

En tête de `apps/desktop/src/main/book-repository.js`, ajouter à côté des autres imports partagés :

```js
import { POPULAR_EDITION_IDS } from '../shared/popular.js';
```

Juste après `getRecentBooks` (ligne ~925) :

```js
  /**
   * Les ouvrages de référence, **dans l'ordre de la liste**.
   *
   * L'ordre est réappliqué en JS après la requête : `ORDER BY` ne sait pas
   * exprimer une suite écrite à la main, et trier par titre effacerait
   * l'intention. C'est la contrainte de `#titleOrder`, dans l'autre sens.
   *
   * `total` compte ce que le catalogue **porte**, jamais la longueur de la
   * liste : sur les cinq livres d'exemple il vaut zéro, et la section s'efface.
   * Un décompte affiché vient de ce qu'on a trouvé, pas de ce qu'on espérait.
   */
  getPopularBooks({ limit = POPULAR_EDITION_IDS.length } = {}) {
    return this.#guard('lecture des livres populaires', async () => {
      const db = await this.#db.catalog();
      const ids = POPULAR_EDITION_IDS.slice(0, Math.max(1, limit));
      const rows = all(
        db,
        `${SUMMARY_SELECT} AND e.edition_id IN (${ids.map(() => '?').join(',')})
         GROUP BY e.edition_id`,
        ids,
      ).map(bookSummary);
      const rank = new Map(ids.map((id, index) => [id, index]));
      rows.sort((a, b) => rank.get(a.editionId) - rank.get(b.editionId));
      return { rows: await this.#withDownloadStatus(rows), total: rows.length };
    });
  }
```

> **Note :** vérifier la forme exacte de `SUMMARY_SELECT` avant d'écrire le `AND`. Il se termine par une clause `WHERE …` (voir `getRecentBooks`, qui enchaîne directement sur `GROUP BY`) : si `SUMMARY_SELECT` ne porte pas de `WHERE`, remplacer `AND` par `WHERE`. Lire les lignes autour de sa déclaration et adopter la forme qui compile.

Ajouter `'getPopularBooks'` dans `REPOSITORY_METHODS`, immédiatement après `'getRecentBooks'`.
Ajouter `'getPopularBooks'` dans `METHODS` de `src/preload/preload.cjs`, immédiatement après `'getRecentBooks'` — **le même rang dans les deux listes**, c'est ce qui rend la comparaison lisible.

- [ ] **Step 4 : relancer**

```bash
cd apps/desktop && node --test test/repository.test.js
```

Attendu : RÉUSSITE, y compris le test de parité déjà présent.

- [ ] **Step 5 : commit**

```bash
git add apps/desktop/src/main/book-repository.js apps/desktop/src/preload/preload.cjs apps/desktop/test/repository.test.js
git commit -m "feat(main): getPopularBooks, dans l'ordre de la liste et non du SQL"
```

---

### Task 3 : le badge sur la carte

**Files:**
- Modify: `apps/desktop/src/renderer/js/icons.js` (table `SHAPES`, à côté de `bookmark`)
- Modify: `apps/desktop/src/renderer/js/components/book-card.js`
- Modify: `apps/desktop/src/renderer/styles/components.css` (après `.book-card__status--busy`, ligne ~424)
- Modify: `apps/desktop/src/renderer/js/locales/ar.js`, `apps/desktop/src/renderer/js/locales/en.js`
- Test: `apps/desktop/test/popular.test.js` (ajout)

**Interfaces:**
- Consumes: `isPopular` de la Task 1.
- Produces: la classe CSS `book-card__popular` et l'icône `star` ; aucune API JS neuve.

- [ ] **Step 1 : écrire le test qui échoue**

Ajouter à `apps/desktop/test/popular.test.js` :

```js
test('la carte de livre porte la pastille, et elle est lisible sans la voir', () => {
  const card = readFileSync(
    fileURLToPath(new URL('../src/renderer/js/components/book-card.js', import.meta.url)),
    'utf8',
  );
  assert.ok(card.includes("isPopular"), 'book-card doit interroger isPopular');
  assert.ok(card.includes('book-card__popular'), 'la pastille doit porter sa classe');
  assert.ok(
    card.includes("t('popular.badge')"),
    'le libellé vient du catalogue de chaînes, jamais du code',
  );
  assert.ok(
    /'aria-label': t\('popular\.badge'\)/.test(card),
    'une pastille muette ne dit rien à qui ne voit pas l’étoile',
  );
});

test('la pastille ne cite aucune teinte, seulement des jetons', () => {
  const css = readFileSync(
    fileURLToPath(new URL('../src/renderer/styles/components.css', import.meta.url)),
    'utf8',
  );
  const bloc = css.slice(css.indexOf('.book-card__popular {'));
  assert.ok(bloc.startsWith('.book-card__popular {'), 'le bloc CSS doit exister');
  const regle = bloc.slice(0, bloc.indexOf('}'));
  assert.ok(!/#[0-9a-fA-F]{3,8}/.test(regle), 'aucune couleur en dur');
  assert.ok(!/\b(left|right)\s*:/.test(regle), 'propriétés logiques seulement');
});
```

- [ ] **Step 2 : lancer, vérifier l'échec**

```bash
cd apps/desktop && node --test test/popular.test.js
```

Attendu : ÉCHEC — « book-card doit interroger isPopular ».

- [ ] **Step 3 : implémenter**

Dans `src/renderer/js/icons.js`, ajouter à la table, juste après `bookmark` :

```js
  star: [
    ['polygon', '12 3 14.6 9.2 21 9.7 16.1 14 17.6 20.3 12 17 6.4 20.3 7.9 14 3 9.7 9.4 9.2'],
  ],
```

Dans `src/renderer/js/components/book-card.js`, ajouter l'import :

```js
import { isPopular } from '../../../shared/popular.js';
```

et, dans le `book-card__media`, immédiatement après `statusBadge(book.downloadStatus),` :

```js
      // La pastille des ouvrages de référence. Elle est **à côté** de la
      // couverture et non dessus : la couverture composée porte déjà trois
      // canaux de sens — la forme de l'objet, la famille de la discipline, la
      // patine du siècle — tous tirés du corpus. Celui-ci vient de nous.
      isPopular(book.editionId) &&
        h(
          'span',
          {
            class: 'book-card__popular',
            title: t('popular.badge'),
            'aria-label': t('popular.badge'),
          },
          icon('star', { size: 12 }),
        ),
```

Dans `src/renderer/styles/components.css`, après `.book-card__status--busy { … }` :

```css
/* Les ouvrages de référence. En bas, du côté où commence la ligne : le haut est
   déjà pris — l'état d'installation d'un bord, la pastille « جديد » de
   l'autre. */
.book-card__popular {
  position: absolute;
  bottom: var(--space-sm);
  inset-inline-start: var(--space-sm);
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: var(--radius-pill);
  background: var(--primary-container);
  color: var(--on-primary-container);
  box-shadow: var(--shadow-sm);
}
```

> **Note :** vérifier que `--primary-container` et `--on-primary-container` existent dans `styles/tokens.css`. S'ils n'y sont pas, prendre la paire réellement déclarée qui joue ce rôle (chercher `--primary` et son encre) — **ne pas inventer de jeton**.

Dans `src/renderer/js/locales/ar.js`, ajouter :

```js
  'popular.badge': 'من أمهات الكتب',
```

Dans `src/renderer/js/locales/en.js` :

```js
  'popular.badge': 'Essential work',
```

- [ ] **Step 4 : relancer**

```bash
cd apps/desktop && node --test test/popular.test.js test/i18n.test.js test/no-hardcoded-strings.test.js
```

Attendu : RÉUSSITE des trois fichiers.

- [ ] **Step 5 : commit**

```bash
git add apps/desktop/src/renderer/js/icons.js apps/desktop/src/renderer/js/components/book-card.js apps/desktop/src/renderer/styles/components.css apps/desktop/src/renderer/js/locales/ apps/desktop/test/popular.test.js
git commit -m "feat(ui): une étoile sur la carte des ouvrages de référence"
```

---

### Task 4 : extraire le carrousel de la bande des nouveautés

**Files:**
- Create: `apps/desktop/src/renderer/js/components/scroller.js`
- Modify: `apps/desktop/src/renderer/js/views/home.js` (`recentSection`, lignes 370-438)
- Modify: `apps/desktop/test/direction.test.js`

**Interfaces:**
- Consumes: rien.
- Produces: `horizontalScroller({ items, tail = null }): { node, previous, next }`
  — `node` est le `<div class="scroller no-scrollbar">` déjà câblé (défilement au sens de lecture, bords synchronisés, `ResizeObserver`) ; `previous` et `next` sont les deux boutons prêts à poser dans `sectionHead`. `items` est un tableau de nœuds — le composant les enveloppe lui-même dans `role="listitem"`. `tail` est un nœud facultatif ajouté en fin de bande (le bouton « voir tout » des nouveautés).

- [ ] **Step 1 : écrire le test qui échoue**

Remplacer, dans `apps/desktop/test/direction.test.js`, le test `« la bande des nouveautés défile dans le sens de lecture »` par :

```js
test('le sens du défilement horizontal vit dans un seul module', () => {
  // Deux bandes existent maintenant — les nouveautés et les ouvrages de
  // référence. Deux copies de la même règle auraient rejoué le `sepia` mort et
  // la liste de polices déclarée deux fois : c'est `components/scroller.js` qui
  // la porte, et l'accueil ne la connaît plus.
  const scroller = read('../src/renderer/js/components/scroller.js');
  assert.ok(
    /const avance = \(\) => \(localeDir\(currentLocale\(\)\) === 'rtl' \? -1 : 1\)/.test(scroller),
    'le sens du défilement doit se déduire de la direction de l’interface',
  );
  for (const source of [home, scroller]) {
    for (const fige of ['left: step()', 'left: -step()']) {
      assert.ok(!source.includes(fige), `sens du défilement figé : ${fige}`);
    }
  }
  assert.ok(
    !/scrollBy/.test(home),
    'l’accueil ne pilote plus le défilement lui-même : il passe par le composant',
  );
});
```

- [ ] **Step 2 : lancer, vérifier l'échec**

```bash
cd apps/desktop && node --test test/direction.test.js
```

Attendu : ÉCHEC — `ENOENT … components/scroller.js`.

- [ ] **Step 3 : créer le composant**

Créer `apps/desktop/src/renderer/js/components/scroller.js` :

```js
import { localeDir } from '../../../shared/locale.js';
import { h } from '../dom.js';
import { currentLocale, t } from '../i18n.js';
import { arrowBackward, arrowForward } from '../icons.js';

/**
 * Une bande qui défile à l'horizontale, avec ses deux chevrons.
 *
 * Elle vit ici parce que **deux** sections de l'accueil en veulent une — les
 * nouveautés et les ouvrages de référence — et qu'une seconde copie de la
 * règle de direction serait la faute que le projet a déjà payée deux fois : le
 * thème `sepia` proposé par un écran et lu par aucun, la liste de polices
 * déclarée dans deux vues.
 *
 * Ce qu'elle sait, et que l'appelant n'a plus à savoir :
 *
 * - `scrollLeft` est **négatif en RTL** sous Chromium. On raisonne donc en
 *   distance absolue au bord, jamais en signe, pour désactiver les chevrons.
 * - Le *sens de lecture* décide du signe du pas, jamais une constante. Écrit
 *   en dur pour l'arabe, « suivant » ne bougeait pas d'un pixel sous interface
 *   anglaise — un défaut qui coïncide avec la vérité dans la langue où l'on
 *   développe, donc invisible jusqu'à la bascule.
 * - `ResizeObserver` plutôt qu'un écouteur sur `window` : la vue est remplacée
 *   à chaque navigation, l'observateur disparaît avec elle.
 */
export function horizontalScroller({ items, tail = null }) {
  const node = h(
    'div',
    { class: 'scroller no-scrollbar', tabindex: 0, role: 'list' },
    items.map((item) => h('div', { role: 'listitem' }, item)),
    tail,
  );

  const previous = h(
    'button',
    {
      class: 'button--icon',
      type: 'button',
      title: t('home.previous'),
      'aria-label': t('home.previous'),
    },
    arrowBackward({ size: 20 }),
  );
  const next = h(
    'button',
    {
      class: 'button--icon',
      type: 'button',
      title: t('home.next'),
      'aria-label': t('home.next'),
    },
    arrowForward({ size: 20 }),
  );

  const step = () => Math.max(240, node.clientWidth * 0.8);
  const avance = () => (localeDir(currentLocale()) === 'rtl' ? -1 : 1);
  previous.onclick = () => node.scrollBy({ left: -avance() * step(), behavior: 'smooth' });
  next.onclick = () => node.scrollBy({ left: avance() * step(), behavior: 'smooth' });

  const syncEdges = () => {
    const max = node.scrollWidth - node.clientWidth;
    const offset = Math.abs(node.scrollLeft);
    previous.disabled = offset <= 1;
    next.disabled = offset >= max - 1;
    node.classList.toggle('scroller--at-start', previous.disabled);
    node.classList.toggle('scroller--at-end', next.disabled);
  };
  node.addEventListener('scroll', syncEdges, { passive: true });
  requestAnimationFrame(syncEdges);
  new ResizeObserver(syncEdges).observe(node);

  return { node, previous, next };
}
```

- [ ] **Step 4 : réécrire `recentSection` par-dessus**

Dans `src/renderer/js/views/home.js`, remplacer intégralement le corps de `recentSection` (lignes 370-438) par :

```js
function recentSection(recent) {
  if (!recent.length) return null;

  const { node, previous, next } = horizontalScroller({
    items: recent.map((book) => bookCard(book, { action: 'open' })),
    tail: h(
      'button',
      { class: 'scroller__more', type: 'button', onclick: () => navigate('/library') },
      icon('plusSquare', { size: 30 }),
      h('span', {}, t('home.allNew')),
    ),
  });

  return h(
    'section',
    {
      class: 'section-block recent',
      'aria-labelledby': 'recent-title',
      'data-reveal': 6,
    },
    sectionHead('recent-title', t('home.recentTitle'), t('home.recentHint'), [previous, next]),
    h('div', { class: 'scroller-frame' }, node),
  );
}
```

Ajouter l'import en tête de `home.js` :

```js
import { horizontalScroller } from '../components/scroller.js';
```

Retirer de `home.js` les imports devenus inutiles **seulement s'ils ne servent plus ailleurs dans le fichier** : `localeDir`, `currentLocale`, `arrowBackward`, `arrowForward`. Vérifier par `grep` avant de supprimer — la frise des siècles et le héros peuvent les utiliser.

- [ ] **Step 5 : relancer**

```bash
cd apps/desktop && node --test test/direction.test.js test/home-density.test.js test/horizontal-overflow.test.js
```

Attendu : RÉUSSITE.

- [ ] **Step 6 : commit**

```bash
git add apps/desktop/src/renderer/js/components/scroller.js apps/desktop/src/renderer/js/views/home.js apps/desktop/test/direction.test.js
git commit -m "refactor(home): le sens du défilement horizontal vit dans un seul module"
```

---

### Task 5 : le carrousel des ouvrages de référence en accueil

**Files:**
- Modify: `apps/desktop/src/renderer/js/views/home.js` (`load`, `render`, nouvelle `popularSection`)
- Modify: `apps/desktop/src/renderer/js/locales/ar.js`, `en.js`
- Test: `apps/desktop/test/popular.test.js` (ajout)

**Interfaces:**
- Consumes: `repository.getPopularBooks` (Task 2), `horizontalScroller` (Task 4).
- Produces: rien de réutilisable.

- [ ] **Step 1 : écrire le test qui échoue**

Ajouter à `apps/desktop/test/popular.test.js` :

```js
test('l’accueil demande les ouvrages de référence et les place avant les cursus', () => {
  const home = readFileSync(
    fileURLToPath(new URL('../src/renderer/js/views/home.js', import.meta.url)),
    'utf8',
  );
  assert.ok(home.includes('repository.getPopularBooks()'), 'la lecture doit être demandée');
  assert.ok(
    !/getPopularBooks\(\)\s*\.catch/.test(home),
    'la lecture n’est pas rattrapée : un dépôt cassé ne doit pas disparaître en silence',
  );
  const rendu = home.slice(home.indexOf('function render(data)'));
  const popular = rendu.indexOf('popularSection(');
  const curricula = rendu.indexOf('curriculaSection(');
  const shelf = rendu.indexOf('shelfSection(');
  assert.ok(popular > 0 && curricula > 0 && shelf > 0);
  assert.ok(shelf < popular, 'ce qui est à soi passe avant ce qu’on recommande');
  assert.ok(popular < curricula, 'les ouvrages de référence passent avant les cursus');
});

test('la section s’efface quand le catalogue ne porte aucune des éditions', () => {
  const home = readFileSync(
    fileURLToPath(new URL('../src/renderer/js/views/home.js', import.meta.url)),
    'utf8',
  );
  const section = home.slice(home.indexOf('function popularSection('));
  assert.ok(
    /if \(!rows\?\.length\) return null;/.test(section.slice(0, 400)),
    'une liste vide est une réponse : la section disparaît',
  );
});
```

- [ ] **Step 2 : lancer, vérifier l'échec**

```bash
cd apps/desktop && node --test test/popular.test.js
```

Attendu : ÉCHEC — « la lecture doit être demandée ».

- [ ] **Step 3 : implémenter**

Dans `load()` de `home.js`, ajouter l'appel au `Promise.all` — **entre `recent` et `curricula`**, pour que l'ordre de destructuration suive celui de l'affichage :

```js
  const [resume, library, recent, popular, curricula, disciplines, eras, undated, featured] =
    await Promise.all([
      repository.getContinueReading(),
      repository.getLibrary({ limit: SHELF_LIMIT + 1, sort: 'recent' }),
      repository.getRecentBooks({ limit: 12 }),
      // Les ouvrages de référence sont une liste close et courte, comme les
      // cursus : il n'y a pas de page à demander. Pas de `catch` non plus, pour
      // la même raison — l'accueil échoue déjà d'un bloc pour toutes ses autres
      // sections, et rattraper celle-ci ferait disparaître un dépôt cassé sans
      // que rien ne le dise. Sur le jeu d'exemple, aucun `sh-*` ne répond et la
      // section s'efface : c'est une réponse.
      repository.getPopularBooks(),
      repository.getCurricula(),
      repository.getTopCategories({ limit: DISCIPLINE_LIMIT, sample: DISCIPLINE_SAMPLE }),
      repository.getEras(),
      repository.getUndatedCount(),
      repository.getFeaturedAuthor(),
    ]);
```

et ajouter `popular,` au littéral rendu par `load()`.

Dans `render(data)`, insérer entre `shelfSection` et `curriculaSection` :

```js
    popularSection(data.popular.rows),
```

Ajouter la section, juste avant `curriculaSection` dans le fichier :

```js
// --------------------------------------------- les ouvrages de référence

/**
 * Une bande, pas une grille : vingt-trois cartes en grille pousseraient les
 * cursus et les disciplines sous la ligne de flottaison sur un téléphone.
 *
 * Aucun repli « voir tout » : la case des filtres de `/explore` fait déjà ce
 * travail, et un écran `/popular` serait `/explore?popular=1` avec un titre —
 * donc un second endroit à tenir pour la même requête.
 */
function popularSection(rows) {
  if (!rows?.length) return null;

  const { node, previous, next } = horizontalScroller({
    items: rows.map((book) => bookCard(book, { action: 'open' })),
  });

  return h(
    'section',
    {
      class: 'section-block recent',
      'aria-labelledby': 'popular-title',
      'data-reveal': 3,
    },
    sectionHead('popular-title', t('popular.title'), t('popular.subtitle'), [previous, next]),
    h('div', { class: 'scroller-frame' }, node),
  );
}
```

> **Note sur `data-reveal` :** les valeurs existantes sont lues par `reveal()` pour échelonner l'apparition. Relire les valeurs déjà posées par les autres sections (`shelfSection`, `curriculaSection`, …) et **décaler celles qui suivent** d'un cran, plutôt que de créer un doublon. Si `reveal()` tolère les doublons, le vérifier dans `components/section.js` avant de décider.

Ajouter aux locales — `ar.js` :

```js
  'popular.title': 'أشهر الكتب',
  'popular.subtitle': 'أمهات المصادر التي يرجع إليها في كل فن',
  'popular.filter': 'الأشهر فقط',
```

`en.js` :

```js
  'popular.title': 'Popular books',
  'popular.subtitle': 'The reference works every discipline goes back to',
  'popular.filter': 'Popular only',
```

> `popular.filter` est posée ici et consommée à la Task 7 : `test/i18n.test.js` échoue sur une clé que personne ne cite, il faut donc que les deux tâches soient commitées ensemble **ou** que `popular.filter` soit ajoutée à la Task 7. Choisir : l'ajouter à la Task 7, et ne poser ici que `popular.title` et `popular.subtitle`.

- [ ] **Step 4 : relancer**

```bash
cd apps/desktop && node --test test/popular.test.js test/i18n.test.js
```

Attendu : RÉUSSITE.

- [ ] **Step 5 : commit**

```bash
git add apps/desktop/src/renderer/js/views/home.js apps/desktop/src/renderer/js/locales/ apps/desktop/test/popular.test.js
git commit -m "feat(home): une bande des ouvrages de référence, avant les cursus"
```

---

### Task 6 : le filtre dans le constructeur de requêtes

**Files:**
- Modify: `apps/desktop/src/main/catalog-query.js`
- Test: `apps/desktop/test/catalog-query.test.js`

**Interfaces:**
- Consumes: `POPULAR_EDITION_IDS` (Task 1).
- Produces: la clé de requête `popular: boolean`, comprise par `buildWhere`, `buildList`, `buildCount` et `buildFacetQuery`.

- [ ] **Step 1 : écrire le test qui échoue**

Ajouter à `apps/desktop/test/catalog-query.test.js` :

```js
import { POPULAR_EDITION_IDS } from '../src/shared/popular.js';

test('popular restreint aux éditions de référence, par paramètres liés', () => {
  const { sql, params } = buildWhere({ popular: true });
  assert.ok(sql.includes('e.edition_id IN ('));
  assert.deepEqual(params, POPULAR_EDITION_IDS);
  // Aucune valeur interpolée : autant de `?` que d'identifiants.
  assert.equal((sql.match(/\?/g) ?? []).length, POPULAR_EDITION_IDS.length);
});

test('popular absent ou faux ne pose aucune condition', () => {
  assert.equal(buildWhere({}).sql, '1 = 1');
  assert.equal(buildWhere({ popular: false }).sql, '1 = 1');
});

test('popular se combine avec les autres facettes', () => {
  const { sql, params } = buildWhere({ popular: true, categories: [7] });
  assert.ok(sql.includes(' AND '));
  assert.ok(params.includes(7));
  assert.equal(params.length, POPULAR_EDITION_IDS.length + 1);
});

test('popular survit au retrait d’une facette : ce n’en est pas une', () => {
  // `buildFacetQuery` retire la facette qu'il compte. `popular` n'est pas une
  // facette — elle n'a pas de valeurs à compter — donc elle reste posée quelle
  // que soit la colonne comptée, sinon les comptes annonceraient des livres que
  // la liste exclut.
  const { params } = buildFacetQuery({ popular: true }, 'categories');
  assert.equal(params.length, POPULAR_EDITION_IDS.length);
});
```

- [ ] **Step 2 : lancer, vérifier l'échec**

```bash
cd apps/desktop && node --test test/catalog-query.test.js
```

Attendu : ÉCHEC — `buildWhere({ popular: true }).sql` vaut `'1 = 1'`.

- [ ] **Step 3 : implémenter**

En tête de `src/main/catalog-query.js` :

```js
import { POPULAR_EDITION_IDS } from '../shared/popular.js';
```

Dans `condition()`, ajouter un `case` avant le `default` :

```js
    case 'popular':
      // Une **case à cocher**, pas une facette : elle n'a pas de valeurs à
      // compter. Elle est donc absente de `FACET_VALUE`, et `buildFacetQuery`
      // ne la retire jamais — la retirer ferait annoncer aux facettes des
      // livres que la liste exclut.
      //
      // La liste vient de `shared/popular.js` et n'est pas recopiée ici : les
      // vingt-trois identifiants partent en paramètres liés, comme tout le
      // reste de ce fichier.
      return query.popular ? [`e.edition_id IN (${placeholders(POPULAR_EDITION_IDS)})`, [...POPULAR_EDITION_IDS]] : null;
```

Ajouter `'popular'` à `ALL_KEYS`, **en tête** — c'est la condition la plus sélective, et SQLite lit les clauses dans l'ordre :

```js
const ALL_KEYS = [
  'popular',
  'ids',
  'categories',
  …
];
```

- [ ] **Step 4 : relancer**

```bash
cd apps/desktop && node --test test/catalog-query.test.js
```

Attendu : RÉUSSITE.

- [ ] **Step 5 : commit**

```bash
git add apps/desktop/src/main/catalog-query.js apps/desktop/test/catalog-query.test.js
git commit -m "feat(main): une clause popular dans le constructeur de requêtes"
```

---

### Task 7 : la case dans `/explore`

**Files:**
- Modify: `apps/desktop/src/renderer/js/views/explore.js` (`EMPTY_QUERY`, `readQuery`, `writeQuery`, puces de filtres actifs)
- Modify: `apps/desktop/src/renderer/js/components/facet-panel.js` (`FILTRANTES`, nouvelle section en tête)
- Modify: `apps/desktop/src/renderer/styles/views.css` (ou le fichier qui porte `.facet__option`)
- Modify: `apps/desktop/src/renderer/js/locales/ar.js`, `en.js` (`popular.filter`)
- Test: `apps/desktop/test/popular.test.js` (ajout)

**Interfaces:**
- Consumes: la clé `popular` de la Task 6.
- Produces: `popular=1` dans le fragment d'URL de `/explore` ; `countActive` compte le filtre.

- [ ] **Step 1 : écrire le test qui échoue**

Ajouter à `apps/desktop/test/popular.test.js` :

```js
import { countActive } from '../src/renderer/js/components/facet-panel.js';

test('le filtre populaire compte comme un filtre actif', () => {
  assert.equal(countActive({ popular: true }), 1);
  assert.equal(countActive({ popular: false }), 0);
  assert.equal(countActive({}), 0);
  assert.equal(countActive({ popular: true, categories: [1, 2] }), 3);
});

test('le filtre voyage dans l’URL, pour qu’un lien soit partageable', () => {
  const explore = readFileSync(
    fileURLToPath(new URL('../src/renderer/js/views/explore.js', import.meta.url)),
    'utf8',
  );
  assert.ok(/popular: raw\.popular === '1'/.test(explore), 'readQuery doit décoder popular');
  assert.ok(
    /params\.set\('popular', '1'\)/.test(explore),
    'writeQuery doit réécrire popular dans le fragment',
  );
});

test('le filtre est une case, pas une facette', () => {
  const panel = readFileSync(
    fileURLToPath(new URL('../src/renderer/js/components/facet-panel.js', import.meta.url)),
    'utf8',
  );
  assert.ok(
    !/\['popular', /.test(panel),
    'popular n’a pas de valeurs à compter : elle n’entre ni dans LISTS ni dans SUGGESTED',
  );
  assert.ok(panel.includes("t('popular.filter')"), 'le libellé vient du catalogue de chaînes');
});
```

> **Note :** `countActive` est déjà exportée par `facet-panel.js` — vérifier que l'import ci-dessus ne casse rien sous `node --test` (le module importe `repository.js`, qui touche `window`). Si l'import échoue hors DOM, remplacer ce premier test par une lecture statique du tableau `FILTRANTES` (`assert.ok(panel.includes("'popular'"))`) et déplacer la vérification du comptage dans un test qui charge déjà `fake-dom.js`.

- [ ] **Step 2 : lancer, vérifier l'échec**

```bash
cd apps/desktop && node --test test/popular.test.js
```

Attendu : ÉCHEC — `countActive({ popular: true })` vaut 0.

- [ ] **Step 3 : implémenter**

Dans `views/explore.js` :

```js
const EMPTY_QUERY = {
  text: '',
  categories: [],
  types: [],
  centuries: [],
  authors: [],
  publishers: [],
  years: null,
  status: null,
  popular: false,
};
```

Dans `readQuery`, ajouter au littéral rendu :

```js
    popular: raw.popular === '1',
```

Dans `writeQuery`, avant la ligne du tri :

```js
  if (query.popular) params.set('popular', '1');
```

Dans les puces de filtres actifs (autour de la ligne 341, là où `years` est poussé) :

```js
    if (state.query.popular) out.push({ key: 'popular', value: null, label: t('popular.filter') });
```

> Le retrait d'une puce passe par `{ [filter.key]: null }` quand `filter.value == null` : `popular: null` est faux, donc le filtre se lève correctement sans code en plus. Le vérifier à la lecture avant de conclure.

Dans `components/facet-panel.js` :

```js
const FILTRANTES = [
  'popular',
  'categories',
  'types',
  'centuries',
  'status',
  'authors',
  'publishers',
];
```

et ajouter, **en tête** du tableau `sections` (donc au-dessus des facettes) :

```js
  const sections = [
    popularFacet(onChange),
    ...LISTS.map(([key, label]) => listFacet(key, label, onChange)),
    …
  ];
```

avec la fabrique, à côté de `listFacet` :

```js
/**
 * Une case, pas une facette.
 *
 * Une facette porte des valeurs et leurs comptes ; celle-ci est un booléen. La
 * bâtir comme les autres l'obligerait à un `GROUP BY` sur une colonne qui
 * n'existe pas — la liste vit dans le code, pas dans le catalogue.
 *
 * Elle est en tête du panneau parce que c'est la restriction la plus large :
 * cocher vingt-trois livres change ce que toutes les autres comptent.
 */
function popularFacet(onChange) {
  const box = h('input', {
    type: 'checkbox',
    onchange: (event) => onChange({ popular: event.target.checked }),
  });

  const node = h(
    'section',
    { class: 'facet facet--toggle' },
    h(
      'label',
      { class: 'facet__option' },
      box,
      h('span', { class: 'facet__label' }, t('popular.filter')),
    ),
  );

  return {
    node,
    paint({ query }) {
      // Un champ ne se réécrit pas sous les doigts qui le tiennent — mais une
      // case n'a pas de curseur à déplacer : la reposer est sans effet visible.
      box.checked = Boolean(query.popular);
    },
  };
}
```

Ajouter aux locales — `ar.js` : `'popular.filter': 'أشهر الكتب فقط',` ; `en.js` : `'popular.filter': 'Popular books only',`.

Ajouter au CSS, à côté de `.facet` :

```css
/* Une seule ligne, sans titre : le libellé de la case dit déjà tout, et un
   `<h3>` au-dessus d'une ligne unique ferait deux fois la même phrase. */
.facet--toggle .facet__option {
  font-family: var(--font-label);
  font-weight: 600;
}
```

- [ ] **Step 4 : relancer**

```bash
cd apps/desktop && node --test test/popular.test.js test/explore-compact.test.js test/explore-selection.test.js test/i18n.test.js
```

Attendu : RÉUSSITE.

- [ ] **Step 5 : commit**

```bash
git add apps/desktop/src/renderer/js/views/explore.js apps/desktop/src/renderer/js/components/facet-panel.js apps/desktop/src/renderer/styles/ apps/desktop/src/renderer/js/locales/ apps/desktop/test/popular.test.js
git commit -m "feat(explore): une case « les plus connus seulement », partageable par l'URL"
```

---

### Task 8 : la case dans `/search`

**Files:**
- Modify: `apps/desktop/src/renderer/js/views/search.js`
- Test: `apps/desktop/test/popular.test.js` (ajout)

**Interfaces:**
- Consumes: la clé `popular` de la Task 6, `popular.filter` de la Task 7.
- Produces: rien.

- [ ] **Step 1 : écrire le test qui échoue**

Ajouter à `apps/desktop/test/popular.test.js` :

```js
test('la recherche générale filtre les livres du catalogue, pas le balayage', () => {
  const search = readFileSync(
    fileURLToPath(new URL('../src/renderer/js/views/search.js', import.meta.url)),
    'utf8',
  );
  assert.ok(
    /exploreBooks\(\{[^}]*popular: this\.#popular/s.test(search),
    'la section « livres » doit porter le filtre',
  );
  // La seconde vague ne le porte pas : un passage n'est pas populaire ou non,
  // et restreindre le balayage ferait mentir « n livres parcourus ».
  const texts = search.slice(search.indexOf('async #runTexts('));
  assert.ok(!texts.includes('popular'), 'la vague plein texte ne doit pas être filtrée');
  assert.ok(
    /popular: this\.#popular/.test(search) &&
      /#toExplore\(\)/.test(search),
    'le lien « voir tout » doit exister',
  );
});

test('le filtre de la recherche voyage vers /explore', () => {
  const search = readFileSync(
    fileURLToPath(new URL('../src/renderer/js/views/search.js', import.meta.url)),
    'utf8',
  );
  assert.ok(
    /popular=1/.test(search),
    '« voir tout » doit reporter le filtre : le perdre en chemin élargirait la réponse sans le dire',
  );
});
```

- [ ] **Step 2 : lancer, vérifier l'échec**

```bash
cd apps/desktop && node --test test/popular.test.js
```

Attendu : ÉCHEC — « la section « livres » doit porter le filtre ».

- [ ] **Step 3 : implémenter**

Dans `views/search.js`, ajouter le champ privé à la classe :

```js
  #popular = false;
```

Dans `#build()`, après le `search__box`, insérer la case :

```js
    const popularBox = h('input', {
      type: 'checkbox',
      onchange: (event) => {
        this.#popular = event.target.checked;
        if (this.#term.trim().length >= 2) this.#run();
      },
    });
    const popularToggle = h(
      'label',
      { class: 'search__toggle' },
      popularBox,
      h('span', {}, t('popular.filter')),
    );
```

et le poser dans l'arbre, entre `search__box` et `catalog` :

```js
        h('div', { class: 'search__box' }, icon('search', { size: 20 }), field),
        popularToggle,
        catalog,
```

Dans `#runCatalog`, remplacer l'appel aux livres :

```js
        repository.exploreBooks({ text: term, limit: BOOKS, popular: this.#popular }),
```

**Ne rien changer à `#runTexts`.** Ajouter au-dessus de la case un commentaire :

```js
    // La case ne porte que sur la **première** vague. Un passage n'est pas
    // populaire ou non : restreindre le balayage aux vingt-trois livres ferait
    // mentir l'annonce « n livres parcourus », qui compte les livres installés.
```

Dans `#toExplore`, reporter le filtre :

```js
  #toExplore() {
    const params = new URLSearchParams();
    const term = this.#term.trim();
    if (term) params.set('text', term);
    // Le filtre part avec : le perdre en chemin élargirait la réponse sans le
    // dire, et l'écran d'arrivée annoncerait un total qui n'est pas celui qu'on
    // vient de lire.
    if (this.#popular) params.set('popular', '1');
    const suffix = params.toString();
    navigate(`/explore${suffix ? `?${suffix}` : ''}`);
  }
```

Ajouter au CSS de la recherche (`views.css`, section `.search`) :

```css
.search__toggle {
  display: flex;
  gap: var(--space-xs);
  align-items: center;
  margin-block: var(--space-sm);
  font-family: var(--font-label);
  color: var(--on-surface-variant);
}
```

- [ ] **Step 4 : relancer**

```bash
cd apps/desktop && node --test test/popular.test.js test/no-hardcoded-strings.test.js
```

Attendu : RÉUSSITE.

- [ ] **Step 5 : commit**

```bash
git add apps/desktop/src/renderer/js/views/search.js apps/desktop/src/renderer/styles/views.css apps/desktop/test/popular.test.js
git commit -m "feat(search): filtrer les livres du catalogue sans toucher au balayage"
```

---

### Task 9 : le portage Android

**Files:**
- Modify: `apps/mobile/src/repository.capacitor.js` (`METHODS`, chargement différé, `ctx`)
- Modify: `apps/mobile/src/repo/catalogue-plus.js` (`condition`, `ALL_KEYS`, `getPopularBooks`, export)
- Modify: `apps/mobile/scripts/verify.mjs` si le compte y est écrit en dur

**Interfaces:**
- Consumes: `shared/popular.js` (Task 1), `getPopularBooks` (Task 2), la clause `popular` (Task 6).
- Produces: la parité des 69 méthodes.

- [ ] **Step 1 : lancer `verify` pour voir l'échec**

```bash
cd apps/mobile && npm run verify
```

Attendu : ÉCHEC — `getPopularBooks` manque au shim (le preload en porte 69, le shim 68).

- [ ] **Step 2 : charger la liste comme les cursus**

Dans `apps/mobile/src/repository.capacitor.js`, à côté de `curriculaModule` (ligne ~1531) :

```js
let popularModule = null;
```

et l'amorçage, sous celui des cursus (ligne ~1545) :

```js
import(new URL('../shared/popular.js', import.meta.url).href)
  .then((module) => {
    popularModule = module;
  })
  .catch(() => {});
```

Dans `ctx`, sous l'accesseur `CURRICULA` :

```js
  /** Lu comme une valeur par `catalogue-plus`, d'où l'accesseur — comme CURRICULA. */
  get POPULAR_EDITION_IDS() {
    return popularModule?.POPULAR_EDITION_IDS;
  },
```

Ajouter `'getPopularBooks'` dans `METHODS`, **au même rang que dans le preload** — immédiatement après `'getRecentBooks'`. Corriger le commentaire « Les 68 noms » en « Les 69 noms ».

- [ ] **Step 3 : porter la clause et la méthode**

Dans `apps/mobile/src/repo/catalogue-plus.js`, ajouter `POPULAR_EDITION_IDS` à la destructuration de `ctx`… **non** : `ctx` porte un accesseur, le destructurer le figerait à `undefined` au moment de l'assemblage, avant que l'import différé n'ait abouti. Écrire donc, dans la fabrique :

```js
  /**
   * Lue par accesseur à **chaque appel**, jamais destructurée.
   *
   * L'import de `shared/popular.js` est différé — depuis `src/`, où
   * `verify.mjs` charge ce fichier, le dossier `shared/` n'existe pas. Le
   * destructurer figerait `undefined` au moment de l'assemblage, c'est-à-dire
   * toujours. Le repli est la liste vide : une clause qui ne trouve rien, donc
   * une section qui s'efface — jamais une clause absente, qui rendrait le
   * catalogue entier sous couvert de filtre.
   */
  const popularIds = () => ctx.POPULAR_EDITION_IDS ?? [];
```

Dans la fonction `condition` locale (ligne ~289), ajouter le `case` avant le `default` :

```js
      case 'popular': {
        if (!query.popular) return null;
        const ids = popularIds();
        // Une liste vide n'est pas « pas de filtre » : c'est « aucun résultat ».
        // `IN ()` est une erreur de syntaxe en SQLite, d'où la constante.
        if (!ids.length) return ['1 = 0', []];
        return [`e.edition_id IN (${placeholders(ids)})`, [...ids]];
      }
```

Ajouter `'popular'` en tête de `ALL_KEYS` (ligne ~371).

Ajouter la méthode, à côté de `exploreBooks` :

```js
  /**
   * Les ouvrages de référence, dans l'ordre de la liste. Le SQL est celui de
   * `book-repository.js`, repris tel quel ; l'ordre est réappliqué en JS pour
   * la même raison — `ORDER BY` ne sait pas exprimer une suite écrite à la main.
   */
  const getPopularBooks = ({ limit } = {}) =>
    garde('lecture des livres populaires', async () => {
      const db = await catalogue();
      const tous = popularIds();
      const ids = tous.slice(0, Math.max(1, limit ?? tous.length));
      if (!ids.length) return { rows: [], total: 0 };
      const installes = await idsInstalles();
      const rows = (
        await all(
          db,
          `${SUMMARY_SELECT} AND e.edition_id IN (${ids.map(() => '?').join(',')})
           GROUP BY e.edition_id`,
          ids,
        )
      ).map(bookSummary);
      const rang = new Map(ids.map((id, index) => [id, index]));
      rows.sort((a, b) => rang.get(a.editionId) - rang.get(b.editionId));
      return { rows: marquerInstalles(rows, installes), total: rows.length };
    });
```

> **Note :** vérifier la forme de `SUMMARY_SELECT` côté mobile (`AND` contre `WHERE`), exactement comme à la Task 2, et le nom réel de l'aide d'installation (`marquerInstalles` / `idsInstalles`) en relisant `exploreBooks` juste au-dessus.

Ajouter `getPopularBooks` au littéral rendu par la fabrique (ligne ~1356, à côté de `exploreBooks`).

- [ ] **Step 4 : relancer `verify`**

```bash
cd apps/mobile && npm run verify
```

Attendu : RÉUSSITE — 69 méthodes des deux côtés, aucune `not-ported`.

- [ ] **Step 5 : commit**

```bash
git add apps/mobile/src/repository.capacitor.js apps/mobile/src/repo/catalogue-plus.js
git commit -m "feat(mobile): getPopularBooks et la clause popular, 69 méthodes"
```

---

### Task 10 : vérification complète et documentation

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1 : lancer les quatre suites**

```bash
cd apps/desktop && npm test
cd ../mobile && npm run verify
cd ../../site && node --test "test/**/*.test.js"
cd ../tools && python -m unittest discover -s shamela/tests -t .
```

Attendu : les quatre vertes. Ne rien commiter tant qu'une seule est rouge — corriger la cause, pas le test.

- [ ] **Step 2 : documenter la règle dans `CLAUDE.md`**

Ajouter, sous le paragraphe des cursus dans la section « Écrans », un bloc :

```markdown
**Les ouvrages de référence se choisissent, ils ne se mesurent pas.** `src/shared/popular.js`
porte vingt-trois identifiants `sh-*`, **seule** — la règle de `curricula.js`, pour la même
raison : au catalogue, corriger un choix d'édition coûterait un `schema_version` et 8 589
manifestes republiés. Le choix porte sur l'**édition**, pas sur l'œuvre : le catalogue publié
porte dix-neuf éditions de `صحيح مسلم`, et c'est l'édition qui se télécharge. Rien n'est compté
— `tools/stats.py` mesure des téléchargements d'installeurs, pas des ouvertures de livre —
donc il n'existe ni tri « par popularité » ni compteur : l'un l'affirmerait, l'autre
l'inventerait. Le filtre est une **case**, pas une facette : `buildFacetQuery` ne la retire
jamais, parce qu'elle n'a pas de valeurs à compter et que la retirer ferait annoncer aux
facettes des livres que la liste exclut. Sur le jeu d'exemple, aucun `sh-*` ne répond, la
bande de l'accueil s'efface — c'est une réponse.

**Une bande qui défile vit dans `components/scroller.js`, seule.** Deux sections de l'accueil
en portent une, et le sens du défilement se déduit de `localeDir(currentLocale())`. Écrit en
dur pour l'arabe, « suivant » ne bougeait pas d'un pixel sous interface anglaise :
`test/direction.test.js` interdit `left: step()` dans les deux fichiers.
```

Corriger aussi, dans la section « L'application Android », « **67 méthodes, aucune
`not-ported`** » en « **69 méthodes** » — le compte y est déjà périmé d'une unité avant ce
chantier, le vérifier avec `grep -c` sur le preload avant d'écrire le chiffre.

- [ ] **Step 3 : commit**

```bash
git add CLAUDE.md
git commit -m "docs: la règle des ouvrages de référence et de la bande qui défile"
```

---

## Auto-revue

**Couverture du spec** — chaque section a sa tâche : la liste (1), le pont (2), le badge (3), le carrousel (4-5), le filtre (6-8), le mobile (9), les tests et la doc (1-10). La règle « aucune vue ne redéclare la liste » est tenue par la Task 1 ; « le décompte vient de ce qu'on a trouvé » par la Task 2 ; « la seconde vague n'est pas filtrée » par la Task 8.

**Points laissés à la lecture, et signalés comme tels** — trois notes disent explicitement de vérifier avant d'écrire : la forme de `SUMMARY_SELECT` (`AND` contre `WHERE`, Tasks 2 et 9), l'existence des jetons `--primary-container` (Task 3), et la valeur libre de `data-reveal` (Task 5). Ce ne sont pas des trous : la réponse est dans le fichier voisin, et l'inventer serait pire que la lire.

**Cohérence des noms** — `getPopularBooks` rend `{ rows, total }` partout (Tasks 2, 5, 9) ; la clé de requête est `popular` partout (Tasks 6, 7, 8, 9) ; la clé i18n du filtre est `popular.filter`, posée à la Task 7 et consommée aux Tasks 7 et 8 ; `horizontalScroller` rend `{ node, previous, next }`, consommé aux Tasks 4 et 5.
