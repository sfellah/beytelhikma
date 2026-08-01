/**
 * Le générateur du site : neuf pages, une page de bascule, un contrat de
 * données. Sans dépendance, sans bundler, sans étape de compilation — le projet
 * n'en a aucun ailleurs et n'a pas de raison d'en acquérir un pour trois pages.
 *
 * Le générateur ne parle **jamais au réseau**. Le workflow écrit
 * `site/data/releases.api.json` avec `gh api` avant de l'appeler ; en local, le
 * fichier peut manquer et le site se rend dans son état « aucune version
 * publiée ». Un build déterministe se teste ; un build qui interroge GitHub
 * échoue les jours où GitHub tousse, et rend des pages différentes selon
 * l'heure.
 *
 *   node site/build.mjs [--out DIR] [--books N] [--allow-missing]
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { translate } from '../beytelhikma-electron/src/shared/translate.js';
import {
  BASE_PATH,
  DEFAULT_LOCALE,
  PAGES,
  REPO,
  SITE_LOCALES,
  absoluteUrl,
  digitsLocale,
  url,
} from './config.mjs';
import { mergeChangelogs, parseChangelog } from './lib/changelog.mjs';
import { buildIndex, missingPlatforms, parseUpdaterManifest } from './lib/releases.mjs';
import { nightMediaCss } from './lib/theme-css.mjs';
import { escapeHtml } from './lib/html.mjs';
import { layout, pagePath } from './templates/layout.mjs';
import { home } from './templates/home.mjs';
import { download } from './templates/download.mjs';
import { releases as releasesPage } from './templates/releases.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const APP = path.join(ROOT, 'beytelhikma-electron');
const RENDERER = path.join(APP, 'src', 'renderer');

const REPO_URL = `https://github.com/${REPO.owner}/${REPO.name}`;

/** Les captures reprises sur le site. Nommées une par une : une copie en bloc
    embarquerait les vingt-cinq écrans de la campagne, dont personne n'a besoin. */
const SHOTS = ['home.png', 'reader.png', 'reader-night.png', 'explore.png'];

function parseArgs(argv) {
  const options = { out: path.join(HERE, 'dist'), books: null, allowMissing: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--out') options.out = path.resolve(argv[++index]);
    else if (flag === '--books') options.books = Number(argv[++index]);
    else if (flag === '--allow-missing') options.allowMissing = true;
    else throw new Error(`Option inconnue : ${flag}`);
  }
  return options;
}

