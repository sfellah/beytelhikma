/**
 * La parité des catalogues, et l'interdiction d'un texte arabe écrit en dur
 * dans un gabarit — même règle et même raison que
 * `apps/desktop/test/no-hardcoded-strings.test.js` : sans ce test, la
 * prochaine section réintroduirait une chaîne non traduite, et le défaut ne se
 * verrait qu'en changeant de langue, c'est-à-dire jamais pendant le travail.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { SITE_LOCALES } from '../config.mjs';
import ar from '../locales/ar.mjs';
import en from '../locales/en.mjs';
import fr from '../locales/fr.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CATALOGS = { ar, fr, en };

test('les trois catalogues portent exactement les mêmes clés', () => {
  const reference = Object.keys(fr).sort();
  for (const [locale, catalog] of Object.entries(CATALOGS)) {
    assert.deepEqual(Object.keys(catalog).sort(), reference, `écart de clés en ${locale}`);
  }
});

test('aucune valeur vide', () => {
  for (const [locale, catalog] of Object.entries(CATALOGS)) {
    for (const [key, value] of Object.entries(catalog)) {
      assert.equal(typeof value, 'string', `${locale}/${key} n'est pas une chaîne`);
      assert.ok(value.trim().length > 0, `${locale}/${key} est vide`);
    }
  }
});

test('les mêmes paramètres apparaissent dans les trois langues', () => {
  // Un `{version}` oublié dans une traduction donne une phrase amputée, jamais
  // une erreur : `translate` laisse la clé manquante telle quelle.
  const params = (value) => [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  for (const key of Object.keys(fr)) {
    const reference = params(fr[key]);
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      assert.deepEqual(params(catalog[key]), reference, `paramètres différents pour ${key} en ${locale}`);
    }
  }
});

test('la liste des locales du site est celle des fichiers présents', async () => {
  const files = await fs.readdir(path.join(HERE, '..', 'locales'));
  assert.deepEqual(
    files.filter((name) => name.endsWith('.mjs')).sort(),
    SITE_LOCALES.map((locale) => `${locale.key}.mjs`).sort(),
  );
});

test('aucun gabarit ne porte de texte arabe en dur', async () => {
  const dir = path.join(HERE, '..', 'templates');
  const arabic = /[؀-ۿ]/;
  for (const name of await fs.readdir(dir)) {
    const source = await fs.readFile(path.join(dir, name), 'utf8');
    const offenders = source
      .split('\n')
      .map((line, index) => [index + 1, line])
      .filter(([, line]) => arabic.test(line) && !line.trim().startsWith('*'));
    assert.deepEqual(offenders, [], `texte arabe en dur dans templates/${name}`);
  }
});
