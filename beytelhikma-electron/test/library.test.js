import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

import {
  AppDatabase,
  BookNotInstalledError,
  USER_DB_SCHEMA_VERSION,
  all,
  resolveLibrarySource,
} from '../src/main/app-database.js';
import { BookRepository } from '../src/main/book-repository.js';

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sampleLibrary = path.join(projectRoot, 'assets', 'sample');
const shamelaLibrary = path.join(projectRoot, '..', 'dist', 'shamela');
const hasShamela = fs.existsSync(path.join(shamelaLibrary, 'catalog.sqlite'));

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'beytelhikma-lib-'));
}

/** Copie d'une bibliothèque, pour simuler deux sources distinctes. */
function cloneLibrary(target) {
  fs.cpSync(sampleLibrary, target, { recursive: true });
  return target;
}

/** Installe [count] livres du catalogue et attend la fin de la file. */
async function install(repository, count = 1) {
  const books = await repository.getBooks({ limit: count });
  for (const book of books) await repository.downloadBook(book.editionId);
  await new Promise((resolve) => repository.downloads.once('idle', resolve));
  return books;
}

test('resolveLibrarySource privilégie BEYTELHIKMA_LIBRARY', () => {
  const previous = process.env.BEYTELHIKMA_LIBRARY;
  process.env.BEYTELHIKMA_LIBRARY = sampleLibrary;
  try {
    assert.equal(resolveLibrarySource(projectRoot), path.resolve(sampleLibrary));
  } finally {
    if (previous === undefined) delete process.env.BEYTELHIKMA_LIBRARY;
    else process.env.BEYTELHIKMA_LIBRARY = previous;
  }
});

test('resolveLibrarySource ignore un chemin sans catalogue', () => {
  const previous = process.env.BEYTELHIKMA_LIBRARY;
  process.env.BEYTELHIKMA_LIBRARY = path.join(os.tmpdir(), 'inexistant-beytelhikma');
  try {
    // retombe sur dist/shamela si l'import a été lancé, sinon sur l'échantillon
    const resolved = resolveLibrarySource(projectRoot);
    assert.ok(fs.existsSync(path.join(resolved, 'catalog.sqlite')));
  } finally {
    if (previous === undefined) delete process.env.BEYTELHIKMA_LIBRARY;
    else process.env.BEYTELHIKMA_LIBRARY = previous;
  }
});

