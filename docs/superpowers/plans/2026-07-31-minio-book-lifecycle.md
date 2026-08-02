# Distribution MinIO et cycle de vie des livres — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Servir les fichiers de livres depuis MinIO en HTTP, et donner à l'application Electron le cycle complet télécharger / annuler / réessayer / supprimer, la suppression laissant le choix de conserver ou d'effacer la progression.

**Architecture:** Le catalogue reste local et lu par `AppDatabase.catalog()`. Un nouveau module `download-manager.js` mène un `edition_id` de `queued` à `installed` : `GET` HTTP reprenable par en-tête `Range` vers un `.part`, décompression zstd en flux, SHA-256 vérifié dans le même passage, `rename` atomique. `BookRepository` lui fournit la release et persiste l'état dans `user.sqlite` ; il expose les nouvelles commandes par l'IPC existant, plus un canal poussé `downloads:changed`. `AppDatabase.book()` cesse de copier depuis la source et exige un fichier installé.

**Tech Stack:** Electron 38.8.6 (Node 22.22.0), ESM, sql.js, `node:test`, `node:zlib` (zstd natif), `fetch` global. Côté outils : Python 3, boto3.

## Global Constraints

- Spec de référence : `docs/superpowers/specs/2026-07-31-minio-book-lifecycle-design.md`. En cas de doute, elle tranche.
- **Aucune migration de `user.sqlite`.** `USER_DB_SCHEMA_VERSION` reste à `1`, aucune colonne n'est ajoutée. Le fichier est partagé avec le client Flutter. Le seul ajout est la valeur `'removed'` dans la colonne TEXT `download_status`.
- Les messages d'erreur destinés à l'utilisateur sont en arabe, exactement ceux du tableau de la section 8 de la spec.
- Aucune nouvelle dépendance npm. `zlib.createZstdDecompress` est natif (vérifié : Electron 38.8.6 / Node 22.22.0).
- Aucun identifiant MinIO dans le dépôt. `tools/publish_minio.py` les lit dans `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY`.
- Le rendu n'a ni Node ni accès disque : il ne peut appeler que les méthodes listées dans `REPOSITORY_METHODS`, répercutées à l'identique dans `src/preload/preload.cjs`.
- Pas de chaîne HTML interprétée dans le rendu : tout passe par `h()` de `src/renderer/js/dom.js`.
- Pas d'alignement gauche/droite codé en dur : l'interface est RTL.
- Les tests tournent avec `npm test` depuis `apps/desktop/` et ne doivent jamais toucher le réseau réel.
- Le client Flutter (`beytelhikma/`) n'est pas modifié par ce plan.

## Structure des fichiers

| Fichier | Responsabilité |
| --- | --- |
| `src/main/download-manager.js` *(créé)* | File séquentielle, téléchargement, décompression, vérification, installation. Ne connaît ni SQL ni Electron. |
| `src/main/app-database.js` *(modifié)* | Accès aux trois bases. Cesse de matérialiser les livres ; gagne `closeBook()` et `installedBooks()`. |
| `src/main/book-repository.js` *(modifié)* | Seul module qui connaît le SQL. Branche le gestionnaire, persiste les statuts, expose les nouvelles commandes. |
| `src/main/main.js` *(modifié)* | Câblage : instancie le gestionnaire, relaie `downloads:changed` vers la fenêtre. |
| `src/preload/preload.cjs` *(modifié)* | Pont IPC. Nouvelles méthodes + `onDownloadsChanged`. |
| `src/renderer/js/components/download-action.js` *(créé)* | Bloc d'action réutilisable (télécharger / annuler / lire / supprimer). |
| `src/renderer/js/components/confirm-delete.js` *(créé)* | Modale de suppression à deux issues. |
| `src/renderer/js/views/downloads.js` *(créé)* | Écran `/downloads`. |
| `src/renderer/js/views/book-detail.js` *(modifié)* | Remplace les boutons factices par le bloc d'action. |
| `src/renderer/js/components/book-card.js` *(modifié)* | Badge de statut. |
| `src/renderer/js/views/reader.js` *(modifié)* | Garde : redirection si le livre n'est pas installé. |
| `src/renderer/js/shell.js` *(modifié)* | Entrée de navigation `التنزيلات` + pastille. |
| `src/renderer/js/app.js` *(modifié)* | Route `/downloads`. |
| `src/renderer/styles/components.css` *(modifié)* | Styles du bloc d'action, de la modale, du badge. |
| `src/renderer/styles/views.css` *(modifié)* | Styles de l'écran `/downloads`. |
| `test/download-manager.test.js` *(créé)* | Serveur `node:http` local, tous les cas de la spec §9. |
| `test/repository.test.js` *(modifié)* | Cycle installer / supprimer / réconcilier. |
| `tools/publish_minio.py` *(créé)* | Upload vers MinIO + réécriture de `download_url`. |
| `tools/shamela/tests/test_publish.py` *(créé)* | Tests de l'outil avec un client S3 factice. |

---

### Task 1: Gestionnaire de téléchargement — chemin nominal

**Files:**
- Create: `apps/desktop/src/main/download-manager.js`
- Test: `apps/desktop/test/download-manager.test.js`

**Interfaces:**
- Consumes: rien.
- Produces:
  - `class DownloadError extends Error` avec `code` (`'network' | 'notFound' | 'checksum' | 'diskFull' | 'aborted'`) et `message` en arabe.
  - `async function installRelease({ release, storageRoot, signal, onProgress })` → `Promise<string>` (chemin du fichier installé). `release` = `{ editionId, url, sha256, compressedSize }`. `onProgress` est appelé avec `(receivedBytes, totalBytes)`.

- [ ] **Step 1: Écrire le test du chemin nominal**

Créer `apps/desktop/test/download-manager.test.js` :

```js
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
```

- [ ] **Step 2: Lancer le test, vérifier l'échec**

Run: `cd apps/desktop && node --test test/download-manager.test.js`
Expected: FAIL — `Cannot find module .../src/main/download-manager.js`

- [ ] **Step 3: Écrire l'implémentation minimale**

Créer `apps/desktop/src/main/download-manager.js` :

```js
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import zlib from 'node:zlib';

/** Messages destinés à l'utilisateur, en arabe (spec §8). */
export const DOWNLOAD_MESSAGES = {
  network: 'تعذّر الاتصال بالخادم',
  notFound: 'الملف غير متوفر على الخادم',
  checksum: 'الملف المُنزَّل تالف',
  diskFull: 'لا توجد مساحة كافية',
  aborted: 'أُلغي التنزيل',
};

/** Échec de téléchargement, porteur d'un code stable et d'un message lisible. */
export class DownloadError extends Error {
  constructor(code, cause) {
    super(DOWNLOAD_MESSAGES[code] ?? code);
    this.name = 'DownloadError';
    this.code = code;
    this.cause = cause;
  }
}

const partPath = (storageRoot, editionId) =>
  path.join(storageRoot, 'downloads', `${editionId}.zst.part`);
const tempPath = (storageRoot, editionId) =>
  path.join(storageRoot, 'downloads', `${editionId}.sqlite.tmp`);
const installedPath = (storageRoot, editionId) =>
  path.join(storageRoot, 'books', `${editionId}.sqlite`);

/** Passe-plat qui alimente [hash] sans recopier le flux. */
function hashTap(hash) {
  return new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  });
}

/**
 * Télécharge la release, la décompresse, vérifie son SHA-256 et l'installe.
 * Renvoie le chemin du fichier installé.
 */
export async function installRelease({ release, storageRoot, signal, onProgress }) {
  fs.mkdirSync(path.join(storageRoot, 'books'), { recursive: true });
  fs.mkdirSync(path.join(storageRoot, 'downloads'), { recursive: true });

  const part = partPath(storageRoot, release.editionId);
  await fetchToPart({ release, part, signal, onProgress });
  const target = await unpackAndVerify({ release, part, storageRoot });
  fs.rmSync(part, { force: true });
  return target;
}

/** Télécharge les octets compressés dans [part]. */
async function fetchToPart({ release, part, signal, onProgress }) {
  let response;
  try {
    response = await fetch(release.url, { signal });
  } catch (error) {
    throw new DownloadError('network', error);
  }
  if (response.status === 404) throw new DownloadError('notFound');
  if (!response.ok) throw new DownloadError('network', new Error(`HTTP ${response.status}`));

  const total = Number(response.headers.get('content-length')) || release.compressedSize || 0;
  let received = 0;
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      onProgress?.(received, total);
      callback(null, chunk);
    },
  });

  try {
    await pipeline(Readable.fromWeb(response.body), counter, fs.createWriteStream(part));
  } catch (error) {
    if (error?.code === 'ENOSPC') throw new DownloadError('diskFull', error);
    throw new DownloadError('network', error);
  }
}

/** Décompresse [part], vérifie le hash, installe. */
async function unpackAndVerify({ release, part, storageRoot }) {
  const temp = tempPath(storageRoot, release.editionId);
  const hash = crypto.createHash('sha256');
  try {
    await pipeline(
      fs.createReadStream(part),
      zlib.createZstdDecompress(),
      hashTap(hash),
      fs.createWriteStream(temp),
    );
  } catch (error) {
    fs.rmSync(temp, { force: true });
    if (error?.code === 'ENOSPC') throw new DownloadError('diskFull', error);
    throw new DownloadError('checksum', error);
  }

  if (hash.digest('hex') !== release.sha256) {
    fs.rmSync(temp, { force: true });
    fs.rmSync(part, { force: true }); // cache corrompu : reprendre ne sert à rien
    throw new DownloadError('checksum');
  }

  const target = installedPath(storageRoot, release.editionId);
  fs.renameSync(temp, target);
  return target;
}
```

- [ ] **Step 4: Lancer le test, vérifier le succès**

