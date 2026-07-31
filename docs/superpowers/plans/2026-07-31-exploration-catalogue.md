# Exploration du catalogue — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner à `/explore` une recherche texte et sept filtres combinables, avec compteurs vivants, autocomplétion auteur/éditeur, sélection multiple et mise en file du lot.

**Architecture:** Un module de normalisation partagé (`src/shared/arabic.js`) reflétant `normalize_ar` du pipeline Python. Un constructeur de requêtes pur (`src/main/catalog-query.js`) que `BookRepository` exécute. Le statut d'installation se filtre par liste d'identifiants, faute de `JOIN` possible entre `catalog.sqlite` et `user.sqlite`. Les noms d'auteurs et d'éditeurs sont indexés en mémoire côté processus principal.

**Tech Stack:** Electron 38.8.6 (Node 22.22.0), ESM, sql.js, FTS5, `node:test`.

## Global Constraints

- Spec de référence : `docs/superpowers/specs/2026-07-31-exploration-catalogue-design.md`.
- **Aucune modification de schéma.** `tools/_common.py` n'est pas touché, aucun réimport, `SchemaParityTest` doit continuer de passer.
- Aucune valeur ne rejoint le SQL par interpolation : tout passe en paramètres liés. Les seuls fragments littéraux viennent de listes blanches.
- Pas de chaîne HTML interprétée dans le rendu : tout par `h()` de `src/renderer/js/dom.js`.
- Interface RTL : `inset-inline-start` / `inset-inline-end`, jamais `left` / `right`.
- Textes visibles en arabe.
- `npm test` depuis `beytelhikma-electron/` doit rester vert à chaque commit.
- Ne pas revenir sur les modifications récentes de `shell.js` et `main.js` (marque, icône d'application).

## Structure des fichiers

| Fichier | Responsabilité |
| --- | --- |
| `src/shared/arabic.js` *(créé)* | `normalizeArabic()`, reflet exact de `normalize_ar`. Importé par le principal et par le rendu. |
| `src/main/catalog-query.js` *(créé)* | Construction des clauses SQL et des requêtes de facettes. Aucun accès base. |
| `src/main/book-repository.js` *(modifié)* | Exécute les requêtes, tient l'index mémoire des noms, expose les cinq méthodes. |
| `src/preload/preload.cjs` *(modifié)* | Nouvelles méthodes IPC. |
| `src/renderer/js/components/modal.js` *(créé)* | `confirmDialog()` générique. |
| `src/renderer/js/components/confirm-delete.js` *(modifié)* | Devient un appelant mince. |
| `src/renderer/js/components/facet-panel.js` *(créé)* | Panneau de facettes : listes à cases, plage d'années, champs à autocomplétion. |
| `src/renderer/js/views/explore.js` *(créé)* | L'écran : état, recherche, grille, pagination, sélection. |
| `src/renderer/js/components/book-card.js` *(modifié)* | Option `action: 'download'`, case de sélection. |
| `src/renderer/js/shell.js` *(modifié)* | La barre de recherche renvoie vers `#/explore?text=…`. |
| `src/renderer/js/app.js` *(modifié)* | `/explore` cesse d'être un texte d'attente. |
| `src/renderer/styles/views.css`, `components.css` *(modifiés)* | Styles de l'écran, du panneau, de la modale générique. |
| `src/main/capture.js` *(modifié)* | Capture de `/explore`. |
| `test/arabic.test.js` *(créé)* | Table de parité. |
| `test/catalog-query.test.js` *(créé)* | Constructeur pur. |
| `test/repository.test.js` *(modifié)* | Exploration contre les données d'exemple. |

---

### Task 1: Normalisation arabe partagée

**Files:**
- Create: `beytelhikma-electron/src/shared/arabic.js`
- Test: `beytelhikma-electron/test/arabic.test.js`

**Interfaces:**
- Produces: `normalizeArabic(text: string): string`

- [ ] **Step 1: Écrire le test de parité**

`beytelhikma-electron/test/arabic.test.js` :

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeArabic } from '../src/shared/arabic.js';

/**
 * Valeurs produites par `normalize_ar` de `tools/_common.py`. Sans cette table,
 * les deux implémentations divergent en silence et la recherche se dégrade sans
 * qu'aucun test n'échoue.
 */
const PARITY = [
  ['أَحْمَد', 'احمد'],
  ['إبراهيم', 'ابراهيم'],
  ['آل عمران', 'ال عمران'],
  ['ٱلكتاب', 'الكتاب'],
  ['مُقَدِّمَة ابن خَلْدُون', 'مقدمه ابن خلدون'],
  ['الرسالة', 'الرساله'],
  ['عائشة', 'عائشه'],
  ['ىسير', 'يسير'],
  ['ابـــن تيمية', 'ابن تيميه'],
  ['  فقه   مالكي  ', 'فقه مالكي'],
  ['الشافعيّة', 'الشافعيه'],
  ['ة', 'ه'],
  ['ى', 'ي'],
];

test('normalizeArabic reproduit normalize_ar du pipeline', () => {
  for (const [input, expected] of PARITY) {
    assert.equal(normalizeArabic(input), expected, `entrée : ${input}`);
  }
});

