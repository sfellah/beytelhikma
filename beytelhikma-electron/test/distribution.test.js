import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_BASE_URL, isAbsoluteKey, resolveObject } from '../src/shared/distribution.js';

const AWS = 'https://beytelhima-library.s3.eu-west-1.amazonaws.com';
const MINIO = 'http://127.0.0.1:9000/beytelhikma';

test('une clé relative se colle derrière la base', () => {
  assert.deepEqual(resolveObject(AWS, 'books/sh-8/1/book.sqlite.zst'), {
    kind: 'http',
    url: `${AWS}/books/sh-8/1/book.sqlite.zst`,
  });
});

test('le préfixe de bucket de la base survit', () => {
  // C'est tout l'intérêt du chemin relatif : en path-style, le nom du bucket
  // fait partie de la base et ne doit pas être perdu.
  assert.deepEqual(resolveObject(MINIO, 'books/sh-8/1/book.sqlite.zst'), {
    kind: 'http',
    url: 'http://127.0.0.1:9000/beytelhikma/books/sh-8/1/book.sqlite.zst',
  });
});

test('ni double barre ni barre manquante à la jointure', () => {
  const attendu = `${AWS}/books/x.zst`;
  assert.equal(resolveObject(`${AWS}/`, 'books/x.zst').url, attendu);
  assert.equal(resolveObject(AWS, '/books/x.zst').url, attendu);
  assert.equal(resolveObject(`${AWS}/`, '/books/x.zst').url, attendu);
});

test('une clé http absolue ignore la base', () => {
  assert.deepEqual(resolveObject(AWS, 'https://autre-hote/x.zst'), {
    kind: 'http',
    url: 'https://autre-hote/x.zst',
  });
});

test('asset:// et local:// désignent la bibliothèque source', () => {
  // Les jeux hors ligne doivent survivre au changement de format : les tests
  // du dépôt tournent sans réseau grâce à eux.
  assert.deepEqual(resolveObject(AWS, 'asset://books/x.sqlite'), {
    kind: 'library',
    url: 'asset://books/x.sqlite',
  });
  assert.deepEqual(resolveObject(AWS, 'local://books/x.sqlite'), {
    kind: 'library',
    url: 'local://books/x.sqlite',
  });
});

test('une base vide retombe sur le défaut compilé', () => {
  assert.equal(resolveObject(null, 'books/x.zst').url, `${DEFAULT_BASE_URL}/books/x.zst`);
  assert.equal(resolveObject('', 'books/x.zst').url, `${DEFAULT_BASE_URL}/books/x.zst`);
  assert.equal(resolveObject('   ', 'books/x.zst').url, `${DEFAULT_BASE_URL}/books/x.zst`);
});

test('isAbsoluteKey ne se laisse pas prendre par un chemin qui contient deux points', () => {
  assert.equal(isAbsoluteKey('books/sh-8/1/book.sqlite.zst'), false);
  assert.equal(isAbsoluteKey('https://x/y'), true);
  assert.equal(isAbsoluteKey('asset://books/x.sqlite'), true);
});