Run: `cd apps/desktop && node --test test/download-manager.test.js`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/download-manager.js apps/desktop/test/download-manager.test.js
git commit -m "feat(electron): téléchargement, décompression zstd et vérification SHA-256"
```

---

### Task 2: Reprise `Range`, annulation, erreurs

**Files:**
- Modify: `apps/desktop/src/main/download-manager.js`
- Test: `apps/desktop/test/download-manager.test.js`

**Interfaces:**
- Consumes: `installRelease`, `DownloadError` de la tâche 1.
- Produces: `installRelease` accepte un `.part` déjà présent et émet `Range: bytes=<taille>-`. Sur réponse `200` au lieu de `206`, le `.part` est tronqué. Un `AbortSignal` déclenché produit `DownloadError('aborted')` et supprime le `.part`.

- [ ] **Step 1: Écrire les tests d'échec**

Ajouter à `apps/desktop/test/download-manager.test.js` :

```js
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
    response.write(PACKED.subarray(0, cut));
    response.destroy();
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
```

- [ ] **Step 2: Lancer les tests, vérifier l'échec**

Run: `cd apps/desktop && node --test test/download-manager.test.js`
Expected: FAIL — la reprise, l'annulation et la conservation du `.part` ne sont pas implémentées.

- [ ] **Step 3: Implémenter reprise et annulation**

Dans `download-manager.js`, remplacer `fetchToPart` par :

```js
/** Télécharge les octets compressés dans [part], en reprenant s'il existe déjà. */
async function fetchToPart({ release, part, signal, onProgress }) {
  let offset = 0;
  try {
    offset = fs.statSync(part).size;
  } catch {
    offset = 0; // absent : téléchargement complet
  }

  let response;
  try {
    response = await fetch(release.url, {
      signal,
      headers: offset > 0 ? { Range: `bytes=${offset}-` } : {},
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw abandon(part, 'aborted', error);
    throw new DownloadError('network', error);
  }

  if (response.status === 404) throw abandon(part, 'notFound');
  if (!response.ok && response.status !== 206) {
    throw new DownloadError('network', new Error(`HTTP ${response.status}`));
  }

  // Le serveur ignore Range : il renvoie tout, le .part accumulé est obsolète.
  const resuming = response.status === 206;
  if (!resuming) offset = 0;

  const remaining = Number(response.headers.get('content-length')) || 0;
  const total = offset + remaining || release.compressedSize || 0;
  let received = offset;
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      onProgress?.(received, total);
      callback(null, chunk);
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(response.body),
      counter,
      fs.createWriteStream(part, resuming ? { flags: 'a' } : { flags: 'w' }),
      { signal },
    );
  } catch (error) {
    if (error?.name === 'AbortError') throw abandon(part, 'aborted', error);
    if (error?.code === 'ENOSPC') throw new DownloadError('diskFull', error);
    // Coupure réseau : le .part est conservé, la reprise repartira de son offset.
    throw new DownloadError('network', error);
  }
}

/** Supprime le .part devenu inutile puis fabrique l'erreur correspondante. */
function abandon(part, code, cause) {
  fs.rmSync(part, { force: true });
  return new DownloadError(code, cause);
}
```

- [ ] **Step 4: Lancer les tests, vérifier le succès**

Run: `cd apps/desktop && node --test test/download-manager.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/download-manager.js apps/desktop/test/download-manager.test.js
git commit -m "feat(electron): reprise par Range, annulation et erreurs de téléchargement"
```

---

### Task 3: Source locale et file séquentielle

**Files:**
- Modify: `apps/desktop/src/main/download-manager.js`
- Test: `apps/desktop/test/download-manager.test.js`

**Interfaces:**
- Consumes: `installRelease`, `DownloadError`.
- Produces:
  - `installRelease` accepte une `release.url` de schéma non-HTTP (`local://…`, `asset://…`) : le fichier est alors copié depuis `librarySource/books/<editionId>.sqlite` sans décompression, hash vérifié.
  - `class DownloadQueue` avec `constructor({ storageRoot, librarySource, resolveRelease, persist, baseUrl = null })`, et les méthodes :
    - `enqueue(editionId): JobSnapshot`
    - `cancel(editionId): void`
    - `retry(editionId): JobSnapshot`
    - `clearFailed(): void`
    - `snapshot(): JobSnapshot[]`
    - `isBusy(editionId): boolean`
    - `setBaseUrl(url): void`
    - hérite de `EventEmitter`, émet `'change'` avec `snapshot()`.
  - `JobSnapshot` = `{ editionId, status, receivedBytes, totalBytes, percent, error }` où `status ∈ 'queued' | 'downloading' | 'verifying' | 'failed'`.
  - `resolveRelease(editionId)` doit renvoyer `{ releaseId, url, sha256, compressedSize, uncompressedSize }`.
  - `persist(editionId, patch)` reçoit `{ status, receivedBytes, totalBytes, releaseId, localPath }` (champs présents seulement quand ils changent).

- [ ] **Step 1: Écrire les tests**

Ajouter à `apps/desktop/test/download-manager.test.js` :

```js
import { DownloadQueue } from '../src/main/download-manager.js';

test('une URL non HTTP est servie depuis la bibliothèque locale', async () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'beyt-src-'));
  fs.mkdirSync(path.join(source, 'books'), { recursive: true });
  fs.writeFileSync(path.join(source, 'books', 'ed-test-01.sqlite'), PLAIN);

  const installed = await installRelease({
    release: { ...release(), url: 'asset://sample/books/ed-test-01.sqlite' },
    storageRoot,
    librarySource: source,
  });

  assert.deepEqual(fs.readFileSync(installed), PLAIN);
  fs.rmSync(source, { recursive: true, force: true });
});

test('la file traite les livres un par un et rapporte ses états', async () => {
  const states = [];
  const queue = new DownloadQueue({
    storageRoot,
    librarySource: null,
    resolveRelease: async (editionId) => ({
      releaseId: `rel-${editionId}`,
      url: `${origin}/books/${editionId}.zst`,
      sha256: SHA256,
      compressedSize: PACKED.length,
      uncompressedSize: PLAIN.length,
    }),
    persist: async (editionId, patch) => states.push([editionId, patch.status]),
  });

  queue.enqueue('ed-a');
  queue.enqueue('ed-b');
  assert.deepEqual(
    queue.snapshot().map((job) => job.status),
    ['downloading', 'queued'],
  );

  await new Promise((resolve) => queue.once('idle', resolve));

  assert.deepEqual(queue.snapshot(), []);
  assert.ok(fs.existsSync(path.join(storageRoot, 'books', 'ed-a.sqlite')));
  assert.ok(fs.existsSync(path.join(storageRoot, 'books', 'ed-b.sqlite')));
  assert.deepEqual(states.filter(([, status]) => status === 'installed').map(([id]) => id), [
    'ed-a',
    'ed-b',
  ]);
});

test('un échec laisse le job en failed jusqu’au réessai', async () => {
  handler = (request, response) => {
    response.writeHead(404).end();
  };
  const queue = new DownloadQueue({
    storageRoot,
    librarySource: null,
    resolveRelease: async (editionId) => ({
      releaseId: `rel-${editionId}`,
      url: `${origin}/absent.zst`,
      sha256: SHA256,
      compressedSize: PACKED.length,
      uncompressedSize: PLAIN.length,
    }),
    persist: async () => {},
  });

  queue.enqueue('ed-a');
  await new Promise((resolve) => queue.once('idle', resolve));

  const [job] = queue.snapshot();
  assert.equal(job.status, 'failed');
  assert.equal(job.error, 'الملف غير متوفر على الخادم');

  queue.clearFailed();
  assert.deepEqual(queue.snapshot(), []);
});

test('setBaseUrl remplace l’origine de l’URL publiée', async () => {
  const queue = new DownloadQueue({
    storageRoot,
    librarySource: null,
    resolveRelease: async () => ({
      releaseId: 'rel-x',
      url: 'http://minio.invalid:9000/beytelhikma/books/ed-x/1/book.sqlite.zst',
      sha256: SHA256,
      compressedSize: PACKED.length,
      uncompressedSize: PLAIN.length,
    }),
    persist: async () => {},
  });
  queue.setBaseUrl(origin);

  queue.enqueue('ed-x');
  await new Promise((resolve) => queue.once('idle', resolve));

  assert.deepEqual(queue.snapshot(), []);
  assert.ok(fs.existsSync(path.join(storageRoot, 'books', 'ed-x.sqlite')));
});
```

- [ ] **Step 2: Lancer les tests, vérifier l'échec**

Run: `cd apps/desktop && node --test test/download-manager.test.js`
Expected: FAIL — `DownloadQueue` n'existe pas, `librarySource` est ignoré.

- [ ] **Step 3: Implémenter la source locale et la file**

Dans `download-manager.js`, ajouter l'import `import { EventEmitter } from 'node:events';`, puis modifier `installRelease` et ajouter `DownloadQueue` :

