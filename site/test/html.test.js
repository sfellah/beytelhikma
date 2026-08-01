import assert from 'node:assert/strict';
import test from 'node:test';

import { escapeHtml, safeUrl } from '../lib/html.mjs';

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
