import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const lire = (chemin) => readFileSync(fileURLToPath(new URL(chemin, import.meta.url)), 'utf8');

const source = lire('../src/renderer/js/views/book-detail.js');
const css = lire('../src/renderer/styles/views.css');
const ar = lire('../src/renderer/js/locales/ar.js');
const en = lire('../src/renderer/js/locales/en.js');

/** Le corps de `tocSection`, de sa signature à la fabrique de chapitre. */
const sommaire = () => {
  const debut = source.indexOf('function tocSection(');
  const fin = source.indexOf('function tocChapter(', debut);
  assert.ok(debut > 0 && fin > debut, 'tocSection introuvable');
  return source.slice(debut, fin);
};

/** Un bloc de règles CSS, de son sélecteur à l'accolade fermante. */
const bloc = (selecteur) => {
  const debut = css.indexOf(`${selecteur} {`);
  assert.ok(debut >= 0, `${selecteur} a disparu de views.css`);
  return css.slice(debut, css.indexOf('}', debut) + 1);
};

test('les entrées du sommaire ne se rétrécissent pas dans la boîte', () => {
  // C'est la panne d'origine, et elle ne se voyait que sur les gros livres.
  // `.toc__list` est une colonne de flex bornée en hauteur ; ses enfants
  // portent `overflow: hidden`, ce qui ramène leur taille minimale automatique
  // à zéro. Soixante chapitres se partageaient donc les ~300 px en filets de
  // cinq pixels, texte rogné — et la liste, ne débordant plus, ne défilait pas
  // non plus. Le sommaire s'affichait comme une pile de barres vides.
  assert.match(bloc('.toc__list > *'), /flex-shrink: 0;/);
  assert.match(bloc('.toc__chapter'), /overflow: hidden;/);
});

test('la boîte du sommaire montre cinq entrées et demie, et défile', () => {
  const regle = bloc('.toc__list');
  assert.match(regle, /overflow-y: auto;/);
  // Une demi-entrée coupée au bord dit qu'il y en a d'autres dessous.
  assert.match(regle, /max-height: calc\(var\(--toc-row\) \* 5\.5\);/);
  assert.match(regle, /--toc-row: \d+px;/);
});

test('aucun alignement physique dans les blocs du sommaire', () => {
  // L'interface bascule RTL/LTR : `left`/`right` désigneraient l'inverse.
  for (const selecteur of ['.toc__list', '.toc__list > *', '.toc__children', '.toc__child']) {
    assert.ok(
      !/\b(left|right):|\bmargin-(left|right)|\bpadding-(left|right)/.test(bloc(selecteur)),
      `alignement physique dans ${selecteur}`,
    );
  }
});

test('le défilement monte la tranche suivante ; plus aucun bouton à viser', () => {
  const corps = sommaire();
  assert.match(corps, /list\.addEventListener\('scroll'/);
  assert.match(corps, /list\.scrollHeight - list\.scrollTop - list\.clientHeight <= TOC_EDGE/);
  assert.match(source, /const TOC_EDGE = \d+;/);
  assert.ok(!/toc__more/.test(source), 'le bloc « voir plus » survit dans la vue');
  assert.ok(!/toc__more/.test(css), 'la règle .toc__more survit dans views.css');
});

test('une clé que plus personne ne cite ne reste pas au catalogue', () => {
  // `detail.showMore` était la seule à nommer le bouton disparu.
  for (const [nom, catalogue] of [
    ['ar', ar],
    ['en', en],
  ]) {
    assert.ok(!catalogue.includes("'detail.showMore'"), `detail.showMore survit dans ${nom}.js`);
  }
});

test('la tranche montée est bornée, et le sommaire entier ne l’est pas', () => {
  const declaration = source.match(/const TOC_WINDOW = (\d+);/);
  assert.ok(declaration, 'TOC_WINDOW a disparu');
  assert.ok(Number(declaration[1]) <= 60, `TOC_WINDOW vaut ${declaration[1]}`);
  assert.match(sommaire(), /roots\.slice\(shown, shown \+ TOC_WINDOW\)/);
});

test('une tranche qui ne remplit pas la boîte est complétée, mais pas sans borne', () => {
  const corps = sommaire();
  assert.match(corps, /if \(list\.scrollHeight > list\.clientHeight\) return;/);
  assert.match(corps, /for \(let i = 0; i < 10 && shown < roots\.length; i \+= 1\)/);
  // La boîte n'est pas dans le document au montage : ses deux hauteurs y valent
  // zéro, et la comparaison monterait les dix crans pour rien.
  assert.match(corps, /if \(!list\.isConnected\) return;/);
  assert.match(corps, /requestAnimationFrame\(fill\);/);
});

test('le compte annoncé est celui de l’arbre, jamais celui de la tranche', () => {
  // La règle du projet : un décompte affiché ne vient pas de ce qui est monté.
  assert.match(sommaire(), /t\('detail\.chapters', \{ count: roots\.length \}\)/);
  assert.ok(!/count: shown/.test(sommaire()), 'le compte vient de la tranche montée');
});

test('ni la tranche ni les sous-entrées ne se posent par une liste d’arguments', () => {
  // `append(...tableau)` déborde la pile d'appels : un chapitre du corpus peut
  // porter des milliers de sous-entrées, montées d'un coup à l'ouverture.
  assert.ok(
    !/\.append\(\s*\.\.\./.test(source),
    'une insertion passe encore par une liste d’arguments',
  );
  assert.match(source, /const bloc = document\.createDocumentFragment\(\);/);
  assert.match(source, /children\.append\(bloc\);/);
});

test('cliquer une entrée ouvre toujours le lecteur à sa page', () => {
  // Le comportement que le fenêtrage ne doit pas emporter.
  assert.match(source, /onclick: \(\) => openReader\(node\.pageId\)/);
  assert.match(source, /onclick: \(\) => openReader\(child\.pageId\)/);
  assert.match(source, /const printed = node\.printedPageNum \?\? node\.pageSequenceNum;/);
});