```js
/**
 * Télécharge la release, la décompresse, vérifie son SHA-256 et l'installe.
 * Une URL de schéma non HTTP désigne un fichier de [librarySource] : c'est le
 * mode hors ligne, celui de `assets/sample` et de `dist/shamela`.
 */
export async function installRelease({
  release,
  storageRoot,
  librarySource = null,
  signal,
  onProgress,
}) {
  fs.mkdirSync(path.join(storageRoot, 'books'), { recursive: true });
  fs.mkdirSync(path.join(storageRoot, 'downloads'), { recursive: true });

  if (!/^https?:/i.test(release.url)) {
    return installFromLibrary({ release, storageRoot, librarySource, onProgress });
  }

  const part = partPath(storageRoot, release.editionId);
  await fetchToPart({ release, part, signal, onProgress });
  const target = await unpackAndVerify({ release, part, storageRoot });
  fs.rmSync(part, { force: true });
  return target;
}

/** Mode hors ligne : le fichier est déjà là, non compressé. */
async function installFromLibrary({ release, storageRoot, librarySource, onProgress }) {
  if (!librarySource) throw new DownloadError('notFound');
  const source = path.join(librarySource, 'books', `${release.editionId}.sqlite`);
  if (!fs.existsSync(source)) throw new DownloadError('notFound');

  const temp = tempPath(storageRoot, release.editionId);
  const hash = crypto.createHash('sha256');
  const total = fs.statSync(source).size;
  let received = 0;
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      onProgress?.(received, total);
      callback(null, chunk);
    },
  });

  try {
    await pipeline(fs.createReadStream(source), counter, hashTap(hash), fs.createWriteStream(temp));
  } catch (error) {
    fs.rmSync(temp, { force: true });
    if (error?.code === 'ENOSPC') throw new DownloadError('diskFull', error);
    throw new DownloadError('network', error);
  }

  if (hash.digest('hex') !== release.sha256) {
    fs.rmSync(temp, { force: true });
    throw new DownloadError('checksum');
  }

  const target = installedPath(storageRoot, release.editionId);
  fs.renameSync(temp, target);
  return target;
}

/**
 * File séquentielle : un seul téléchargement actif, les autres en attente.
 * Elle ne connaît pas le SQL — elle appelle [resolveRelease] pour obtenir la
 * release et [persist] pour écrire l'état dans `user.sqlite`.
 */
export class DownloadQueue extends EventEmitter {
  #storageRoot;
  #librarySource;
  #resolveRelease;
  #persist;
  #baseUrl;
  #jobs = new Map();
  #controllers = new Map();
  #running = false;

  constructor({ storageRoot, librarySource, resolveRelease, persist, baseUrl = null }) {
    super();
    this.#storageRoot = storageRoot;
    this.#librarySource = librarySource;
    this.#resolveRelease = resolveRelease;
    this.#persist = persist;
    this.#baseUrl = baseUrl;
  }

  setBaseUrl(url) {
    this.#baseUrl = url || null;
  }

  isBusy(editionId) {
    const status = this.#jobs.get(editionId)?.status;
    return status === 'queued' || status === 'downloading' || status === 'verifying';
  }

  snapshot() {
    return [...this.#jobs.values()].map((job) => ({ ...job }));
  }

  enqueue(editionId) {
    const existing = this.#jobs.get(editionId);
    if (existing && existing.status !== 'failed') return { ...existing };
    this.#jobs.set(editionId, {
      editionId,
      status: 'queued',
      receivedBytes: 0,
      totalBytes: 0,
      percent: 0,
      error: null,
    });
    this.#persist(editionId, { status: 'queued', receivedBytes: 0 });
    this.#emit();
    this.#pump();
    return { ...this.#jobs.get(editionId) };
  }

  retry(editionId) {
    this.#jobs.delete(editionId);
    return this.enqueue(editionId);
  }

  cancel(editionId) {
    const job = this.#jobs.get(editionId);
    if (!job) return;
    this.#controllers.get(editionId)?.abort();
    this.#jobs.delete(editionId);
    fs.rmSync(partPath(this.#storageRoot, editionId), { force: true });
    this.#persist(editionId, { status: 'removed', receivedBytes: 0 });
    this.#emit();
  }

  clearFailed() {
    for (const [editionId, job] of this.#jobs) {
      if (job.status === 'failed') this.#jobs.delete(editionId);
    }
    this.#emit();
  }

  #emit() {
    this.emit('change', this.snapshot());
  }

  #next() {
    for (const job of this.#jobs.values()) if (job.status === 'queued') return job;
    return null;
  }

  async #pump() {
    if (this.#running) return;
    this.#running = true;
    try {
      let job;
      while ((job = this.#next())) await this.#run(job);
    } finally {
      this.#running = false;
      this.emit('idle');
    }
  }

  async #run(job) {
    const { editionId } = job;
    const controller = new AbortController();
    this.#controllers.set(editionId, controller);
    job.status = 'downloading';
    this.#emit();

    // Écriture au plus une fois par 500 ms : sql.js réexporte tout le fichier
    // à chaque write, une mise à jour par paquet mettrait l'app à genoux.
    let lastWrite = 0;

    try {
      const release = await this.#resolveRelease(editionId);
      if (!release) throw new DownloadError('notFound');
      await this.#persist(editionId, {
        status: 'downloading',
        releaseId: release.releaseId,
        totalBytes: release.uncompressedSize ?? 0,
      });

      const localPath = await installRelease({
        release: { ...release, editionId, url: this.#applyBaseUrl(release.url) },
        storageRoot: this.#storageRoot,
        librarySource: this.#librarySource,
        signal: controller.signal,
        onProgress: (received, total) => {
          const current = this.#jobs.get(editionId);
          if (!current) return;
          current.receivedBytes = received;
          current.totalBytes = total;
          current.percent = total > 0 ? received / total : 0;
          const now = Date.now();
          if (now - lastWrite >= 500) {
            lastWrite = now;
            this.#persist(editionId, { status: 'downloading', receivedBytes: received });
            this.#emit();
          }
        },
      });

      const verifying = this.#jobs.get(editionId);
      if (verifying) {
        verifying.status = 'verifying';
        this.#emit();
      }

      await this.#persist(editionId, {
        status: 'installed',
        receivedBytes: release.uncompressedSize ?? 0,
        totalBytes: release.uncompressedSize ?? 0,
        localPath: `books/${editionId}.sqlite`,
        releaseId: release.releaseId,
      });
      this.#jobs.delete(editionId);
    } catch (error) {
      // `cancel` a déjà retiré le job et écrit son état : ne rien écraser.
      if (this.#jobs.has(editionId)) {
        const failed = this.#jobs.get(editionId);
        failed.status = 'failed';
        failed.error = error?.message ?? String(error);
        await this.#persist(editionId, { status: 'failed' });
      }
    } finally {
      this.#controllers.delete(editionId);
      this.#emit();
    }
  }

  /** Réglage `minio.base_url` : remplace l'origine des URL du catalogue. */
  #applyBaseUrl(url) {
    if (!this.#baseUrl || !/^https?:/i.test(url)) return url;
    const target = new URL(url);
    const base = new URL(this.#baseUrl);
    target.protocol = base.protocol;
    target.host = base.host;
    return target.toString();
  }
}
```

Note : `unpackAndVerify` est appelée depuis `installRelease` avant le `verifying` du job ; la fenêtre `verifying` est donc courte sur les petits livres et bien visible sur les gros. C'est le comportement attendu.

- [ ] **Step 4: Lancer les tests, vérifier le succès**

