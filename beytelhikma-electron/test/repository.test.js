import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';

import { AppDatabase, USER_DB_SCHEMA_VERSION, all } from '../src/main/app-database.js';
import {
  BookRepository,
  REPOSITORY_METHODS,
  RepositoryError,
} from '../src/main/book-repository.js';

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

let storageRoot;
let database;
let repository;

before(async () => {
  storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'beytelhikma-'));
  database = new AppDatabase({
    librarySource: path.join(projectRoot, 'assets', 'sample'),
    storageRoot,
  });
  await database.initialize();
  repository = new BookRepository(database);
  repository.createDownloadQueue();
  await repository.reconcileLibrary();
  // Les cinq livres d'exemple ont une `object_key` en `asset://` : le
  // gestionnaire les installe par copie, sans réseau.
  await installAll(repository);
});

/** Installe tout le catalogue et attend la fin de la file. */
async function installAll(repo) {
  const books = await repo.getBooks({ limit: 50 });
  const queue = repo.downloads;
  for (const book of books) await repo.downloadBook(book.editionId);
  if (queue.snapshot().length) await new Promise((resolve) => queue.once('idle', resolve));
}

after(() => {
  database.close();
  fs.rmSync(storageRoot, { recursive: true, force: true });
});

test('les assets sont matérialisés dans le dossier de données', async () => {
  await repository.getCategories();
  assert.ok(fs.existsSync(path.join(storageRoot, 'catalog.sqlite')));
  assert.ok(fs.existsSync(path.join(storageRoot, 'user.sqlite')));
});

test('le catalogue expose les disciplines et les nouveautés', async () => {
  const categories = await repository.getCategories();
  assert.ok(categories.length >= 5);
  assert.ok(categories.every((category) => typeof category.label === 'string'));

  const recent = await repository.getRecentBooks({ limit: 12 });
  assert.equal(recent.length, 5);
  assert.ok(recent.every((book) => book.title && book.editionId));
});

test('la fiche livre porte auteurs, volumes et métadonnées', async () => {
  const detail = await repository.getBookDetail('ed-muqaddima-01');
  assert.equal(detail.summary.title, 'مقدمة ابن خلدون');
  assert.ok(detail.authors.length >= 1);
  assert.equal(detail.volumes.length, 1);
  assert.ok(detail.pageCount > 0);
});

test('une édition inconnue remonte une RepositoryError', async () => {
  await assert.rejects(() => repository.getBookDetail('inconnu'), RepositoryError);
});

test('le sommaire est hiérarchique et pointe des pages réelles', async () => {
  const toc = await repository.getToc('ed-muqaddima-01');
  assert.ok(toc.length >= 3);
  assert.ok(toc.some((entry) => entry.parentTocId != null));

  const page = await repository.getPageById('ed-muqaddima-01', toc[0].pageId);
  assert.ok(page.bodyHtml.includes('<p>'));
  assert.ok(page.bodyPlain.length > 0);
});

test('les pages se lisent par fenêtre, dans l’ordre', async () => {
  const pages = await repository.getPages('ed-muqaddima-01', { offset: 0, limit: 20 });
  assert.equal(pages.length, 5);
  assert.deepEqual(
    pages.map((page) => page.sequenceNum),
    [1, 2, 3, 4, 5],
  );
});

test('la progression est écrite puis relue depuis user.sqlite', async () => {
  await repository.saveProgress({
    editionId: 'ed-muqaddima-01',
    pageId: 3,
    sequenceNum: 3,
    percent: 0.6,
  });

  const progress = await repository.getProgress('ed-muqaddima-01');
  assert.equal(progress.pageId, 3);
  assert.equal(progress.percent, 0.6);

  const resume = await repository.getContinueReading();
  assert.equal(resume.book.editionId, 'ed-muqaddima-01');
  assert.equal(resume.percent, 0.6);
});

test('la progression survit à la réouverture de la base', async () => {
  database.close();
  const reopened = new AppDatabase({
    librarySource: path.join(projectRoot, 'assets', 'sample'),
    storageRoot,
  });
  await reopened.initialize();
  const progress = await new BookRepository(reopened).getProgress('ed-muqaddima-01');
  assert.equal(progress.pageId, 3);
  reopened.close();

  database = new AppDatabase({
    librarySource: path.join(projectRoot, 'assets', 'sample'),
    storageRoot,
  });
  await database.initialize();
  repository = new BookRepository(database);
  repository.createDownloadQueue();
});