async function readIfExists(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function copyFile(from, to) {
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.copyFile(from, to);
}

/**
 * Le nombre de livres annoncé vient de `assets/catalog-seed.json`, écrit par
 * `scripts/fetch-seed.mjs` depuis le pointeur du bucket.
 *
 * C'est le même fichier qui dit ce que l'installeur embarque : la page ne peut
 * donc pas promettre un corpus que l'application n'a pas. Un nombre écrit en
 * dur ici aurait vieilli à la première republication du catalogue, sans que
 * rien ne le signale.
 */
async function readBookCount(override) {
  if (Number.isFinite(override)) return override;
  const raw = await readIfExists(path.join(APP, 'assets', 'catalog-seed.json'));
  if (!raw) {
    throw new Error(
      "assets/catalog-seed.json est absent : lance `npm run seed` dans beytelhikma-electron, " +
        'ou passe `--books N` pour un rendu local.',
    );
  }
  const seed = JSON.parse(raw);
  if (!Number.isFinite(seed.edition_count)) {
    throw new Error('catalog-seed.json ne porte pas de `edition_count`.');
  }
  return seed.edition_count;
}

/** Les manifestes d'`electron-updater` téléchargés par le workflow, par tag. */
async function readDigests(dataDir) {
  const digests = new Map();
  let entries = [];
  try {
    entries = await fs.readdir(path.join(dataDir, 'updater'), { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return digests;
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const tag = entry.name;
    const merged = new Map();
    const files = await fs.readdir(path.join(dataDir, 'updater', tag));
    for (const file of files.filter((name) => /\.ya?ml$/i.test(name))) {
      const text = await fs.readFile(path.join(dataDir, 'updater', tag, file), 'utf8');
      for (const [name, digest] of parseUpdaterManifest(text)) merged.set(name, digest);
    }
    digests.set(tag, merged);
  }
  return digests;
}

/**
 * La page servie à la racine : elle envoie vers la langue du visiteur.
 *
 * Sans JavaScript, elle affiche les trois liens. C'est le seul endroit du site
 * où une redirection est acceptable, et elle ne doit jamais faire disparaître
 * le choix : un visiteur qui veut l'anglais sur un système arabe doit pouvoir
 * cliquer.
 */
function rootRedirect() {
  const links = SITE_LOCALES.map(
    (entry) =>
      `      <li><a href="${url(pagePath(entry.key, 'index'))}" lang="${entry.key}" dir="${entry.dir}" hreflang="${entry.hreflang}">${escapeHtml(entry.label)}</a></li>`,
  ).join('\n');

  return `<!doctype html>
<html lang="${DEFAULT_LOCALE}" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Beyt El Hikma</title>
  <link rel="canonical" href="${escapeHtml(absoluteUrl(pagePath(DEFAULT_LOCALE, 'index')))}" />
${SITE_LOCALES.map((entry) => `  <link rel="alternate" hreflang="${entry.hreflang}" href="${escapeHtml(absoluteUrl(pagePath(entry.key, 'index')))}" />`).join('\n')}
  <link rel="alternate" hreflang="x-default" href="${escapeHtml(absoluteUrl(pagePath(DEFAULT_LOCALE, 'index')))}" />
  <link rel="icon" href="${url('assets/brand/mark.png')}" type="image/png" />
  <script src="${url('assets/redirect.js')}" defer></script>
</head>
<body>
  <main>
    <h1>Beyt El Hikma</h1>
    <ul>
${links}
    </ul>
  </main>
</body>
</html>
`;
}

function sitemap() {
  const entries = [];
  for (const locale of SITE_LOCALES) {
    for (const page of PAGES) {
      entries.push(`  <url><loc>${escapeHtml(absoluteUrl(pagePath(locale.key, page)))}</loc></url>`);
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>
`;
}

export async function build(options = {}) {
  const out = options.out ?? path.join(HERE, 'dist');
  // `dataDir` est un paramètre pour que les tests rendent le site complet sur
  // des fixtures, sans réseau et sans dépendre de ce qui est publié le jour où
  // ils tournent.
  const dataDir = options.dataDir ?? path.join(HERE, 'data');

  // --- les notes, source de vérité des trois langues ----------------------
  const changelogs = {};
  for (const locale of SITE_LOCALES) {
    const file = path.join(ROOT, `CHANGELOG.${locale.key}.md`);
    const text = await readIfExists(file);
    if (text === null) throw new Error(`CHANGELOG.${locale.key}.md est absent.`);
    changelogs[locale.key] = parseChangelog(text, { source: `CHANGELOG.${locale.key}.md` });
  }
  const changelog = mergeChangelogs(changelogs);

  // --- les artefacts réellement publiés -----------------------------------
  const apiRaw = await readIfExists(path.join(dataDir, 'releases.api.json'));
  const index = buildIndex(apiRaw ? JSON.parse(apiRaw) : [], changelog, await readDigests(dataDir));

  const missing = missingPlatforms(index.latest);
  if (missing.length && !options.allowMissing) {
    throw new Error(
      `La version ${index.latest.version} n'a aucun artefact pour : ${missing.join(', ')}. ` +
        'Un bouton qui pointe vers rien est pire qu\'un bouton absent.',
    );
  }

  const books = await readBookCount(options.books);
  const appPackage = JSON.parse(await fs.readFile(path.join(APP, 'package.json'), 'utf8'));
  const builtVersion = index.latest?.version ?? appPackage.version;

  // --- les fichiers hérités de l'application, copiés et jamais recopiés ----
  const tokens = await fs.readFile(path.join(RENDERER, 'styles', 'tokens.css'), 'utf8');
  await fs.mkdir(path.join(out, 'styles'), { recursive: true });
  await fs.writeFile(path.join(out, 'styles', 'tokens.css'), tokens);
  await fs.writeFile(path.join(out, 'styles', 'theme-system.css'), nightMediaCss(tokens));
  await copyFile(
    path.join(RENDERER, 'styles', 'fonts.css'),
    path.join(out, 'styles', 'fonts.css'),
  );
  await copyFile(path.join(HERE, 'styles', 'site.css'), path.join(out, 'styles', 'site.css'));

  const fontFiles = await fs.readdir(path.join(RENDERER, 'assets', 'fonts'));
  for (const font of fontFiles) {
    await copyFile(
      path.join(RENDERER, 'assets', 'fonts', font),
      path.join(out, 'assets', 'fonts', font),
    );
  }
  for (const brand of ['mark.png', 'mark-light.png', 'lockup.png', 'app-icon.png']) {
    await copyFile(
      path.join(RENDERER, 'assets', 'brand', brand),
      path.join(out, 'assets', 'brand', brand),
    );
  }
  for (const shot of SHOTS) {
    await copyFile(path.join(HERE, 'assets', 'shots', shot), path.join(out, 'assets', 'shots', shot));
  }
  for (const script of ['site.js', 'redirect.js']) {
    await copyFile(path.join(HERE, 'assets', script), path.join(out, 'assets', script));
  }

  const sprite = await fs.readFile(path.join(HERE, 'assets', 'icons.svg'), 'utf8');

  // --- les neuf pages -----------------------------------------------------
  const written = [];
  for (const locale of SITE_LOCALES) {
    const catalog = (await import(`./locales/${locale.key}.mjs`)).default;
    const t = (key, params) => translate(catalog, key, params, digitsLocale(locale.key));
    const formatter = new Intl.DateTimeFormat(locale.key, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const fmtDate = (iso) => (iso ? formatter.format(new Date(iso)) : '—');

    const bodies = {
      index: () =>
        home({ locale: locale.key, t, latest: index.latest, books, defaultPlatform: 'windows' }),
      download: () =>
        download({ locale: locale.key, t, fmtDate, latest: index.latest, repoUrl: REPO_URL }),
      releases: () => releasesPage({ locale: locale.key, t, fmtDate, index }),
    };

    for (const page of PAGES) {
      const titles = {
        index: t('home.title'),
        download: t('download.title'),
        releases: t('releases.title'),
      };
      const descriptions = {
        index: t('home.description', { books }),
        download: t('download.description', { version: index.latest?.version ?? '—' }),
        releases: t('releases.description'),
      };

      const html = layout({
        locale: locale.key,
        dir: locale.dir,
        page,
        title: titles[page],
        description: descriptions[page],
        body: bodies[page](),
        sprite,
        t,
        repoUrl: REPO_URL,
        builtVersion,
      });

      const file = path.join(out, pagePath(locale.key, page), 'index.html');
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, html, 'utf8');
      written.push(path.relative(out, file));
    }
  }

  await fs.writeFile(path.join(out, 'index.html'), rootRedirect(), 'utf8');
  await fs.writeFile(path.join(out, 'sitemap.xml'), sitemap(), 'utf8');
  await fs.writeFile(
    path.join(out, 'robots.txt'),
    `User-agent: *\nAllow: /\nSitemap: ${absoluteUrl('sitemap.xml')}\n`,
    'utf8',
  );
  // GitHub Pages passe les fichiers dans Jekyll sans ce marqueur, et Jekyll
  // ignore tout dossier commençant par `_`. Rien n'en porte aujourd'hui, mais
  // la panne serait invisible en local et silencieuse en production.
  await fs.writeFile(path.join(out, '.nojekyll'), '', 'utf8');
  await fs.writeFile(
    path.join(out, 'releases.json'),
    `${JSON.stringify(index, null, 2)}\n`,
    'utf8',
  );

  return {
    out,
    pages: written,
    books,
    latest: index.latest?.version ?? null,
    releases: index.history.length,
    fingerprint: createHash('sha256').update(JSON.stringify(index)).digest('hex').slice(0, 12),
    basePath: BASE_PATH,
  };
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('build.mjs')) {
  const options = parseArgs(process.argv.slice(2));
  const report = await build(options);
  process.stdout.write(
    `site : ${report.pages.length} pages, ${report.releases} version(s), ` +
      `${report.books} livres, dernière ${report.latest ?? 'aucune'} → ${report.out}\n`,
  );
}