test('normalizeArabic tolère le vide et le non-arabe', () => {
  assert.equal(normalizeArabic(''), '');
  assert.equal(normalizeArabic(null), '');
  assert.equal(normalizeArabic('Ibn Khaldun'), 'Ibn Khaldun');
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `cd beytelhikma-electron && node --test test/arabic.test.js`
Expected: FAIL — `Cannot find module .../src/shared/arabic.js`

- [ ] **Step 3: Écrire le module**

`beytelhikma-electron/src/shared/arabic.js` :

```js
/**
 * Normalisation arabe pour la recherche souple. Reflet **exact** de
 * `normalize_ar` dans `tools/_common.py` : c'est ce contrat qui a produit la
 * colonne `catalog_fts.title_normalized`. Toute divergence dégrade la recherche
 * sans rien casser de visible — d'où la table de parité dans `test/arabic.test.js`.
 *
 * Les plages de harakāt sont celles de `HARAKAT`, obtenues par énumération des
 * points de code et non par transcription à vue de la classe de caractères.
 */
const HARAKAT = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;
const TATWEEL = /ـ/g;
const ALIF = /[أإآٱ]/g;

export function normalizeArabic(text) {
  if (!text) return '';
  return String(text)
    .normalize('NFC')
    .replace(HARAKAT, '')
    .replace(TATWEEL, '')
    .replace(ALIF, 'ا')
    .replaceAll('ى', 'ي')
    .replaceAll('ة', 'ه')
    .replace(/\s+/g, ' ')
    .trim();
}
```

- [ ] **Step 4: Lancer, vérifier le succès**

Run: `cd beytelhikma-electron && node --test test/arabic.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add beytelhikma-electron/src/shared/arabic.js beytelhikma-electron/test/arabic.test.js
git commit -m "feat(electron): normalisation arabe partagée, conforme au pipeline"
```

---

### Task 2: Constructeur de requêtes

**Files:**
- Create: `beytelhikma-electron/src/main/catalog-query.js`
- Test: `beytelhikma-electron/test/catalog-query.test.js`

**Interfaces:**
- Consumes: `normalizeArabic` (tâche 1).
- Produces:
  - `SORTS` — objet `{ title, recent, pages, size }` vers fragments `ORDER BY`.
  - `FACETS` — `['categories', 'types', 'centuries', 'status']`.
  - `buildWhere(query, { installedIds }) -> { sql, params }` où `sql` est le contenu du `WHERE` sans le mot-clé (`'1 = 1'` si rien).
  - `buildList(query, { installedIds }) -> { sql, params }` — la requête complète des résumés.
  - `buildCount(query, { installedIds }) -> { sql, params }`
  - `buildFacetQuery(query, facetKey, { installedIds }) -> { sql, params }` — la facette est retirée de ses propres filtres.

- [ ] **Step 1: Écrire les tests**

`beytelhikma-electron/test/catalog-query.test.js` :

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCount, buildFacetQuery, buildList, buildWhere } from '../src/main/catalog-query.js';

const none = { installedIds: [] };

test('une requête vide ne pose aucune condition', () => {
  const { sql, params } = buildWhere({}, none);
  assert.equal(sql, '1 = 1');
  assert.deepEqual(params, []);
});

test('les valeurs d’une facette sont en OU, les facettes en ET', () => {
  const { sql, params } = buildWhere({ categories: [12, 15], types: ['كتاب'] }, none);
  assert.match(sql, /e\.category_id IN \(\?,\?\)/);
  assert.match(sql, /e\.book_type_label IN \(\?\)/);
  assert.equal((sql.match(/ AND /g) ?? []).length, 2);
  assert.deepEqual(params, [12, 15, 'كتاب']);
});

test('aucune valeur n’est interpolée dans le SQL', () => {
  const hostile = "'; DROP TABLE editions; --";
  const { sql, params } = buildWhere({ types: [hostile], publishers: [hostile] }, none);
  assert.equal(sql.includes('DROP'), false);
  assert.deepEqual(params, [hostile, hostile]);
});

test('la plage d’années accepte une borne seule', () => {
  assert.deepEqual(buildWhere({ years: { from: 1990 } }, none).params, [1990]);
  assert.deepEqual(buildWhere({ years: { to: 2010 } }, none).params, [2010]);
  assert.deepEqual(buildWhere({ years: { from: 1990, to: 2010 } }, none).params, [1990, 2010]);
});

test('le statut se filtre par liste d’identifiants installés', () => {
  const installed = { installedIds: ['ed-a', 'ed-b'] };
  const yes = buildWhere({ status: 'installed' }, installed);
  assert.match(yes.sql, /e\.edition_id IN \(\?,\?\)/);
  assert.deepEqual(yes.params, ['ed-a', 'ed-b']);

  const no = buildWhere({ status: 'missing' }, installed);
  assert.match(no.sql, /e\.edition_id NOT IN \(\?,\?\)/);

  // Rien d'installé : « installés » ne renvoie rien, « manquants » renvoie tout.
  assert.equal(buildWhere({ status: 'installed' }, none).sql, '1 = 0');
  assert.equal(buildWhere({ status: 'missing' }, none).sql, '1 = 1');
});

test('le siècle se traduit en intervalle sur la date de décès', () => {
  const { sql, params } = buildWhere({ centuries: [7] }, none);
  assert.match(sql, /death_year_hijri/);
  assert.deepEqual(params, [7]);
});

test('un tri inconnu retombe sur le titre', () => {
  assert.match(buildList({ sort: 'rm -rf' }, none).sql, /ORDER BY e\.title_ar/);
  assert.match(buildList({ sort: 'pages' }, none).sql, /ORDER BY r\.page_count/);
});

test('la pagination est bornée', () => {
  const { params } = buildList({ limit: 10_000, offset: 40 }, none);
  assert.deepEqual(params.slice(-2), [200, 40], 'limite plafonnée à 200');
});

test('le compte ne trie ni ne pagine', () => {
  const { sql } = buildCount({ sort: 'pages', limit: 40 }, none);
  assert.equal(sql.includes('ORDER BY'), false);
  assert.equal(sql.includes('LIMIT'), false);
});

test('une facette est comptée sans son propre filtre', () => {
  const query = { categories: [12], types: ['كتاب'] };
  const own = buildFacetQuery(query, 'categories', none);
  assert.equal(own.sql.includes('category_id IN'), false, 'son filtre est retiré');
  assert.match(own.sql, /book_type_label IN/, 'les autres restent');
  assert.deepEqual(own.params, ['كتاب']);
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `cd beytelhikma-electron && node --test test/catalog-query.test.js`
Expected: FAIL — module absent.

- [ ] **Step 3: Écrire le module**

`beytelhikma-electron/src/main/catalog-query.js` :

```js
import { normalizeArabic } from '../shared/arabic.js';

/** Tris autorisés. Toute autre valeur retombe sur le titre. */
export const SORTS = {
  title: 'e.title_ar',
  recent: 'r.published_at DESC, e.title_ar',
  pages: 'r.page_count DESC, e.title_ar',
  size: 'r.compressed_size DESC, e.title_ar',
};

/** Facettes à compteur. */
export const FACETS = ['categories', 'types', 'centuries', 'status'];

/** Une page de résultats ne dépasse jamais cette taille. */
const MAX_LIMIT = 200;

const FROM = `
  FROM editions e
  LEFT JOIN book_releases r ON r.edition_id = e.edition_id AND r.is_active = 1
  WHERE e.is_hidden = 0 AND `;

const placeholders = (values) => values.map(() => '?').join(',');

/** Conditions d'une facette, ou `null` si elle n'est pas filtrée. */
function condition(key, query, installedIds) {
  const values = query[key];
  switch (key) {
    case 'categories':
      return values?.length ? [`e.category_id IN (${placeholders(values)})`, values] : null;
    case 'types':
      return values?.length ? [`e.book_type_label IN (${placeholders(values)})`, values] : null;
    case 'publishers':
      return values?.length ? [`e.publisher_ar IN (${placeholders(values)})`, values] : null;
    case 'authors':
      return values?.length
        ? [
            `e.edition_id IN (SELECT edition_id FROM edition_authors
                               WHERE author_id IN (${placeholders(values)}))`,
            values,
          ]
        : null;
    case 'centuries':
      return values?.length
        ? [
            `e.edition_id IN (
               SELECT ea.edition_id FROM edition_authors ea
               JOIN authors a ON a.author_id = ea.author_id
               WHERE a.death_year_hijri IS NOT NULL AND a.death_year_hijri > 0
                 AND (a.death_year_hijri - 1) / 100 + 1 IN (${placeholders(values)}))`,
            values,
          ]
        : null;
    case 'years': {
      const { from, to } = query.years ?? {};
      const parts = [];
      const params = [];
      if (from != null) {
        parts.push('e.publication_year >= ?');
        params.push(from);
      }
      if (to != null) {
        parts.push('e.publication_year <= ?');
        params.push(to);
      }
      return parts.length ? [parts.join(' AND '), params] : null;
    }
    case 'status': {
      if (query.status !== 'installed' && query.status !== 'missing') return null;
      // Sans aucun livre installé, les deux sens sont des constantes : une
      // clause `IN ()` vide est une erreur de syntaxe en SQLite.
      if (!installedIds.length) {
        return [query.status === 'installed' ? '1 = 0' : '1 = 1', []];
      }
      const operator = query.status === 'installed' ? 'IN' : 'NOT IN';
      return [`e.edition_id ${operator} (${placeholders(installedIds)})`, [...installedIds]];
    }
    case 'text': {
      if (!query.text?.trim()) return null;
      const raw = query.text.trim();
      const normalized = normalizeArabic(raw);
      // Deux formes : `title_normalized` répond à la normalisée, `title_ar` et
      // `bibliography_text` à la brute. Les auteurs sont résolus en amont, en
      // mémoire, et arrivent par la facette `authors`.
      const terms = normalized && normalized !== raw ? [normalized, raw] : [raw];
      const match = terms.map((term) => `"${term.replaceAll('"', '')}"*`).join(' OR ');
      return [`e.edition_id IN (SELECT edition_id FROM catalog_fts WHERE catalog_fts MATCH ?)`, [match]];
    }
    default:
      return null;
  }
}