test('la bibliothèque ne liste que les livres installés', async () => {
  const library = await repository.getLibrary();
  assert.equal(library.total, 5);
  assert.equal(library.counts.all, 5);
  assert.ok(library.rows.every((entry) => entry.status === 'installed'));
});

test('reconcileLibrary corrige une ligne sans fichier et un fichier sans ligne', async () => {
  // Fichier supprimé à la main sous l'application.
  database.closeBook('ed-muqaddima-01');
  fs.rmSync(path.join(storageRoot, 'books', 'ed-muqaddima-01.sqlite'));
  await repository.reconcileLibrary();
  let library = await repository.getLibrary();
  assert.equal(
    library.rows.some((entry) => entry.book.editionId === 'ed-muqaddima-01'),
    false,
  );

  // Fichier reposé à la main : la réconciliation le réintègre.
  fs.copyFileSync(
    path.join(projectRoot, 'assets', 'sample', 'books', 'ed-muqaddima-01.sqlite'),
    path.join(storageRoot, 'books', 'ed-muqaddima-01.sqlite'),
  );
  await repository.reconcileLibrary();
  library = await repository.getLibrary();
  assert.ok(library.rows.some((entry) => entry.book.editionId === 'ed-muqaddima-01'));
});

test('les résumés portent le statut de téléchargement', async () => {
  const books = await repository.getBooks({ limit: 50 });
  const installed = books.filter((book) => book.downloadStatus === 'installed');
  assert.ok(installed.length >= 1);
  assert.ok(books.every((book) => 'downloadStatus' in book));
});

test('la fiche livre porte l’état de téléchargement et la taille', async () => {
  const detail = await repository.getBookDetail('ed-muqaddima-01');
  assert.equal(detail.download.status, 'installed');
  assert.ok(detail.download.compressedSize > 0);
  assert.ok(detail.download.releaseId);
});

test('l’espace occupé compte les fichiers réellement présents', async () => {
  const usage = await repository.getStorageUsage();
  assert.equal(usage.bookCount, database.installedBooks().length);
  assert.ok(usage.bytes > 0);
});

test('supprimer en gardant la progression efface le fichier, pas la position', async () => {
  await repository.saveProgress({
    editionId: 'ed-risala-01',
    pageId: 2,
    sequenceNum: 2,
    percent: 0.4,
  });

  await repository.deleteBook('ed-risala-01', { keepProgress: true });

  assert.equal(fs.existsSync(path.join(storageRoot, 'books', 'ed-risala-01.sqlite')), false);
  const library = await repository.getLibrary();
  assert.equal(
    library.rows.some((entry) => entry.book.editionId === 'ed-risala-01'),
    false,
  );

  const progress = await repository.getProgress('ed-risala-01');
  assert.equal(progress.pageId, 2);
  assert.equal(progress.percent, 0.4);

  // Réinstallation : la position est retrouvée telle quelle.
  await repository.downloadBook('ed-risala-01');
  await new Promise((resolve) => repository.downloads.once('idle', resolve));
  assert.equal((await repository.getProgress('ed-risala-01')).pageId, 2);
});

test('supprimer totalement efface aussi la progression', async () => {
  await repository.saveProgress({
    editionId: 'ed-risala-01',
    pageId: 3,
    sequenceNum: 3,
    percent: 0.7,
  });

  await repository.deleteBook('ed-risala-01', { keepProgress: false });

  assert.equal(await repository.getProgress('ed-risala-01'), null);
  const user = await database.user();
  assert.equal(
    all(user, 'SELECT edition_id FROM downloaded_books WHERE edition_id = ?', ['ed-risala-01'])
      .length,
    0,
  );
});

test('l’exploration sans filtre renvoie tout le catalogue', async () => {
  const { books, total } = await repository.exploreBooks({});
  assert.equal(total, 5);
  assert.equal(books.length, 5);
  assert.ok(books.every((book) => 'downloadStatus' in book));
});

