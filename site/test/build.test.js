/**
 * Le rendu complet, sur fixtures. Aucun réseau : le générateur n'en fait pas,
 * et c'est ce qui rend ce test possible.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { build } from '../build.mjs';
import { BASE_PATH, PAGES, SITE_LOCALES } from '../config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RENDERER = path.join(HERE, '..', '..', 'beytelhikma-electron', 'src', 'renderer');

let out;
let report;

test.before(async () => {
  out = await fs.mkdtemp(path.join(os.tmpdir(), 'beyt-site-'));
  report = await build({
    out,
    dataDir: path.join(HERE, 'fixtures', 'data'),
    books: 8568,
  });
});

test.after(async () => {
  await fs.rm(out, { recursive: true, force: true });
});

const read = (relative) => fs.readFile(path.join(out, relative), 'utf8');

test('neuf pages et la bascule de racine sont écrites', async () => {
  assert.equal(report.pages.length, SITE_LOCALES.length * PAGES.length);
  await fs.access(path.join(out, 'index.html'));
  await fs.access(path.join(out, 'releases.json'));
  await fs.access(path.join(out, 'sitemap.xml'));
  await fs.access(path.join(out, '.nojekyll'));
});

test('chaque page annonce sa langue et sa direction', async () => {
  for (const locale of SITE_LOCALES) {
    for (const page of PAGES) {
      const file = page === 'index' ? `${locale.key}/index.html` : `${locale.key}/${page}/index.html`;
      const html = await read(file);
      assert.match(html, new RegExp(`<html lang="${locale.key}" dir="${locale.dir}">`), file);
    }
  }
});

test('chaque page porte les trois alternats et un x-default', async () => {
  const html = await read('fr/download/index.html');
  for (const locale of SITE_LOCALES) {
    assert.match(html, new RegExp(`hreflang="${locale.hreflang}"`));
  }
  assert.match(html, /hreflang="x-default"/);
});

test('aucun lien interne n’oublie le préfixe de GitHub Pages', async () => {
  // Un `/assets/…` écrit en dur marcherait en local et donnerait un 404 en
  // production : la panne ne se verrait qu'après publication.
  const html = await read('ar/index.html');
  const internal = [...html.matchAll(/(?:href|src)="(\/[^"]*)"/g)].map((match) => match[1]);
  assert.ok(internal.length > 0, 'la page doit porter des liens internes');
  for (const link of internal) {
    assert.ok(link.startsWith(BASE_PATH), `lien sans préfixe : ${link}`);
  }
});

test('aucune ressource ne vient d’un tiers', async () => {
  // Les maquettes tiraient Tailwind, Google Fonts et Material Symbols d'un CDN,
  // et leurs images d'un domaine Google. Rien de tout cela ne doit revenir.
  for (const locale of SITE_LOCALES) {
    const html = await read(`${locale.key}/index.html`);
    const external = [...html.matchAll(/(?:href|src)="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
    for (const link of external) {
      assert.ok(
        link.startsWith('https://github.com/') || link.startsWith('https://sfellah.github.io'),
        `ressource tierce : ${link}`,
      );
    }
    assert.doesNotMatch(html, /cdn\.tailwindcss|fonts\.googleapis|googleusercontent/);
  }
});

test('les jetons de l’application sont copiés à l’identique', async () => {
  const source = await fs.readFile(path.join(RENDERER, 'styles', 'tokens.css'), 'utf8');
  assert.equal(await read('styles/tokens.css'), source);
});

test('l’ambiance nuit est dérivée des jetons, pas recopiée', async () => {
  const derived = await read('styles/theme-system.css');
  assert.match(derived, /@media \(prefers-color-scheme: dark\)/);
  assert.match(derived, /--surface:/);
  assert.match(derived, /:root:not\(\[data-theme\]\)/);
});

test('polices, marque et captures sont présentes', async () => {
  await fs.access(path.join(out, 'styles', 'fonts.css'));
  await fs.access(path.join(out, 'assets', 'fonts', 'amiri-400-arabic.woff2'));
  await fs.access(path.join(out, 'assets', 'brand', 'mark.png'));
  await fs.access(path.join(out, 'assets', 'shots', 'home.png'));
  await fs.access(path.join(out, 'assets', 'site.js'));
});

test('chaque fichier référencé par une page existe vraiment', async () => {
  const html = await read('fr/download/index.html');
  const links = [...html.matchAll(/(?:href|src)="(\/[^"#?]*\.[a-z0-9]+)"/g)].map((m) => m[1]);
  for (const link of links) {
    await fs.access(path.join(out, link.slice(BASE_PATH.length)));
  }
});

test('la page de téléchargement propose les quatre artefacts et aucun fichier machine', async () => {
  const html = await read('en/download/index.html');
  assert.match(html, /Setup%200\.3\.0\.exe/);
  assert.match(html, /portable\.exe/);
  assert.match(html, /\.AppImage/);
  assert.match(html, /amd64\.deb/);
  assert.doesNotMatch(html, /latest\.yml/);
  assert.doesNotMatch(html, /blockmap/);
});

test('l’empreinte publiée est affichée', async () => {
  const html = await read('en/download/index.html');
  assert.match(html, /4Nc9jTUq2rkVnCcnbLXfCUX3HbfsNiE5aP5wJ1lz3rGZ5vT0m1B5CzQ8VwqLpXbJ0d2Q==/);
});

test('l’avertissement Windows est dit, pas tu', async () => {
  const html = await read('fr/download/index.html');
  assert.match(html, /Windows a protégé votre ordinateur/);
});

test('les tailles sont en chiffres arabes-indiens sur les pages arabes', async () => {
  // 98 566 144 octets → 94 Mo → ٩٤ م.ب. C'est le contrat de `translate` :
  // il convertit les nombres, jamais les chaînes.
  const arabic = await read('ar/download/index.html');
  assert.match(arabic, /٩٤ م\.ب/);
  const french = await read('fr/download/index.html');
  assert.match(french, /94 Mo/);
});

test('les notes de version sont rendues dans la langue de la page', async () => {
  const arabic = await read('ar/releases/index.html');
  assert.match(arabic, /الإصدار العلني الأول/);
  const english = await read('en/releases/index.html');
  assert.match(english, /First public release/);
});

test('le contrat de données est écrit tel que la page le consomme', async () => {
  const index = JSON.parse(await read('releases.json'));
  assert.equal(index.latest.version, '0.3.0');
  assert.equal(index.latest.assets.length, 4);
  assert.ok(index.latest.notes.ar.length > 0);
});

test('une plateforme requise sans artefact fait échouer le build', async () => {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'beyt-site-partiel-'));
  const dataDir = path.join(scratch, 'data');
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(
    path.join(dataDir, 'releases.api.json'),
    JSON.stringify([
      {
        tag_name: 'v0.3.0',
        published_at: '2026-08-01T10:00:00Z',
        assets: [
          {
            name: 'Beyt El Hikma Setup 0.3.0.exe',
            browser_download_url: 'https://github.com/sfellah/beytelhikma/releases/download/v0.3.0/a.exe',
            size: 1,
          },
        ],
      },
    ]),
  );

  await assert.rejects(
    build({ out: path.join(scratch, 'dist'), dataDir, books: 8568 }),
    /aucun artefact pour : linux/,
  );
  await fs.rm(scratch, { recursive: true, force: true });
});

test('sans version publiée, la page de téléchargement le dit au lieu de mentir', async () => {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'beyt-site-vide-'));
  await build({
    out: path.join(scratch, 'dist'),
    dataDir: path.join(scratch, 'data'),
    books: 8568,
  });
  const html = await fs.readFile(path.join(scratch, 'dist', 'fr', 'download', 'index.html'), 'utf8');
  assert.match(html, /Aucune version publiée/);
  assert.doesNotMatch(html, /releases\/download/);
  await fs.rm(scratch, { recursive: true, force: true });
});