const ALL_KEYS = [
  'text',
  'categories',
  'types',
  'publishers',
  'authors',
  'centuries',
  'years',
  'status',
];

/** Contenu du `WHERE`, sans le mot-clé. `except` retire une facette. */
export function buildWhere(query, { installedIds = [] } = {}, except = null) {
  const parts = [];
  const params = [];
  for (const key of ALL_KEYS) {
    if (key === except) continue;
    const built = condition(key, query, installedIds);
    if (!built) continue;
    parts.push(`(${built[0]})`);
    params.push(...built[1]);
  }
  return { sql: parts.length ? parts.join(' AND ') : '1 = 1', params };
}

const SUMMARY_COLUMNS = `
  e.edition_id, e.work_id, e.title_ar, e.subtitle_ar, e.category_id,
  e.volume_count, e.language, e.cover_url,
  (SELECT label_ar FROM categories c WHERE c.category_id = e.category_id)  AS category_label,
  (SELECT COALESCE(a.short_name_ar, a.full_name_ar)
     FROM edition_authors ea JOIN authors a ON a.author_id = ea.author_id
    WHERE ea.edition_id = e.edition_id AND ea.role = 'author'
    ORDER BY ea.position LIMIT 1)                                          AS author_name,
  r.page_count, r.published_at, r.compressed_size`;

export function buildList(query, options = {}) {
  const where = buildWhere(query, options);
  const order = SORTS[query.sort] ?? SORTS.title;
  const limit = Math.min(Math.max(Number(query.limit) || 40, 1), MAX_LIMIT);
  const offset = Math.max(Number(query.offset) || 0, 0);
  return {
    sql: `SELECT ${SUMMARY_COLUMNS}${FROM}${where.sql} ORDER BY ${order} LIMIT ? OFFSET ?`,
    params: [...where.params, limit, offset],
  };
}

export function buildCount(query, options = {}) {
  const where = buildWhere(query, options);
  return {
    sql: `SELECT COUNT(*) AS n, COALESCE(SUM(r.compressed_size), 0) AS bytes${FROM}${where.sql}`,
    params: where.params,
  };
}

/** Compte par valeur d'une facette, son propre filtre retiré. */
export function buildFacetQuery(query, facetKey, options = {}) {
  const where = buildWhere(query, options, facetKey);
  const value = {
    categories: 'e.category_id',
    types: 'e.book_type_label',
    centuries: `(SELECT (a.death_year_hijri - 1) / 100 + 1
                   FROM edition_authors ea JOIN authors a ON a.author_id = ea.author_id
                  WHERE ea.edition_id = e.edition_id
                    AND a.death_year_hijri IS NOT NULL AND a.death_year_hijri > 0
                  ORDER BY ea.position LIMIT 1)`,
    publishers: 'e.publisher_ar',
  }[facetKey];
  if (!value) throw new Error(`facette inconnue : ${facetKey}`);
  return {
    sql: `SELECT ${value} AS value, COUNT(*) AS n${FROM}${where.sql}
          GROUP BY value HAVING value IS NOT NULL ORDER BY n DESC`,
    params: where.params,
  };
}
```

- [ ] **Step 4: Lancer, vérifier le succès**

Run: `cd beytelhikma-electron && node --test test/catalog-query.test.js`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add beytelhikma-electron/src/main/catalog-query.js beytelhikma-electron/test/catalog-query.test.js
git commit -m "feat(electron): constructeur de requêtes du catalogue, paramètres liés"
```

---

### Task 3: Exploration côté dépôt

**Files:**
- Modify: `beytelhikma-electron/src/main/book-repository.js`
- Modify: `beytelhikma-electron/test/repository.test.js`

**Interfaces:**
- Consumes: `buildList`, `buildCount`, `buildFacetQuery`, `FACETS` (tâche 2) ; `normalizeArabic` (tâche 1).
- Produces:
  - `exploreBooks(query) -> Promise<{ books, total, bytes }>`
  - `getFacets(query) -> Promise<{ categories, types, centuries, status, publishers }>` — chaque entrée est un tableau `{ value, label, count }`.
  - `suggestValues(facetKey, term) -> Promise<{ value, label, count }[]>` pour `'authors'` et `'publishers'`.
  - `getSelectionWeight(editionIds) -> Promise<{ count, bytes }>`
  - `downloadSelection(editionIds) -> Promise<number>` — nombre réellement mis en file.

- [ ] **Step 1: Écrire les tests**

Ajouter à `beytelhikma-electron/test/repository.test.js` :

