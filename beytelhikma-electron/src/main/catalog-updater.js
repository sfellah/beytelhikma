/**
 * Mise à jour du catalogue depuis la source de distribution.
 *
 * Principe directeur : **une source injoignable ne dégrade jamais la lecture.**
 * L'application embarque son catalogue et fonctionne hors ligne ; le pointeur
 * n'est qu'une occasion de faire mieux. Cinq branches de décision sur six sont
 * donc silencieuses — une application hors ligne ne doit rien afficher
 * d'anxiogène, elle a déjà tout ce qu'il lui faut pour explorer.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import zlib from 'node:zlib';

import { resolveObject } from '../shared/distribution.js';

/** Version de schéma de catalogue que ce client sait lire. */
export const SUPPORTED_SCHEMA_VERSION = 2;

/** Clé du pointeur, seul objet du bucket qui change sous une clé fixe. */
export const POINTER_KEY = 'catalog/latest.json';

const POINTER_TIMEOUT_MS = 8000;

/**
 * Lit le pointeur. Renvoie `null` pour **toute** anomalie — réseau, HTTP, JSON.
 *
 * Aucune levée : l'appelant est un démarrage d'application, pas une requête
 * utilisateur, et il n'a rien à rattraper. Un `throw` ici obligerait chaque
 * appelant à un `try` dont la seule branche utile serait « ne rien faire ».
 */
export async function fetchPointer(baseUrl, { signal = null, timeoutMs = POINTER_TIMEOUT_MS } = {}) {
  const { url } = resolveObject(baseUrl, POINTER_KEY);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return null;
    return JSON.parse(await response.text());
  } catch {
    return null; // hors ligne, DNS mort, JSON cassé : silence
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

function estEntierPositif(valeur) {
  return Number.isInteger(valeur) && valeur > 0;
}

/**
 * Décide s'il y a lieu de proposer une mise à jour.
 *
 * Fonction pure : c'est elle qu'on teste, pas le réseau. Toute branche
 * silencieuse rend `pointer: null`, pour qu'aucun appelant ne puisse installer
 * un catalogue qu'on vient de refuser.
 */
export function decideUpdate({ pointer, localVersion, declinedVersion }) {
  if (!pointer || typeof pointer !== 'object') {
    return { action: 'none', reason: 'noPointer', pointer: null };
  }
  if (!estEntierPositif(pointer.catalog_version) || !pointer.object_key) {
    return { action: 'none', reason: 'malformed', pointer: null };
  }
  if (
    !estEntierPositif(pointer.schema_version) ||
    pointer.schema_version > SUPPORTED_SCHEMA_VERSION
  ) {
    // L'application est trop ancienne pour ce catalogue. Le dire n'aiderait
    // pas : elle ne peut rien en faire.
    return { action: 'none', reason: 'schemaTooNew', pointer: null };
  }
  if (pointer.catalog_version <= (localVersion ?? 0)) {
    return { action: 'none', reason: 'upToDate', pointer: null };
  }
  if (pointer.catalog_version === declinedVersion) {
    return { action: 'none', reason: 'declined', pointer: null };
  }
  return { action: 'offer', reason: 'newer', pointer };
}

/**
 * Télécharge, vérifie et installe le catalogue désigné par [pointer].
 *
 * L'ordre est la garantie : on décompresse vers un fichier de côté, on vérifie
 * l'empreinte, et le `rename` n'a lieu qu'après. Une coupure à n'importe quel
 * point laisse l'ancien catalogue intact et lisible — jamais de catalogue à
 * moitié écrit, jamais de catalogue corrompu qui en remplace un bon.
 *
 * Renvoie le chemin installé.
 */
export async function installCatalog({ pointer, baseUrl, storageRoot, signal = null, onProgress }) {
  const cible = resolveObject(baseUrl, pointer.object_key);
  if (cible.kind !== 'http') {
    throw new Error(`clé de catalogue non téléchargeable : ${pointer.object_key}`);
  }

  fs.mkdirSync(storageRoot, { recursive: true });
  const destination = path.join(storageRoot, 'catalog.sqlite');
  const staged = `${destination}.new`;

  const response = await fetch(cible.url, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error(`catalogue introuvable (HTTP ${response.status})`);

  const total = pointer.compressed_size || Number(response.headers.get('content-length')) || 0;
  let reçus = 0;
  const empreinte = createHash('sha256');

  try {
    // L'empreinte porte sur le catalogue **décompressé** : c'est lui que
    // `publish_minio.py` a haché, et c'est lui qu'on va ouvrir.
    await pipeline(
      Readable.fromWeb(response.body),
      async function* (source) {
        for await (const morceau of source) {
          reçus += morceau.length;
          onProgress?.({ receivedBytes: reçus, totalBytes: total });
          yield morceau;
        }
      },
      zlib.createZstdDecompress(),
      async function* (source) {
        for await (const morceau of source) {
          empreinte.update(morceau);
          yield morceau;
        }
      },
      fs.createWriteStream(staged),
    );

    const obtenue = empreinte.digest('hex');
    if (pointer.sha256 && obtenue !== pointer.sha256) {
      throw new Error(`empreinte du catalogue invalide : ${obtenue} au lieu de ${pointer.sha256}`);
    }

    fs.renameSync(staged, destination); // atomique : le dernier geste
    return destination;
  } catch (error) {
    fs.rmSync(staged, { force: true });
    throw error;
  }
}
