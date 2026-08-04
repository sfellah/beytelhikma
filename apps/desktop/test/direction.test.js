import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/**
 * La direction est le défaut qui ne se voit jamais en développement : tout est
 * écrit et relu en arabe, donc une icône figée « à droite » ou un dégradé figé
 * « vers la gauche » coïncide avec la vérité et ne se démasque qu'en anglais —
 * c'est-à-dire jamais. Ces vérifications sont statiques, comme celles du thème
 * et des polices : elles lisent la source et interdisent la régression.
 */

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const reader = read('../src/renderer/js/views/reader.js');
const home = read('../src/renderer/js/views/home.js');
const bookDetail = read('../src/renderer/js/views/book-detail.js');
const pagination = read('../src/renderer/js/components/pagination.js');
const icons = read('../src/renderer/js/icons.js');
const css = read('../src/renderer/styles/views.css');

test('icons.js est le seul propriétaire du sens des chevrons', () => {
  for (const [name, source] of [
    ['reader.js', reader],
    ['book-detail.js', bookDetail],
    ['pagination.js', pagination],
  ]) {
    for (const frozen of ['chevronLeft', 'chevronRight', 'arrowLeft', 'arrowRight']) {
      assert.ok(
        !source.includes(`'${frozen}'`),
        `${name} nomme ${frozen} en dur : le sens doit venir de icons.js`,
      );
    }
  }

  for (const helper of ['chevronForward', 'chevronBackward', 'arrowForward', 'arrowBackward']) {
    assert.ok(icons.includes(`export function ${helper}`), `icons.js doit exporter ${helper}`);
  }
});

test('le feuilletage au clavier suit la direction de l’interface', () => {
  // Une flèche figée fait reculer le bouton qui avance dès que l'interface
  // bascule : les deux touches se décident, elles ne se codent pas.
  assert.ok(
    /const forward = isRtl\(\) \? 'ArrowLeft' : 'ArrowRight'/.test(reader),
    'le lecteur doit choisir la touche « suivante » selon la direction',
  );
  assert.ok(
    /const backward = isRtl\(\) \? 'ArrowRight' : 'ArrowLeft'/.test(reader),
    'le lecteur doit choisir la touche « précédente » selon la direction',
  );
});

test('le texte du livre porte sa direction, l’interface ne la lui donne pas', () => {
  // Le corpus est arabe : une page reste RTL sous une interface anglaise.
  const marked = reader.match(/dir: CONTENT_DIR/g) ?? [];
  assert.ok(marked.length >= 6, 'les nœuds de contenu du lecteur doivent porter `dir`');
  assert.ok(
    /const body = h\('article', \{ class: 'reader__page', dir: CONTENT_DIR \}\)/.test(reader),
    'la page du livre doit porter sa direction explicitement',
  );
  assert.equal(reader.includes("const CONTENT_DIR = 'rtl'"), true);
});

test('la jauge de lecture se remplit du bord d’où part la poignée', () => {
  // `input[type=range]` croît de droite à gauche en RTL : un dégradé figé
  // remplissait la jauge à l'envers sous interface anglaise.
  const rail = css.slice(css.indexOf('.reader__rail {'));
  assert.ok(/\.reader__rail \{[^}]*to right/s.test(rail), 'LTR : remplissage vers la droite');
  assert.ok(
    /\[dir='rtl'\] \.reader__rail \{[^}]*to left/s.test(rail),
    'RTL : le dégradé doit être renversé',
  );
});

test('le sens du défilement horizontal vit dans un seul module', () => {
  // Deux bandes existent maintenant — les nouveautés et les ouvrages de
  // référence. Deux copies de la même règle auraient rejoué le `sepia` mort et
  // la liste de polices déclarée deux fois : c'est `components/scroller.js` qui
  // la porte, et l'accueil ne la connaît plus.
  //
  // `scrollLeft` décroît en RTL et croît en LTR. Écrit en dur pour l'arabe, le
  // bouton « suivant » de l'accueil ne bougeait pas d'un pixel sous interface
  // anglaise — un défaut qui coïncide avec la vérité dans la langue où l'on
  // développe, donc invisible jusqu'à la bascule.
  const scroller = read('../src/renderer/js/components/scroller.js');
  assert.ok(
    /const avance = \(\) => \(localeDir\(currentLocale\(\)\) === 'rtl' \? -1 : 1\)/.test(scroller),
    'le sens du défilement doit se déduire de la direction de l’interface',
  );
  for (const [nom, source] of [
    ['home.js', home],
    ['scroller.js', scroller],
  ]) {
    for (const fige of ['left: step()', 'left: -step()']) {
      assert.ok(!source.includes(fige), `${nom} fige le sens du défilement : ${fige}`);
    }
  }
  assert.ok(
    !home.includes('scrollBy'),
    'l’accueil ne pilote plus le défilement lui-même : il passe par le composant',
  );
});

test('les décalages physiques du lecteur ont leur pendant RTL', () => {
  for (const rule of [
    "[dir='rtl'] .reader__back:hover .icon",
    // La classe de la façon de lire a disparu avec le fil vertical : il n'en
    // reste qu'une, et les animations de feuilletage se portent sur le bloc.
    "[dir='rtl'] .reader__block.is-turned-next",
    "[dir='rtl'] .reader__block.is-turned-previous",
    "[dir='rtl'] .toc__chapter[open] > summary .icon--chevron",
  ]) {
    assert.ok(css.includes(rule), `règle RTL manquante : ${rule}`);
  }
});
