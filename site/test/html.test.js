import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { escapeHtml, safeUrl } from '../lib/html.mjs';
import { extractThemeBlock, nightMediaCss } from '../lib/theme-css.mjs';

const RENDERER = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'beytelhikma-electron',
  'src',
  'renderer',
);

test('l’échappement couvre le guillemet et l’apostrophe', () => {
  // C'est le défaut relevé dans `tools/shamela/text.py` : un `escape()` qui
  // laisse passer `"` est sûr entre balises et devient une injection
  // d'attribut dès qu'on l'interpole dans un `alt=`.
  assert.equal(escapeHtml('a"b'), 'a&quot;b');
  assert.equal(escapeHtml("a'b"), 'a&#39;b');
  assert.equal(escapeHtml('<x> & </x>'), '&lt;x&gt; &amp; &lt;/x&gt;');
  assert.equal(escapeHtml(null), '');
});

test('une URL de schéma inattendu ne franchit pas le rendu', () => {
  assert.equal(safeUrl('javascript:alert(1)'), '#');
  assert.equal(safeUrl('http://exemple.test'), '#');
  assert.equal(safeUrl('https://github.com/o/r'), 'https://github.com/o/r');
  assert.equal(safeUrl('/beytelhikma/ar/'), '/beytelhikma/ar/');
});

test('le bloc d’ambiance nuit s’extrait de tokens.css', async () => {
  const tokens = await fs.readFile(path.join(RENDERER, 'styles', 'tokens.css'), 'utf8');
  const block = extractThemeBlock(tokens, 'night');
  assert.match(block, /--surface:/);
  assert.match(nightMediaCss(tokens), /@media \(prefers-color-scheme: dark\)/);
});

test('un thème absent de tokens.css est une erreur, pas un silence', () => {
  assert.throws(() => extractThemeBlock(':root { --a: 1; }', 'night'), /ne déclare pas/);
});
