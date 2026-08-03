import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/**
 * La densité de l'accueil sur téléphone.
 *
 * Le héros doit tenir dans le premier écran d'un téléphone, jusqu'au bouton de
 * reprise. La seule façon d'y arriver sans abîmer le bureau est de resserrer
 * **dans une requête média**, jamais en rabotant les valeurs de base : un
 * resserrement écrit dans la règle générale ne se voit pas en développement,
 * où l'on regarde une fenêtre large, et se découvre sur l'écran de quelqu'un
 * d'autre. Ces vérifications sont statiques, comme celles du thème, des
 * polices et de la direction.
 */

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const css = read('../src/renderer/styles/views.css');
const carte = read('../src/renderer/js/components/curriculum-card.js');

/** La requête média qui suit [marqueur], accolades appariées. */
function bloc(source, marqueur) {
  const depart = source.indexOf('@media', source.indexOf(marqueur));
  assert.ok(depart > 0, `requête média introuvable après « ${marqueur} »`);
  let profondeur = 0;
  for (let i = source.indexOf('{', depart); i < source.length; i += 1) {
    if (source[i] === '{') profondeur += 1;
    else if (source[i] === '}') {
      profondeur -= 1;
      if (profondeur === 0) return source.slice(depart, i + 1);
    }
  }
  throw new Error(`accolade non refermée après « ${marqueur} »`);
}

const telephone = bloc(css, 'densité du premier écran (téléphone)');
const cursus = bloc(css, "Sur un téléphone, la carte d'un cursus");

test('le resserrement de l’accueil vit dans une requête média téléphone', () => {
  assert.match(telephone, /^@media \(max-width: 640px\)/);
  assert.match(cursus, /^@media \(max-width: 640px\)/);
});

test('le héros se resserre jusqu’au bouton de reprise', () => {
  // Titre, respirations, couverture, chiffre de la carte d'état : chacun est
  // une part de la hauteur qui poussait le bouton hors du premier écran.
  for (const regle of [
    '.hero .headline-lg',
    '.continue-card__cover',
    '.continue-card .button',
    '.stat-card__value',
    '.quick-card__go',
  ]) {
    assert.ok(telephone.includes(regle), `le bloc téléphone doit resserrer ${regle}`);
  }
  // Le titre prend la taille mobile de l'échelle, pas un nombre inventé.
  assert.match(telephone, /font-size: var\(--text-headline-mobile\)/);
});

test('l’étagère montre des couvertures plus petites, et seulement sur téléphone', () => {
  assert.match(telephone, /\.shelf-row__cover \{\s*width: 36px;/);
  // La valeur de bureau reste intacte : on n'a pas raboté, on a ajouté.
  assert.match(css, /\.shelf-row__cover \{[^}]*width: 44px;/s);
});

test('le bureau n’est pas raboté : ses valeurs de base sont inchangées', () => {
  const base = css.slice(0, css.indexOf('densité du premier écran (téléphone)'));
  assert.match(base, /\.continue-card \{[^}]*gap: var\(--space-xl\);[^}]*padding: var\(--space-lg\);/s);
  assert.match(base, /\.continue-card \.button \{\s*margin-top: var\(--space-xl\);/);
  assert.match(base, /\.stat-card__value \{[^}]*font-size: 26px;/s);
});

test('le rayon d’un cursus se met à l’échelle par un seul facteur', () => {
  // Les mesures partent en variables : un `width` posé en ligne l'emporterait
  // sur toute feuille, et le rayon ne pourrait plus se resserrer sans un
  // `!important` par propriété.
  assert.ok(carte.includes("'--spine-w'"), 'la vue doit poser --spine-w');
  assert.ok(carte.includes("'--spine-h'"), 'la vue doit poser --spine-h');
  assert.ok(
    !/width: `\$\{width\}px`/.test(carte),
    'la vue ne doit plus poser `width` en ligne sur une tranche',
  );

  assert.match(css, /\.shelf__spine \{[^}]*width: calc\(var\(--spine-w\) \* var\(--spine-scale, 1\)\);/s);
  assert.match(css, /\.shelf__spine \{[^}]*height: calc\(var\(--spine-h\) \* var\(--spine-scale, 1\)\);/s);
  // La planche suit le même facteur : rien ne peut se resserrer à moitié.
  assert.match(css, /\.shelf \{[^}]*min-height: calc\(124px \* var\(--spine-scale, 1\)\);/s);
  assert.match(css, /--spine-scale: 1;/);
  assert.match(cursus, /--spine-scale: 0\.78;/);
});

test('le resserrement ne cite ni couleur en dur ni côté physique', () => {
  for (const bloc_ of [telephone, cursus]) {
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(bloc_), 'une couleur en dur s’est glissée dans le bloc');
    assert.ok(
      !/(margin|padding|inset|border)-(left|right)\b/.test(bloc_),
      'un côté physique s’est glissé dans le bloc : propriétés logiques seulement',
    );
  }
});

test('les retraits système ne sont pas touchés par la densité', () => {
  for (const bloc_ of [telephone, cursus]) {
    assert.ok(!bloc_.includes('--safe-'), 'les retraits système ne sont pas de la décoration');
  }
});
