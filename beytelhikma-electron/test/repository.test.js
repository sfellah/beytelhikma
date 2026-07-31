import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';

import { AppDatabase, all } from '../src/main/app-database.js';
import { BookRepository, RepositoryError } from '../src/main/book-repository.js';

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
  // Les cinq livres d'exemple ont une `download_url` en `asset://` : le
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
  assert.equal(library.length, 5);
  assert.ok(library.every((entry) => entry.status === 'installed'));
});

test('reconcileLibrary corrige une ligne sans fichier et un fichier sans ligne', async () => {
  // Fichier supprimé à la main sous l'application.
  database.closeBook('ed-muqaddima-01');
  fs.rmSync(path.join(storageRoot, 'books', 'ed-muqaddima-01.sqlite'));
  await repository.reconcileLibrary();
  let library = await repository.getLibrary();
  assert.equal(
    library.some((entry) => entry.book.editionId === 'ed-muqaddima-01'),
    false,
  );

  // Fichier reposé à la main : la réconciliation le réintègre.
  fs.copyFileSync(
    path.join(projectRoot, 'assets', 'sample', 'books', 'ed-muqaddima-01.sqlite'),
    path.join(storageRoot, 'books', 'ed-muqaddima-01.sqlite'),
  );
  await repository.reconcileLibrary();
  library = await repository.getLibrary();
  assert.ok(library.some((entry) => entry.book.editionId === 'ed-muqaddima-01'));
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
    library.some((entry) => entry.book.editionId === 'ed-risala-01'),
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
  const authors = await repository.getAuthors();
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

test('les auteurs sont listés du plus au moins représenté', async () => {
  const authors = await repository.getAuthors();
  assert.ok(authors.length >= 1);
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

test("l'auteur en vedette a des œuvres", async () => {
  const author = await repository.getFeaturedAuthor();
  assert.ok(author.fullName);
  const books = await repository.getBooksByAuthor(author.authorId, { limit: 3 });
  assert.ok(books.length >= 1);
});
