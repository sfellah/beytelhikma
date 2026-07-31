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

test('un SHA-256 non conforme échoue et ne laisse aucun fichier', async () => {
  await assert.rejects(
    () => installRelease({ release: { ...release(), sha256: 'f'.repeat(64) }, storageRoot }),
    (error) => error.code === 'checksum' && error.message === 'الملف المُنزَّل تالف',
  );
  assert.equal(fs.existsSync(path.join(storageRoot, 'books', 'ed-test-01.sqlite')), false);
  assert.equal(
    fs.existsSync(path.join(storageRoot, 'downloads', 'ed-test-01.zst.part')),
    false,
    'un cache corrompu doit être jeté',
  );
});

test('une 404 échoue avec le message dédié', async () => {
  handler = (request, response) => {
    response.writeHead(404).end();
  };
  await assert.rejects(
    () => installRelease({ release: release(), storageRoot }),
    (error) => error.code === 'notFound' && error.message === 'الملف غير متوفر على الخادم',
  );
});

test('une coupure à mi-parcours est reprise par Range', async () => {
  const cut = Math.floor(PACKED.length / 2);
  const ranges = [];

  // Première tentative : le serveur coupe la connexion au milieu.
  handler = (request, response) => {
    ranges.push(request.headers.range ?? null);
    response.writeHead(200, {
      'content-type': 'application/zstd',
      'content-length': String(PACKED.length),
    });
    // La socket doit être vidée avant d'être détruite, sinon le client ne voit
    // jamais la première moitié et n'a rien à reprendre.
    response.write(PACKED.subarray(0, cut), () => {
      setTimeout(() => response.destroy(), 20);
    });
  };
  await assert.rejects(() => installRelease({ release: release(), storageRoot }));
  const part = path.join(storageRoot, 'downloads', 'ed-test-01.zst.part');
  assert.ok(fs.existsSync(part), 'le .part est conservé pour la reprise');

  // Seconde tentative : le serveur honore Range.
  handler = (request, response) => {
    ranges.push(request.headers.range ?? null);
    const offset = Number(/bytes=(\d+)-/.exec(request.headers.range ?? '')?.[1] ?? 0);
    const rest = PACKED.subarray(offset);
    response.writeHead(206, {
      'content-type': 'application/zstd',
      'content-length': String(rest.length),
      'content-range': `bytes ${offset}-${PACKED.length - 1}/${PACKED.length}`,
    });
    response.end(rest);
  };
  const installed = await installRelease({ release: release(), storageRoot });

  assert.deepEqual(fs.readFileSync(installed), PLAIN);
  assert.equal(ranges[0], null, 'la première requête ne demande aucun intervalle');
  assert.match(ranges[1], /^bytes=\d+-$/);
});

test('un serveur sans support de Range fait repartir de zéro', async () => {
  fs.mkdirSync(path.join(storageRoot, 'downloads'), { recursive: true });
  fs.writeFileSync(
    path.join(storageRoot, 'downloads', 'ed-test-01.zst.part'),
    PACKED.subarray(0, 64),
  );
  handler = (request, response) => {
    // Range ignoré : réponse 200 complète.
    response.writeHead(200, {
      'content-type': 'application/zstd',
      'content-length': String(PACKED.length),
    });
    response.end(PACKED);
  };

  const installed = await installRelease({ release: release(), storageRoot });
  assert.deepEqual(fs.readFileSync(installed), PLAIN);
});

test('une annulation interrompt et efface le .part', async () => {
  const controller = new AbortController();
  handler = (request, response) => {
    response.writeHead(200, { 'content-length': String(PACKED.length) });
    response.write(PACKED.subarray(0, 32));
    setTimeout(() => controller.abort(), 10);
  };

  await assert.rejects(
    () => installRelease({ release: release(), storageRoot, signal: controller.signal }),
    (error) => error.code === 'aborted',
  );
  assert.equal(fs.existsSync(path.join(storageRoot, 'downloads', 'ed-test-01.zst.part')), false);
});
