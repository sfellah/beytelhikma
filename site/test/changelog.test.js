import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { SITE_LOCALES } from '../config.mjs';
import { mergeChangelogs, parseChangelog, releaseBody } from '../lib/changelog.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const SAMPLE = `# Journal

> Un préambule ignoré.

## [0.3.0] — 2026-08-01

### added
- Une chose.
- Une autre.

### fixed
- Un défaut.
`;

test('une version se lit avec sa date et ses rubriques', () => {
  const [release] = parseChangelog(SAMPLE);
  assert.equal(release.version, '0.3.0');
  assert.equal(release.date, '2026-08-01');
  assert.deepEqual(
    release.sections.map((section) => section.kind),
    ['added', 'fixed'],
  );
  assert.equal(release.sections[0].items.length, 2);
});

test('une rubrique inconnue fait échouer la lecture', () => {
  assert.throws(
    () => parseChangelog('## [1.0.0] — 2026-01-01\n\n### improuvements\n- x\n'),
    /rubrique .* inconnue/,
  );
});

test('une ligne non reconnue fait échouer la lecture', () => {
  // Une note avalée en silence, c'est une note qui disparaît de la page sans
  // que rien n'échoue : le contraire de ce qu'on veut d'un journal.
  assert.throws(
    () => parseChangelog('## [1.0.0] — 2026-01-01\n\n### added\ntexte libre\n'),
    /ligne non reconnue/,
  );
});

test('une entrée hors rubrique fait échouer la lecture', () => {
  assert.throws(() => parseChangelog('## [1.0.0] — 2026-01-01\n\n- orpheline\n'), /hors de toute rubrique/);
});

test('une version présente dans une seule langue fait échouer la fusion', () => {
  const fr = parseChangelog(SAMPLE);
  const en = parseChangelog(SAMPLE + '\n## [0.2.0] — 2026-07-01\n\n### added\n- x\n');
  assert.throws(() => mergeChangelogs({ fr, en }), /ne couvre pas les mêmes versions/);
});

test('une date qui diffère entre deux langues fait échouer la fusion', () => {
  const fr = parseChangelog(SAMPLE);
  const en = parseChangelog(SAMPLE.replace('2026-08-01', '2026-08-02'));
  assert.throws(() => mergeChangelogs({ fr, en }), /est datée du/);
});

test('le corps de Release porte les trois langues', () => {
  const merged = mergeChangelogs({
    ar: parseChangelog(SAMPLE),
    fr: parseChangelog(SAMPLE),
    en: parseChangelog(SAMPLE),
  });
  const body = releaseBody(merged[0], {
    labels: {
      ar: { added: 'جديد', fixed: 'إصلاحات' },
      fr: { added: 'Nouveautés', fixed: 'Corrections' },
      en: { added: 'New', fixed: 'Fixed' },
    },
    localeLabels: { ar: 'العربية', fr: 'Français', en: 'English' },
  });
  assert.match(body, /## العربية/);
  assert.match(body, /## Français/);
  assert.match(body, /## English/);
});

test('les CHANGELOG du dépôt se lisent et concordent', async () => {
  const byLocale = {};
  for (const locale of SITE_LOCALES) {
    const file = path.join(ROOT, `CHANGELOG.${locale.key}.md`);
    byLocale[locale.key] = parseChangelog(await fs.readFile(file, 'utf8'), {
      source: `CHANGELOG.${locale.key}.md`,
    });
  }
  const merged = mergeChangelogs(byLocale);
  assert.ok(merged.length >= 1, 'au moins une version doit être documentée');
  for (const entry of merged) {
    for (const locale of SITE_LOCALES) {
      assert.ok(
        entry.notes[locale.key].length > 0,
        `la version ${entry.version} n'a aucune rubrique en ${locale.key}`,
      );
    }
  }
});
