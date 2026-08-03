import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  ANCHORS_SETTING,
  MAX_ANCHORS,
  anchorFor,
  readAnchors,
  rememberAnchor,
  serializeAnchors,
} from '../src/shared/reader-anchors.js';

const readerSource = readFileSync(
  fileURLToPath(new URL('../src/renderer/js/views/reader.js', import.meta.url)),
  'utf8',
);

test('une carte illisible ouvre le livre en haut, elle ne casse rien', () => {
  for (const raw of [null, undefined, '', 'pas du json', '[]', '"texte"', '42']) {
    assert.deepEqual(readAnchors(raw), {}, `refusé : ${String(raw)}`);
  }
});

test('une ancre sans rapport ni page est écartée, les autres passent', () => {
  const anchors = readAnchors(
    JSON.stringify({
      'sh-1': { pageId: 12, ratio: 0.5 },
      'sh-2': { pageId: 'x', ratio: 0.5 },
      'sh-3': { pageId: 4 },
      'sh-4': null,
    }),
  );
  assert.deepEqual(Object.keys(anchors), ['sh-1']);
});

test('le rapport est borné : une hauteur mesurée en pleine recomposition rend n’importe quoi', () => {
  const anchors = readAnchors(
    JSON.stringify({ 'sh-1': { pageId: 1, ratio: 4.2 }, 'sh-2': { pageId: 1, ratio: -3 } }),
  );
  assert.equal(anchorFor(anchors, 'sh-1').ratio, 1);
  assert.equal(anchorFor(anchors, 'sh-2').ratio, 0);
});

test('la carte se taille à cinquante livres, par la tête', () => {
  let anchors = {};
  for (let index = 0; index < MAX_ANCHORS + 10; index += 1) {
    anchors = rememberAnchor(anchors, `sh-${index}`, { pageId: index, ratio: 0.25 });
  }
  const keys = Object.keys(anchors);
  assert.equal(keys.length, MAX_ANCHORS);
  // Les dix premiers sont tombés, le dernier touché est en queue.
  assert.equal(keys[0], 'sh-10');
  assert.equal(keys.at(-1), `sh-${MAX_ANCHORS + 9}`);
});

test('rouvrir un livre le remet en queue, il ne tombe donc jamais', () => {
  let anchors = {};
  for (let index = 0; index < MAX_ANCHORS; index += 1) {
    anchors = rememberAnchor(anchors, `sh-${index}`, { pageId: index, ratio: 0.5 });
  }
  // Le livre qu'on lit tous les jours : sans la remise en queue, il garderait
  // son rang d'origine et tomberait avant celui qu'on a ouvert une seule fois.
  anchors = rememberAnchor(anchors, 'sh-0', { pageId: 99, ratio: 0.8 });
  for (let index = 0; index < 10; index += 1) {
    anchors = rememberAnchor(anchors, `neuf-${index}`, { pageId: index, ratio: 0.1 });
  }
  assert.deepEqual(anchorFor(anchors, 'sh-0'), { pageId: 99, ratio: 0.8 });
  assert.equal(anchorFor(anchors, 'sh-1'), null);
});

test('la carte d’origine n’est jamais modifiée', () => {
  const before = rememberAnchor({}, 'sh-1', { pageId: 3, ratio: 0.3 });
  const after = rememberAnchor(before, 'sh-2', { pageId: 4, ratio: 0.4 });
  assert.deepEqual(Object.keys(before), ['sh-1']);
  assert.deepEqual(Object.keys(after), ['sh-1', 'sh-2']);
});

test('une ancre bancale ne remplace pas celle qui est en place', () => {
  const anchors = rememberAnchor({}, 'sh-1', { pageId: 3, ratio: 0.3 });
  assert.deepEqual(rememberAnchor(anchors, 'sh-1', { pageId: null, ratio: 0.9 }), anchors);
  assert.deepEqual(rememberAnchor(anchors, '', { pageId: 1, ratio: 0.1 }), anchors);
});

test('ce qui est écrit se relit à l’identique', () => {
  const anchors = rememberAnchor({}, 'sh-7745', { pageId: 812, ratio: 0.62 });
  assert.deepEqual(readAnchors(serializeAnchors(anchors)), anchors);
});

/** ------------------------------------------------------ le câblage du lecteur */

test('le lecteur relit la carte au démarrage et l’écrit en partant', () => {
  assert.match(readerSource, /this\.#anchors = readAnchors\(prefs\[ANCHORS_SETTING\]\)/);
  // Quitter le lecteur est le moment où l'on veut que l'endroit soit retenu :
  // l'écriture ne doit pas attendre son répit.
  const dispose = readerSource.slice(
    readerSource.indexOf('  dispose() {'),
    readerSource.indexOf('// ------------------------------------------------------------- structure'),
  );
  assert.match(dispose, /clearTimeout\(this\.#anchorTimer\);\s*\n\s*this\.#saveAnchor\(\);/);
});

test('un saut ouvre en haut, seule une reprise rend sa position', () => {
  // On saute pour voir un endroit précis, pas pour retrouver le sien.
  assert.match(readerSource, /restore: !this\.#requestedPageId/);
  assert.match(readerSource, /if \(restore\) this\.#restoreAnchor\(page\)/);
  const goTo = readerSource.slice(
    readerSource.indexOf('async #goToPage(pageId)'),
    readerSource.indexOf('#chapterFor(page)'),
  );
  assert.ok(!goTo.includes('restore'), 'un saut depuis le sommaire rend sa position');
});

test('la position se rend après une image, jamais au montage', () => {
  const restore = readerSource.slice(
    readerSource.indexOf('#restoreAnchor(page) {'),
    readerSource.indexOf('#scheduleAnchor() {'),
  );
  // La hauteur du bloc n'existe pas encore au moment où on l'insère : un
  // `scrollTop` posé trop tôt retombe à zéro sans rien dire.
  assert.match(restore, /requestAnimationFrame/);
  // `lastScroll` avancé **avant** le saut : sinon `#onScroll` y voit une
  // descente et escamote les barres au moment où l'on cherche où l'on est.
  const avance = restore.indexOf('lastScroll = top');
  const saut = restore.indexOf('scroll.scrollTop = top');
  assert.ok(avance > 0 && avance < saut, 'lastScroll est posé après le saut');
});

test('le nom du réglage est celui du module partagé', () => {
  assert.equal(ANCHORS_SETTING, 'reader.anchors');
  assert.ok(
    !/'reader\.anchors'/.test(readerSource),
    'le lecteur écrit le nom du réglage en clair au lieu de le prendre au module',
  );
});
