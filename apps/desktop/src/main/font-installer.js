import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';

/**
 * Installation d'une police depuis Google Fonts.
 *
 * **Installer, pas lier.** La CSP est `default-src 'none'` avec `style-src
 * 'self'` et `font-src 'self'` : poser un `<link>` vers `fonts.googleapis.com`
 * imposerait de l'ouvrir vers deux hôtes tiers. L'application appellerait alors
 * Google à chaque démarrage — un lecteur hors ligne perdrait ses polices alors
 * que tout le reste fonctionne sans réseau, et chaque lancement émettrait une
 * requête vers un tiers.
 *
 * On fait donc ici, à l'exécution, ce que `tools/fetch_fonts.py` fait au build :
 * une seule requête, au moment de l'ajout, puis des fichiers locaux.
 *
 * La feuille de Google n'est jamais injectée. On en extrait des URL et des
 * `unicode-range`, et l'application réécrit ses propres règles `@font-face`.
 */

/** Les deux seuls hôtes joignables, quelle que soit l'URL collée. */
export const SHEET_HOST = 'fonts.googleapis.com';
export const FILE_HOST = 'fonts.gstatic.com';

/** Plafonds : une URL fournie par l'utilisateur ne doit pas pouvoir remplir le disque. */
export const LIMITS = {
  sheet: 256 * 1024,
  file: 2 * 1024 * 1024,
  family: 8 * 1024 * 1024,
};

export class FontInstallError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FontInstallError';
  }
}

/**
 * Chrome récent : sans cet en-tête, Google renvoie du TTF non compressé.
 * `tools/fetch_fonts.py` porte la même constante et la même raison.
 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const SUBSETS = { arabic: 'U+0600-06FF', latin: 'U+0000-00FF' };
const SCRIPT_OF = { arabic: 'arab', latin: 'latn' };

/**
 * Vérifie l'origine **avant** toute requête, et sans suivre de redirection vers
 * un autre hôte — une liste d'hôtes qu'une redirection contourne ne protège
 * rien.
 */
function assertHost(raw, host) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new FontInstallError(`URL illisible : ${raw}`);
  }
  if (url.protocol !== 'https:') throw new FontInstallError(`https seul : ${raw}`);
  if (url.hostname !== host) throw new FontInstallError(`hôte refusé : ${url.hostname}`);
  return url;
}

/** Récupère au plus [limit] octets, et échoue dès le dépassement. */
function download(url, limit) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      { headers: { 'User-Agent': UA }, timeout: 20_000 },
      (response) => {
        // Pas de suivi de redirection : une 3xx vers un autre hôte contournerait
        // la liste ci-dessus, et Google n'en émet pas sur ces deux chemins.
        if (response.statusCode !== 200) {
          response.resume();
          reject(new FontInstallError(`réponse ${response.statusCode} pour ${url}`));
          return;
        }
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > limit) {
            request.destroy();
            reject(new FontInstallError(`dépassement de ${limit} octets pour ${url}`));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => resolve(Buffer.concat(chunks)));
      },
    );
    request.on('timeout', () => request.destroy(new FontInstallError(`délai dépassé : ${url}`)));
    request.on('error', (error) =>
      reject(error instanceof FontInstallError ? error : new FontInstallError(error.message)),
    );
  });
}

/** `Noto Kufi Arabic` -> `user-noto-kufi-arabic`. ASCII seul, par construction. */
export function slugify(family) {
  const slug = String(family)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `user-${slug || 'font'}`;
}

/**
 * Lit les blocs `@font-face` d'une feuille Google. Ne retient que les
 * sous-ensembles utiles et les fichiers `woff2` : c'est le seul format écrit
 * sur disque.
 */
