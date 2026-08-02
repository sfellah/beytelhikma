/**
 * Contrôle du repère de décalages du parseur natif.
 *
 * Ce que ça garde : `src/parse.js` doit compter les caractères exactement comme
 * `annotations.js` les compte dans le DOM. Si les deux divergent d'un seul
 * caractère, une annotation posée sur mobile se dessine au mauvais endroit sur
 * le bureau — et rien ne le dirait à l'exécution.
 *
 *   node check.mjs
 */
import assert from 'node:assert/strict';

import { PAGE_HTML, SEEDED_HIGHLIGHTS } from './src/fixture.js';
import { locateAll, parseHtml, renderedText, splitRun, toBlocks } from './src/parse.js';

const tree = parseHtml(PAGE_HTML);
const full = renderedText(tree);
const blocks = toBlocks(tree);
const placed = locateAll(full, SEEDED_HIGHLIGHTS);

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

console.log('repère de décalages');

check('aucune balise ne survit dans le texte rendu', () => {
  assert.equal(/[<>]/.test(full), false, `texte pollué : ${full.slice(0, 80)}`);
});

check('les entités sont décodées comme par le DOM', () => {
  assert.equal(full.includes('&nbsp;'), false, 'entité non décodée');
  assert.ok(full.includes(' '), 'l’espace insécable doit rester U+00A0, pas devenir une espace');
});

check('<br> et <hr> ne comptent pour aucun caractère', () => {
  assert.equal(full.includes('\n'), false, 'un saut de ligne s’est glissé dans le repère');
  const flat = blocks.flatMap((block) => block.runs).filter((run) => run.marks.includes('br'));
  assert.equal(flat.length, 1, `un seul <br> attendu, ${flat.length} trouvés`);
  assert.equal(flat[0].start, flat[0].end, '<br> doit occuper une largeur nulle');
});

check('les frontières de blocs ne comptent pour rien', () => {
  const runs = blocks.flatMap((block) => block.runs).filter((run) => run.text);
  const joined = runs.map((run) => run.text).join('');
  assert.equal(joined, full, 'la concaténation des runs doit rendre le texte entier');
  for (let i = 1; i < runs.length; i += 1) {
    assert.equal(runs[i].start, runs[i - 1].end, `trou entre les runs ${i - 1} et ${i}`);
  }
});

console.log('\nsurlignages');

check('les trois surlignages sont placés', () => {
  assert.equal(placed.length, 3, `attendu 3, obtenu ${placed.length} : ${placed.map((h) => h.highlightId)}`);
});

for (const highlight of placed) {
  check(`« ${highlight.selectedText.slice(0, 24)} » retombe sur son texte`, () => {
    assert.equal(full.slice(highlight.start, highlight.end), highlight.selectedText);
  });
}

check('le surlignage traversant la césure tient dans un seul bloc', () => {
  const across = placed.find((highlight) => highlight.highlightId === 'hl-across');
  assert.ok(across, 'hl-across introuvable — le texte cherché ne correspond pas à la page');
  const holders = blocks.filter((block) =>
    block.runs.some((run) => run.end > across.start && run.start < across.end),
  );
  assert.equal(holders.length, 1, `réparti sur ${holders.length} blocs`);
  assert.equal(holders[0].cls, 'verse', 'devrait tomber dans un vers');
});

check('le découpage aux frontières ne perd ni n’ajoute de texte', () => {
  const pieces = blocks.flatMap((block) => block.runs.flatMap((run) => splitRun(run, placed)));
  assert.equal(pieces.map((piece) => piece.text).join(''), full);
  const painted = pieces.filter((piece) => piece.highlight);
  assert.ok(painted.length >= 3, `au moins 3 morceaux peints, ${painted.length} obtenus`);
  for (const highlight of placed) {
    const mine = painted.filter((piece) => piece.highlight.highlightId === highlight.highlightId);
    assert.equal(
      mine.map((piece) => piece.text).join(''),
      highlight.selectedText,
      `${highlight.highlightId} : les morceaux peints ne reforment pas la sélection`,
    );
  }
});

console.log('\nstructure');
check('le corpus réel ne produit aucun bloc dans le flux inline', () => {
  const inline = new Set(blocks.flatMap((block) => block.runs.flatMap((run) => run.marks)));
  const blocky = [...inline].filter((mark) => ['ul', 'ol', 'li', 'div', 'blockquote'].includes(mark));
  assert.deepEqual(blocky, [], `balises de bloc en ligne : ${blocky}`);
});

console.log(
  `\n${blocks.length} blocs, ${full.length} caractères, ${placed.length} surlignages — ` +
    (failures ? `${failures} ÉCHEC(S)` : 'tout passe'),
);
process.exit(failures ? 1 : 0);