test('les filtres se combinent en ET, leurs valeurs en OU', async () => {
  const categories = (await repository.getCategories()).filter((c) => c.bookCount > 0);
  const [first, second] = categories;
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
  const categories = (await repository.getCategories()).filter((c) => c.bookCount > 0);
  const target = categories[0];
  const facets = await repository.getFacets({ categories: [target.categoryId] });

  // Les catégories non choisies gardent un compte non nul : on peut en ajouter.
  const others = facets.categories.filter((entry) => entry.value !== target.categoryId);
  assert.ok(
    others.some((entry) => entry.count > 0),
    'les sœurs ne tombent pas à zéro',
  );
  // Le type, lui, est bien restreint à la catégorie choisie.
  const typeTotal = facets.types.reduce((sum, entry) => sum + entry.count, 0);
  assert.equal(typeTotal, target.bookCount);
});

test('la recherche trouve avec et sans diacritiques', async () => {
  const withMarks = await repository.exploreBooks({ text: 'مقدمة' });
  assert.ok(withMarks.total >= 1);
  const bare = await repository.exploreBooks({ text: 'مقدمه' });
  assert.equal(bare.total, withMarks.total);
});

test('l’autocomplétion des auteurs cherche sur le nom normalisé', async () => {
  const { rows: authors } = await repository.getAuthors();
  const target = authors[0];
  const suggestions = await repository.suggestValues('authors', target.fullName.slice(0, 4));
  assert.ok(suggestions.some((entry) => entry.value === target.authorId));
  assert.ok(suggestions.every((entry) => entry.count >= 1));
  assert.deepEqual(await repository.suggestValues('authors', 'ا'), [], 'moins de 2 caractères');
});

test('la sélection se pèse et se met en file, sans les déjà installés', async () => {
  await repository.deleteBook('ed-muqaddima-01', { keepProgress: true });
  const missing = await repository.exploreBooks({ status: 'missing' });
  assert.ok(missing.total >= 1);

  const ids = missing.books.map((book) => book.editionId);
  const weight = await repository.getSelectionWeight(ids);
  assert.equal(weight.count, ids.length);
  assert.ok(weight.bytes > 0);

  const queued = await repository.downloadSelection(ids);
  assert.equal(queued, ids.length);
  await new Promise((resolve) => repository.downloads.once('idle', resolve));
  assert.equal((await repository.exploreBooks({ status: 'missing' })).total, 0);
});

test('les réglages du lecteur sont persistés', async () => {
  await repository.saveSetting('reader.fontSize', '26');
  await repository.saveSetting('reader.theme', 'night');
  const settings = await repository.getSettings();
  assert.equal(settings['reader.fontSize'], '26');
  assert.equal(settings['reader.theme'], 'night');
});

// --------------------------------------------------- recherche dans le livre

test('la recherche interne trouve avec et sans diacritiques', async () => {
  const page = await repository.getPageById('ed-muqaddima-01', 1);
  const word = page.bodyPlain.split(/\s+/).find((token) => token.length >= 4);

  const found = await repository.searchInBook('ed-muqaddima-01', word);
  assert.ok(found.pages.length >= 1, `aucun résultat pour « ${word} »`);
  const [hit] = found.pages;
  assert.ok(hit.snippet.match.length > 0, "l'extrait doit porter la correspondance");
  assert.ok(typeof hit.sequenceNum === 'number');
});

test('un terme trop court ne cherche rien', async () => {
  const found = await repository.searchInBook('ed-muqaddima-01', 'ا');
  assert.deepEqual(found.pages, []);
  assert.deepEqual(found.chapters, []);
});

test('un joker LIKE ne ramène pas tout le livre', async () => {
  const found = await repository.searchInBook('ed-muqaddima-01', '%%');
  assert.deepEqual(found.pages, [], 'les % doivent être échappés, pas interprétés');
});

test('la recherche interne remonte aussi les titres du sommaire', async () => {
  const toc = await repository.getToc('ed-muqaddima-01');
  const word = toc[0].title.split(/\s+/).find((token) => token.length >= 3) ?? toc[0].title;
  const found = await repository.searchInBook('ed-muqaddima-01', word);
  assert.ok(found.chapters.length >= 1);
  assert.ok(found.chapters.every((entry) => typeof entry.pageId === 'number'));
});

