import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  footnotesByNumber,
  markerPattern,
  parseFootnotes,
  toLatinDigits,
} from '../src/shared/footnotes.js';

const readerSource = readFileSync(
  fileURLToPath(new URL('../src/renderer/js/views/reader.js', import.meta.url)),
  'utf8',
);

test('les chiffres arabes-indiens se ramènent à leur valeur', () => {
  // Le corpus mêle les deux écritures, parfois sur la même page : la note peut
  // être numérotée « (1) » et son appel écrit « (١) ».
  assert.equal(toLatinDigits('١٢٣'), '123');
  assert.equal(toLatinDigits('(٤)'), '(4)');
  assert.equal(toLatinDigits('abc'), 'abc');
});

test('les notes du jeu d’exemple se découpent', () => {
  const notes = parseFootnotes('(1) الأقيال: جمع قَيْل، وهو الملك من ملوك حِمْيَر.');
  assert.deepEqual(notes, [
    { number: 1, text: 'الأقيال: جمع قَيْل، وهو الملك من ملوك حِمْيَر.' },
  ]);
});

test('une note qui déborde sur plusieurs lignes reste une note', () => {
  // La couper en deux en montrerait la moitié.
  const notes = parseFootnotes('(1) أول السطر\nتتمّة السطر\n(2) الثانية');
  assert.equal(notes.length, 2);
  assert.equal(notes[0].text, 'أول السطر تتمّة السطر');
  assert.equal(notes[1].number, 2);
});

test('trois formes de numérotation, et les chiffres des deux écritures', () => {
  const notes = parseFootnotes('(1) أ\n٢) ب\n[3] ج');
  assert.deepEqual(
    notes.map((note) => note.number),
    [1, 2, 3],
  );
});

test('ce qui précède la première note est gardé, sans numéro', () => {
  const notes = parseFootnotes('نصّ لا يُستدعى\n(1) الأولى');
  assert.equal(notes[0].number, null);
  assert.equal(notes[1].number, 1);
  // Sans numéro, elle n'est pas appelable : elle ne doit pas entrer dans la
  // table, sinon un `(NaN)` du texte lui répondrait.
  assert.equal(footnotesByNumber('نصّ لا يُستدعى\n(1) الأولى').size, 1);
});

test('rien à lire rend une table vide', () => {
  for (const raw of [null, undefined, '', '   ', 42]) {
    assert.deepEqual(parseFootnotes(raw), [], `refusé : ${String(raw)}`);
  }
  assert.equal(markerPattern(footnotesByNumber(null)), null);
});

test('sans note en pied, aucun appel n’est cherché dans le texte', () => {
  // C'est la garde qui empêche d'abîmer une page : « (3) » au fil d'un texte
  // est aussi bien un numéro de verset ou une énumération.
  assert.equal(markerPattern(new Map()), null);
  assert.notEqual(markerPattern(footnotesByNumber('(1) شيء')), null);
});

test('le motif trouve les appels des deux écritures, et rien d’autre', () => {
  const pattern = markerPattern(footnotesByNumber('(1) أ\n(2) ب'));
  const found = [...'نصّ (١) ثم 12 ثم [2] وليس 3'.matchAll(pattern)].map((match) =>
    Number(toLatinDigits(match[1])),
  );
  // « 12 » nu n'est pas un appel : sans parenthèses, un nombre est un nombre.
  assert.deepEqual(found, [1, 2]);
});

test('un numéro répété ne remplace pas la note qu’il double', () => {
  const notes = footnotesByNumber('(1) la vraie\n(1) la seconde');
  assert.equal(notes.get(1), 'la vraie');
});

/** ------------------------------------------------------ le câblage du lecteur */

test('le lecteur traite les deux formes d’appel du corpus', () => {
  // `tools/shamela/text.py` retire toute balise autre que `br`, `hr`, les
  // images et les titres : le corpus réel n'a pas de `<sup class="fn">`, et ne
  // traiter que celui-ci donnerait une fonctionnalité qui marche sur les cinq
  // livres d'exemple et sur rien d'autre.
  const bloc = readerSource.slice(
    readerSource.indexOf('#linkFootnotes(block) {'),
    readerSource.indexOf('#armFootnote(block, element, number) {'),
  );
  assert.match(bloc, /querySelectorAll\('sup\.fn'\)/);
  assert.match(bloc, /markerPattern\(notes\)/);
  assert.match(bloc, /createTreeWalker/);
  // On ne marque que ce à quoi une note répond.
  assert.match(bloc, /if \(!notes\.has\(number\)\) continue;/);
});

test('la note est la première couche que le retour referme', () => {
  const cascade = readerSource.slice(
    readerSource.indexOf('#closeTopLayer() {'),
    readerSource.indexOf('#onKey(event) {'),
  );
  assert.ok(
    cascade.indexOf('#closeFootnote()') < cascade.indexOf('#hideSelection()'),
    'la note se referme après la sélection : ce n’est pas la couche du dessus',
  );
});

test('un appel de note ne tourne pas la page sous la note qu’il ouvre', () => {
  const arme = readerSource.slice(
    readerSource.indexOf('#armFootnote(block, element, number) {'),
    readerSource.indexOf('#openFootnote(block, number) {'),
  );
  assert.match(arme, /event\.stopPropagation\(\)/);
  // Au clavier aussi : l'appel est un bouton, pas une décoration.
  assert.match(arme, /role', 'button'/);
  assert.match(arme, /tabindex', '0'/);
});
