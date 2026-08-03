import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/**
 * Le débordement horizontal, et la page qu'on doit glisser pour la lire.
 *
 * Signalé sur un POCO `peridot` — 1220 × 2712 à 480 dpi, soit **407 dp** de
 * large : `/downloads` et `/explore` s'ouvraient décalés, titre coupé au bord,
 * et il fallait pousser l'écran de côté pour atteindre l'interface. Mesuré dans
 * Electron à cette largeur, avec la taille de texte d'Android agrandie d'un
 * tiers — l'appareil applique ce facteur à toutes les tailles de police, `rem`
 * comprise. Deux causes, deux familles de règles :
 *
 * 1. **Une largeur fixe sur un champ est un plancher, pas un souhait.**
 *    `.downloads__search { width: 18rem }` valait 374 px sur une rangée de 361
 *    dès que le texte grossissait. Le `max-width: 100%` d'à côté ne sauvait
 *    rien : la boîte qui porte le champ prend elle-même 18 rem, et `100%` se
 *    mesure alors sur elle.
 *
 * 2. **Une colonne de flex qui garde `wrap` cesse d'avoir la largeur de
 *    l'écran.** `.explore__header` passait en `column` sur téléphone sans
 *    retirer le `flex-wrap: wrap` de la règle de bureau. Une boîte multi-lignes
 *    calcule la taille transverse de ses lignes — ici leur **largeur** — sur le
 *    contenu maximal de ses enfants, jamais sur son conteneur : l'entête prenait
 *    366 px sur 361, et 472 px à texte agrandi.
 *
 * Ce qui n'est **pas** un remède : `overflow-x: hidden` sur `html` ou `body`.
 * Il cache le symptôme et rend le prochain débordement introuvable — c'est le
 * dernier test de ce fichier.
 *
 * Vérifications statiques, comme celles du thème, des polices, de la direction
 * et de la densité des grilles : la mise en forme est hors de portée d'un test
 * de comportement.
 */

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const FEUILLES = {
  'tokens.css': read('../src/renderer/styles/tokens.css'),
  'base.css': read('../src/renderer/styles/base.css'),
  'shell.css': read('../src/renderer/styles/shell.css'),
  'components.css': read('../src/renderer/styles/components.css'),
  'views.css': read('../src/renderer/styles/views.css'),
};

/**
 * Les règles d'une feuille, une par sélecteur, avec le contexte `@media` où
 * elles vivent. Un analyseur minimal suffit : le projet n'imbrique rien d'autre
 * que des `@media`, et aucune valeur ne porte d'accolade.
 */
function regles(source) {
  const nu = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const trouvees = [];
  const pile = [];
  let tampon = '';
  for (let i = 0; i < nu.length; i += 1) {
    const c = nu[i];
    if (c === '{') {
      const entete = tampon.trim();
      tampon = '';
      if (entete.startsWith('@')) {
        pile.push(entete);
        continue;
      }
      const fin = nu.indexOf('}', i);
      const corps = nu.slice(i + 1, fin);
      for (const selecteur of entete.split(',').map((part) => part.trim()).filter(Boolean)) {
        trouvees.push({ selecteur, media: pile.join(' '), corps });
      }
      i = fin;
      continue;
    }
    if (c === '}') {
      pile.pop();
      tampon = '';
      continue;
    }
    tampon += c;
  }
  return trouvees;
}

const VUES = regles(FEUILLES['views.css']);

/** La valeur déclarée pour [propriete], ou `null`. */
function valeur(corps, propriete) {
  const trouve = corps.match(new RegExp(`(?:^|;|\\s)${propriete}\\s*:\\s*([^;]+)`));
  return trouve ? trouve[1].trim() : null;
}

const pour = (selecteur) => VUES.filter((regle) => regle.selecteur === selecteur);

/* ------------------------------ un champ demande une largeur, il ne l'impose pas */

/**
 * Les champs et listes que porte une barre d'outils. Ce sont eux qui décident
 * de la largeur plancher de leur rangée, donc de celle de la page.
 */
const CHAMPS = [
  '.downloads__search',
  '.authors__search',
  '.notes__search',
  '.explore__search',
  '.explore__sort',
];