Run: `cd apps/desktop && node --test test/download-manager.test.js`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/download-manager.js apps/desktop/test/download-manager.test.js
git commit -m "feat(electron): file séquentielle de téléchargement et repli sur la bibliothèque locale"
```

---

### Task 4: `AppDatabase` cesse de matérialiser les livres

**Files:**
- Modify: `apps/desktop/src/main/app-database.js`
- Test: `apps/desktop/test/library.test.js`

**Interfaces:**
- Consumes: rien.
- Produces:
  - `class BookNotInstalledError extends Error` exportée depuis `app-database.js`, avec `editionId`.
  - `AppDatabase.book(editionId)` lève `BookNotInstalledError` si `<root>/books/<editionId>.sqlite` n'existe pas.
  - `AppDatabase.closeBook(editionId): void`
  - `AppDatabase.installedBooks(): string[]`

- [ ] **Step 1: Écrire le test**

Ajouter à la fin de `apps/desktop/test/library.test.js` :

```js
import { AppDatabase, BookNotInstalledError } from '../src/main/app-database.js';

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
  assert.ok(all(book, 'SELECT page_id FROM pages LIMIT 1').length === 1);

  database.closeBook('ed-muqaddima-01');
  fs.rmSync(path.join(root, 'books', 'ed-muqaddima-01.sqlite'));
  await assert.rejects(() => database.book('ed-muqaddima-01'), BookNotInstalledError);

  database.close();
  fs.rmSync(root, { recursive: true, force: true });
});
```

- [ ] **Step 2: Lancer le test, vérifier l'échec**

Run: `cd apps/desktop && node --test test/library.test.js`
Expected: FAIL — `BookNotInstalledError` n'est pas exportée, `book()` copie le fichier.

- [ ] **Step 3: Modifier `app-database.js`**

Ajouter après la déclaration de `USER_SCHEMA` :

```js
/** Le fichier du livre n'est pas installé : l'appelant doit le télécharger. */
export class BookNotInstalledError extends Error {
  constructor(editionId) {
    super(`livre non installé : ${editionId}`);
    this.name = 'BookNotInstalledError';
    this.editionId = editionId;
  }
}
```

Remplacer la méthode `book()` :

```js
  /**
   * Ouvre un livre **installé**. Contrairement au catalogue, aucun fichier n'est
   * copié ici : c'est le gestionnaire de téléchargement qui installe les livres.
   */
  async book(editionId) {
    const cached = this.#books.get(editionId);
    if (cached) return cached;
    const file = path.join(this.#root, 'books', `${editionId}.sqlite`);
    if (!fs.existsSync(file)) throw new BookNotInstalledError(editionId);
    const db = await this.#open(file);
    this.#books.set(editionId, db);
    return db;
  }

  /** Ferme un livre et le retire du cache : préalable à sa suppression. */
  closeBook(editionId) {
    const db = this.#books.get(editionId);
    if (!db) return;
    db.close();
    this.#books.delete(editionId);
  }

  /** Identifiants des livres dont le fichier est présent sur le disque. */
  installedBooks() {
    const dir = path.join(this.#root, 'books');
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.sqlite'))
      .map((name) => name.slice(0, -'.sqlite'.length))
      .sort();
  }
```

Mettre à jour le commentaire de classe : remplacer la phrase « Le catalogue est copié au démarrage, chaque livre seulement à sa première ouverture. » par « Seul le catalogue est copié depuis la source ; les livres sont installés par `download-manager.js`. »

- [ ] **Step 4: Lancer les tests, vérifier le succès du nouveau**

Run: `cd apps/desktop && node --test test/library.test.js`
Expected: le nouveau test PASS. D'autres tests de ce fichier et de `repository.test.js` peuvent échouer — ils dépendent de `warmUp()` et sont corrigés à la tâche 5.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/app-database.js apps/desktop/test/library.test.js
git commit -m "feat(electron): AppDatabase exige un livre installé, ferme et liste les livres"
```

---

### Task 5: `reconcileLibrary()` remplace `warmUp()`, gestionnaire branché

**Files:**
- Modify: `apps/desktop/src/main/book-repository.js`
- Modify: `apps/desktop/test/repository.test.js`
- Modify: `apps/desktop/test/library.test.js`

**Interfaces:**
- Consumes: `DownloadQueue`, `DownloadError` (tâche 3) ; `BookNotInstalledError`, `installedBooks()`, `closeBook()` (tâche 4).
- Produces:
  - `new BookRepository(database, { downloads = null } = {})` — `downloads` est une `DownloadQueue`, optionnelle pour les tests qui n'en ont pas besoin.
  - `BookRepository.createDownloadQueue()` → construit et mémorise une `DownloadQueue` câblée sur ce dépôt ; renvoie l'instance.
  - `BookRepository.reconcileLibrary(): Promise<void>` — remplace `warmUp()`, qui est supprimé.
  - `BookRepository.downloadBook(editionId)`, `cancelDownload(editionId)`, `retryDownload(editionId)`.
  - `getLibrary()` ne renvoie que les entrées `download_status = 'installed'`.

- [ ] **Step 1: Écrire le test**

Dans `apps/desktop/test/repository.test.js`, remplacer le bloc `before` :

```js
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
```

Remplacer le test `'la bibliothèque liste les livres installés'` par :

```js
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
  assert.equal(library.some((entry) => entry.book.editionId === 'ed-muqaddima-01'), false);

  // Fichier reposé à la main : la réconciliation le réintègre.
  fs.copyFileSync(
    path.join(projectRoot, 'assets', 'sample', 'books', 'ed-muqaddima-01.sqlite'),
    path.join(storageRoot, 'books', 'ed-muqaddima-01.sqlite'),
  );
  await repository.reconcileLibrary();
  library = await repository.getLibrary();
  assert.ok(library.some((entry) => entry.book.editionId === 'ed-muqaddima-01'));
});
```

Dans `test/library.test.js`, remplacer chaque `await repository.warmUp()` par `await repository.reconcileLibrary()`. Les assertions de ce fichier qui comptent des entrées de bibliothèque doivent désormais attendre `0` avant installation ; ajuster celles qui échouent en conséquence, sans changer leur intention.

- [ ] **Step 2: Lancer les tests, vérifier l'échec**

Run: `cd apps/desktop && npm test`
Expected: FAIL — `repository.createDownloadQueue is not a function`, `reconcileLibrary is not a function`.

- [ ] **Step 3: Modifier `book-repository.js`**

Ajouter en tête :

```js
import fs from 'node:fs';
import path from 'node:path';

import { all, first } from './app-database.js';
import { DownloadQueue } from './download-manager.js';
```

Remplacer le constructeur et `warmUp()` :

```js
export class BookRepository {
  #db;
  #downloads = null;

  constructor(database, { downloads = null } = {}) {
    this.#db = database;
    this.#downloads = downloads;
  }

  get downloads() {
    return this.#downloads;
  }

  /**
   * Construit la file de téléchargement câblée sur ce dépôt : elle lui demande
   * la release active et lui délègue l'écriture dans `user.sqlite`.
   */
  createDownloadQueue() {
    this.#downloads = new DownloadQueue({
      storageRoot: this.#db.root,
      librarySource: this.#db.librarySource,
      resolveRelease: (editionId) => this.#activeRelease(editionId),
      persist: (editionId, patch) => this.#persistDownload(editionId, patch),
    });
    return this.#downloads;
  }

  async #activeRelease(editionId) {
    const catalog = await this.#db.catalog();
    const row = first(
      catalog,
      `SELECT release_id, download_url, sha256, compressed_size, uncompressed_size
       FROM book_releases WHERE edition_id = ? AND is_active = 1 LIMIT 1`,
      [editionId],
    );
    if (!row) return null;
    return {
      releaseId: row.release_id,
      url: row.download_url,
      sha256: row.sha256,
      compressedSize: row.compressed_size ?? 0,
      uncompressedSize: row.uncompressed_size ?? 0,
    };
  }

  async #persistDownload(editionId, patch) {
    await this.#db.writeUser((user) => {
      user.run(
        `INSERT INTO downloaded_books
           (edition_id, release_id, local_path, download_status,
            downloaded_bytes, total_bytes, downloaded_at, progress_percent)
         VALUES (?,?,?,?,?,?,?,0)
         ON CONFLICT(edition_id) DO UPDATE SET
           release_id       = COALESCE(excluded.release_id, downloaded_books.release_id),
           local_path       = COALESCE(excluded.local_path, downloaded_books.local_path),
           download_status  = excluded.download_status,
           downloaded_bytes = excluded.downloaded_bytes,
           total_bytes      = CASE WHEN excluded.total_bytes > 0
                                   THEN excluded.total_bytes
                                   ELSE downloaded_books.total_bytes END,
           downloaded_at    = COALESCE(excluded.downloaded_at, downloaded_books.downloaded_at)`,
        [
          editionId,
          patch.releaseId ?? null,
          patch.localPath ?? null,
          patch.status,
          patch.receivedBytes ?? 0,
          patch.totalBytes ?? 0,
          patch.status === 'installed' ? new Date().toISOString() : null,
        ],
      );
    });
  }

  /**
   * Confronte les fichiers réellement présents aux lignes de `downloaded_books`.
   * Remplace l'ancien `warmUp()`, qui déclarait tout le catalogue installé.
   */
  reconcileLibrary() {
    return this.#guard('réconciliation de la bibliothèque', async () => {
      const present = new Set(this.#db.installedBooks());
      const user = await this.#db.user();
      const rows = all(user, 'SELECT edition_id, download_status FROM downloaded_books');
      const known = new Set(rows.map((row) => row.edition_id));

      await this.#db.writeUser((db) => {
        for (const row of rows) {
          if (present.has(row.edition_id)) {
            if (row.download_status !== 'installed') {
              db.run(
                "UPDATE downloaded_books SET download_status = 'installed' WHERE edition_id = ?",
                [row.edition_id],
              );
            }
          } else if (row.download_status === 'installed') {
            db.run(
              `UPDATE downloaded_books
                  SET download_status = 'removed', downloaded_bytes = 0, local_path = NULL
                WHERE edition_id = ?`,
              [row.edition_id],
            );
          } else if (row.download_status === 'downloading' || row.download_status === 'verifying') {
            db.run(
              "UPDATE downloaded_books SET download_status = 'queued' WHERE edition_id = ?",
              [row.edition_id],
            );
          }
        }
        // Fichier posé à la main, sans ligne : on l'adopte.
        for (const editionId of present) {
          if (known.has(editionId)) continue;
          db.run(
            `INSERT INTO downloaded_books
               (edition_id, local_path, download_status, downloaded_bytes,
                total_bytes, downloaded_at, progress_percent)
             VALUES (?,?, 'installed', 0, 0, ?, 0)`,
            [editionId, `books/${editionId}.sqlite`, new Date().toISOString()],
          );
        }
      });

      // Les téléchargements interrompus repartent seuls.
      if (this.#downloads) {
        const resumable = all(
          await this.#db.user(),
          "SELECT edition_id FROM downloaded_books WHERE download_status = 'queued'",
        );
        for (const row of resumable) this.#downloads.enqueue(row.edition_id);
      }
    });
  }

  // ------------------------------------------------------------ téléchargement

  downloadBook(editionId) {
    return this.#guard('mise en file du téléchargement', async () => {
      if (!this.#downloads) throw new Error('gestionnaire de téléchargement absent');
      return this.#downloads.enqueue(editionId);
    });
  }

  cancelDownload(editionId) {
    return this.#guard("annulation du téléchargement", async () => {
      this.#downloads?.cancel(editionId);
    });
  }

  retryDownload(editionId) {
    return this.#guard('réessai du téléchargement', async () => {
      if (!this.#downloads) throw new Error('gestionnaire de téléchargement absent');
      return this.#downloads.retry(editionId);
    });
  }
```

Modifier `getLibrary()` pour filtrer :

```js
  getLibrary() {
    return this.#guard('lecture de la bibliothèque', async () => {
      const user = await this.#db.user();
      const installed = all(
        user,
        `SELECT * FROM downloaded_books
          WHERE download_status = 'installed'
          ORDER BY last_opened_at DESC, downloaded_at DESC`,
      );
      return installed.length ? this.#joinWithCatalog(installed) : [];
    });
  }
```

Faire de même dans `getContinueReading()` : ajouter `AND download_status = 'installed'` à la clause `WHERE`.

Enfin, dans `REPOSITORY_METHODS`, remplacer `'warmUp'` par `'reconcileLibrary'` et ajouter `'downloadBook'`, `'cancelDownload'`, `'retryDownload'`.

Dans `main.js`, remplacer `await repository.warmUp();` par :

```js
  repository = new BookRepository(database);
  repository.createDownloadQueue();
  await repository.reconcileLibrary();
```

- [ ] **Step 4: Lancer les tests, vérifier le succès**

Run: `cd apps/desktop && npm test`
Expected: PASS pour l'ensemble de la suite.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main apps/desktop/test
git commit -m "feat(electron): réconciliation de la bibliothèque et commandes de téléchargement"
```

---

### Task 6: Suppression au choix de l'utilisateur

**Files:**
- Modify: `apps/desktop/src/main/book-repository.js`
- Test: `apps/desktop/test/repository.test.js`

**Interfaces:**
- Consumes: `closeBook()` (tâche 4), `DownloadQueue.isBusy()` (tâche 3).
- Produces: `BookRepository.deleteBook(editionId, { keepProgress = true } = {}): Promise<void>`.

- [ ] **Step 1: Écrire le test**

Ajouter à `apps/desktop/test/repository.test.js` :

```js
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
  assert.equal(library.some((entry) => entry.book.editionId === 'ed-risala-01'), false);

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
```

Ajouter `all` à l'import depuis `../src/main/app-database.js` en tête du fichier.

- [ ] **Step 2: Lancer les tests, vérifier l'échec**

Run: `cd apps/desktop && node --test test/repository.test.js`
Expected: FAIL — `repository.deleteBook is not a function`

- [ ] **Step 3: Implémenter `deleteBook`**

Dans `book-repository.js`, après `retryDownload` :

```js
  /**
   * Supprime le fichier du livre. [keepProgress] décide du sort de l'état
   * utilisateur : conservé (le livre repasse en `removed`) ou effacé avec la
   * ligne et les appartenances aux collections.
   */
  deleteBook(editionId, { keepProgress = true } = {}) {
    return this.#guard('suppression du livre', async () => {
      if (this.#downloads?.isBusy(editionId)) {
        throw new Error('téléchargement en cours : annuler avant de supprimer');
      }

      this.#db.closeBook(editionId);
      const root = this.#db.root;
      fs.rmSync(path.join(root, 'books', `${editionId}.sqlite`), { force: true });
      fs.rmSync(path.join(root, 'downloads', `${editionId}.zst.part`), { force: true });
      fs.rmSync(path.join(root, 'downloads', `${editionId}.sqlite.tmp`), { force: true });

      await this.#db.writeUser((user) => {
        if (keepProgress) {
          user.run(
            `UPDATE downloaded_books
                SET download_status = 'removed', downloaded_bytes = 0, local_path = NULL
              WHERE edition_id = ?`,
            [editionId],
          );
        } else {
          user.run('DELETE FROM downloaded_books WHERE edition_id = ?', [editionId]);
          user.run('DELETE FROM collection_books WHERE edition_id = ?', [editionId]);
        }
      });
    });
  }
