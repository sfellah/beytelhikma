import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_LOCALE,
  LOCALES,
  localeDigits,
  localeDir,
  resolveLocale,
} from '../src/shared/locale.js';

test('resolveLocale rend une clé connue telle quelle', () => {
  for (const locale of LOCALES) {
    assert.equal(resolveLocale(locale.key), locale.key);
  }
});

/**
 * `CLAUDE.md` annonçait trois locales, dont le français. On en retient deux :
 * une base d'utilisateur peut porter `fr`, et il ne doit pas laisser
 * l'application sans langue.
 */
test('resolveLocale replie tout le reste sur l’arabe', () => {
  for (const stored of ['fr', 'ar-EG', '', ' ', null, undefined, 0, {}]) {
    assert.equal(resolveLocale(stored), DEFAULT_LOCALE);
  }
});

test('chaque locale porte une direction et un système de chiffres', () => {
  assert.equal(localeDir('ar'), 'rtl');
  assert.equal(localeDir('en'), 'ltr');
  assert.equal(localeDigits('ar'), 'arab');
  assert.equal(localeDigits('en'), 'latn');
});

test('une locale inconnue prend la direction du défaut', () => {
  assert.equal(localeDir('fr'), 'rtl');
  assert.equal(localeDir(null), 'rtl');
});

/**
 * Le propriétaire est unique. C'est de deux copies de la liste des thèmes
 * qu'était née la panne du `sepia` ; la liste des locales part du bon pied.
 */
test('les clés sont exactement ar et en', () => {
  assert.deepEqual(
    LOCALES.map((locale) => locale.key),
    ['ar', 'en'],
  );
});
