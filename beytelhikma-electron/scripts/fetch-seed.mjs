/**
 * Récupère la graine de catalogue embarquée dans l'application.
 *
 * L'application doit pouvoir explorer dès l'installation, hors ligne. Elle
 * embarque donc un catalogue de départ — mais lequel ? Celui qui est **en
 * ligne**, téléchargé au moment du build : c'est la seule façon de garantir
 * qu'un installeur ne promette pas des livres que le bucket n'a pas.
 *
 * Aucun repli. Une source injoignable arrête le build : un installeur
 * silencieusement obsolète est pire qu'un build raté, parce que l'erreur se
 * découvre alors chez l'utilisateur.
 *
 * Utilisable en script (`node scripts/fetch-seed.mjs`) ou en module (les tests).
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { DEFAULT_BASE_URL, resolveObject } from '../src/shared/distribution.js';
import { POINTER_KEY, SUPPORTED_SCHEMA_VERSION } from '../src/main/catalog-updater.js';

const RACINE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARCHIVE = 'catalog.sqlite.zst';
const DESCRIPTION = 'catalog-seed.json';

/** Ce que le build a embarqué : lu par l'écran « à propos », et par ce script. */
function grainePresente(assetsDir) {
  try {
    const décrit = JSON.parse(fs.readFileSync(path.join(assetsDir, DESCRIPTION), 'utf8'));
    if (!fs.existsSync(path.join(assetsDir, ARCHIVE))) return null;
    return décrit;
  } catch {
    return null; // absente ou illisible : on retélécharge
  }
}

async function lit(url, { timeoutMs, binaire = false }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const réponse = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!réponse.ok) throw new Error(`HTTP ${réponse.status}`);
    return binaire ? Buffer.from(await réponse.arrayBuffer()) : await réponse.text();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchSeed({
  baseUrl = DEFAULT_BASE_URL,
  assetsDir = path.join(RACINE, 'assets'),
  timeoutMs = 30_000,
} = {}) {
  const { url: urlPointeur } = resolveObject(baseUrl, POINTER_KEY);

  let pointeur;
  try {
    pointeur = JSON.parse(await lit(urlPointeur, { timeoutMs }));
  } catch (erreur) {
    throw new Error(`pointeur illisible sur ${urlPointeur} : ${erreur.message}`);
  }

  if (!Number.isInteger(pointeur.schema_version) || !pointeur.object_key) {
    throw new Error('pointeur malformé : catalog_version, schema_version ou object_key manquant');
  }
  if (pointeur.schema_version > SUPPORTED_SCHEMA_VERSION) {
    throw new Error(
      `schéma de catalogue ${pointeur.schema_version} non supporté ` +
        `(cette application lit jusqu'au ${SUPPORTED_SCHEMA_VERSION}) — ` +
        "l'application serait livrée avec un catalogue qu'elle ne sait pas ouvrir",
    );
  }

  const déjàLà = grainePresente(assetsDir);
  if (déjàLà?.sha256 === pointeur.sha256) {
    return { action: 'upToDate', catalogVersion: déjàLà.catalog_version, pointeur };
  }

  const { url } = resolveObject(baseUrl, pointeur.object_key);
  const octets = await lit(url, { timeoutMs, binaire: true });

  // L'empreinte du pointeur porte sur le catalogue **décompressé** : c'est celle
  // que l'application revérifiera à l'installation. On décompresse donc pour la
  // contrôler, plutôt que de faire confiance à l'archive.
  const zlib = await import('node:zlib');
  const clair = zlib.zstdDecompressSync(octets);
  const obtenue = createHash('sha256').update(clair).digest('hex');
  if (obtenue !== pointeur.sha256) {
    throw new Error(`empreinte de la graine invalide : ${obtenue} au lieu de ${pointeur.sha256}`);
  }

  fs.mkdirSync(assetsDir, { recursive: true });
  fs.writeFileSync(path.join(assetsDir, ARCHIVE), octets);
  fs.writeFileSync(
    path.join(assetsDir, DESCRIPTION),
    `${JSON.stringify(
      {
        catalog_version: pointeur.catalog_version,
        schema_version: pointeur.schema_version,
        generated_at: pointeur.generated_at,
        edition_count: pointeur.edition_count,
        sha256: pointeur.sha256,
        compressed_size: octets.length,
        uncompressed_size: clair.length,
        source: baseUrl,
      },
      null,
      2,
    )}\n`,
  );

  return { action: 'fetched', catalogVersion: pointeur.catalog_version, pointeur };
}

// Comparaison d'URL, pas de chaînes : sur Windows `process.argv[1]` est un
// chemin `C:\…` que `file://` + remplacement de barres ne reconstitue pas
// fidèlement. `pathToFileURL` est la seule forme qui se compare sans surprise.
const lancéDirectement =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (lancéDirectement) {
  const baseUrl = process.env.BEYTELHIKMA_BASE_URL || DEFAULT_BASE_URL;
  try {
    const rapport = await fetchSeed({ baseUrl });
    const verbe = rapport.action === 'fetched' ? 'embarquée' : 'déjà à jour';
    console.log(
      `graine ${verbe} : catalogue v${rapport.catalogVersion}, ` +
        `${rapport.pointeur.edition_count} éditions, depuis ${baseUrl}`,
    );
  } catch (erreur) {
    console.error(`échec de la récupération de la graine : ${erreur.message}`);
    process.exit(1);
  }
}
