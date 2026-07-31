import assert from 'node:assert/strict';
import http from 'node:http';
import test, { after, before } from 'node:test';

import {
  SUPPORTED_SCHEMA_VERSION,
  decideUpdate,
  fetchPointer,
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
