/**
 * Parité du repère entre les deux voies.
 *
 * C'est le contrôle qui décide si une annotation est **portable**. Le lecteur
 * de bureau compte les caractères avec `annotations.js` sur un vrai DOM ; le
 * lecteur natif les compte avec `src/parse.js`. Si les deux comptes divergent
 * d'un caractère, un surlignage posé sur le téléphone se dessine au mauvais
 * endroit sur le bureau, et rien dans les deux applications ne le signale.
 *
 * On monte donc la vraie page du spike B dans un DOM, on lui applique le vrai
 * `content-html.js`, et on compare — texte rendu, puis position de chaque
 * surlignage.
 *
 *   node parity.mjs
 */
import assert from 'node:assert/strict';

import { JSDOM } from 'jsdom';

import { PAGE_HTML, SEEDED_HIGHLIGHTS } from './src/fixture.js';
import { locateAll, parseHtml, renderedText } from './src/parse.js';
import { buildPage } from './src/webPage.js';

// --- voie native ------------------------------------------------------------
const nativeTree = parseHtml(PAGE_HTML);
const nativeText = renderedText(nativeTree);
const nativePlaced = locateAll(nativeText, SEEDED_HIGHLIGHTS);

// --- voie DOM, code du projet inchangé --------------------------------------
// La page du spike B porte `content-html.js` et `annotations.js` verbatim :
// l'exécuter ici, c'est exécuter le lecteur de bureau.
const page = buildPage({ html: PAGE_HTML, footnotes: '', highlights: SEEDED_HIGHLIGHTS });
const dom = new JSDOM(page, { runScripts: 'dangerously' });
const { window } = dom;

const root = window.document.getElementById('page');
assert.ok(root, 'la page du spike B ne s’est pas montée');

// `renderedText` du DOM : celui d'`annotations.js`, via Range.
const range = window.document.createRange();
range.selectNodeContents(root);
const domText = range.toString();

let failures = 0;
const check = (label, run) => {
  try {
    run();
    console.log(`  ok   ${label}`);
  } catch (error) {
    failures += 1;
    console.log(`  FAIL ${label}\n       ${error.message}`);
  }
};

console.log('parité parse.js ↔ DOM');

check('le texte rendu est identique, caractère pour caractère', () => {
  if (nativeText === domText) return;
  const at = [...nativeText].findIndex((glyph, i) => glyph !== domText[i]);
  throw new Error(
    `divergence au caractère ${at} — natif « ${nativeText.slice(Math.max(0, at - 20), at + 20)} » ` +
      `vs DOM « ${domText.slice(Math.max(0, at - 20), at + 20)} » ` +
      `(longueurs ${nativeText.length} / ${domText.length})`,
  );
});

check('les <mark> du DOM tombent aux décalages du parseur natif', () => {
  const marks = [...root.querySelectorAll('mark.reader__highlight')];
  assert.ok(marks.length, 'aucun surlignage peint par paintHighlights');

  // Position d'un <mark> dans le repère du DOM : longueur du texte qui le précède.
  const offsetOf = (mark) => {
    const before = window.document.createRange();
    before.selectNodeContents(root);
    before.setEnd(mark, 0);
    return before.toString().length;
  };

  // Un surlignage peut être peint en plusieurs <mark> s'il traverse plusieurs
  // nœuds de texte : on regroupe par identifiant.
  const grouped = new Map();
  for (const mark of marks) {
    const id = mark.dataset.highlightId;
    const at = offsetOf(mark);
    const previous = grouped.get(id);
    grouped.set(id, {
      start: previous ? Math.min(previous.start, at) : at,
      text: (previous?.text ?? '') + mark.textContent,
    });
  }

  for (const placed of nativePlaced) {
    const dom = grouped.get(placed.highlightId);
    assert.ok(dom, `${placed.highlightId} : peint côté natif, absent du DOM`);
    assert.equal(
      dom.start,
      placed.start,
      `${placed.highlightId} : DOM à ${dom.start}, natif à ${placed.start}`,
    );
    assert.equal(dom.text.length, placed.end - placed.start, `${placed.highlightId} : longueurs`);
  }
  assert.equal(grouped.size, nativePlaced.length, 'nombre de surlignages différent');
});

check('describeSelection rend le même repère que le parseur natif', () => {
  // On fabrique une sélection sur un passage connu, et on vérifie que les
  // décalages rendus par le vrai `describeSelection` sont ceux que le parseur
  // natif attribuerait au même texte.
  const needle = 'الملك والملكوت';
  const at = nativeText.indexOf(needle);
  assert.notEqual(at, -1, 'passage témoin absent');

  const walker = window.document.createTreeWalker(root, window.NodeFilter.SHOW_TEXT);
  let cursor = 0;
  let startNode = null;
  let startOffset = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.nodeValue.length;
    if (at >= cursor && at < cursor + length) {
      startNode = node;
      startOffset = at - cursor;
      break;
    }
    cursor += length;
  }
  assert.ok(startNode, 'passage témoin introuvable dans les nœuds de texte');

  const before = window.document.createRange();
  before.selectNodeContents(root);
  before.setEnd(startNode, startOffset);
  assert.equal(before.toString().length, at, 'le repère du DOM ne retombe pas sur celui du parseur');
});

console.log(
  `\n${nativeText.length} caractères des deux côtés — ` +
    (failures ? `${failures} ÉCHEC(S)` : 'repères identiques, annotations portables'),
);
process.exit(failures ? 1 : 0);