export function parseSheet(css) {
  const faces = [];
  let family = null;

  for (const [, block] of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const name = block.match(/font-family:\s*'([^']+)'/)?.[1];
    const weight = block.match(/font-weight:\s*(\d+)/)?.[1] ?? '400';
    const src = block.match(/src:\s*url\(([^)]+)\)([^;]*)/);
    const range = block.match(/unicode-range:\s*([^;]+);/)?.[1]?.trim();
    if (!name || !src || !range) continue;

    const url = src[1].replace(/['"]/g, '').trim();
    if (!url.endsWith('.woff2')) continue;

    const subset = Object.keys(SUBSETS).find((key) => range.includes(SUBSETS[key]));
    if (!subset) continue;

    family ??= name;
    if (name !== family) continue;
    faces.push({ weight: Number(weight), subset, url, range });
  }

  if (!family || !faces.length) throw new FontInstallError('aucune police lisible dans la feuille');

  const scripts = [...new Set(faces.map((face) => SCRIPT_OF[face.subset]))];
  return { family, faces, scripts };
}

/**
 * Télécharge et installe. Le nom de fichier est **construit** depuis le slug et
 * le poids — jamais repris de l'URL distante, qui traverserait le chemin.
 *
 * Rien n'est laissé derrière en cas d'échec : le dossier de la famille est
 * effacé, pour qu'une police à moitié posée ne se retrouve jamais au catalogue.
 */
export async function installFont({ url, fontsRoot, fetchImpl = null }) {
  const sheetUrl = assertHost(url, SHEET_HOST);
  const get = fetchImpl ?? download;

  const sheet = (await get(sheetUrl.toString(), LIMITS.sheet)).toString('utf8');
  if (sheet.length > LIMITS.sheet) throw new FontInstallError('feuille trop grande');

  const { family, faces, scripts } = parseSheet(sheet);
  const key = slugify(family);
  const dir = path.join(fontsRoot, key);

  fs.mkdirSync(dir, { recursive: true });
  try {
    let total = 0;
    const installed = [];

    for (const face of faces) {
      assertHost(face.url, FILE_HOST);
      const bytes = await get(face.url, LIMITS.file);
      if (bytes.length > LIMITS.file) throw new FontInstallError('fichier trop grand');
      total += bytes.length;
      if (total > LIMITS.family) throw new FontInstallError('famille trop lourde');

      const file = `${key}-${face.weight}-${face.subset}.woff2`;
      fs.writeFileSync(path.join(dir, file), bytes);
      installed.push({ weight: face.weight, subset: face.subset, file, range: face.range });
    }

    return { key, family, scripts, faces: installed, sourceUrl: sheetUrl.toString() };
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Résout un chemin servi par le schéma `userfont:`. Rend `null` dès que la
 * cible sort de la racine — c'est le seul rempart entre une URL et le disque.
 */
export function resolveUserFontPath(fontsRoot, relative) {
  const root = path.resolve(fontsRoot);
  const full = path.resolve(root, decodeURIComponent(relative));
  const inside = full === root || full.startsWith(root + path.sep);
  return inside && full.endsWith('.woff2') ? full : null;
}

/**
 * Le nom de famille vient d'un tiers : il est **réduit** avant d'être cité.
 *
 * Citer suffirait à l'empêcher de refermer la règle, mais laisserait entrer du
 * texte arbitraire — accolades, points-virgules, sauts de ligne — dans une
 * feuille de style. Un nom de police n'a besoin que de lettres, de chiffres,
 * d'espaces et de traits d'union ; tout le reste tombe.
 */
function quoteFamily(family) {
  const clean = String(family)
    .replace(/[^\p{L}\p{N} \-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64);
  return `"${clean || 'Font'}"`;
}

/**
 * Réécrit les règles `@font-face` de l'application. La feuille de Google n'est
 * jamais servie : seules ses valeurs traversent, et elles ressortent citées.
 */
export function cssFor(font) {
  return font.faces
    .map((face) =>
      [
        '@font-face {',
        `  font-family: ${quoteFamily(font.family)};`,
        '  font-style: normal;',
        `  font-weight: ${Number(face.weight) || 400};`,
        '  font-display: swap;',
        `  src: url('userfont://fonts/${font.key}/${face.file}') format('woff2');`,
        `  unicode-range: ${String(face.range).replace(/[^U+0-9A-Fa-f,\-\s]/g, '')};`,
        '}',
      ].join('\n'),
    )
    .join('\n\n');
}