// ---------------------------------------------------------------- collections

test('une collection se crée, se remplit et se vide sans toucher aux livres', async () => {
  const id = await repository.createCollection('  أصول الفقه  ');
  let collections = await repository.getCollections();
  const created = collections.find((entry) => entry.id === id);
  assert.equal(created.name, 'أصول الفقه', 'le nom est rogné');
  assert.equal(created.bookCount, 0);

  const books = await repository.getBooks({ limit: 3 });
  const ids = books.map((book) => book.editionId);
  assert.equal(await repository.addToCollection(id, ids), 3);
  assert.equal(await repository.addToCollection(id, ids), 0, 'aucun doublon');

  const content = await repository.getCollectionBooks(id);
  assert.equal(content.total, 3);
  assert.deepEqual(
    content.rows.map((book) => book.editionId),
    ids,
    "l'ordre de la collection est conservé",
  );
  assert.ok(content.rows.every((book) => 'downloadStatus' in book));

  collections = await repository.getCollections();
  assert.equal(collections.find((entry) => entry.id === id).bookCount, 3);

  await repository.removeFromCollection(id, ids[0]);
  assert.equal((await repository.getCollectionBooks(id)).total, 2);

  await repository.renameCollection(id, 'مراجع');
  assert.equal((await repository.getCollections()).find((e) => e.id === id).name, 'مراجع');

  await repository.deleteCollection(id);
  assert.equal(
    (await repository.getCollections()).some((entry) => entry.id === id),
    false,
  );
  // Les livres n'ont pas bougé.
  assert.equal((await repository.getLibrary()).total, 5);
});

test('une collection refuse un nom vide', async () => {
  await assert.rejects(() => repository.createCollection('   '), RepositoryError);
});

// ------------------------------------------------------------------ réglages

test('l’adresse du serveur est persistée et appliquée à la file', async () => {
  await repository.setDownloadBaseUrl('http://127.0.0.1:9000/beytelhikma');
  const settings = await repository.getSettings();
  assert.equal(settings['distribution.base_url'], 'http://127.0.0.1:9000/beytelhikma');
  await repository.setDownloadBaseUrl('');
  assert.equal((await repository.getSettings())['distribution.base_url'], '');
});

test('une source injoignable ne propose rien et ne lève pas', async () => {
  // C'est la propriété qui compte : hors ligne, l'application se tait. Elle a
  // déjà tout ce qu'il lui faut pour explorer.
  await repository.setDownloadBaseUrl('http://127.0.0.1:1/');
  try {
    const verdict = await repository.checkCatalogUpdate();
    assert.equal(verdict.action, 'none');
    assert.equal(verdict.pointer, null);
  } finally {
    await repository.setDownloadBaseUrl('');
  }
});

test('un refus est retenu par version, pas une fois pour toutes', async () => {
  await repository.declineCatalogUpdate(7);
  assert.equal((await repository.getSettings())['distribution.declined_catalog_version'], '7');
  await repository.declineCatalogUpdate(8);
  assert.equal((await repository.getSettings())['distribution.declined_catalog_version'], '8');
});

test('les informations d’application décrivent la bibliothèque installée', async () => {
  const about = await repository.getAbout();
  assert.equal(about.editionCount, 5);
  assert.ok(about.categoryCount >= 5);
  assert.equal(about.schemaVersion, USER_DB_SCHEMA_VERSION);
  assert.ok(about.librarySource.endsWith('sample'));
});

test('deleteAllBooks vide le dossier et conserve les progressions', async () => {
  await repository.saveProgress({
    editionId: 'ed-muqaddima-01',
    pageId: 4,
    sequenceNum: 4,
    percent: 0.8,
  });

  const removed = await repository.deleteAllBooks();
  assert.ok(removed >= 1);
  assert.deepEqual(database.installedBooks(), []);
  assert.equal((await repository.getLibrary()).total, 0);
  assert.equal((await repository.getProgress('ed-muqaddima-01')).pageId, 4);
});