```js
test('l’exploration sans filtre renvoie tout le catalogue', async () => {
  const { books, total } = await repository.exploreBooks({});
  assert.equal(total, 5);
  assert.equal(books.length, 5);
  assert.ok(books.every((book) => 'downloadStatus' in book));
});

test('les filtres se combinent en ET, leurs valeurs en OU', async () => {
  const categories = await repository.getCategories();
  const [first, second] = categories.filter((c) => c.bookCount > 0);
  const one = await repository.exploreBooks({ categories: [first.categoryId] });
  const two = await repository.exploreBooks({
    categories: [first.categoryId, second.categoryId],
  });
  assert.equal(one.total, first.bookCount);
  assert.equal(two.total, first.bookCount + second.bookCount);
});

test('le filtre de statut s’appuie sur les livres réellement installés', async () => {
  const installed = await repository.exploreBooks({ status: 'installed' });
  const missing = await repository.exploreBooks({ status: 'missing' });
  assert.equal(installed.total, database.installedBooks().length);
  assert.equal(installed.total + missing.total, 5);
});

test('le compteur d’une facette ignore son propre filtre', async () => {
  const categories = await repository.getCategories();
  const target = categories.find((c) => c.bookCount > 0);
  const facets = await repository.getFacets({ categories: [target.categoryId] });
  // Les catégories non choisies gardent un compte non nul : on peut en ajouter.
  const others = facets.categories.filter((entry) => entry.value !== target.categoryId);
  assert.ok(others.some((entry) => entry.count > 0), 'les sœurs ne tombent pas à zéro');
  // Alors que le type, lui, est bien restreint à la catégorie choisie.
  const typeTotal = facets.types.reduce((sum, entry) => sum + entry.count, 0);
  assert.equal(typeTotal, target.bookCount);
});

test('la recherche trouve avec et sans diacritiques', async () => {
  const withMarks = await repository.exploreBooks({ text: 'مقدمة' });
  assert.ok(withMarks.total >= 1);
  const bare = await repository.exploreBooks({ text: 'مقدمه' });
  assert.equal(bare.total, withMarks.total);
});

test('l’autocomplétion des auteurs ignore la forme de la hamza', async () => {
  const authors = await repository.getAuthors();
  const target = authors[0];
  const term = target.fullName.slice(0, 4);
  const suggestions = await repository.suggestValues('authors', term);
  assert.ok(suggestions.some((entry) => entry.value === target.authorId));
  assert.ok(suggestions.every((entry) => entry.count >= 1));
});

test('la sélection se pèse et se met en file, sans les déjà installés', async () => {
  const missing = await repository.exploreBooks({ status: 'missing' });
  const ids = missing.books.map((book) => book.editionId);
  const weight = await repository.getSelectionWeight(ids);
  assert.equal(weight.count, ids.length);

  const queued = await repository.downloadSelection(ids);
  assert.equal(queued, ids.length);
  await new Promise((resolve) => repository.downloads.once('idle', resolve));
  assert.equal((await repository.exploreBooks({ status: 'missing' })).total, 0);
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `cd beytelhikma-electron && node --test test/repository.test.js`
Expected: FAIL — `repository.exploreBooks is not a function`

- [ ] **Step 3: Implémenter**

Dans `book-repository.js`, ajouter aux imports :

```js
import { buildCount, buildFacetQuery, buildList } from './catalog-query.js';
import { normalizeArabic } from '../shared/arabic.js';
```

Ajouter un champ privé `#nameIndex = null;` puis, dans une section `// ------- exploration` :

```js
  /** Identifiants des livres installés, pour le filtre de statut. */
  async #installedIds() {
    const user = await this.#db.user();
    return all(
      user,
      "SELECT edition_id FROM downloaded_books WHERE download_status = 'installed'",
    ).map((row) => row.edition_id);
  }

  /**
   * Index mémoire des noms d'auteurs et d'éditeurs, normalisés.
   * `authors.full_name_ar` et `editions.publisher_ar` ne le sont pas en base et
   * le schéma ne bouge pas : un `LIKE` manquerait toute variante de hamza.
   * Quelques milliers de chaînes, construites une fois par session.
   */
  async #names() {
    if (this.#nameIndex) return this.#nameIndex;
    const catalog = await this.#db.catalog();
    const authors = all(
      catalog,
      `SELECT a.author_id, COALESCE(a.short_name_ar, a.full_name_ar) AS label,
              a.full_name_ar, COUNT(DISTINCT e.edition_id) AS n
         FROM authors a
         JOIN edition_authors ea ON ea.author_id = a.author_id
         JOIN editions e         ON e.edition_id = ea.edition_id AND e.is_hidden = 0
        GROUP BY a.author_id`,
    ).map((row) => ({
      value: row.author_id,
      label: row.label,
      count: row.n,
      needle: normalizeArabic(`${row.full_name_ar} ${row.label}`),
    }));

    const publishers = all(
      catalog,
      `SELECT publisher_ar AS label, COUNT(*) AS n FROM editions
        WHERE is_hidden = 0 AND publisher_ar IS NOT NULL AND publisher_ar <> ''
        GROUP BY publisher_ar`,
    ).map((row) => ({
      value: row.label,
      label: row.label,
      count: row.n,
      needle: normalizeArabic(row.label),
    }));

    this.#nameIndex = { authors, publishers };
    return this.#nameIndex;
  }

  exploreBooks(query = {}) {
    return this.#guard('exploration du catalogue', async () => {
      const db = await this.#db.catalog();
      const options = { installedIds: await this.#installedIds() };
      const resolved = await this.#resolveText(query);
      const list = buildList(resolved, options);
      const count = buildCount(resolved, options);
      const books = await this.#withDownloadStatus(all(db, list.sql, list.params).map(bookSummary));
      const totals = first(db, count.sql, count.params) ?? { n: 0, bytes: 0 };
      return { books, total: totals.n, bytes: totals.bytes };
    });
  }

  /**
   * Une recherche texte porte aussi sur les auteurs, que `catalog_fts`
   * n'indexe pas sous forme normalisée. On résout les auteurs en mémoire et on
   * les ajoute à la facette correspondante.
   */
  async #resolveText(query) {
    if (!query.text?.trim()) return query;
    const { authors } = await this.#names();
    const needle = normalizeArabic(query.text);
    const matched = authors.filter((entry) => entry.needle.includes(needle)).map((e) => e.value);
    if (!matched.length) return query;
    return { ...query, authors: [...new Set([...(query.authors ?? []), ...matched])] };
  }

  getFacets(query = {}) {
    return this.#guard('lecture des facettes', async () => {
      const db = await this.#db.catalog();
      const installedIds = await this.#installedIds();
      const options = { installedIds };
      const resolved = await this.#resolveText(query);

      const labelsById = new Map(
        all(db, 'SELECT category_id, label_ar FROM categories').map((r) => [
          r.category_id,
          r.label_ar,
        ]),
      );
      const facet = (key, label) => {
        const built = buildFacetQuery(resolved, key, options);
        return all(db, built.sql, built.params).map((row) => ({
          value: row.value,
          label: label(row.value),
          count: row.n,
        }));
      };

      // Le statut se compte à part : ses deux valeurs ne sortent pas d'un GROUP BY.
      const withoutStatus = { ...resolved, status: null };
      const installedCount = first(
        db,
        buildCount({ ...withoutStatus, status: 'installed' }, options).sql,
        buildCount({ ...withoutStatus, status: 'installed' }, options).params,
      );
      const missingCount = first(
        db,
        buildCount({ ...withoutStatus, status: 'missing' }, options).sql,
        buildCount({ ...withoutStatus, status: 'missing' }, options).params,
      );

      return {
        categories: facet('categories', (id) => labelsById.get(id) ?? String(id)),
        types: facet('types', (value) => value),
        centuries: facet('centuries', (value) => `القرن ${value}`),
        publishers: facet('publishers', (value) => value).slice(0, 30),
        status: [
          { value: 'installed', label: 'مُنزَّل', count: installedCount?.n ?? 0 },
          { value: 'missing', label: 'غير مُنزَّل', count: missingCount?.n ?? 0 },
        ],
      };
    });
  }

  suggestValues(facetKey, term) {
    return this.#guard('suggestion de valeurs', async () => {
      const index = await this.#names();
      const list = index[facetKey];
      if (!list) throw new Error(`facette sans suggestions : ${facetKey}`);
      const needle = normalizeArabic(term ?? '');
      if (needle.length < 2) return [];
      return list
        .filter((entry) => entry.needle.includes(needle))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20)
        .map(({ value, label, count }) => ({ value, label, count }));
    });
  }

  getSelectionWeight(editionIds = []) {
    return this.#guard('pesée de la sélection', async () => {
      if (!editionIds.length) return { count: 0, bytes: 0 };
      const installed = new Set(await this.#installedIds());
      const pending = editionIds.filter((id) => !installed.has(id));
      if (!pending.length) return { count: 0, bytes: 0 };
      const db = await this.#db.catalog();
      const row = first(
        db,
        `SELECT COUNT(*) AS n, COALESCE(SUM(compressed_size), 0) AS bytes
           FROM book_releases
          WHERE is_active = 1 AND edition_id IN (${pending.map(() => '?').join(',')})`,
        pending,
      );
      return { count: row?.n ?? 0, bytes: row?.bytes ?? 0 };
    });
  }

  downloadSelection(editionIds = []) {
    return this.#guard('mise en file de la sélection', async () => {
      if (!this.#downloads) throw new Error('gestionnaire de téléchargement absent');
      const installed = new Set(await this.#installedIds());
      let queued = 0;
      for (const editionId of editionIds) {
        if (installed.has(editionId)) continue;
        this.#downloads.enqueue(editionId);
        queued += 1;
      }
      return queued;
    });
  }
```