```

Ajouter `'deleteBook'` à `REPOSITORY_METHODS`.

- [ ] **Step 4: Lancer les tests, vérifier le succès**

Run: `cd apps/desktop && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/book-repository.js apps/desktop/test/repository.test.js
git commit -m "feat(electron): suppression d'un livre avec ou sans conservation de la progression"
```

---

### Task 7: Statuts exposés au rendu

**Files:**
- Modify: `apps/desktop/src/main/book-repository.js`
- Test: `apps/desktop/test/repository.test.js`

**Interfaces:**
- Consumes: `DownloadQueue.snapshot()`, `clearFailed()`.
- Produces:
  - `getDownloads(): Promise<JobSnapshot[]>`
  - `clearFailedDownloads(): Promise<void>`
  - `getStorageUsage(): Promise<{ bookCount: number, bytes: number }>`
  - `getBookDetail(editionId)` gagne `download: { status, percent, compressedSize, uncompressedSize, releaseId }`.
  - Toutes les listes de résumés portent désormais `downloadStatus` (`'installed' | 'queued' | 'downloading' | 'verifying' | 'failed' | 'removed' | null`).

- [ ] **Step 1: Écrire le test**

Ajouter à `apps/desktop/test/repository.test.js` :

```js
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
```

- [ ] **Step 2: Lancer les tests, vérifier l'échec**

Run: `cd apps/desktop && node --test test/repository.test.js`
Expected: FAIL — `downloadStatus` absent, `getStorageUsage` non définie.

- [ ] **Step 3: Implémenter**

Dans `book-repository.js`, ajouter une méthode privée et l'appliquer aux listes :

```js
  /**
   * Joint le statut d'installation aux résumés d'une page de résultats.
   * Une seule requête `user.sqlite` par appel, pas une par livre.
   */
  async #withDownloadStatus(summaries) {
    if (!summaries.length) return summaries;
    const user = await this.#db.user();
    const ids = summaries.map((book) => book.editionId);
    const placeholders = ids.map(() => '?').join(',');
    const byId = new Map(
      all(
        user,
        `SELECT edition_id, download_status FROM downloaded_books
          WHERE edition_id IN (${placeholders})`,
        ids,
      ).map((row) => [row.edition_id, row.download_status]),
    );
    const live = new Map((this.#downloads?.snapshot() ?? []).map((job) => [job.editionId, job.status]));
    for (const book of summaries) {
      book.downloadStatus = live.get(book.editionId) ?? byId.get(book.editionId) ?? null;
    }
    return summaries;
  }
```

Envelopper le `return` de `getRecentBooks`, `getBooks`, `getBooksByCategory`, `getBooksByCentury`, `getBooksByAuthor` :

```js
      return this.#withDownloadStatus(
        all(db, /* … requête inchangée … */).map(bookSummary),
      );
```

Dans `getBookDetail`, après le calcul de `summary`, lire la release et l'état, puis ajouter la clé au retour :

```js
      const release = await this.#activeRelease(editionId);
      const user = await this.#db.user();
      const stored = first(
        user,
        'SELECT download_status, progress_percent FROM downloaded_books WHERE edition_id = ?',
        [editionId],
      );
      const job = (this.#downloads?.snapshot() ?? []).find((item) => item.editionId === editionId);
      const download = {
        status: job?.status ?? stored?.download_status ?? null,
        percent: job?.percent ?? 0,
        error: job?.error ?? null,
        compressedSize: release?.compressedSize ?? 0,
        uncompressedSize: release?.uncompressedSize ?? 0,
        releaseId: release?.releaseId ?? null,
      };
```

et dans l'objet renvoyé, ajouter `download,` juste après `otherEditions,`.

Ajouter enfin :

```js
  getDownloads() {
    return this.#guard('lecture des téléchargements', async () =>
      this.#downloads?.snapshot() ?? [],
    );
  }

  clearFailedDownloads() {
    return this.#guard('nettoyage des téléchargements échoués', async () => {
      this.#downloads?.clearFailed();
    });
  }

  getStorageUsage() {
    return this.#guard("lecture de l'espace occupé", async () => {
      const dir = path.join(this.#db.root, 'books');
      const ids = this.#db.installedBooks();
      let bytes = 0;
      for (const editionId of ids) {
        try {
          bytes += fs.statSync(path.join(dir, `${editionId}.sqlite`)).size;
        } catch {
          // Fichier disparu entre le listage et la mesure : il ne compte pas.
        }
      }
      return { bookCount: ids.length, bytes };
    });
  }
```

Ajouter `'getDownloads'`, `'clearFailedDownloads'`, `'getStorageUsage'` à `REPOSITORY_METHODS`.

- [ ] **Step 4: Lancer les tests, vérifier le succès**

Run: `cd apps/desktop && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/book-repository.js apps/desktop/test/repository.test.js
git commit -m "feat(electron): statut de téléchargement dans les résumés, fiches et espace occupé"
```

---

### Task 8: IPC, préchargement, canal poussé

**Files:**
- Modify: `apps/desktop/src/main/main.js`
- Modify: `apps/desktop/src/preload/preload.cjs`
- Modify: `apps/desktop/src/renderer/js/repository.js`

**Interfaces:**
- Consumes: `REPOSITORY_METHODS` (tâches 5-7), `DownloadQueue` événement `'change'`.
- Produces:
  - `window.beytelhikma.repository.{downloadBook, cancelDownload, retryDownload, deleteBook, getDownloads, clearFailedDownloads, getStorageUsage}`
  - `window.beytelhikma.onDownloadsChanged(callback): () => void` — `callback` reçoit `JobSnapshot[]`.
  - Depuis `src/renderer/js/repository.js` : `export function onDownloadsChanged(callback)`.

- [ ] **Step 1: Relayer l'événement depuis `main.js`**

Dans `main.js`, `openRepository()` devient :

```js
async function openRepository() {
  const librarySource = resolveLibrarySource(projectRoot);
  console.log(`[beytelhikma] bibliothèque : ${librarySource}`);
  database = new AppDatabase({
    librarySource,
    storageRoot: path.join(app.getPath('userData'), 'library'),
  });
  await database.initialize();
  repository = new BookRepository(database);
  const downloads = repository.createDownloadQueue();

  // Réglage optionnel : pointer un autre MinIO sans régénérer le catalogue.
  const settings = await repository.getSettings();
  downloads.setBaseUrl(settings['minio.base_url'] ?? null);

  downloads.on('change', (jobs) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('downloads:changed', jobs);
    }
  });

  await repository.reconcileLibrary();
}
```

- [ ] **Step 2: Étendre le préchargement**

Dans `src/preload/preload.cjs`, compléter `METHODS` avec les sept nouvelles entrées et remplacer l'appel final :

```js
const METHODS = [
  'reconcileLibrary',
  'getCategories',
  'getRecentBooks',
  'getBooks',
  'getBooksByCategory',
  'getBookDetail',
  'getFeaturedAuthor',
  'getAuthors',
  'getEras',
  'getBooksByCentury',
  'getBooksByAuthor',
  'getToc',
  'getPageCount',
  'getPages',
  'getPageById',
  'getLibrary',
  'getContinueReading',
  'getProgress',
  'saveProgress',
  'getSettings',
  'saveSetting',
  'downloadBook',
  'cancelDownload',
  'retryDownload',
  'deleteBook',
  'getDownloads',
  'clearFailedDownloads',
  'getStorageUsage',
];

const repository = {};
for (const method of METHODS) {
  repository[method] = (...args) => ipcRenderer.invoke('repository', method, args);
}

/** Abonnement au canal poussé ; renvoie la fonction de désabonnement. */
function onDownloadsChanged(callback) {
  const listener = (_event, jobs) => callback(jobs);
  ipcRenderer.on('downloads:changed', listener);
  return () => ipcRenderer.off('downloads:changed', listener);
}

contextBridge.exposeInMainWorld('beytelhikma', { repository, onDownloadsChanged });
```

- [ ] **Step 3: Réexporter côté rendu**

Dans `src/renderer/js/repository.js`, ajouter :

```js
/**
 * S'abonne au canal poussé des téléchargements. Renvoie la fonction de
 * désabonnement : toute vue qui s'abonne doit l'appeler quand elle disparaît.
 */
export function onDownloadsChanged(callback) {
  return window.beytelhikma.onDownloadsChanged(callback);
}
```

- [ ] **Step 4: Vérifier que l'application démarre**

Run: `cd apps/desktop && npm test && BEYT_CAPTURE=1 npm start`
Expected: la suite passe ; l'application démarre, produit ses captures dans `build/screenshots/` et quitte sans erreur console.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/main.js apps/desktop/src/preload/preload.cjs apps/desktop/src/renderer/js/repository.js
git commit -m "feat(electron): IPC des téléchargements et canal poussé downloads:changed"
```

---

### Task 9: Bloc d'action de la fiche livre

**Files:**
- Create: `apps/desktop/src/renderer/js/components/download-action.js`
- Modify: `apps/desktop/src/renderer/js/views/book-detail.js`
- Modify: `apps/desktop/src/renderer/styles/components.css`

**Interfaces:**
- Consumes: `repository.downloadBook / cancelDownload / retryDownload / deleteBook`, `onDownloadsChanged` (tâche 8) ; `detail.download` (tâche 7).
- Produces: `export function downloadAction({ book, download, progress, onOpen, onDelete, onChanged })` → `HTMLElement`. `onDelete` est appelé sans argument quand l'utilisateur demande la suppression (la modale arrive à la tâche 10 ; ici, `onDelete` supprime directement en conservant la progression).

- [ ] **Step 1: Écrire le composant**

Créer `apps/desktop/src/renderer/js/components/download-action.js` :

