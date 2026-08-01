import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  AppDatabase,
  USER_DB_SCHEMA_VERSION,
  all,
  first,
} from '../src/main/app-database.js';
import { BookRepository } from '../src/main/book-repository.js';

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sampleLibrary = path.join(projectRoot, 'assets', 'sample');

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'beytelhikma-annot-'));
}

/** Dépôt prêt à l'emploi sur une racine jetable, avec [count] livres installés. */
async function open(count = 1) {
  const root = tempRoot();
  const database = new AppDatabase({ librarySource: sampleLibrary, storageRoot: root });
  await database.initialize();
  const repository = new BookRepository(database);
  repository.createDownloadQueue();
  await repository.reconcileLibrary();

  const books = await repository.getBooks({ limit: count });
  for (const book of books) await repository.downloadBook(book.editionId);
  if (count) await new Promise((resolve) => repository.downloads.once('idle', resolve));

  return {
    repository,
    database,
    books,
    dispose() {
      database.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

test('une base utilisateur de version 1 gagne les tables d\'annotations', async () => {
  const root = tempRoot();

  // Base à l'ancien schéma : les trois tables manquent, `user_version` vaut 1.
  let database = new AppDatabase({ librarySource: sampleLibrary, storageRoot: root });
  await database.initialize();
  const user = await database.user();
  for (const table of ['bookmarks', 'highlights', 'notes']) user.run(`DROP TABLE ${table}`);
  user.run('PRAGMA user_version = 1');
  user.run('UPDATE user_info SET schema_version = 1');
  fs.writeFileSync(path.join(root, 'user.sqlite'), Buffer.from(user.export()));
  database.close();

  database = new AppDatabase({ librarySource: sampleLibrary, storageRoot: root });
  try {
    await database.initialize();
    const migrated = await database.user();
    assert.equal(
      all(migrated, 'PRAGMA user_version')[0].user_version,
      USER_DB_SCHEMA_VERSION,
    );
    for (const table of ['bookmarks', 'highlights', 'notes']) {
      assert.ok(
        first(migrated, "SELECT name FROM sqlite_master WHERE type='table' AND name = ?", [table]),
        `table ${table} créée`,
      );
    }
    assert.equal(
      first(migrated, 'SELECT schema_version FROM user_info').schema_version,
      USER_DB_SCHEMA_VERSION,
    );
  } finally {
    database.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('surlignage, note et marque-page vivent et meurent ensemble', async () => {
  const context = await open(1);
  const { repository } = context;
  const editionId = context.books[0].editionId;
  const [page] = await repository.getPages(editionId, { limit: 1 });

  try {
    const highlight = await repository.saveHighlight({
      editionId,
      pageId: page.pageId,
      startOffset: 4,
      endOffset: 12,
      selectedText: 'مقدمة ابن',
      prefixText: 'بسم',
      suffixText: 'خلدون',
      color: '#f2c744',
    });
    assert.ok(highlight.highlightId);
    assert.equal(highlight.color, '#f2c744');

    // Recolorer ne crée pas un second surlignage.
    const recolored = await repository.saveHighlight({ ...highlight, color: '#5fa877' });
    assert.equal(recolored.highlightId, highlight.highlightId);

    const note = await repository.saveNote({
      editionId,
      pageId: page.pageId,
      highlightId: highlight.highlightId,
      content: 'ملاحظة تجريبية',
    });
    assert.equal(note.content, 'ملاحظة تجريبية');

    const toggled = await repository.toggleBookmark({ editionId, pageId: page.pageId });
    assert.equal(toggled.added, true);

    let annotations = await repository.getBookAnnotations(editionId);
    assert.equal(annotations.highlights.length, 1);
    assert.equal(annotations.highlights[0].color, '#5fa877');
    assert.equal(annotations.notes.length, 1);
    assert.equal(annotations.bookmarks.length, 1);

    // Le même bouton retire la marque-page.
    assert.equal((await repository.toggleBookmark({ editionId, pageId: page.pageId })).added, false);

    // Supprimer le surlignage emporte la note qui ne commentait que lui.
    await repository.deleteHighlight(highlight.highlightId);
    annotations = await repository.getBookAnnotations(editionId);
    assert.equal(annotations.highlights.length, 0);
    assert.equal(annotations.notes.length, 0);
    assert.equal(annotations.bookmarks.length, 0);
  } finally {
    context.dispose();
  }
});

test('une note vide est refusée', async () => {
  const context = await open(1);
  try {
    await assert.rejects(() =>
      context.repository.saveNote({ editionId: context.books[0].editionId, content: '   ' }),
    );
  } finally {
    context.dispose();
  }
});

test('getAnnotations agrège les trois types et filtre sur le texte normalisé', async () => {
  const context = await open(1);
  const { repository } = context;
  const editionId = context.books[0].editionId;
  const [page] = await repository.getPages(editionId, { limit: 1 });

  try {
    await repository.saveNote({ editionId, pageId: page.pageId, content: 'الإسناد عند المحدثين' });
    await repository.saveNote({ editionId, pageId: page.pageId, content: 'ملاحظة أخرى' });
    await repository.saveHighlight({
      editionId,
      pageId: page.pageId,
      selectedText: 'الاسناد',
      color: '#e2604c',
    });
    await repository.toggleBookmark({ editionId, pageId: page.pageId, label: 'موضع مهم' });

    const everything = await repository.getAnnotations({});
    assert.equal(everything.total, 4);
    assert.deepEqual(everything.counts, { note: 2, highlight: 1, bookmark: 1 });
    assert.ok(everything.items.every((item) => item.bookTitle && item.bookTitle !== item.editionId));

    // « الإسناد » et « الاسناد » ne diffèrent que par la hamza : les deux
    // doivent répondre au même terme, sinon la recherche est inutilisable.
    const filtered = await repository.getAnnotations({ text: 'الإسناد' });
    assert.equal(filtered.total, 2);

    const notesOnly = await repository.getAnnotations({ kind: 'note' });
    assert.equal(notesOnly.total, 2);
    assert.ok(notesOnly.items.every((item) => item.kind === 'note'));
    // Les compteurs d'onglets restent ceux de tout le corpus, sinon l'onglet
    // qu'on ne regarde pas afficherait toujours zéro.
    assert.deepEqual(notesOnly.counts, { note: 2, highlight: 1, bookmark: 1 });

    const firstPage = await repository.getAnnotations({ limit: 1 });
    assert.equal(firstPage.items.length, 1);
    assert.equal(firstPage.total, 4);
  } finally {
    context.dispose();
  }
});

test('les annotations partent avec le livre quand on ne garde pas la progression', async () => {
  const context = await open(1);
  const { repository } = context;
  const editionId = context.books[0].editionId;
  const [page] = await repository.getPages(editionId, { limit: 1 });

  try {
    await repository.saveNote({ editionId, pageId: page.pageId, content: 'à effacer' });
    await repository.deleteBook(editionId, { keepProgress: true });
    assert.equal((await repository.getAnnotations({})).total, 1, 'conservées par défaut');

    await repository.deleteBook(editionId, { keepProgress: false });
    assert.equal((await repository.getAnnotations({})).total, 0);
  } finally {
    context.dispose();
  }
});

test('searchLibrary balaie les livres installés et referme ceux qu\'il ouvre', async () => {
  const context = await open(3);
  const { repository, database } = context;

  try {
    const editionId = context.books[0].editionId;
    const [page] = await repository.getPages(editionId, { limit: 1 });
    const term = page.bodyPlain.trim().split(/\s+/).find((word) => word.length > 3);
    assert.ok(term, 'un mot de recherche dans la page');

    // `getPages` a laissé ce livre en cache : la recherche ne doit pas le fermer.
    assert.equal(database.isBookOpen(editionId), true);
    const found = await repository.searchLibrary(term, { perBook: 3 });

    assert.equal(found.installed, 3);
    assert.equal(found.scanned, 3);
    assert.equal(found.skipped, 0);
    assert.ok(found.total > 0);
    assert.ok(found.results.some((entry) => entry.editionId === editionId));
    assert.ok(found.results.every((entry) => entry.title && entry.pages.length));
    assert.ok(found.results.every((entry) => entry.pages.every((hit) => hit.snippet.match)));
    assert.equal(database.isBookOpen(editionId), true, 'le livre déjà ouvert le reste');

    // Un terme trop court ne déclenche aucun balayage.
    assert.deepEqual((await repository.searchLibrary('ا')).results, []);

    // maxBooks borne le balayage et le dit.
    const bounded = await repository.searchLibrary(term, { maxBooks: 1 });
    assert.equal(bounded.scanned, 1);
    assert.equal(bounded.skipped, 2);
  } finally {
    context.dispose();
  }
});

test('getManagedBooks pagine le catalogue avec taille locale et statut', async () => {
  const context = await open(1);
  const { repository } = context;
  const installedId = context.books[0].editionId;

  try {
    const firstPage = await repository.getManagedBooks({ limit: 2, offset: 0 });
    assert.equal(firstPage.rows.length, 2);
    assert.equal(firstPage.total, 5, 'le total porte sur tout le catalogue');
    assert.ok(firstPage.rows.every((row) => row.title));

    const secondPage = await repository.getManagedBooks({ limit: 2, offset: 2 });
    assert.equal(secondPage.rows.length, 2);
    assert.ok(
      secondPage.rows.every((row) => !firstPage.rows.some((other) => other.editionId === row.editionId)),
      'pas de recouvrement entre les pages',
    );

    const installedOnly = await repository.getManagedBooks({ status: 'installed', limit: 25 });
    assert.equal(installedOnly.rows.length, 1);
    assert.equal(installedOnly.rows[0].editionId, installedId);
    assert.equal(installedOnly.rows[0].downloadStatus, 'installed');
    assert.ok(installedOnly.rows[0].localBytes > 0, 'taille lue sur le disque');
    assert.ok(installedOnly.rows[0].pageCount > 0);

    const missing = await repository.getManagedBooks({ status: 'missing', limit: 25 });
    assert.equal(missing.rows.length, 4);
    assert.ok(missing.rows.every((row) => row.localBytes === 0));

    assert.equal(await repository.deleteBooks([installedId]), 1);
    assert.equal((await repository.getManagedBooks({ status: 'installed' })).rows.length, 0);
  } finally {
    context.dispose();
  }
});
