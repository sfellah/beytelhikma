import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import zlib from 'node:zlib';

import {
  SUPPORTED_SCHEMA_VERSION,
  decideUpdate,
  fetchPointer,
  installCatalog,
} from '../src/main/catalog-updater.js';

let server;
let origin;
let handler;

before(async () => {
  server = http.createServer((request, response) => handler(request, response));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function pointeur(patch = {}) {
  return {
    catalog_version: 3,
    schema_version: SUPPORTED_SCHEMA_VERSION,
    generated_at: '2026-08-01T10:00:00Z',
    edition_count: 500,
    object_key: 'catalog/3/catalog.sqlite.zst',
    sha256: 'b'.repeat(64),
    compressed_size: 8_380_000,
    uncompressed_size: 45_000_000,
    ...patch,
  };
}

test('une version plus récente est proposée', () => {
  const verdict = decideUpdate({ pointer: pointeur(), localVersion: 2, declinedVersion: null });
  assert.equal(verdict.action, 'offer');
  assert.equal(verdict.pointer.catalog_version, 3);
});

test('une version identique ou plus ancienne ne dit rien', () => {
  for (const locale of [3, 4]) {
    const verdict = decideUpdate({
      pointer: pointeur(),
      localVersion: locale,
      declinedVersion: null,
    });
    assert.equal(verdict.action, 'none', `locale ${locale}`);
  }
});

test('une version refusée se tait, la suivante non', () => {
  // Refuser la 3 ne doit pas faire taire la 4 : sinon un seul « plus tard »
  // condamne l'application à ne plus jamais se mettre à jour.
  const refusée = decideUpdate({ pointer: pointeur(), localVersion: 2, declinedVersion: 3 });
  assert.equal(refusée.action, 'none');

  const suivante = decideUpdate({
    pointer: pointeur({ catalog_version: 4 }),
    localVersion: 2,
    declinedVersion: 3,
  });
  assert.equal(suivante.action, 'offer');
});

test('un schéma trop récent ne propose rien', () => {
  // L'application ne saurait pas lire ce catalogue : le proposer mènerait à une
  // installation qui casse tout.
  const verdict = decideUpdate({
    pointer: pointeur({ schema_version: SUPPORTED_SCHEMA_VERSION + 1 }),
    localVersion: 2,
    declinedVersion: null,
  });
  assert.equal(verdict.action, 'none');
  assert.equal(verdict.reason, 'schemaTooNew');
});

test('un pointeur incomplet ne propose rien', () => {
  for (const cassé of [null, {}, { catalog_version: 'trois' }, pointeur({ object_key: '' })]) {
    const verdict = decideUpdate({ pointer: cassé, localVersion: 1, declinedVersion: null });
    assert.equal(verdict.action, 'none');
    assert.equal(verdict.pointer, null, 'aucune branche silencieuse ne rend de pointeur');
  }
});

/**
 * Sans empreinte il n'y a rien à vérifier à l'installation, et le catalogue
 * devient ensuite la source de vérité de toute l'application. On ne le propose
 * donc même pas.
 */
test('un pointeur sans empreinte utilisable ne propose rien', () => {
  for (const sha of [undefined, null, '', 'court', 'z'.repeat(64), 'a'.repeat(63), 42]) {
    const verdict = decideUpdate({
      pointer: pointeur({ sha256: sha }),
      localVersion: 1,
      declinedVersion: null,
    });
    assert.equal(verdict.action, 'none', `proposé à tort : ${String(sha)}`);
    assert.equal(verdict.reason, 'malformed');
    assert.equal(verdict.pointer, null);
  }
});

test('un serveur injoignable rend null, sans lever', async () => {
  assert.equal(await fetchPointer('http://127.0.0.1:1/', { timeoutMs: 200 }), null);
});

test('un pointeur non JSON rend null', async () => {
  handler = (request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('<html>pas du json</html>');
  };
  assert.equal(await fetchPointer(origin, {}), null);
});

test('un 404 rend null', async () => {
  handler = (request, response) => {
    response.writeHead(404);
    response.end();
  };
  assert.equal(await fetchPointer(origin, {}), null);
});

test('le pointeur est lu sous catalog/latest.json', async () => {
  let demandé = null;
  handler = (request, response) => {
    demandé = request.url;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(pointeur()));
  };

  const lu = await fetchPointer(origin, {});
  assert.equal(demandé, '/catalog/latest.json');
  assert.equal(lu.catalog_version, 3);
});

function racineJetable(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beyt-catalog-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const CLAIR = Buffer.from('SQLite format 3\0'.repeat(64));
const COMPRESSÉ = zlib.zstdCompressSync(CLAIR);
const EMPREINTE = createHash('sha256').update(CLAIR).digest('hex');

function sertLArchive() {
  handler = (request, response) => {
    response.writeHead(200, { 'content-length': COMPRESSÉ.length });
    response.end(COMPRESSÉ);
  };
}

test('le catalogue est téléchargé, décompressé et installé', async (t) => {
  const root = racineJetable(t);
  sertLArchive();

  const installé = await installCatalog({
    pointer: pointeur({
      sha256: EMPREINTE,
      compressed_size: COMPRESSÉ.length,
      uncompressed_size: CLAIR.length,
    }),
    baseUrl: origin,
    storageRoot: root,
  });

  assert.equal(installé, path.join(root, 'catalog.sqlite'));
  assert.deepEqual(fs.readFileSync(installé), CLAIR);
});

test('un SHA-256 faux laisse l’ancien catalogue en place', async (t) => {
  // C'est la propriété qui compte : un catalogue corrompu ne remplace jamais un
  // catalogue valide, et ne laisse rien à moitié écrit derrière lui.
  const root = racineJetable(t);
  const ancien = path.join(root, 'catalog.sqlite');
  fs.writeFileSync(ancien, Buffer.from('ancien catalogue'));
  sertLArchive();

  await assert.rejects(
    installCatalog({
      pointer: pointeur({ sha256: 'c'.repeat(64), compressed_size: COMPRESSÉ.length }),
      baseUrl: origin,
      storageRoot: root,
    }),
    /empreinte/,
  );

  assert.deepEqual(fs.readFileSync(ancien), Buffer.from('ancien catalogue'));
  assert.equal(fs.existsSync(`${ancien}.new`), false, 'aucun reste à moitié écrit');
});

test('une coupure en cours de route laisse le catalogue précédent valide', async (t) => {
  const root = racineJetable(t);
  const ancien = path.join(root, 'catalog.sqlite');
  fs.writeFileSync(ancien, Buffer.from('ancien catalogue'));

  handler = (request, response) => {
    response.writeHead(200, { 'content-length': COMPRESSÉ.length * 2 });
    response.write(COMPRESSÉ.subarray(0, 8));
    response.destroy(); // coupure franche au milieu
  };

  await assert.rejects(
    installCatalog({
      pointer: pointeur({ sha256: EMPREINTE }),
      baseUrl: origin,
      storageRoot: root,
    }),
  );

  assert.deepEqual(fs.readFileSync(ancien), Buffer.from('ancien catalogue'));
  assert.equal(fs.existsSync(`${ancien}.new`), false);
});

/**
 * La même exigence à l'autre bout de la chaîne : `installCatalog` est
 * appelable directement, et refusait autrefois de vérifier ce qu'aucun
 * `sha256` ne décrivait — `if (pointer.sha256 && …)` laissait passer.
 */
test('un pointeur sans empreinte n’installe rien, et ne télécharge même pas', async (t) => {
  const root = racineJetable(t);
  let demandé = false;
  handler = (request, response) => {
    demandé = true;
    response.writeHead(200, { 'content-length': COMPRESSÉ.length });
    response.end(COMPRESSÉ);
  };

  await assert.rejects(
    installCatalog({
      pointer: pointeur({ sha256: undefined }),
      baseUrl: origin,
      storageRoot: root,
    }),
    /sans empreinte/,
  );

  assert.equal(demandé, false, 'refus prononcé avant la requête');
  assert.equal(fs.existsSync(path.join(root, 'catalog.sqlite')), false);
});

test('un 404 sur le catalogue ne touche à rien', async (t) => {
  const root = racineJetable(t);
  handler = (request, response) => {
    response.writeHead(404);
    response.end();
  };

  await assert.rejects(
    installCatalog({ pointer: pointeur(), baseUrl: origin, storageRoot: root }),
    /404/,
  );
  assert.equal(fs.existsSync(path.join(root, 'catalog.sqlite')), false);
});
