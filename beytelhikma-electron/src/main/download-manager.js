import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import zlib from 'node:zlib';

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