Ajouter à `REPOSITORY_METHODS` : `'exploreBooks'`, `'getFacets'`, `'suggestValues'`, `'getSelectionWeight'`, `'downloadSelection'`. Répercuter les cinq dans `METHODS` de `src/preload/preload.cjs`.

- [ ] **Step 4: Lancer, vérifier le succès**

Run: `cd beytelhikma-electron && npm test`
Expected: PASS pour toute la suite.

- [ ] **Step 5: Commit**

```bash
git add beytelhikma-electron/src/main/book-repository.js beytelhikma-electron/src/preload/preload.cjs beytelhikma-electron/test/repository.test.js
git commit -m "feat(electron): exploration, facettes, suggestions et mise en file d'une sélection"
```

---

### Task 4: Modale générique

**Files:**
- Create: `beytelhikma-electron/src/renderer/js/components/modal.js`
- Modify: `beytelhikma-electron/src/renderer/js/components/confirm-delete.js`

**Interfaces:**
- Produces: `confirmDialog({ title, message, actions }): Promise<any>` où `actions` est un tableau `{ value, label, variant }` avec `variant ∈ 'filled' | 'danger' | 'tonal'`. La première action reçoit le focus. `Échap` et le clic hors panneau résolvent `null`.

- [ ] **Step 1: Écrire la modale générique**

`beytelhikma-electron/src/renderer/js/components/modal.js` :

```js
import { h } from '../dom.js';

const CLASSES = {
  filled: 'button button--filled',
  danger: 'button button--danger',
  tonal: 'button button--tonal',
};

/**
 * Confirmation générique. Rendue en HTML, pas via `dialog.showMessageBox`, pour
 * garder la typographie arabe et le sens de lecture de l'application.
 * Résout la `value` de l'action choisie, ou `null` si l'utilisateur renonce.
 */
export function confirmDialog({ title, message, actions }) {
  return new Promise((resolve) => {
    let settle = (value) => {
      settle = () => {}; // une seule issue, quel que soit le chemin
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
      resolve(value);
    };

    const onKey = (event) => {
      if (event.key === 'Escape') settle(null);
    };

    const buttons = actions.map((action) =>
      h(
        'button',
        { class: CLASSES[action.variant] ?? CLASSES.tonal, onclick: () => settle(action.value) },
        action.label,
      ),
    );

    const backdrop = h(
      'div',
      {
        class: 'modal',
        onclick: (event) => {
          if (event.target === backdrop) settle(null);
        },
      },
      h(
        'div',
        { class: 'modal__panel', role: 'dialog', 'aria-modal': 'true' },
        h('h3', { class: 'title-md' }, title),
        message && h('p', { class: 'body-md muted' }, message),
        h(
          'div',
          { class: 'modal__actions' },
          buttons,
          h('button', { class: CLASSES.tonal, onclick: () => settle(null) }, 'إلغاء'),
        ),
      ),
    );

    document.addEventListener('keydown', onKey);
    document.body.append(backdrop);
    buttons[0]?.focus();
  });
}
```

- [ ] **Step 2: Réduire `confirm-delete.js`**

Remplacer tout le contenu par :

```js
import { confirmDialog } from './modal.js';

/**
 * Confirmation de suppression. Résout `'keep'` (garder la progression),
 * `'purge'` (tout effacer) ou `null`. Sans progression enregistrée, il n'y a
 * rien à conserver : un seul bouton, pas de choix vide à trancher.
 */
export function confirmDelete({ title, hasProgress }) {
  return confirmDialog({
    title: `حذف «${title}»؟`,
    message: hasProgress
      ? 'يمكنك حذف الملف مع الاحتفاظ بموضع قراءتك، أو حذف كل شيء نهائيًا.'
      : 'سيُحذف ملف الكتاب من جهازك.',
    actions: hasProgress
      ? [
          { value: 'keep', label: 'حذف مع الاحتفاظ بموضع القراءة', variant: 'filled' },
          { value: 'purge', label: 'حذف نهائي', variant: 'danger' },
        ]
      : [{ value: 'keep', label: 'حذف', variant: 'filled' }],
  });
}
```

- [ ] **Step 3: Vérifier que la suppression fonctionne toujours**

Run: `cd beytelhikma-electron && npm start`
Expected: sur une fiche de livre installé, `حذف` ouvre la modale ; les trois issues se comportent comme avant.

- [ ] **Step 4: Commit**

```bash
git add beytelhikma-electron/src/renderer/js/components/modal.js beytelhikma-electron/src/renderer/js/components/confirm-delete.js
git commit -m "refactor(ui): modale de confirmation générique, réutilisée par la suppression"
```

---

### Task 5: Panneau de facettes

**Files:**
- Create: `beytelhikma-electron/src/renderer/js/components/facet-panel.js`
- Modify: `beytelhikma-electron/src/renderer/styles/views.css`

**Interfaces:**
- Consumes: `repository.suggestValues` (tâche 3).
- Produces: `facetPanel({ facets, query, onChange })` → `HTMLElement`. `onChange(patch)` reçoit un fragment de requête à fusionner. `facets` est la valeur renvoyée par `getFacets`.

- [ ] **Step 1: Écrire le composant**

`beytelhikma-electron/src/renderer/js/components/facet-panel.js` :

