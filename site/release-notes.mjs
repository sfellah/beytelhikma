/**
 * Écrit sur la sortie standard le corps de la Release GitHub d'une version,
 * dans les trois langues, depuis les `CHANGELOG.<langue>.md`.
 *
 * GitHub n'offre qu'un champ de texte par Release : c'est ce script qui le
 * remplit, à partir des mêmes fichiers que la page `/releases`. Écrire les
 * notes à la main dans l'interface de GitHub ferait diverger les deux sans que
 * rien ne le signale.
 *
 *   node site/release-notes.mjs 0.3.0 > notes.md
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SITE_LOCALES } from './config.mjs';
import { mergeChangelogs, parseChangelog, releaseBody } from './lib/changelog.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const version = process.argv[2]?.replace(/^v/, '');
if (!version) {
  process.stderr.write('usage : node site/release-notes.mjs <version>\n');
  process.exit(2);
}

const byLocale = {};
const labels = {};
const localeLabels = {};

for (const locale of SITE_LOCALES) {
  const file = path.join(ROOT, `CHANGELOG.${locale.key}.md`);
  byLocale[locale.key] = parseChangelog(await fs.readFile(file, 'utf8'), {
    source: `CHANGELOG.${locale.key}.md`,
  });

  const catalog = (await import(`./locales/${locale.key}.mjs`)).default;
  labels[locale.key] = Object.fromEntries(
    Object.entries(catalog)
      .filter(([key]) => key.startsWith('changelog.'))
      .map(([key, value]) => [key.slice('changelog.'.length), value]),
  );
  localeLabels[locale.key] = locale.label;
}

const entry = mergeChangelogs(byLocale).find((candidate) => candidate.version === version);
if (!entry) {
  // Un tag sans notes est un tag qu'on ne publie pas : la Release partirait
  // avec un corps vide, et la page `/releases` afficherait un trou.
  process.stderr.write(`La version ${version} n'est dans aucun CHANGELOG.\n`);
  process.exit(1);
}

process.stdout.write(`${releaseBody(entry, { labels, localeLabels })}\n`);