test('les auteurs sont listés du plus au moins représenté', async () => {
  const { rows: authors, total } = await repository.getAuthors();
  assert.ok(authors.length >= 1);
  assert.equal(total, authors.length, 'le total porte sur tout le fonds');
  for (const item of authors) {
    assert.ok(item.fullName);
    assert.ok(item.bookCount >= 1);
  }
  const counts = authors.map((item) => item.bookCount);
  assert.deepEqual(counts, [...counts].sort((a, b) => b - a));
});

test('les siècles se déduisent du décès des auteurs', async () => {
  const eras = await repository.getEras();
  assert.ok(eras.length >= 1);
  for (const era of eras) {
    assert.ok(era.century >= 1 && era.century <= 15, `siècle hors bornes : ${era.century}`);
    assert.ok(era.bookCount >= 1);
    const books = await repository.getBooksByCentury(era.century);
    assert.equal(books.length, era.bookCount);
  }
});

test('les disciplines principales comptent tout le fonds, pas la page rendue', async () => {
  const peupled = (await repository.getCategories()).filter((item) => item.bookCount > 0);

  const page = await repository.getTopCategories({ limit: 2, sample: 3 });
  assert.equal(page.rows.length, 2);
  assert.equal(page.total, peupled.length, 'le total vient de SQL, jamais de rows.length');
  assert.ok(page.total > page.rows.length, "l'accueil doit pouvoir annoncer ce qu'il ne montre pas");

  const counts = page.rows.map((row) => row.bookCount);
  assert.deepEqual(counts, [...counts].sort((a, b) => b - a), 'un top se trie par volume');

  for (const row of page.rows) {
    assert.ok(row.share > 0 && row.share <= 1);
    assert.ok(row.books.length <= 3, "l'échantillon est plafonné");
    assert.ok(row.books.length >= 1);
    for (const book of row.books) {
      assert.equal(book.categoryId, row.categoryId);
      // Les trois canaux de la couverture composée doivent être projetés :
      // sans eux les vignettes tomberaient toutes sur le même repli.
      assert.ok('bookType' in book && 'authorDeathYear' in book && 'categoryLabel' in book);
    }
  }
});

test('ce que la frise ne sait pas dater reste atteignable', async () => {
  const undated = await repository.getUndatedCount();
  const list = await repository.getBooksIn({ scope: 'undated' });
  assert.equal(list.total, undated, 'le compte affiché et la liste viennent du même SQL');
  for (const book of list.rows) assert.equal(book.authorDeathYear, null);

  // Le corpus se partage entre siècles et non datés : la somme des siècles peut
  // dépasser le fonds (une édition à deux auteurs compte deux fois), mais un
  // livre non daté n'apparaît dans aucun siècle.
  const eras = await repository.getEras();
  const dated = eras.reduce((sum, era) => sum + era.bookCount, 0);
  const all = await repository.getBooks({ limit: 500 });
  assert.ok(dated + undated >= all.length);
});

test("l'auteur en vedette a des œuvres", async () => {
  const author = await repository.getFeaturedAuthor();
  assert.ok(author.fullName);
  const books = await repository.getBooksByAuthor(author.authorId, { limit: 3 });
  assert.ok(books.length >= 1);
});

test('les auteurs se paginent, se trient et se cherchent sans mentir sur le total', async () => {
  const first = await repository.getAuthors({ limit: 1 });
  assert.equal(first.rows.length, 1);
  assert.ok(first.total > 1, 'le total porte sur tout le fonds, pas sur la page');

  const second = await repository.getAuthors({ limit: 1, offset: 1 });
  assert.equal(second.total, first.total, 'le total ne bouge pas avec la page');
  assert.notEqual(second.rows[0].authorId, first.rows[0].authorId);

  // Le tri alphabétique replie les hamzas portées, comme `normalize_ar` : sans
  // cela « أ » se rangerait avant « ا » et l'index paraîtrait désordonné.
  const byName = await repository.getAuthors({ limit: 100, sort: 'name' });
  const folded = byName.rows.map((item) =>
    (item.shortName ?? item.fullName).replace(/[أإآ]/g, 'ا'),
  );
  assert.deepEqual(folded, [...folded].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));

  const byDeath = await repository.getAuthors({ limit: 100, sort: 'death' });
  const years = byDeath.rows.map((item) => item.deathYearHijri).filter(Boolean);
  assert.deepEqual(years, [...years].sort((a, b) => a - b));

  // La recherche passe par le nom normalisé : avec ou sans diacritiques.
  const target = first.rows[0];
  const found = await repository.getAuthors({ text: target.fullName.slice(0, 4) });
  assert.ok(found.rows.some((item) => item.authorId === target.authorId));
  assert.equal(found.total, found.rows.length);

  assert.deepEqual(await repository.getAuthors({ text: 'zzzz' }), { rows: [], total: 0 });
});