test('le catalogue est copié au premier accès, les livres seulement au téléchargement', async () => {
  const root = tempRoot();
  const database = new AppDatabase({ librarySource: sampleLibrary, storageRoot: root });
  try {
    await database.initialize();
    assert.ok(fs.existsSync(path.join(root, 'library.json')), 'marqueur de bibliothèque');
    assert.ok(!fs.existsSync(path.join(root, 'catalog.sqlite')), 'rien avant le premier accès');

    const repository = new BookRepository(database);
    repository.createDownloadQueue();
    await repository.reconcileLibrary();

    // Lire les pages ne suffit plus : sans téléchargement, le livre est absent.
    const books = await repository.getBooks({ limit: 500 });
    assert.ok(fs.existsSync(path.join(root, 'catalog.sqlite')), 'catalogue copié au 1er accès');
    assert.equal(fs.readdirSync(path.join(root, 'books')).length, 0, 'aucun livre copié');
    await assert.rejects(() => repository.getPages(books[0].editionId, { offset: 0, limit: 1 }));

    await install(repository, 1);
    assert.deepEqual(fs.readdirSync(path.join(root, 'books')), [`${books[0].editionId}.sqlite`]);
    assert.equal((await repository.getPages(books[0].editionId, { limit: 1 })).length, 1);
  } finally {
    database.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('user.sqlite porte user_version, sinon sqflite refuse de l\'ouvrir', async () => {
  const root = tempRoot();
  const database = new AppDatabase({ librarySource: sampleLibrary, storageRoot: root });
  try {
    await database.initialize();
    const user = await database.user();
    assert.equal(
      all(user, 'PRAGMA user_version')[0].user_version,
      USER_DB_SCHEMA_VERSION,
    );
  } finally {
    database.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('changer de bibliothèque jette le catalogue et garde les livres', async () => {
  // Le catalogue appartient à la source : il part avec elle. Les livres, non —
  // ils ont été téléchargés, parfois annotés. Purger `books/` était tenable
  // quand la source était un dossier qu'on changeait à la main ; avec un
  // catalogue qui se met à jour tout seul, ce serait tout retélécharger.
  const root = tempRoot();
  const otherLibrary = cloneLibrary(path.join(tempRoot(), 'autre'));

  let database = new AppDatabase({ librarySource: sampleLibrary, storageRoot: root });
  try {
    await database.initialize();
    let repository = new BookRepository(database);
    repository.createDownloadQueue();
    await repository.reconcileLibrary();
    await install(repository, 1);
    assert.equal(fs.readdirSync(path.join(root, 'books')).length, 1);
    database.close();

    database = new AppDatabase({ librarySource: otherLibrary, storageRoot: root });
    await database.initialize();
    assert.equal(fs.readdirSync(path.join(root, 'books')).length, 1, 'les livres restent');
    assert.ok(!fs.existsSync(path.join(root, 'catalog.sqlite')), 'catalogue jeté');
    assert.ok(fs.existsSync(path.join(root, 'user.sqlite')), 'progression conservée');

    repository = new BookRepository(database);
    repository.createDownloadQueue();
    await repository.reconcileLibrary();
    assert.equal((await repository.getBooks({ limit: 500 })).length, 5);
  } finally {
    database.close();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(path.dirname(otherLibrary), { recursive: true, force: true });
  }
});

test('une édition absente du nouveau catalogue ne remonte pas en bibliothèque', async () => {
  const root = tempRoot();
  const emptyLibrary = cloneLibrary(path.join(tempRoot(), 'vide'));
  // catalogue sans aucune édition : toutes les lignes de `downloaded_books`
  // deviennent orphelines
  const database0 = new AppDatabase({ librarySource: sampleLibrary, storageRoot: root });
  await database0.initialize();
  const repository0 = new BookRepository(database0);
  repository0.createDownloadQueue();
  await repository0.reconcileLibrary();
  await install(repository0, 5);
  assert.equal((await repository0.getLibrary()).total, 5);
  database0.close();

  // on remplace le catalogue par un fichier au même schéma mais vide
  const emptyCatalog = new AppDatabase({ librarySource: emptyLibrary, storageRoot: tempRoot() });
  await emptyCatalog.initialize();
  const catalog = await emptyCatalog.catalog();
  catalog.run('DELETE FROM editions');
  fs.writeFileSync(path.join(emptyLibrary, 'catalog.sqlite'), Buffer.from(catalog.export()));
  emptyCatalog.close();

  const database = new AppDatabase({ librarySource: emptyLibrary, storageRoot: root });
  try {
    await database.initialize();
    const repository = new BookRepository(database);
    // pas de warmUp : les 5 lignes de l'ancienne bibliothèque sont toujours là
    assert.equal((await repository.getLibrary()).total, 0, 'aucun livre fantôme');
  } finally {
    database.close();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(path.dirname(emptyLibrary), { recursive: true, force: true });
  }
});

test('un catalogue republié de même taille est tout de même recopié', async () => {
  const root = tempRoot();
  const source = cloneLibrary(path.join(tempRoot(), 'republié'));
  const catalogPath = path.join(source, 'catalog.sqlite');

  const database = new AppDatabase({ librarySource: source, storageRoot: root });
  await database.initialize();
  const repository = new BookRepository(database);
  repository.createDownloadQueue();
  await repository.getBooks({ limit: 1 });
  const installed = path.join(root, 'catalog.sqlite');
  assert.ok(fs.existsSync(installed));
  database.close();

  // `publish_minio.py` réécrit `object_key` : le contenu change, la taille
  // peut rester identique. Sans comparaison de date, la copie serait sautée.
  const before = fs.readFileSync(catalogPath);
  const patched = Buffer.from(before);
  patched[patched.length - 1] ^= 0xff;
  assert.equal(patched.length, before.length, 'même taille, contenu différent');
  fs.writeFileSync(catalogPath, patched);
  const now = new Date();
  fs.utimesSync(catalogPath, now, now);

  const reopened = new AppDatabase({ librarySource: source, storageRoot: root });
  await reopened.initialize();
  await reopened.catalog().catch(() => null); // le contenu trafiqué peut ne plus s'ouvrir
  assert.deepEqual(fs.readFileSync(installed), patched, 'la copie a été rafraîchie');
  reopened.close();

  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(path.dirname(source), { recursive: true, force: true });
});

/** Archive de graine bâtie depuis le catalogue d'exemple. */
function grainePour(dossier) {
  fs.mkdirSync(dossier, { recursive: true });
  const archive = path.join(dossier, 'catalog.sqlite.zst');
  const clair = fs.readFileSync(path.join(sampleLibrary, 'catalog.sqlite'));
  fs.writeFileSync(archive, zlib.zstdCompressSync(clair));
  return archive;
}

test('sans bibliothèque source, la graine fournit le catalogue', async () => {
  // C'est le cas d'une application empaquetée : ni `dist/shamela` ni
  // `assets/sample` n'existent, et aucun livre ne peut venir d'ailleurs que du
  // bucket.
  const root = tempRoot();
  const graine = grainePour(path.join(tempRoot(), 'assets'));
  const database = new AppDatabase({ librarySource: null, seedArchive: graine, storageRoot: root });
  try {
    await database.initialize();
    assert.ok(fs.existsSync(path.join(root, 'catalog.sqlite')), 'graine décompressée');

    const repository = new BookRepository(database);
    assert.equal((await repository.getBooks({ limit: 50 })).length, 5);
    assert.equal(database.librarySource, null, 'aucune source locale en production');
  } finally {
    database.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('la graine ne remplace jamais un catalogue déjà installé', async () => {
  // Une mise à jour d'application embarque une graine plus ancienne que le
  // catalogue que l'utilisateur a téléchargé depuis le bucket. L'écraser ferait
  // régresser son catalogue à l'installation d'une nouvelle version.
  const root = tempRoot();
  const graine = grainePour(path.join(tempRoot(), 'assets'));
  fs.mkdirSync(root, { recursive: true });
  const plusRecent = Buffer.from('catalogue plus récent que la graine');
  fs.writeFileSync(path.join(root, 'catalog.sqlite'), plusRecent);

  const database = new AppDatabase({ librarySource: null, seedArchive: graine, storageRoot: root });
  try {
    await database.initialize();
    assert.deepEqual(fs.readFileSync(path.join(root, 'catalog.sqlite')), plusRecent);
  } finally {
    database.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ni source ni graine ni catalogue installé : erreur explicite', async () => {
  const root = tempRoot();
  const database = new AppDatabase({ librarySource: null, storageRoot: root });
  try {
    await database.initialize();
    await assert.rejects(() => database.catalog(), /catalogue/i);
  } finally {
    database.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('une réédition est signalée, jamais appliquée', async () => {
  // Les ancres de surlignage sont posées sur le texte rendu : une réédition
  // peut les déplacer. Ce doit être un choix de l'utilisateur, jamais un effet
  // de bord d'une mise à jour de catalogue.
  const root = tempRoot();
  const database = new AppDatabase({ librarySource: sampleLibrary, storageRoot: root });
  try {
    await database.initialize();
    const repository = new BookRepository(database);
    repository.createDownloadQueue();
    const [book] = await install(repository, 1);

    const avant = await repository.getLibrary({ limit: 10 });
    assert.equal(avant.rows[0].hasNewerRelease, false, 'rien à signaler tant que rien ne bouge');

    // La release installée devient périmée : le catalogue en annonce une autre.
    await database.writeUser((user) => {
      user.run('UPDATE downloaded_books SET release_id = ? WHERE edition_id = ?', [
        'rel-perimee-v0',
        book.editionId,
      ]);
    });

    const après = await repository.getLibrary({ limit: 10 });
    const ligne = après.rows.find((row) => row.book.editionId === book.editionId);
    assert.equal(ligne.hasNewerRelease, true);
    assert.ok(
      fs.existsSync(path.join(root, 'books', `${book.editionId}.sqlite`)),
      'aucun fichier ne doit être supprimé',
    );
  } finally {
    database.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('un livre non installé ne se matérialise plus tout seul', async () => {
  const root = tempRoot();
  const database = new AppDatabase({ librarySource: sampleLibrary, storageRoot: root });
  await database.initialize();

  await assert.rejects(
    () => database.book('ed-muqaddima-01'),
    (error) => error instanceof BookNotInstalledError && error.editionId === 'ed-muqaddima-01',
  );
  assert.deepEqual(database.installedBooks(), []);

  // Une fois le fichier posé, il s'ouvre — et closeBook le rend à nouveau absent
  // du cache, condition d'une suppression sûre.
  fs.copyFileSync(
    path.join(sampleLibrary, 'books', 'ed-muqaddima-01.sqlite'),
    path.join(root, 'books', 'ed-muqaddima-01.sqlite'),
  );
  assert.deepEqual(database.installedBooks(), ['ed-muqaddima-01']);
  const book = await database.book('ed-muqaddima-01');
  assert.equal(all(book, 'SELECT page_id FROM pages LIMIT 1').length, 1);

  database.closeBook('ed-muqaddima-01');
  fs.rmSync(path.join(root, 'books', 'ed-muqaddima-01.sqlite'));
  await assert.rejects(() => database.book('ed-muqaddima-01'), BookNotInstalledError);

  database.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test(
  'la bibliothèque Shamela importée est lue telle quelle',
  { skip: hasShamela ? false : 'dist/shamela absent — lancer tools/import_shamela.py' },
  async () => {
    const root = tempRoot();
    const database = new AppDatabase({ librarySource: shamelaLibrary, storageRoot: root });
    try {
      await database.initialize();
      const repository = new BookRepository(database);
      repository.createDownloadQueue();
      await repository.reconcileLibrary();

      const categories = await repository.getCategories();
      assert.equal(categories.length, 40);
      assert.ok(categories.every((c) => c.bookCount > 0));

      const books = await repository.getBooks({ limit: 1000 });
      assert.ok(books.length > 0);
      assert.ok(books.every((b) => b.editionId.startsWith('sh-')));
      assert.ok(books.every((b) => b.title && b.authorName && b.categoryLabel));
      assert.ok(books.every((b) => b.pageCount > 0));

      // Le livre n'est plus matérialisé à la lecture : il faut l'installer.
      await install(repository, 1);

      const detail = await repository.getBookDetail(books[0].editionId);
      assert.ok(detail.volumes.length >= 1);

      const pages = await repository.getPages(books[0].editionId, { offset: 0, limit: 3 });
      assert.ok(pages.length > 0);
      for (const page of pages) {
        assert.ok(!page.bodyHtml.includes('<table'));
        assert.ok(!page.bodyHtml.includes('data:image'));
        assert.ok(!page.bodyHtml.includes('\r'));
      }
    } finally {
      database.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);
