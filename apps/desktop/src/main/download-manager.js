import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import zlib from 'node:zlib';

import { resolveObject } from '../shared/distribution.js';
import { assertEditionId } from './edition-id.js';

/** Messages destinés à l'utilisateur, en arabe. */
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
 *
 * La release porte une **clé** (`release.objectKey`), pas une URL : c'est
 * [baseUrl] qui décide d'où elle vient. Une clé de schéma non HTTP désigne un
 * fichier de [librarySource] — mode hors ligne d'`assets/sample` et de
 * `dist/shamela`. Renvoie le chemin du fichier installé.
 */
export async function installRelease({
  release,
  storageRoot,
  librarySource = null,
  baseUrl = null,
  signal,
  onProgress,
}) {
  fs.mkdirSync(path.join(storageRoot, 'books'), { recursive: true });
  fs.mkdirSync(path.join(storageRoot, 'downloads'), { recursive: true });

  const cible = resolveObject(baseUrl, release.objectKey);
  if (cible.kind === 'library') {
    return installFromLibrary({ release, storageRoot, librarySource, onProgress });
  }

  const part = partPath(storageRoot, release.editionId);
  await fetchToPart({ release: { ...release, url: cible.url }, part, signal, onProgress });
  const target = await unpackAndVerify({ release, part, storageRoot });
  fs.rmSync(part, { force: true });
  return target;
}

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
    if (isAbort(error, signal)) throw abandon(part, 'aborted', error);
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
      fs.createWriteStream(part, { flags: resuming ? 'a' : 'w' }),
    );
  } catch (error) {
    if (isAbort(error, signal)) throw abandon(part, 'aborted', error);
    if (error?.code === 'ENOSPC') throw new DownloadError('diskFull', error);
    // Coupure réseau : le .part est conservé, la reprise repartira de son offset.
    throw new DownloadError('network', error);
  }
}

/**
 * Une annulation remonte tantôt en `AbortError`, tantôt en erreur de flux
 * quelconque selon l'endroit où le signal a frappé : le signal fait foi.
 */
function isAbort(error, signal) {
  return signal?.aborted === true || error?.name === 'AbortError';
}

/** Supprime le .part devenu inutile puis fabrique l'erreur correspondante. */
function abandon(part, code, cause) {
  fs.rmSync(part, { force: true });
  return new DownloadError(code, cause);
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
    await pipeline(
      fs.createReadStream(source),
      counter,
      hashTap(hash),
      fs.createWriteStream(temp),
    );
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

  /** Réglage `distribution.base_url` : préfixe des clés du catalogue. */
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
    // La file fabrique trois chemins depuis cet identifiant (`.part`, `.tmp`,
    // fichier installé) : il est validé à l'entrée, pas à chaque usage.
    assertEditionId(editionId);
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

      await installRelease({
        release: { ...release, editionId },
        storageRoot: this.#storageRoot,
        librarySource: this.#librarySource,
        baseUrl: this.#baseUrl,
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
            // Sans `catch`, une écriture qui échoue devient un rejet non
            // traité : le téléchargement continuerait pendant que le processus
            // principal signale une promesse morte. Perdre un jalon de
            // progression n'est pas grave — la reprise repart du `.part`.
            Promise.resolve(
              this.#persist(editionId, { status: 'downloading', receivedBytes: received }),
            ).catch((error) => console.warn('[beytelhikma] progression non écrite :', error));
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

}