```js
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { repository } from '../repository.js';

/** Facettes à liste de cases, dans l'ordre d'affichage. */
const LISTS = [
  ['categories', 'التخصص'],
  ['types', 'النوع'],
  ['centuries', 'القرن'],
  ['status', 'الحالة'],
];

/** Facettes à autocomplétion. */
const SUGGESTED = [
  ['authors', 'المؤلف', 'ابحث عن مؤلف…'],
  ['publishers', 'الناشر', 'ابحث عن ناشر…'],
];

export function facetPanel({ facets, query, onChange }) {
  return h(
    'aside',
    { class: 'facets' },
    LISTS.map(([key, label]) => listFacet(key, label, facets[key] ?? [], query, onChange)),
    SUGGESTED.map(([key, label, placeholder]) =>
      suggestFacet(key, label, placeholder, query, onChange),
    ),
    yearFacet(query, onChange),
  );
}

/** Le statut n'accepte qu'une valeur ; les autres facettes en acceptent plusieurs. */
function toggle(key, value, query) {
  if (key === 'status') return { status: query.status === value ? null : value };
  const current = query[key] ?? [];
  const next = current.includes(value)
    ? current.filter((item) => item !== value)
    : [...current, value];
  return { [key]: next };
}

function listFacet(key, label, entries, query, onChange) {
  if (!entries.length) return null;
  const selected = key === 'status' ? [query.status].filter(Boolean) : (query[key] ?? []);
  return h(
    'section',
    { class: 'facet' },
    h('h3', { class: 'facet__title label-md' }, label),
    h(
      'div',
      { class: 'facet__list' },
      entries.map((entry) =>
        h(
          'label',
          { class: `facet__option${entry.count === 0 ? ' is-empty' : ''}` },
          h('input', {
            type: 'checkbox',
            checked: selected.includes(entry.value),
            // Une valeur à zéro reste visible mais inutilisable : voir qu'une
            // combinaison est vide vaut mieux qu'une liste qui rétrécit.
            disabled: entry.count === 0 && !selected.includes(entry.value),
            onchange: () => onChange(toggle(key, entry.value, query)),
          }),
          h('span', { class: 'facet__label' }, entry.label),
          h('span', { class: 'facet__count label-sm muted' }, String(entry.count)),
        ),
      ),
    ),
  );
}

function suggestFacet(key, label, placeholder, query, onChange) {
  const chosen = query[key] ?? [];
  const results = h('div', { class: 'facet__suggestions' });
  let timer = null;

  const field = h('input', {
    type: 'search',
    placeholder,
    oninput: () => {
      clearTimeout(timer);
      // Antirebond : sans lui, chaque frappe déclenche une requête IPC.
      timer = setTimeout(async () => {
        const term = field.value.trim();
        const suggestions = term.length >= 2 ? await repository.suggestValues(key, term) : [];
        results.replaceChildren(
          ...suggestions
            .filter((entry) => !chosen.includes(entry.value))
            .map((entry) =>
              h(
                'button',
                {
                  class: 'facet__suggestion',
                  onclick: () => {
                    field.value = '';
                    results.replaceChildren();
                    onChange({ [key]: [...chosen, entry.value] });
                  },
                },
                h('span', {}, entry.label),
                h('span', { class: 'label-sm muted' }, String(entry.count)),
              ),
            ),
        );
      }, 200);
    },
  });

  return h(
    'section',
    { class: 'facet' },
    h('h3', { class: 'facet__title label-md' }, label),
    chosen.length > 0 &&
      h(
        'div',
        { class: 'facet__chosen' },
        chosen.map((value) =>
          h(
            'button',
            {
              class: 'chip chip--removable',
              onclick: () => onChange({ [key]: chosen.filter((item) => item !== value) }),
            },
            h('span', {}, value),
            icon('close', { size: 14 }),
          ),
        ),
      ),
    field,
    results,
  );
}

function yearFacet(query, onChange) {
  const { from = '', to = '' } = query.years ?? {};
  const emit = (patch) => {
    const years = { ...(query.years ?? {}), ...patch };
    for (const key of ['from', 'to']) {
      if (years[key] === '' || years[key] == null || Number.isNaN(years[key])) delete years[key];
    }
    onChange({ years: Object.keys(years).length ? years : null });
  };
  const box = (value, key, placeholder) =>
    h('input', {
      type: 'number',
      class: 'facet__year',
      value: String(value ?? ''),
      placeholder,
      onchange: (event) => emit({ [key]: event.target.value === '' ? null : Number(event.target.value) }),
    });

  return h(
    'section',
    { class: 'facet' },
    h('h3', { class: 'facet__title label-md' }, 'سنة النشر'),
    h('div', { class: 'facet__range' }, box(from, 'from', 'من'), box(to, 'to', 'إلى')),
  );
}
```

- [ ] **Step 2: Ajouter les styles**

Ajouter à `src/renderer/styles/views.css` :

```css
/* ------------------------------------------------------------ facettes */

.facets {
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
  width: 280px;
  flex: none;
}

.facet {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.facet__title {
  color: var(--deep-emerald);
}

.facet__list {
  display: flex;
  flex-direction: column;
  max-height: 240px;
  overflow-y: auto;
}

.facet__option {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: 4px 0;
  cursor: pointer;
}

.facet__option.is-empty {
  opacity: 0.4;
}

.facet__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.facet__chosen {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
}

.chip--removable {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
}

.facet__suggestions {
  display: flex;
  flex-direction: column;
  max-height: 200px;
  overflow-y: auto;
}

.facet__suggestion {
  display: flex;
  justify-content: space-between;
  gap: var(--space-sm);
  padding: 6px var(--space-sm);
  border-radius: var(--radius);
  cursor: pointer;
  text-align: start;
}

.facet__suggestion:hover {
  background: var(--surface-container);
}

.facet__range {
  display: flex;
  gap: var(--space-sm);
}

.facet__year {
  width: 100%;
  min-width: 0;
}
```

- [ ] **Step 3: Commit**

```bash
git add beytelhikma-electron/src/renderer/js/components/facet-panel.js beytelhikma-electron/src/renderer/styles/views.css
git commit -m "feat(ui): panneau de facettes avec compteurs et autocomplétion"
```

---

### Task 6: Écran `/explore`

**Files:**
- Create: `beytelhikma-electron/src/renderer/js/views/explore.js`
- Modify: `beytelhikma-electron/src/renderer/js/app.js`
- Modify: `beytelhikma-electron/src/renderer/js/shell.js`
- Modify: `beytelhikma-electron/src/renderer/js/components/book-card.js`
- Modify: `beytelhikma-electron/src/renderer/styles/views.css`
- Modify: `beytelhikma-electron/src/main/capture.js`

**Interfaces:**
- Consumes: `repository.exploreBooks / getFacets / getSelectionWeight / downloadSelection`, `facetPanel` (tâche 5), `confirmDialog` (tâche 4), `formatBytes` (déjà dans `download-action.js`).
- Produces: `exploreView(host, params)` conforme au routeur ; `bookCard(book, { selectable, selected, onToggle, action })`.

