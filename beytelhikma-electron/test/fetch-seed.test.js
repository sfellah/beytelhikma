import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import zlib from 'node:zlib';

import { SUPPORTED_SCHEMA_VERSION } from '../src/main/catalog-updater.js';
import { fetchSeed } from '../scripts/fetch-seed.mjs';

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

const CLAIR = Buffer.from('SQLite format 3\0'.repeat(64));
const COMPRESSÉ = zlib.zstdCompressSync(CLAIR);
const EMPREINTE = createHash('sha256').update(CLAIR).digest('hex');

function pointeur(patch = {}) {
  return {
    catalog_version: 4,
    schema_version: SUPPORTED_SCHEMA_VERSION,
    generated_at: '2026-08-01T10:00:00Z',
    edition_count: 397,
    object_key: 'catalog/4/catalog.sqlite.zst',
    sha256: EMPREINTE,
    compressed_size: COMPRESSÉ.length,
    uncompressed_size: CLAIR.length,
    ...patch,
  };
}

/** Sert le pointeur puis l'archive, en comptant les requêtes. */
function sert(p = pointeur()) {
  const vues = [];
  handler = (request, response) => {
    vues.push(request.url);
    if (request.url.endsWith('latest.json')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(p));
      return;
    }
    response.writeHead(200, { 'content-length': COMPRESSÉ.length });
    response.end(COMPRESSÉ);
  };
  return vues;
}

function dossierJetable(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beyt-seed-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('la graine est téléchargée, vérifiée et décrite', async (t) => {
  const assets = dossierJetable(t);
  sert();

  const rapport = await fetchSeed({ baseUrl: origin, assetsDir: assets });

  assert.equal(rapport.action, 'fetched');
  assert.equal(rapport.catalogVersion, 4);
  assert.deepEqual(fs.readFileSync(path.join(assets, 'catalog.sqlite.zst')), COMPRESSÉ);

  const décrit = JSON.parse(fs.readFileSync(path.join(assets, 'catalog-seed.json'), 'utf8'));
  assert.equal(décrit.catalog_version, 4);
  assert.equal(décrit.sha256, EMPREINTE);
  assert.equal(décrit.edition_count, 397);
});

test('une graine déjà à jour ne se retélécharge pas', async (t) => {
  // Sans ce court-circuit, chaque build repaierait 8 Mo pour rien une fois le
  // corpus entier publié.
  const assets = dossierJetable(t);
  sert();
  await fetchSeed({ baseUrl: origin, assetsDir: assets });

  const vues = sert();
  const rapport = await fetchSeed({ baseUrl: origin, assetsDir: assets });

  assert.equal(rapport.action, 'upToDate');
  assert.deepEqual(vues, [`/catalog/latest.json`], "seul le pointeur est relu");
});

test('un SHA-256 faux n’écrit rien', async (t) => {
  const assets = dossierJetable(t);
  sert(pointeur({ sha256: 'c'.repeat(64) }));

  await assert.rejects(() => fetchSeed({ baseUrl: origin, assetsDir: assets }), /empreinte/);
  assert.deepEqual(fs.readdirSync(assets), []);
});

test('un schéma trop récent arrête le build', async (t) => {
  // Empaqueter une application dont le catalogue embarqué est illisible
  // produirait un installeur qui échoue au premier lancement, chez
  // l'utilisateur, sans aucun signal avant.
  const assets = dossierJetable(t);
  sert(pointeur({ schema_version: SUPPORTED_SCHEMA_VERSION + 1 }));

  await assert.rejects(() => fetchSeed({ baseUrl: origin, assetsDir: assets }), /schéma/);
  assert.deepEqual(fs.readdirSync(assets), []);
});

test('une source injoignable arrête le build, sans repli', async (t) => {
  // Pas de repli sur une graine périmée : un installeur silencieusement
  // obsolète est pire qu'un build raté.
  const assets = dossierJetable(t);

  await assert.rejects(
    () => fetchSeed({ baseUrl: 'http://127.0.0.1:1/', assetsDir: assets, timeoutMs: 200 }),
    /pointeur/,
  );
  assert.deepEqual(fs.readdirSync(assets), []);
});