```js
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { repository, onDownloadsChanged } from '../repository.js';
import { toast } from '../shell.js';

/** Octets -> « 12,4 م.ب », en chiffres arabes occidentaux comme le reste de l'UI. */
export function formatBytes(bytes) {
  if (!bytes) return '';
  const mega = bytes / (1024 * 1024);
  if (mega >= 1) return `${mega.toFixed(1).replace('.', ',')} م.ب`;
  return `${Math.max(1, Math.round(bytes / 1024))} ك.ب`;
}

/**
 * Bloc d'action unique de la fiche livre : télécharger, patienter, annuler,
 * lire, supprimer, réessayer. Se réabonne au canal poussé et se redessine seul.
 */
export function downloadAction({ book, download, progress, onOpen, onDelete }) {
  const host = h('div', { class: 'download-action' });
  let state = { ...download };

  const unsubscribe = onDownloadsChanged((jobs) => {
    const job = jobs.find((item) => item.editionId === book.editionId);
    if (job) state = { ...state, ...job };
    else if (state.status && state.status !== 'installed' && state.status !== 'removed') {
      // Le job a disparu de la file : soit installé, soit annulé.
      state = { ...state, status: null, percent: 0, error: null };
      repository.getBookDetail(book.editionId).then((fresh) => {
        state = { ...state, ...fresh.download };
        draw();
      });
    }
    draw();
  });

  // La vue est remplacée à chaque navigation : couper l'abonnement avec elle.
  host.addEventListener('beforeunload', unsubscribe);
  new MutationObserver((records, observer) => {
    if (host.isConnected) return;
    unsubscribe();
    observer.disconnect();
  }).observe(document.body, { childList: true, subtree: true });

  async function run(action, label) {
    try {
      await action();
    } catch (error) {
      toast(error?.message ?? label);
    }
    draw();
  }

  function draw() {
    host.replaceChildren(...content());
  }

  function content() {
    switch (state.status) {
      case 'queued':
        return [
          h('p', { class: 'label-md muted' }, 'في الانتظار'),
          cancelButton(),
        ];
      case 'downloading':
        return [
          h(
            'div',
            { class: 'progress' },
            h('span', { style: { width: `${Math.round((state.percent ?? 0) * 100)}%` } }),
          ),
          h('p', { class: 'label-sm muted' }, `${Math.round((state.percent ?? 0) * 100)}٪`),
          cancelButton(),
        ];
      case 'verifying':
        return [h('p', { class: 'label-md muted' }, 'جارٍ التحقق')];
      case 'installed':
        return [
          h(
            'button',
            { class: 'button button--filled', onclick: onOpen },
            icon('bookOpen', { size: 20 }),
            h('span', {}, progress ? 'متابعة القراءة' : 'ابدأ القراءة'),
          ),
          h(
            'button',
            { class: 'button button--tonal', onclick: onDelete },
            icon('close', { size: 20 }),
            h('span', {}, 'حذف'),
          ),
        ];
      case 'failed':
        return [
          h('p', { class: 'label-md download-action__error' }, state.error ?? 'فشل التنزيل'),
          h(
            'button',
            {
              class: 'button button--filled',
              onclick: () => run(() => repository.retryDownload(book.editionId), 'فشل التنزيل'),
            },
            h('span', {}, 'إعادة المحاولة'),
          ),
        ];
      default:
        return [
          h(
            'button',
            {
              class: 'button button--filled',
              onclick: () => run(() => repository.downloadBook(book.editionId), 'فشل التنزيل'),
            },
            icon('download', { size: 20 }),
            h(
              'span',
              {},
              state.compressedSize ? `تحميل (${formatBytes(state.compressedSize)})` : 'تحميل',
            ),
          ),
          progress &&
            h(
              'p',
              { class: 'label-sm muted' },
              `تتابع من الصفحة ${progress.sequenceNum}`,
            ),
        ];
    }
  }

  function cancelButton() {
    return h(
      'button',
      {
        class: 'button button--tonal',
        onclick: () => run(() => repository.cancelDownload(book.editionId), 'تعذّر الإلغاء'),
      },
      h('span', {}, 'إلغاء'),
    );
  }

  draw();
  return host;
}
```

- [ ] **Step 2: Brancher dans la fiche livre**

Dans `src/renderer/js/views/book-detail.js` :

- ajouter `import { downloadAction } from '../components/download-action.js';`
- remplacer tout le contenu de `h('div', { class: 'detail__actions' }, …)` (les boutons « ابدأ القراءة », « تحميل PDF », المفضلة, مشاركة) par :

```js
        h(
          'div',
          { class: 'detail__actions' },
          downloadAction({
            book,
            download: detail.download,
            progress,
            onOpen: () => openReader(progress?.pageId ?? null),
            onDelete: async () => {
              await repository.deleteBook(book.editionId, { keepProgress: true });
              navigate(`/book/${book.editionId}`);
            },
          }),
          progress &&
            h(
              'div',
              { class: 'progress' },
              h('span', { style: { width: `${Math.round(progress.percent * 100)}%` } }),
            ),
        ),
```

- supprimer l'import devenu inutile de `toast` si plus aucune référence ne subsiste dans le fichier.

- [ ] **Step 3: Ajouter les styles**

Dans `src/renderer/styles/components.css`, à la suite des styles `.detail__actions` :

```css
.download-action {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  width: 100%;
}

.download-action .button {
  width: 100%;
  justify-content: center;
}

.download-action__error {
  color: var(--danger, #a3342b);
}
```

Si `--danger` n'existe pas dans `tokens.css`, l'ajouter au bloc `:root` avec la valeur `#a3342b`.

- [ ] **Step 4: Vérifier visuellement**

Run: `cd apps/desktop && npm start`
Expected: la fiche d'un livre non installé affiche `تحميل (…)`; cliquer déclenche la barre puis l'état `installed` avec `ابدأ القراءة` et `حذف`.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer
git commit -m "feat(ui): bloc d'action de téléchargement sur la fiche livre"
```

---

### Task 10: Modale de suppression à deux issues

**Files:**
- Create: `apps/desktop/src/renderer/js/components/confirm-delete.js`
- Modify: `apps/desktop/src/renderer/js/views/book-detail.js`
- Modify: `apps/desktop/src/renderer/styles/components.css`

**Interfaces:**
- Consumes: `h()` de `dom.js`.
- Produces: `export function confirmDelete({ title, hasProgress }): Promise<'keep' | 'purge' | null>` — `null` si l'utilisateur annule.

- [ ] **Step 1: Écrire le composant**

Créer `apps/desktop/src/renderer/js/components/confirm-delete.js` :

```js
import { h } from '../dom.js';

/**
 * Confirmation de suppression. Rendue en HTML, pas via `dialog.showMessageBox`,
 * pour garder la typographie arabe et le sens de lecture de l'application.
 * Résout `'keep'`, `'purge'` ou `null`.
 */
export function confirmDelete({ title, hasProgress }) {
  return new Promise((resolve) => {
    let settle = (value) => {
      settle = () => {};
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
      resolve(value);
    };

    const onKey = (event) => {
      if (event.key === 'Escape') settle(null);
    };

    const primary = h(
      'button',
      { class: 'button button--filled', onclick: () => settle('keep') },
      hasProgress ? 'حذف مع الاحتفاظ بموضع القراءة' : 'حذف',
    );

    const backdrop = h(
      'div',
      { class: 'modal', onclick: (event) => event.target === backdrop && settle(null) },
      h(
        'div',
        { class: 'modal__panel', role: 'dialog', 'aria-modal': 'true' },
        h('h3', { class: 'title-md' }, `حذف «${title}»؟`),
        h(
          'p',
          { class: 'body-md muted' },
          hasProgress
            ? 'يمكنك حذف الملف مع الاحتفاظ بموضع قراءتك، أو حذف كل شيء نهائيًا.'
            : 'سيُحذف ملف الكتاب من جهازك.',
        ),
        h(
          'div',
          { class: 'modal__actions' },
          primary,
          hasProgress &&
            h(
              'button',
              { class: 'button button--danger', onclick: () => settle('purge') },
              'حذف نهائي',
            ),
          h('button', { class: 'button button--tonal', onclick: () => settle(null) }, 'إلغاء'),
        ),
      ),
    );

    document.addEventListener('keydown', onKey);
    document.body.append(backdrop);
    primary.focus();
  });
}
```

- [ ] **Step 2: Brancher dans la fiche livre**

Dans `book-detail.js`, ajouter `import { confirmDelete } from '../components/confirm-delete.js';` et remplacer le `onDelete` de la tâche 9 par :

```js
            onDelete: async () => {
              const choice = await confirmDelete({
                title: book.title,
                hasProgress: Boolean(progress),
              });
              if (!choice) return;
              await repository.deleteBook(book.editionId, { keepProgress: choice === 'keep' });
              navigate(`/book/${book.editionId}`);
            },
```

- [ ] **Step 3: Ajouter les styles**

Dans `src/renderer/styles/components.css` :

```css
.modal {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgb(0 0 0 / 45%);
  z-index: 50;
}

.modal__panel {
  width: min(30rem, calc(100vw - 2 * var(--space-lg)));
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  padding: var(--space-lg);
  border-radius: var(--radius-lg);
  background: var(--surface);
  box-shadow: 0 1.5rem 3rem rgb(0 0 0 / 25%);
}