test('le décompte des auteurs est compté en SQL, pas déduit d’une page', async () => {
  const stats = await repository.getAuthorStats();
  const everyone = await repository.getAuthors({ limit: 1000 });
  assert.equal(stats.authorCount, everyone.total);
  assert.ok(stats.bookCount >= stats.authorCount);
  if (stats.firstCentury != null) {
    assert.ok(stats.firstCentury <= stats.lastCentury);
  }
});

test('getBooksIn pagine les trois listes et compte tout le lot', async () => {
  const author = await repository.getFeaturedAuthor();
  const byAuthor = await repository.getBooksIn({ scope: 'author', id: author.authorId });
  assert.ok(byAuthor.total >= 1);
  assert.equal(byAuthor.label, author.shortName ?? author.fullName);
  assert.ok(byAuthor.rows.every((book) => 'downloadStatus' in book));

  // Une page d'un seul livre ne change pas le total annoncé.
  const narrow = await repository.getBooksIn({
    scope: 'author',
    id: author.authorId,
    limit: 1,
  });
  assert.equal(narrow.rows.length, Math.min(1, byAuthor.total));
  assert.equal(narrow.total, byAuthor.total);

  const [category] = (await repository.getCategories()).filter((item) => item.bookCount > 0);
  const byCategory = await repository.getBooksIn({ scope: 'category', id: category.categoryId });
  assert.equal(byCategory.total, category.bookCount);
  assert.equal(byCategory.label, category.label);

  const [era] = await repository.getEras();
  const byEra = await repository.getBooksIn({ scope: 'era', id: era.century });
  assert.equal(byEra.total, era.bookCount);
  assert.equal(byEra.label, null, 'un siècle se nomme dans la vue, pas en base');

  await assert.rejects(() => repository.getBooksIn({ scope: 'nimportequoi', id: 1 }));
});