- [ ] **Step 1: Étendre `bookCard`**

Dans `src/renderer/js/components/book-card.js`, ajouter les options `selectable`, `selected`, `onToggle` à la signature, et, dans `book-card__media`, avant l'overlay :

```js
      selectable &&
        h('input', {
          type: 'checkbox',
          class: 'book-card__check',
          checked: selected,
          disabled: book.downloadStatus === 'installed',
          onclick: (event) => {
            event.stopPropagation();
            onToggle?.(book.editionId, event.target.checked);
          },
        }),
```

Le gestionnaire de clic de la carte devient :

```js
      onclick: (event) => {
        // En mode sélection, un clic coche : un clic ne fait jamais deux choses
        // différentes selon l'endroit où il tombe.
        if (selectable) {
          if (book.downloadStatus === 'installed') return;
          onToggle?.(book.editionId, !selected);
          return;
        }
        (onClick ?? (() => navigate(`/book/${book.editionId}`)))(event);
      },
```

Styles à ajouter dans `components.css` :

```css
.book-card__check {
  position: absolute;
  top: var(--space-sm);
  inset-inline-end: var(--space-sm);
  width: 20px;
  height: 20px;
  z-index: 2;
}
```

- [ ] **Step 2: Écrire la vue**

`beytelhikma-electron/src/renderer/js/views/explore.js` :

```js
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { onDownloadsChanged, repository } from '../repository.js';
import { renderShell } from '../shell.js';
import { bookCard } from '../components/book-card.js';
import { confirmDialog } from '../components/modal.js';
import { formatBytes } from '../components/download-action.js';
import { facetPanel } from '../components/facet-panel.js';
import { emptyView, errorView, loadingView } from '../components/states.js';

const PAGE = 40;

const SORTS = [
  ['title', 'العنوان'],
  ['recent', 'الأحدث'],
  ['pages', 'عدد الصفحات'],
  ['size', 'الحجم'],
];

/** Décode l'état depuis le fragment d'URL, pour qu'un lien soit partageable. */
function readQuery(params) {
  const raw = params.query ?? {};
  const list = (key) => (raw[key] ? raw[key].split(',').filter(Boolean) : []);
  const numbers = (key) => list(key).map(Number);
  return {
    text: raw.text ?? '',
    categories: numbers('categories'),
    types: list('types'),
    centuries: numbers('centuries'),
    authors: list('authors'),
    publishers: list('publishers'),
    years:
      raw.from || raw.to
        ? { from: raw.from ? Number(raw.from) : undefined, to: raw.to ? Number(raw.to) : undefined }
        : null,
    status: raw.status ?? null,
    sort: raw.sort ?? 'title',
  };
}

/** Réécrit le fragment sans provoquer de navigation ni de re-rendu. */
function writeQuery(query) {
  const params = new URLSearchParams();
  if (query.text) params.set('text', query.text);
  for (const key of ['categories', 'types', 'centuries', 'authors', 'publishers']) {
    if (query[key]?.length) params.set(key, query[key].join(','));
  }
  if (query.years?.from != null) params.set('from', String(query.years.from));
  if (query.years?.to != null) params.set('to', String(query.years.to));
  if (query.status) params.set('status', query.status);
  if (query.sort && query.sort !== 'title') params.set('sort', query.sort);
  const suffix = params.toString();
  history.replaceState(null, '', `#/explore${suffix ? `?${suffix}` : ''}`);
}