.modal__actions {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.button--danger {
  background: var(--danger, #a3342b);
  color: #fff;
}
```

Si `--surface`, `--radius-lg`, `--space-*` portent d'autres noms dans `tokens.css`, utiliser ceux qui existent — ne pas en inventer.

- [ ] **Step 4: Vérifier visuellement**

Run: `cd apps/desktop && npm start`
Expected: `حذف` sur un livre lu ouvre la modale à trois boutons ; sur un livre jamais ouvert, un seul bouton `حذف` plus `إلغاء`. `Échap` annule.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer
git commit -m "feat(ui): modale de suppression, progression conservée ou effacée"
```

---

### Task 11: Écran `/downloads`

**Files:**
- Create: `apps/desktop/src/renderer/js/views/downloads.js`
- Modify: `apps/desktop/src/renderer/js/app.js`
- Modify: `apps/desktop/src/renderer/js/shell.js`
- Modify: `apps/desktop/src/renderer/styles/views.css`

**Interfaces:**
- Consumes: `repository.getDownloads / cancelDownload / retryDownload / clearFailedDownloads / getStorageUsage`, `onDownloadsChanged`, `formatBytes` (tâche 9).
- Produces: `export function downloadsView(host)` — vue de route conforme à la signature attendue par `router.js`.

- [ ] **Step 1: Écrire la vue**

Créer `apps/desktop/src/renderer/js/views/downloads.js` :

```js
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { onDownloadsChanged, repository } from '../repository.js';
import { renderShell } from '../shell.js';
import { formatBytes } from '../components/download-action.js';
import { asyncView, emptyView } from '../components/states.js';

const SECTIONS = [
  { key: 'active', title: 'قيد التنزيل', keep: (job) => job.status === 'downloading' || job.status === 'verifying' },
  { key: 'queued', title: 'في الانتظار', keep: (job) => job.status === 'queued' },
  { key: 'failed', title: 'فشل', keep: (job) => job.status === 'failed' },
];

/** Écran de suivi de la file : en cours, en attente, échecs. */
export function downloadsView(host) {
  const content = renderShell(host, { active: 'downloads' });
  const load = async () => ({
    jobs: await repository.getDownloads(),
    usage: await repository.getStorageUsage(),
  });

  const refresh = () => asyncView(content, load, render, { empty: 'لا توجد تنزيلات' });
  refresh();

  const unsubscribe = onDownloadsChanged(() => {
    if (content.isConnected) refresh();
    else unsubscribe();
  });
  return null;
}

function render({ jobs, usage }) {
  const sections = SECTIONS.map((section) => [section, jobs.filter(section.keep)]).filter(
    ([, items]) => items.length > 0,
  );

  const header = h(
    'div',
    { class: 'downloads__header' },
    h('h1', { class: 'display-lg' }, 'التنزيلات'),
    h(
      'p',
      { class: 'body-md muted' },
      `${usage.bookCount} كتابًا • ${formatBytes(usage.bytes) || '0 ك.ب'}`,
    ),
  );

  if (!sections.length) {
    return h('section', { class: 'downloads' }, header, emptyView('لا توجد تنزيلات جارية'));
  }

  return h(
    'section',
    { class: 'downloads' },
    header,
    sections.map(([section, items]) =>
      h(
        'div',
        { class: 'downloads__section' },
        h(
          'div',
          { class: 'downloads__section-head' },
          h('h2', { class: 'headline-lg' }, section.title),
          section.key === 'failed' &&
            h(
              'button',
              {
                class: 'button button--tonal',
                onclick: () => repository.clearFailedDownloads(),
              },
              'مسح الإخفاقات',
            ),
        ),
        items.map((job) => jobRow(job)),
      ),
    ),
  );
}

function jobRow(job) {
  const percent = Math.round((job.percent ?? 0) * 100);
  return h(
    'article',
    { class: 'download-row' },
    h(
      'div',
      { class: 'download-row__main' },
      h('p', { class: 'title-md' }, job.editionId),
      job.status === 'failed'
        ? h('p', { class: 'label-sm download-action__error' }, job.error ?? 'فشل التنزيل')
        : h(
            'div',
            { class: 'progress' },
            h('span', { style: { width: `${percent}%` } }),
          ),
      job.status !== 'failed' &&
        h(
          'p',
          { class: 'label-sm muted' },
          `${percent}٪ • ${formatBytes(job.receivedBytes)} / ${formatBytes(job.totalBytes)}`,
        ),
    ),
    job.status === 'failed'
      ? h(
          'button',
          {
            class: 'button--icon',
            title: 'إعادة المحاولة',
            onclick: () => repository.retryDownload(job.editionId),
          },
          icon('download', { size: 20 }),
        )
      : h(
          'button',
          {
            class: 'button--icon',
            title: 'إلغاء',
            onclick: () => repository.cancelDownload(job.editionId),
          },
          icon('close', { size: 20 }),
        ),
  );
}
```

- [ ] **Step 2: Déclarer la route et la navigation**

Dans `src/renderer/js/app.js`, ajouter `import { downloadsView } from './views/downloads.js';` et la route `'/downloads': downloadsView,` juste après `'/library'`.

Dans `src/renderer/js/shell.js`, ajouter l'entrée à `NAV`, après `library` :

```js
  { key: 'downloads', path: '/downloads', label: 'التنزيلات', icon: 'download' },
```

Puis, pour la pastille, remplacer le corps de `railItem` afin qu'il accepte un compteur. Ajouter en tête de `shell.js` :

```js
import { onDownloadsChanged, repository } from './repository.js';

/** Nombre de travaux actifs, tenu à jour pour la pastille de navigation. */
let activeDownloads = 0;

repository.getDownloads().then((jobs) => {
  activeDownloads = jobs.length;
  paintBadges();
});
onDownloadsChanged((jobs) => {
  activeDownloads = jobs.length;
  paintBadges();
});

function paintBadges() {
  for (const node of document.querySelectorAll('[data-nav="downloads"]')) {
    const existing = node.querySelector('.nav-badge');
    existing?.remove();
    if (activeDownloads > 0) node.append(h('span', { class: 'nav-badge' }, String(activeDownloads)));
  }
}
```

et, dans `railItem` comme dans `bottomNav`, ajouter `dataset: { nav: key }` aux props du bouton, puis appeler `paintBadges()` à la fin de `renderShell`.

- [ ] **Step 3: Ajouter les styles**

Dans `src/renderer/styles/views.css` :

```css
.downloads {
  display: flex;
  flex-direction: column;
  gap: var(--space-xl);
}

.downloads__section {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.downloads__section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
}

.download-row {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  padding: var(--space-md);
  border-radius: var(--radius-md);
  background: var(--surface);
}

.download-row__main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  min-width: 0;
}

.nav-badge {
  min-width: 1.25rem;
  padding: 0 0.25rem;
  border-radius: 999px;
  background: var(--deep-emerald);
  color: #fff;
  font-size: 0.7rem;
  line-height: 1.25rem;
  text-align: center;
}
```

- [ ] **Step 4: Vérifier visuellement**

Run: `cd apps/desktop && npm start`
Expected: lancer plusieurs téléchargements depuis les fiches, `/downloads` liste le travail actif et les suivants en attente, la pastille de navigation affiche leur nombre, l'annulation vide la ligne.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer
git commit -m "feat(ui): écran des téléchargements et pastille de navigation"
```

---

### Task 12: Badge sur les cartes et garde du lecteur

**Files:**
- Modify: `apps/desktop/src/renderer/js/components/book-card.js`
- Modify: `apps/desktop/src/renderer/js/views/reader.js`
- Modify: `apps/desktop/src/renderer/styles/components.css`

**Interfaces:**
- Consumes: `book.downloadStatus` (tâche 7).
- Produces: aucune nouvelle interface publique.

- [ ] **Step 1: Ajouter le badge**

Dans `src/renderer/js/components/book-card.js`, insérer après le `badge && …` existant, à l'intérieur de `book-card__media` :

```js
      statusBadge(book.downloadStatus),
```

et ajouter en bas du fichier :

```js
/** Pastille discrète d'état : installé ou en cours. Rien d'autre. */
function statusBadge(status) {
  if (status === 'installed') {
    return h('span', { class: 'book-card__status', title: 'مُنزَّل' }, icon('check', { size: 14 }));
  }
  if (status === 'downloading' || status === 'queued' || status === 'verifying') {
    return h(
      'span',
      { class: 'book-card__status book-card__status--busy', title: 'قيد التنزيل' },
      icon('download', { size: 14 }),
    );
  }
  return null;
}
```

- [ ] **Step 2: Garder le lecteur**

Dans `src/renderer/js/views/reader.js`, au début du chargement des données (la fonction qui appelle `repository.getPages` / `getPageCount`), placer la garde :

```js
  const detail = await repository.getBookDetail(editionId);
  if (detail.download?.status !== 'installed') {
    navigate(`/book/${editionId}`);
    return null;
  }
```

Et, dans le gestionnaire d'erreur de navigation de page, si l'erreur mentionne `livre non installé`, appeler `navigate(`/book/${editionId}`)` au lieu d'afficher l'état d'erreur.

- [ ] **Step 3: Ajouter les styles**

Dans `src/renderer/styles/components.css` :

```css
.book-card__status {
  position: absolute;
  inset-block-start: var(--space-xs);
  inset-inline-start: var(--space-xs);
  display: grid;
  place-items: center;
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 999px;
  background: rgb(255 255 255 / 85%);
  color: var(--deep-emerald);
}

.book-card__status--busy {
  color: var(--muted-ink, #6b6357);
}
```

- [ ] **Step 4: Vérifier visuellement**

Run: `cd apps/desktop && npm start`
Expected: les grilles montrent `✓` sur les livres installés ; ouvrir `#/reader/<id>` d'un livre non installé renvoie sur sa fiche.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer
git commit -m "feat(ui): badge d'état sur les cartes et garde du lecteur"
```

---

### Task 13: Outil de publication `tools/publish_minio.py`

**Files:**
- Create: `tools/publish_minio.py`
- Create: `tools/shamela/tests/test_publish.py`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `dist/shamela/books/*.sqlite.zst` + `*.manifest.json`, `dist/shamela/catalog.sqlite`.
- Produces:
  - `publish(client, *, src, bucket, public_base, force=False, dry_run=False) -> dict` avec les clés `uploaded`, `skipped`, `updated`.
  - `object_key(edition_id, content_version) -> str`
  - CLI : `python tools/publish_minio.py --endpoint … --bucket …`

- [ ] **Step 1: Écrire le test**

Créer `tools/shamela/tests/test_publish.py` :

```python
import json
import os
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from publish_minio import object_key, publish


class FakeS3:
    """Client S3 minimal : mémorise les objets et les appels."""

    def __init__(self):
        self.objects = {}
        self.puts = []

    def head_object(self, Bucket, Key):
        if Key not in self.objects:
            raise FileNotFoundError(Key)
        return {"ContentLength": len(self.objects[Key])}

    def put_object(self, Bucket, Key, Body, **kwargs):
        self.objects[Key] = Body
        self.puts.append(Key)


def build_src(root):
    books = os.path.join(root, "books")
    os.makedirs(books)
    with open(os.path.join(books, "ed-a.sqlite.zst"), "wb") as fh:
        fh.write(b"compressed-bytes")
    with open(os.path.join(books, "ed-a.manifest.json"), "w", encoding="utf-8") as fh:
        json.dump({"sha256": "a" * 64, "size": 4096, "compressed_size": 16}, fh)

    con = sqlite3.connect(os.path.join(root, "catalog.sqlite"))
    con.execute(
        "CREATE TABLE book_releases (release_id TEXT PRIMARY KEY, edition_id TEXT,"
        " content_version INTEGER, download_url TEXT, compressed_size INTEGER, is_active INTEGER)"
    )
    con.execute(
        "INSERT INTO book_releases VALUES ('rel-a', 'ed-a', 1, 'local://books/ed-a.sqlite', 0, 1)"
    )
    con.commit()
    con.close()
    return root


class PublishTest(unittest.TestCase):
    def test_upload_puis_reecriture_de_download_url(self):
        with tempfile.TemporaryDirectory() as root:
            build_src(root)
            client = FakeS3()
            report = publish(
                client,
                src=root,
                bucket="beytelhikma",
                public_base="http://127.0.0.1:9000/beytelhikma",
            )

            self.assertEqual(report["uploaded"], 2)  # le livre et son manifest
            self.assertEqual(report["updated"], 1)
            key = object_key("ed-a", 1)
            self.assertIn(key, client.objects)

            con = sqlite3.connect(os.path.join(root, "catalog.sqlite"))
            url, size = con.execute(
                "SELECT download_url, compressed_size FROM book_releases WHERE release_id='rel-a'"
            ).fetchone()
            con.close()
            self.assertEqual(url, f"http://127.0.0.1:9000/beytelhikma/{key}")
            self.assertEqual(size, 16)

    def test_second_passage_ne_reenvoie_rien(self):
        with tempfile.TemporaryDirectory() as root:
            build_src(root)
            client = FakeS3()
            publish(client, src=root, bucket="b", public_base="http://x/b")
            client.puts.clear()
            report = publish(client, src=root, bucket="b", public_base="http://x/b")
            self.assertEqual(client.puts, [])
            self.assertEqual(report["uploaded"], 0)
            self.assertEqual(report["skipped"], 2)

    def test_dry_run_n_ecrit_rien(self):
        with tempfile.TemporaryDirectory() as root:
            build_src(root)
            client = FakeS3()
            publish(client, src=root, bucket="b", public_base="http://x/b", dry_run=True)
            self.assertEqual(client.puts, [])
            con = sqlite3.connect(os.path.join(root, "catalog.sqlite"))
            (url,) = con.execute(
                "SELECT download_url FROM book_releases WHERE release_id='rel-a'"
            ).fetchone()
            con.close()
            self.assertEqual(url, "local://books/ed-a.sqlite")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Lancer le test, vérifier l'échec**

Run: `cd tools && python -m unittest shamela.tests.test_publish -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'publish_minio'`

- [ ] **Step 3: Écrire l'outil**

Créer `tools/publish_minio.py` :

```python
"""Publie les livres importés vers un bucket MinIO compatible S3.

Entrée : la sortie de `import_shamela.py --compress` (`dist/shamela/`).
Sortie : les objets `books/<edition_id>/<content_version>/book.sqlite.zst` et
leur manifest, puis `download_url` réécrit dans `dist/shamela/catalog.sqlite`.

Les chemins sont immutables : une nouvelle `content_version` crée un nouvel
objet, jamais un écrasement.

Identifiants lus dans MINIO_ACCESS_KEY / MINIO_SECRET_KEY. Jamais dans le dépôt.
"""

import argparse
import glob
import json
import os
import sqlite3
import sys

READ_ONLY_POLICY = {
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Principal": {"AWS": ["*"]},
            "Action": ["s3:GetObject"],
            "Resource": [],  # complété par set_anonymous_policy
        }
    ],
}


def object_key(edition_id: str, content_version: int) -> str:
    return f"books/{edition_id}/{content_version}/book.sqlite.zst"


def manifest_key(edition_id: str, content_version: int) -> str:
    return f"books/{edition_id}/{content_version}/manifest.json"


def _upload(client, bucket, key, body, content_type, metadata, force, dry_run, report):
    if not force:
        try:
            head = client.head_object(Bucket=bucket, Key=key)
            if head.get("ContentLength") == len(body):
                report["skipped"] += 1
                return
        except Exception:
            pass  # absent : on envoie
    if dry_run:
        return
    client.put_object(
        Bucket=bucket,
        Key=key,
        Body=body,
        ContentType=content_type,
        Metadata=metadata,
    )
    report["uploaded"] += 1


def publish(client, *, src, bucket, public_base, force=False, dry_run=False):
    """Monte les livres puis réécrit `download_url`. Renvoie un compte rendu."""
    report = {"uploaded": 0, "skipped": 0, "updated": 0, "missing": []}
    catalog_path = os.path.join(src, "catalog.sqlite")
    if not os.path.exists(catalog_path):
        raise SystemExit(f"catalogue introuvable : {catalog_path}")

    con = sqlite3.connect(catalog_path)
    releases = con.execute(
        "SELECT release_id, edition_id, content_version FROM book_releases WHERE is_active = 1"
    ).fetchall()

    updates = []
    for release_id, edition_id, content_version in releases:
        packed = os.path.join(src, "books", f"{edition_id}.sqlite.zst")
        manifest_path = os.path.join(src, "books", f"{edition_id}.manifest.json")
        if not os.path.exists(packed):
            report["missing"].append(edition_id)
            continue

        with open(packed, "rb") as fh:
            body = fh.read()
        manifest = {}
        if os.path.exists(manifest_path):
            with open(manifest_path, encoding="utf-8") as fh:
                manifest = json.load(fh)

        key = object_key(edition_id, content_version)
        _upload(
            client,
            bucket,
            key,
            body,
            "application/zstd",
            {
                "sha256": str(manifest.get("sha256", "")),
                "uncompressed-size": str(manifest.get("size", 0)),
            },
            force,
            dry_run,
            report,
        )
        _upload(
            client,
            bucket,
            manifest_key(edition_id, content_version),
            json.dumps(manifest, ensure_ascii=False).encode("utf-8"),
            "application/json",
            {},
            force,
            dry_run,
            report,
        )
        updates.append((f"{public_base.rstrip('/')}/{key}", len(body), release_id))

    if not dry_run and updates:
        con.executemany(
            "UPDATE book_releases SET download_url = ?, compressed_size = ? WHERE release_id = ?",
            updates,
        )
        con.commit()
        report["updated"] = len(updates)
    con.close()

    if report["missing"]:
        print(
            f"attention : {len(report['missing'])} livre(s) sans .sqlite.zst — "
            "relancer import_shamela.py --compress",
            file=sys.stderr,
        )
    return report


def set_anonymous_policy(client, bucket):
    """Rend `books/*` lisible sans authentification. À lancer une seule fois."""
    policy = json.loads(json.dumps(READ_ONLY_POLICY))
    policy["Statement"][0]["Resource"] = [f"arn:aws:s3:::{bucket}/books/*"]
    client.put_bucket_policy(Bucket=bucket, Policy=json.dumps(policy))


def build_parser():
    parser = argparse.ArgumentParser(description="Publie dist/shamela vers MinIO")
    parser.add_argument("--src", default="dist/shamela")
    parser.add_argument("--endpoint", default="http://127.0.0.1:9000")
    parser.add_argument("--bucket", default="beytelhikma")
    parser.add_argument(
        "--public-base",
        default=None,
        help="préfixe des URL publiques ; par défaut <endpoint>/<bucket>",
    )
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--set-anonymous-policy", action="store_true")
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        import boto3
    except ImportError:
        print("erreur : boto3 est requis (pip install boto3)", file=sys.stderr)
        return 2

    access = os.environ.get("MINIO_ACCESS_KEY")
    secret = os.environ.get("MINIO_SECRET_KEY")
    if not access or not secret:
        print("erreur : définir MINIO_ACCESS_KEY et MINIO_SECRET_KEY", file=sys.stderr)
        return 2

    client = boto3.client(
        "s3",
        endpoint_url=args.endpoint,
        aws_access_key_id=access,
        aws_secret_access_key=secret,
        region_name="us-east-1",
    )

    if args.set_anonymous_policy:
        set_anonymous_policy(client, args.bucket)
        print(f"policy de lecture publique posée sur {args.bucket}/books/*")

    public_base = args.public_base or f"{args.endpoint.rstrip('/')}/{args.bucket}"
    report = publish(
        client,
        src=args.src,
        bucket=args.bucket,
        public_base=public_base,
        force=args.force,
        dry_run=args.dry_run,
    )
    print(
        f"envoyés : {report['uploaded']} • ignorés : {report['skipped']} • "
        f"catalogue mis à jour : {report['updated']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Lancer le test, vérifier le succès**

Run: `cd tools && python -m unittest shamela.tests.test_publish -v && python -m unittest discover -s shamela/tests -t .`
Expected: PASS pour les trois nouveaux tests et pour la suite existante.

- [ ] **Step 5: Documenter et committer**

Dans `CLAUDE.md`, section « Commandes », ajouter après le bloc d'import Shamela :

```bash
# publication vers MinIO (depuis la racine)
export MINIO_ACCESS_KEY=… MINIO_SECRET_KEY=…
python tools/publish_minio.py --endpoint http://127.0.0.1:9000 --bucket beytelhikma --dry-run
python tools/publish_minio.py --endpoint http://127.0.0.1:9000 --bucket beytelhikma
```

et, dans la section « Architecture », remplacer la phrase « Tant que le pipeline de téléchargement n'existe pas… » par une phrase décrivant l'état réel : le catalogue est local, les livres sont téléchargés depuis MinIO par `download-manager.js`, et `assets/sample` / `dist/shamela` restent utilisables hors ligne grâce aux `download_url` en `asset://` et `local://`.

```bash
git add tools/publish_minio.py tools/shamela/tests/test_publish.py CLAUDE.md
git commit -m "feat(tools): publication des livres vers MinIO et réécriture de download_url"
```

---

## Auto-relecture

**Couverture de la spec :**

| Section de la spec | Tâche |
| --- | --- |
| §3 Disposition MinIO | 13 |
| §4 Publication | 13 |
| §5.1 `AppDatabase` | 4 |
| §5.2 `download-manager.js` | 1, 2, 3 |
| §5.3 `reconcileLibrary()` | 5 |
| §5.4 Suppression | 6, 10 |
| §5.5 `minio.base_url` | 3 (`setBaseUrl`), 8 (lecture du réglage) |
| §6 Surface IPC | 5, 6, 7, 8 |
| §7.1 Fiche livre | 9 |
| §7.2 Modale | 10 |
| §7.3 Écran `/downloads` | 11 |
| §7.4 Badge, garde du lecteur | 12 |
| §8 Erreurs | 1, 2 (codes et messages), 6 (refus pendant téléchargement) |
| §9 Tests | 1, 2, 3, 5, 6, 7, 13 |

Aucune section sans tâche.