test('la bibliothèque se filtre, se trie et se pagine côté dépôt', async () => {
  // Les tests précédents ont vidé la bibliothèque : on la repose.
  await installAll(repository);
  await repository.saveProgress({
    editionId: 'ed-muqaddima-01',
    pageId: 3,
    sequenceNum: 3,
    percent: 0.5,
  });
  await repository.saveProgress({
    editionId: 'ed-bukhari-01',
    pageId: 4,
    sequenceNum: 4,
    percent: 1,
  });
  // `saveProgress` accepte n'importe quel identifiant et pose une ligne
  // « installée » : ce livre-là n'est pas au catalogue, il ne doit compter
  // dans aucun décompte — sinon la pagination promettrait des pages vides.
  await repository.saveProgress({
    editionId: 'ed-fantome-01',
    pageId: 1,
    sequenceNum: 1,
    percent: 1,
  });

  const all = await repository.getLibrary();
  assert.equal(all.counts.all, 5);
  assert.equal(all.counts.reading, 1);
  assert.equal(all.counts.done, 1);

  const reading = await repository.getLibrary({ filter: 'reading' });
  assert.equal(reading.total, 1);
  assert.equal(reading.rows[0].book.editionId, 'ed-muqaddima-01');
  // Les décomptes restent ceux de toute la bibliothèque, sinon l'onglet qu'on
  // ne regarde pas afficherait toujours zéro.
  assert.deepEqual(reading.counts, all.counts);

  const page = await repository.getLibrary({ limit: 2 });
  assert.equal(page.rows.length, 2);
  assert.equal(page.total, 5);
  const next = await repository.getLibrary({ limit: 2, offset: 2 });
  assert.ok(
    next.rows.every(
      (entry) => !page.rows.some((other) => other.book.editionId === entry.book.editionId),
    ),
    'pas de recouvrement entre les pages',
  );

  const byTitle = await repository.getLibrary({ sort: 'title', limit: 50 });
  const titles = byTitle.rows.map((entry) => entry.book.title);
  assert.deepEqual(titles, [...titles].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
});

test('une collection paginée annonce tout son contenu et ce qui manque', async () => {
  await installAll(repository);
  const id = await repository.createCollection('كل شيء');
  const books = await repository.getBooks({ limit: 5 });
  await repository.addToCollection(id, books.map((book) => book.editionId));

  const page = await repository.getCollectionBooks(id, { limit: 2 });
  assert.equal(page.rows.length, 2);
  assert.equal(page.total, 5);

  // `missing` porte sur toute la collection : « télécharger le reste » ne peut
  // pas ne proposer que ce qui tient dans la page affichée.
  await repository.deleteBook(books[4].editionId, { keepProgress: true });
  const after = await repository.getCollectionBooks(id, { limit: 2 });
  assert.deepEqual(after.missing, [books[4].editionId]);

  await repository.deleteCollection(id);
});

test('les deux listes de méthodes exposées ne peuvent pas diverger', async () => {
  // `preload.cjs` décide ce que le rendu peut appeler, `REPOSITORY_METHODS` ce
  // que le principal accepte. Une méthode ajoutée d'un seul côté ne casse rien
  // au démarrage : elle échoue au premier clic, ce que personne ne voit venir.
  const preload = fs.readFileSync(
    path.join(projectRoot, 'src', 'preload', 'preload.cjs'),
    'utf8',
  );
  const declared = [...preload.matchAll(/^\s*'([a-zA-Z]+)',$/gm)].map((match) => match[1]);
  assert.ok(declared.length >= 40, 'les noms sont bien lus dans le pont');

  assert.deepEqual(
    declared.filter((name) => !REPOSITORY_METHODS.includes(name)),
    [],
    'exposées au rendu mais refusées par le principal',
  );
  // L'inverse est permis : `reconcileLibrary` est appelée par le principal au
  // démarrage et n'a rien à faire dans le pont. Ce qui casse, c'est une méthode
  // que le rendu croit pouvoir appeler et que le principal refuse.
  for (const name of REPOSITORY_METHODS) {
    assert.equal(typeof repository[name], 'function', `${name} n'existe pas sur le dépôt`);
  }
});

/**
 * Le catalogue nourrit deux caches de session : l'ordre alphabétique
 * (`#titleOrderCache`) et l'index des noms (`#nameIndex`). Une mise à jour de
 * catalogue doit jeter les deux.
 *
 * La panne d'origine : `installCatalogUpdate` remettait le premier à zéro et
 * oubliait le second. La recherche continuait de rendre des `edition_id`
 * disparus, et de rater les nouveaux, jusqu'au redémarrage.
 *
 * Le test est structurel — la mise à jour elle-même demande un bucket — mais il
 * porte la propriété qui compte : **une seule liste**, et elle est appelée.
 */
test('une mise à jour de catalogue jette tous les caches qui en dérivent', () => {
  const source = fs.readFileSync(
    path.join(projectRoot, 'src', 'main', 'book-repository.js'),
    'utf8',
  );

  const caches = [...source.matchAll(/^\s{2}#(\w*(?:Cache|Index))\s*=/gm)].map((m) => m[1]);
  assert.ok(caches.length >= 2, 'les champs de cache sont bien lus');

  const oubli = source.match(/#forgetCatalogCaches\(\)\s*\{([^}]*)\}/)?.[1];
  assert.ok(oubli, '#forgetCatalogCaches doit exister');
  for (const cache of caches) {
    assert.ok(oubli.includes(`#${cache} = null`), `${cache} survit à la mise à jour`);
  }

  const installe = source.match(/installCatalogUpdate\(\)\s*\{[\s\S]*?\n  \}/)?.[0];
  assert.ok(installe?.includes('#forgetCatalogCaches()'), 'la mise à jour doit les jeter');
  // Remettre un cache à zéro ailleurs, c'est rouvrir la porte : le prochain
  // cache ajouté ne serait pas dans la liste.
  assert.equal(
    installe.includes('Cache = null') || installe.includes('Index = null'),
    false,
    'aucune remise à zéro à la main hors de #forgetCatalogCaches',
  );
});
