import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { DEFAULT_THEME, resolveTheme, THEMES } from '../src/shared/theme.js';

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

test('resolveTheme rend une clé connue telle quelle', () => {
  for (const theme of THEMES) {
    assert.equal(resolveTheme(theme.key), theme.key);
  }
});

test('resolveTheme replie tout le reste sur le parchemin', () => {
  // `sepia` a existé dans `views/settings.js` : une base d'utilisateur peut
  // encore le porter, et il ne doit pas laisser l'application sans thème.
  for (const stored of ['sepia', 'dark', '', ' ', null, undefined, 0, {}]) {
    assert.equal(resolveTheme(stored), DEFAULT_THEME);
  }
});

/**
 * Parité table ↔ feuille de style. C'est faute d'un tel test que les listes de
 * `reader.js` et de `settings.js` avaient divergé sans qu'aucun test n'échoue.
 */
test('chaque thème a son bloc de jetons, et le parchemin n’en a pas', () => {
  const tokens = read('../src/renderer/styles/tokens.css');

  for (const theme of THEMES) {
    const block = `:root[data-theme='${theme.key}']`;
    if (theme.key === DEFAULT_THEME) {
      assert.equal(
        tokens.includes(block),
        false,
        `${theme.key} est le défaut : il *est* :root, il ne se surcharge pas`,
      );
    } else {
      assert.ok(tokens.includes(block), `bloc de jetons manquant pour ${theme.key}`);
    }
  }
});

test('les blocs de jetons ne déclarent pas de thème inconnu', () => {
  const tokens = read('../src/renderer/styles/tokens.css');
  const declared = [...tokens.matchAll(/:root\[data-theme='([^']+)'\]/g)].map((match) => match[1]);
  const known = new Set(THEMES.map((theme) => theme.key));

  for (const key of declared) {
    assert.ok(known.has(key), `bloc orphelin dans tokens.css : ${key}`);
  }
});

/**
 * Le propriétaire est unique. Une vue qui redéclare la liste la fait dériver —
 * c'est exactement ce qui s'était produit, et `sepia` en était la trace.
 */
test('aucune vue ne redéclare la liste des thèmes', () => {
  for (const view of ['../src/renderer/js/views/reader.js', '../src/renderer/js/views/settings.js']) {
    const source = read(view);
    assert.equal(/const THEMES\s*=/.test(source), false, `${view} redéclare THEMES`);
    assert.equal(source.includes('sepia'), false, `${view} porte encore sepia`);
  }
});

test('les swatches annoncent les jetons réels', () => {
  const tokens = read('../src/renderer/styles/tokens.css');
  const surfaceOf = (block) => {
    const scope = block ? tokens.slice(tokens.indexOf(block)) : tokens;
    return scope.match(/--surface:\s*(#[0-9a-f]{6})/i)[1];
  };

  const expected = {
    paper: surfaceOf(null),
    white: surfaceOf(":root[data-theme='white']"),
    night: surfaceOf(":root[data-theme='night']"),
  };

  for (const theme of THEMES) {
    assert.equal(
      theme.swatch.toLowerCase(),
      expected[theme.key].toLowerCase(),
      `la pastille de ${theme.key} ment sur la couleur du thème`,
    );
  }
});
