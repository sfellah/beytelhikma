/**
 * Un serveur statique pour relire le site en local — rien de plus.
 *
 * Il sert `dist/` **sous `BASE_PATH`**, comme GitHub Pages. Servir à la racine
 * en local ferait passer tous les liens internes et laisserait la seule panne
 * que ce préfixe peut causer se découvrir en production.
 *
 *   node site/serve.mjs [--port 4173]
 */
import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BASE_PATH } from './config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, 'dist');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const portFlag = process.argv.indexOf('--port');
const port = portFlag === -1 ? 4173 : Number(process.argv[portFlag + 1]);

createServer(async (request, response) => {
  const requested = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);

  if (!requested.startsWith(BASE_PATH)) {
    response.writeHead(302, { location: BASE_PATH });
    response.end();
    return;
  }

  let relative = requested.slice(BASE_PATH.length);
  if (relative === '' || relative.endsWith('/')) relative += 'index.html';

  // `path.normalize` puis vérification du préfixe : un `..%2f` dans l'URL ne
  // doit pas sortir de `dist/`. Le serveur est local, mais un chemin non
  // vérifié est un défaut qu'on ne veut pas écrire, même ici.
  const file = path.join(DIST, path.normalize(relative));
  if (!file.startsWith(DIST)) {
    response.writeHead(403).end('403');
    return;
  }

  try {
    const body = await fs.readFile(file);
    response.writeHead(200, {
      'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    response.end(body);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('404');
  }
}).listen(port, () => {
  process.stdout.write(`http://localhost:${port}${BASE_PATH}\n`);
});
