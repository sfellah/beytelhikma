import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeArabic } from '../src/shared/arabic.js';

/**
 * Valeurs produites par `normalize_ar` de `tools/_common.py`. Sans cette table,
 * les deux implémentations divergent en silence et la recherche se dégrade sans
 * qu'aucun test n'échoue.
 */
const PARITY = [
  ['أَحْمَد', 'احمد'],
  ['إبراهيم', 'ابراهيم'],
  ['آل عمران', 'ال عمران'],
  ['ٱلكتاب', 'الكتاب'],
  ['مُقَدِّمَة ابن خَلْدُون', 'مقدمه ابن خلدون'],
  ['الرسالة', 'الرساله'],
  ['عائشة', 'عائشه'],
  ['ىسير', 'يسير'],
  ['ابـــن تيمية', 'ابن تيميه'],
  ['  فقه   مالكي  ', 'فقه مالكي'],
  ['الشافعيّة', 'الشافعيه'],
  ['ة', 'ه'],
  ['ى', 'ي'],
];

test('normalizeArabic reproduit normalize_ar du pipeline', () => {
  for (const [input, expected] of PARITY) {
    assert.equal(normalizeArabic(input), expected, `entrée : ${input}`);
  }
});

test('normalizeArabic tolère le vide et le non-arabe', () => {
  assert.equal(normalizeArabic(''), '');
  assert.equal(normalizeArabic(null), '');
  assert.equal(normalizeArabic('Ibn Khaldun'), 'Ibn Khaldun');
});
