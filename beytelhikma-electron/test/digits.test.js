import assert from 'node:assert/strict';
import test from 'node:test';

import { formatNumber, toArabicDigits } from '../src/shared/digits.js';

test('toArabicDigits convertit les dix chiffres', () => {
  assert.equal(toArabicDigits('0123456789'), '٠١٢٣٤٥٦٧٨٩');
});

test('toArabicDigits ne touche à rien d’autre', () => {
  assert.equal(toArabicDigits('page 42 of 350'), 'page ٤٢ of ٣٥٠');
  assert.equal(toArabicDigits('الصفحة'), 'الصفحة');
  assert.equal(toArabicDigits(''), '');
});

test('formatNumber suit la locale', () => {
  assert.equal(formatNumber(42, 'ar'), '٤٢');
  assert.equal(formatNumber(42, 'en'), '42');
  assert.equal(formatNumber(0, 'ar'), '٠');
  assert.equal(formatNumber(0, 'en'), '0');
  assert.equal(formatNumber(8568, 'ar'), '٨٥٦٨');
});

/**
 * Pas d'`Intl.NumberFormat` : son `ar` ajoute un séparateur de milliers (`٬`)
 * et un signe décimal (`٫`) que rien dans l'interface n'attend, et son
 * comportement suit la version d'ICU embarquée dans Electron.
 */
test('formatNumber ne pose aucun séparateur de milliers', () => {
  assert.equal(formatNumber(182805, 'ar'), '١٨٢٨٠٥');
  assert.equal(formatNumber(182805, 'en'), '182805');
});

test('formatNumber garde le signe et la décimale', () => {
  assert.equal(formatNumber(-7, 'ar'), '-٧');
  assert.equal(formatNumber(1.5, 'ar'), '١.٥');
});

test('formatNumber replie une locale inconnue sur l’arabe', () => {
  assert.equal(formatNumber(42, 'fr'), '٤٢');
  assert.equal(formatNumber(42, null), '٤٢');
});
