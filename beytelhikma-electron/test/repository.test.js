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