test('aucun champ de barre d’outils ne porte de largeur fixe', () => {
  for (const selecteur of CHAMPS) {
    const trouvees = pour(selecteur);
    assert.notEqual(trouvees.length, 0, `sélecteur introuvable : ${selecteur}`);
    for (const regle of trouvees) {
      const largeur = valeur(regle.corps, 'width');
      assert.ok(
        largeur === null || /^(100%|auto|inherit)$/.test(largeur),
        `${selecteur} { width: ${largeur} } — une largeur en px ou en rem est un ` +
          'plancher : elle survit à la rangée et pousse la page. La largeur ' +
          'souhaitée se déclare en `flex-basis`.',
      );
    }
  }
});

test('chaque champ de barre d’outils peut se rétrécir à zéro', () => {
  for (const selecteur of CHAMPS) {
    assert.ok(
      pour(selecteur).some((regle) => valeur(regle.corps, 'min-width') === '0'),
      `${selecteur} n’a nulle part \`min-width: 0\` : le minimum automatique d’un ` +
        'enfant de flex est celui de son contenu, et le plancher revient par là.',
    );
  }
});

test('le conteneur qui porte un champ se rétrécit avec lui', () => {
  // Un champ qui se rétrécit dans une boîte qui, elle, ne le peut pas ne
  // rétrécit rien du tout.
  for (const selecteur of [
    '.downloads__search-box',
    '.notes__search-box',
    '.authors__search-box',
    '.downloads__toolbar',
    '.downloads__filter',
    '.explore__toolbar',
    '.explore__controls',
    '.explore__sort-field',
  ]) {
    const trouvees = pour(selecteur);
    assert.notEqual(trouvees.length, 0, `sélecteur introuvable : ${selecteur}`);
    assert.ok(
      trouvees.some((regle) => valeur(regle.corps, 'min-width') === '0'),
      `${selecteur} ne déclare jamais \`min-width: 0\``,
    );
  }
});

/* ------------------------------------- une colonne de flex n'enroule jamais */

test('aucune boîte ne passe en colonne en gardant son enroulement', () => {
  const enWrap = new Set(
    VUES.filter((regle) => /^wrap(-reverse)?$/.test(valeur(regle.corps, 'flex-wrap') ?? ''))
      .map((regle) => regle.selecteur),
  );

  for (const regle of VUES) {
    if (valeur(regle.corps, 'flex-direction') !== 'column') continue;
    const propre = valeur(regle.corps, 'flex-wrap');
    if (propre !== null) {
      assert.ok(
        propre === 'nowrap',
        `${regle.selecteur} { flex-direction: column; flex-wrap: ${propre} }`,
      );
      continue;
    }
    assert.ok(
      !enWrap.has(regle.selecteur),
      `${regle.selecteur} passe en colonne (${regle.media || 'hors @media'}) sans ` +
        'retirer le `flex-wrap: wrap` qu’une autre règle lui pose. Une colonne qui ' +
        'enroule est une boîte multi-lignes : sa largeur devient celle du contenu ' +
        'maximal de ses enfants, et la page se met à défiler de côté.',
    );
  }
});

/* --------------------------------------------- la largeur de la fenêtre ment */

test('aucune mise en page ne se mesure en 100vw', () => {
  // `100vw` compte la barre de défilement classique et ignore les retraits
  // système : posé sur une boîte du flux, il déborde par construction. Les
  // superpositions de `components.css` — la boîte de dialogue, le pain grillé —
  // n'en usent que sous `min(…)` et sont fixées, hors du flux : elles ne
  // poussent rien.
  for (const feuille of ['views.css', 'shell.css']) {
    const nu = FEUILLES[feuille].replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(
      !/100vw/.test(nu),
      `${feuille} mesure une boîte en 100vw : la largeur utile est celle du ` +
        'conteneur, jamais celle de la fenêtre.',
    );
  }
});

/* ------------------------------------ on ne cache pas un débordement, on le corrige */

test('ni html ni body ne masquent le débordement horizontal', () => {
  for (const [nom, source] of Object.entries(FEUILLES)) {
    for (const regle of regles(source)) {
      if (!/^(html|body|:root)$/.test(regle.selecteur)) continue;
      for (const propriete of ['overflow', 'overflow-x']) {
        const declare = valeur(regle.corps, propriete);
        assert.ok(
          declare === null || !/hidden|clip/.test(declare),
          `${nom} : ${regle.selecteur} { ${propriete}: ${declare} } — le débordement ` +
            'est masqué, donc le prochain devient introuvable. Le remède est la ' +
            'boîte qui déborde, pas le document.',
        );
      }
    }
  }
});
