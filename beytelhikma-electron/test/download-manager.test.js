import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import zlib from 'node:zlib';

import { installRelease } from '../src/main/download-manager.js';

/** Un « livre » factice : quelques kilo-octets suffisent à exercer le flux. */
const PLAIN = Buffer.from('SQLite format 3\0'.repeat(400), 'utf8');
const SHA256 = crypto.createHash('sha256').update(PLAIN).digest('hex');
const PACKED = zlib.zstdCompressSync(PLAIN);

let server;
let origin;
let storageRoot;

/** Routes servies par le serveur de test, réassignables par test. */
let handler;

before(async () => {
  server = http.createServer((request, response) => handler(request, response));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test.beforeEach(() => {
  storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'beyt-dl-'));
  handler = (request, response) => {
    response.writeHead(200, {
      'content-type': 'application/zstd',
      'content-length': String(PACKED.length),
    });
    response.end(PACKED);
  };
});

test.afterEach(() => {
  fs.rmSync(storageRoot, { recursive: true, force: true });
});

const release = () => ({
  editionId: 'ed-test-01',
  url: `${origin}/books/ed-test-01/1/book.sqlite.zst`,
  sha256: SHA256,
  compressedSize: PACKED.length,
});

test('un téléchargement nominal installe le livre décompressé', async () => {
  const seen = [];
  const installed = await installRelease({
    release: release(),
    storageRoot,
    onProgress: (received, total) => seen.push([received, total]),
  });

  assert.equal(installed, path.join(storageRoot, 'books', 'ed-test-01.sqlite'));
  assert.deepEqual(fs.readFileSync(installed), PLAIN);
  assert.ok(seen.length >= 1, 'la progression doit être rapportée');
  assert.equal(seen.at(-1)[0], PACKED.length);
  // Aucun résidu.
  assert.equal(fs.existsSync(path.join(storageRoot, 'downloads', 'ed-test-01.zst.part')), false);
  assert.equal(fs.existsSync(path.join(storageRoot, 'downloads', 'ed-test-01.sqlite.tmp')), false);
});