export function exploreView(host, params) {
  const content = renderShell(host, { active: 'explore' });
  const state = {
    query: readQuery(params),
    offset: 0,
    books: [],
    total: 0,
    facets: {},
    selecting: false,
    selection: new Set(),
    loading: true,
    error: null,
  };

  const nodes = {
    header: h('div', { class: 'explore__header' }),
    chips: h('div', { class: 'explore__chips' }),
    body: h('div', { class: 'explore__body' }),
  };
  content.append(h('section', { class: 'explore' }, nodes.header, nodes.chips, nodes.body));

  let token = 0;

  async function load({ append = false } = {}) {
    const mine = ++token;
    state.loading = true;
    if (!append) state.offset = 0;
    draw();
    try {
      const [page, facets] = await Promise.all([
        repository.exploreBooks({ ...state.query, offset: state.offset, limit: PAGE }),
        repository.getFacets(state.query),
      ]);
      if (mine !== token) return; // une requête plus récente a pris la main
      state.books = append ? [...state.books, ...page.books] : page.books;
      state.total = page.total;
      state.facets = facets;
      state.error = null;
    } catch (error) {
      if (mine !== token) return;
      state.error = error;
    } finally {
      if (mine === token) {
        state.loading = false;
        draw();
      }
    }
  }

  function update(patch) {
    state.query = { ...state.query, ...patch };
    writeQuery(state.query);
    load();
  }

  const unsubscribe = onDownloadsChanged(() => {
    if (!content.isConnected) {
      unsubscribe();
      return;
    }
    load();
  });

  function draw() {
    nodes.header.replaceChildren(...header());
    nodes.chips.replaceChildren(...chips());
    nodes.body.replaceChildren(
      facetPanel({ facets: state.facets, query: state.query, onChange: update }),
      results(),
    );
  }

  function header() {
    const field = h('input', {
      type: 'search',
      class: 'explore__search',
      value: state.query.text,
      placeholder: 'ابحث في العناوين والمؤلفين…',
      oninput: debounce((event) => update({ text: event.target.value }), 250),
    });
    return [
      h(
        'div',
        {},
        h('h1', { class: 'display-lg' }, 'الاستكشاف'),
        h('p', { class: 'body-md muted' }, `${state.total} نتيجة`),
      ),
      field,
      h(
        'select',
        {
          class: 'explore__sort',
          onchange: (event) => update({ sort: event.target.value }),
        },
        SORTS.map(([value, label]) =>
          h('option', { value, selected: state.query.sort === value }, label),
        ),
      ),
    ];
  }

  function activeFilters() {
    const out = [];
    const labelOf = (key, value) =>
      state.facets[key]?.find((entry) => entry.value === value)?.label ?? String(value);
    for (const key of ['categories', 'types', 'centuries', 'authors', 'publishers']) {
      for (const value of state.query[key] ?? []) {
        out.push({ key, value, label: labelOf(key, value) });
      }
    }
    if (state.query.status) {
      out.push({ key: 'status', value: state.query.status, label: labelOf('status', state.query.status) });
    }
    if (state.query.years) out.push({ key: 'years', value: null, label: 'سنة النشر' });
    return out;
  }

  function chips() {
    const active = activeFilters();
    const nodes = active.map((filter) =>
      h(
        'button',
        {
          class: 'chip chip--removable',
          onclick: () =>
            update(
              filter.key === 'status' || filter.key === 'years'
                ? { [filter.key]: null }
                : { [filter.key]: state.query[filter.key].filter((v) => v !== filter.value) },
            ),
        },
        h('span', {}, filter.label),
        icon('close', { size: 14 }),
      ),
    );
    if (active.length) {
      nodes.push(
        h(
          'button',
          {
            class: 'button button--tonal',
            onclick: () =>
              update({
                categories: [],
                types: [],
                centuries: [],
                authors: [],
                publishers: [],
                years: null,
                status: null,
              }),
          },
          'مسح الكل',
        ),
      );
    }
    nodes.push(state.selecting ? selectionBar() : selectButton());
    return nodes;
  }

  function selectButton() {
    return h(
      'button',
      {
        class: 'button button--tonal explore__select',
        onclick: () => {
          state.selecting = true;
          draw();
        },
      },
      icon('check', { size: 18 }),
      h('span', {}, 'تحديد'),
    );
  }

  function selectionBar() {
    const weight = h('span', { class: 'label-md' }, `${state.selection.size} محدد`);
    // Le poids demande une requête : on l'affiche dès qu'elle répond.
    repository.getSelectionWeight([...state.selection]).then(({ count, bytes }) => {
      if (weight.isConnected) weight.textContent = `${count} محدد • ${formatBytes(bytes) || '0 ك.ب'}`;
    });

    return h(
      'div',
      { class: 'explore__selection' },
      weight,
      h(
        'button',
        {
          class: 'button button--tonal',
          onclick: () => {
            for (const book of state.books) {
              if (book.downloadStatus !== 'installed') state.selection.add(book.editionId);
            }
            draw();
          },
        },
        'تحديد كل الصفحة',
      ),
      h(
        'button',
        {
          class: 'button button--filled',
          disabled: state.selection.size === 0,
          onclick: () => downloadSelection(),
        },
        icon('download', { size: 18 }),
        h('span', {}, 'تنزيل المحدد'),
      ),
      h(
        'button',
        {
          class: 'button button--tonal',
          onclick: () => {
            state.selecting = false;
            state.selection.clear();
            draw();
          },
        },
        'إلغاء',
      ),
    );
  }

  async function downloadSelection() {
    const ids = [...state.selection];
    const { count, bytes } = await repository.getSelectionWeight(ids);
    const choice = await confirmDialog({
      title: `تنزيل ${count} كتابًا؟`,
      message: `الحجم الإجمالي ${formatBytes(bytes) || '0 ك.ب'}.`,
      actions: [{ value: 'go', label: 'تنزيل', variant: 'filled' }],
    });
    if (choice !== 'go') return;
    await repository.downloadSelection(ids);
    state.selection.clear();
    state.selecting = false;
    load();
  }

  function results() {
    if (state.error) return errorView(state.error, () => load());
    if (state.loading && !state.books.length) return loadingView();
    if (!state.books.length) {
      return h(
        'div',
        { class: 'explore__results' },
        emptyView('لا نتائج مطابقة'),
        h(
          'button',
          {
            class: 'button button--tonal',
            onclick: () =>
              update({
                text: '',
                categories: [],
                types: [],
                centuries: [],
                authors: [],
                publishers: [],
                years: null,
                status: null,
              }),
          },
          'مسح المرشّحات',
        ),
      );
    }

    const grid = h(
      'div',
      { class: 'explore__grid' },
      state.books.map((book) =>
        bookCard(book, {
          action: 'download',
          selectable: state.selecting,
          selected: state.selection.has(book.editionId),
          onToggle: (editionId, checked) => {
            if (checked) state.selection.add(editionId);
            else state.selection.delete(editionId);
            draw();
          },
        }),
      ),
    );

    const more =
      state.books.length < state.total &&
      h(
        'button',
        {
          class: 'button button--tonal explore__more',
          onclick: () => {
            state.offset = state.books.length;
            load({ append: true });
          },
        },
        state.loading ? 'جارٍ التحميل…' : 'عرض المزيد',
      );

    return h('div', { class: 'explore__results' }, grid, more);
  }

  function debounce(fn, delay) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  load();
  return { dispose: unsubscribe };
}
```

- [ ] **Step 3: Brancher route, navigation et barre de recherche**

Dans `src/renderer/js/app.js` : importer `exploreView` et remplacer l'entrée `'/explore'` (le `placeholderView`) par `exploreView`. Supprimer le commentaire « Hors périmètre v1 » devenu faux.

Dans `src/renderer/js/shell.js`, le champ de la barre supérieure :

```js
    onkeydown: (event) => {
      if (event.key !== 'Enter') return;
      const term = field.value.trim();
      navigate(`/explore${term ? `?text=${encodeURIComponent(term)}` : ''}`);
    },
```

`toast` reste importé si d'autres appels subsistent ; sinon retirer l'import.

Dans `src/main/capture.js`, ajouter la route après `library` :

```js
    ['explore', '/explore', '.explore__grid'],
```

- [ ] **Step 4: Ajouter les styles de l'écran**

Ajouter à `src/renderer/styles/views.css` :

```css
/* --------------------------------------------------------- استكشاف */

.explore {
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
}

.explore__header {
  display: flex;
  align-items: flex-end;
  gap: var(--space-md);
  flex-wrap: wrap;
}

.explore__search {
  flex: 1;
  min-width: 240px;
  padding: 10px var(--space-md);
  border-radius: var(--radius-pill);
  border: 1px solid var(--rule);
  background: var(--surface-container-lowest);
}

.explore__chips {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-sm);
}

.explore__select {
  margin-inline-start: auto;
}

.explore__selection {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  flex-wrap: wrap;
  margin-inline-start: auto;
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-pill);
  background: var(--surface-container);
}

.explore__body {
  display: flex;
  align-items: flex-start;
  gap: var(--space-xl);
}

.explore__results {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-lg);
}

.explore__grid {
  width: 100%;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: var(--space-lg);
}

@media (max-width: 900px) {
  .explore__body {
    flex-direction: column;
  }

  .facets {
    width: 100%;
  }
}
```

- [ ] **Step 5: Vérifier**

Run: `cd beytelhikma-electron && npm test && BEYT_CAPTURE=1 npx electron .`
Expected: suite verte ; `build/screenshots/explore.png` montre la grille, le panneau de facettes et les compteurs ; aucune erreur de console dans la sortie.

- [ ] **Step 6: Commit**

```bash
git add beytelhikma-electron/src/renderer beytelhikma-electron/src/main/capture.js
git commit -m "feat(ui): écran d'exploration, filtres, sélection et mise en file du lot"
```

---

## Auto-relecture

| Section de la spec | Tâche |
| --- | --- |
| §2 Aucune modification de schéma | 2 (statut par liste), 3 (index mémoire) |
| §3 Filtres et sémantique | 2, 5 |
| §4 Compteurs de facettes | 2 (`buildFacetQuery`), 3 (`getFacets`), 5 |
| §5 Recherche et normalisation | 1, 2 (`condition('text')`), 3 (`#resolveText`) |
| §6 `catalog-query.js` | 2 |
| §7 Écran `/explore` | 6 |
| §8 Sélection et téléchargement | 3 (`downloadSelection`), 4 (modale), 6 |
| §9 Tests | 1, 2, 3 |

Aucune section sans tâche.
