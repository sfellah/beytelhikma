import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/**
 * La densité des grilles, et le défaut « ça marche sur mon téléphone ».
 *
 * `minmax(150px, 1fr)` avec 24 px de gouttière réclame 324 px de contenu pour
 * deux colonnes, donc 364 px de fenêtre une fois les 20 px de réserve de
 * `.main` retirés de chaque côté. Un téléphone de 411 dp — celui du
 * développement — en offre 371 : deux colonnes. Un de 360 dp, le modèle le plus
 * répandu, en offre 320 : **une** couverture par rangée, haute de tout l'écran.
 * Quatre pixels séparaient les deux appareils, et le même écart se rouvre sur
 * n'importe quel modèle dès qu'on agrandit la taille d'affichage du système.
 *
 * Le remède est une borne en pourcentage, jamais un point de rupture : la
 * largeur d'un téléphone Android n'est pas une valeur, c'est un intervalle
 * continu que l'utilisateur déplace lui-même depuis ses réglages.
 *
 * Vérifications statiques, comme celles du thème, des polices et de la
 * direction : la mise en forme est hors de portée d'un test de comportement.
 */

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const tokens = read('../src/renderer/styles/tokens.css');
const views = read('../src/renderer/styles/views.css');
const shell = read('../src/renderer/styles/shell.css');

/** Les déclarations de [selector], commentaires retirés, blocs réunis. */
function bloc(source, selector) {
  const nu = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const regles = [...nu.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((regle) =>
    regle[1]
      .split(',')
      .map((part) => part.trim())
      .includes(selector),
  );
  assert.notEqual(regles.length, 0, `sélecteur introuvable : ${selector}`);
  return regles.map((regle) => regle[2]).join('\n');
}

/* ------------------------------------------- le plancher d'une carte de livre */

test('la largeur plancher d’une carte de livre vit dans un jeton, et une seule fois', () => {
  assert.match(tokens, /--card-min:\s*150px;/, 'tokens.css doit porter --card-min');

  // Aucune grille ne redéclare la valeur : c'est de deux copies d'une liste
  // qu'étaient nées la police orpheline et le thème mort.
  const orphelines = [...views.matchAll(/grid-template-columns:[^;]*minmax\(\s*150px/g)];
  assert.equal(
    orphelines.length,
    0,
    'une grille cite encore 150px en dur au lieu de var(--card-min)',
  );
});

test('les grilles de couvertures bornent leur plancher à la largeur disponible', () => {
  for (const selecteur of [
    '.library__grid',
    // La même classe sert à `/explore` et à l'écran d'une collection.
    '.explore__grid',
    '.search__grid',
  ]) {
    assert.match(
      bloc(views, selecteur),
      /repeat\(auto-fill,\s*minmax\(min\(var\(--card-min\),\s*45%\),\s*1fr\)\)/,
      `${selecteur} retombe sur une colonne dès que la fenêtre passe sous 364px`,
    );
  }
});

/* ------------------------------------- un plancher ne dépasse pas son conteneur */

test('aucune grille ne pose un plancher plus large que ce qui peut le porter', () => {
  // Un plancher supérieur au conteneur ne réduit pas le nombre de colonnes : il
  // fait **déborder** la piste, et c'est la page entière qui se met à défiler
  // de côté. `min(…, 100%)` est le seul garde-fou.
  const nu = views.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [, valeur] of nu.matchAll(/minmax\(\s*(\d+(?:\.\d+)?)(px|rem)\s*,/g)) {
    const px = valeur.endsWith('rem') ? Number.parseFloat(valeur) * 16 : Number.parseFloat(valeur);
    assert.ok(
      px <= 240,
      `un plancher de ${valeur} n'est borné ni par min(…, 100%) ni par 45% : il débordera`,
    );
  }
});

/* --------------------------------------------- une piste flexible se comprime */

test('les colonnes de texte ont un plancher zéro, pas celui de leur mot le plus long', () => {
  // `1fr` nu vaut `minmax(auto, 1fr)` : son plancher est le contenu minimal.
  // Un titre arabe agrandi par la taille de police du système d'Android pousse
  // alors la rangée hors de l'écran, sans qu'aucune fenêtre de bureau ne le
  // montre jamais.
  for (const selecteur of ['.curriculum-step', '.meta-grid']) {
    // Les `minmax(…)` retirés, il ne doit plus rester un seul `1fr` : ceux qui
    // survivent sont ceux qu'aucun plancher n'encadre.
    const pistes = [...bloc(views, selecteur).matchAll(/grid-template-columns:([^;]*);/g)]
      .map(([, valeur]) => valeur.replace(/minmax\([^()]*\)/g, ''))
      .join(' ');
    assert.ok(pistes.length > 0, `${selecteur} ne déclare aucune piste`);
    assert.ok(
      !/1fr/.test(pistes),
      `${selecteur} garde une piste 1fr nue : elle ne peut pas se comprimer`,
    );
  }

  // Et le texte a où couper : sans point de coupe, un plancher zéro déborde
  // quand même.
  assert.match(bloc(views, '.curriculum-step__text'), /overflow-wrap:\s*anywhere/);
});

/* ------------------------------------------- les retraits latéraux du système */

test('le corps de page écarte l’encoche, physiquement', () => {
  const main = bloc(shell, '.main');
  assert.ok(main.includes('var(--safe-left)'), 'le corps de page ignore l’encoche de gauche');
  assert.ok(main.includes('var(--safe-right)'), 'le corps de page ignore l’encoche de droite');
  // Physiques et non logiques : une encoche ne change pas de côté quand
  // l'interface bascule en RTL.
  assert.ok(
    !/padding-inline-(start|end):[^;]*--safe-(left|right)/.test(main),
    'un retrait latéral a été posé en propriété logique',
  );
});
