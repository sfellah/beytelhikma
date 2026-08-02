import assert from 'node:assert/strict';
import test from 'node:test';

import { arabicSearchPattern, normalizeArabic } from '../src/shared/arabic.js';

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

/**
 * `pages.body_search` est normalisé, `body_plain` ne l'est pas : leurs longueurs
 * diffèrent. Le motif sert à retrouver la position dans le **texte d'origine**,
 * seule façon d'extraire un extrait juste et de surligner au bon endroit.
 */
test('arabicSearchPattern retrouve le terme dans le texte non normalisé', () => {
  const source = 'قال الشيخ أَحْمَد بن عبد الله';
  // `exec` et non `match` : avec le drapeau `g`, `match` ne rend pas l'index.
  const match = arabicSearchPattern('احمد').exec(source);
  assert.ok(match, 'la forme vocalisée doit être trouvée');
  assert.equal(match[0], 'أَحْمَد');
  assert.equal(source.slice(match.index, match.index + match[0].length), 'أَحْمَد');
});

test('arabicSearchPattern absorbe tāʾ marbūṭa, alif maqṣūra et tatweel', () => {
  assert.match('هذه الرسالة نافعة', arabicSearchPattern('الرساله'));
  assert.match('قرأ مصطفى الكتاب', arabicSearchPattern('مصطفي'));
  assert.match('ابـــن تيمية', arabicSearchPattern('ابن'));
});

test('arabicSearchPattern tolère un espacement différent', () => {
  assert.match('فقه    مالكي', arabicSearchPattern('فقه مالكي'));
});

test('arabicSearchPattern échappe les métacaractères', () => {
  // Sans échappement, « (a) » serait un groupe et « . » n'importe quel caractère.
  assert.match('texte (a) ici', arabicSearchPattern('(a)'));
  assert.equal(arabicSearchPattern('a.c').test('abc'), false);
  assert.match('a.c', arabicSearchPattern('a.c'));
});

test('arabicSearchPattern sur un terme vide ne trouve rien', () => {
  assert.equal(arabicSearchPattern('').test('quoi que ce soit'), false);
  assert.equal(arabicSearchPattern(null).test('quoi que ce soit'), false);
});
