import { coverStyle } from '../../../shared/book-cover.js';
import { h, svg } from '../dom.js';

/**
 * Couverture composée. Aucun livre du corpus n'a d'image : elle est dessinée,
 * et dessinée d'après ce que le catalogue sait plutôt qu'au hasard d'un hachage.
 *
 * - la **forme** de l'objet décide de la mise en page ;
 * - la **famille** de la catégorie décide de la matière — teinte et motif ;
 * - le **siècle** de l'auteur décide de la patine, appliquée aux teintes et à
 *   la dorure en amont, dans le module partagé.
 *
 * Les tables vivent dans `src/shared/book-cover.js`, en miroir du fichier Dart.
 * Ici on ne fait que poser les nœuds.
 * Voir `docs/superpowers/specs/2026-07-31-couvertures-composees-design.md`.
 */

/* ------------------------------------------------------------------- motifs */

/**
 * Six géométries, pas neuf : deux familles partagent parfois la même trame et
 * n'en changent que la teinte. Chaque entrée est la tuile d'un `<pattern>` en
 * `userSpaceOnUse`, donc en pixels CSS — le motif garde la même échelle sur une
 * vignette de rayonnage et sur la grande couverture de la fiche livre.
 */
const PATTERNS = {
  // étoile à huit branches : deux carrés superposés, l'un tourné d'un quart
  girih: [
    52,
    [
      ['rect', { x: 13, y: 13, width: 26, height: 26 }],
      ['rect', { x: 13, y: 13, width: 26, height: 26, transform: 'rotate(45 26 26)' }],
      ['circle', { cx: 26, cy: 26, r: 3.6 }],
    ],
  ],
  // entrelacs : deux arcs qui se croisent et se relaient d'une tuile à l'autre
  knot: [
    46,
    [
      ['path', { d: 'M0 23 Q11.5 0 23 23 T46 23' }],
      ['path', { d: 'M23 0 Q46 11.5 23 23 T23 46' }],
    ],
  ],
  octagon: [
    44,
    [
      ['polygon', { points: '22,4 34,10 40,22 34,34 22,40 10,34 4,22 10,10' }],
      ['circle', { cx: 22, cy: 22, r: 7 }],
    ],
  ],
  vine: [
    48,
    [
      ['path', { d: 'M24 4C34 14 34 34 24 44C14 34 14 14 24 4Z' }],
      ['path', { d: 'M4 24C14 14 34 14 44 24C34 34 14 34 4 24Z' }],
    ],
  ],
  // kufique carré : angles droits, jambages coupés net
  kufi: [
    30,
    [
      ['path', { d: 'M4 4H20V14H10V26' }],
      ['path', { d: 'M26 4V20H16' }],
    ],
  ],
  grid: [
    26,
    [
      ['rect', { x: 4, y: 4, width: 18, height: 18 }],
      ['path', { d: 'M0 13H26M13 0V26' }],
    ],
  ],
};

const DEFS_ID = 'cover-defs';

/** Une rosace à seize branches, décrite une fois et tournée quinze fois. */
function shamsa() {
  const petals = [];
  for (let index = 0; index < 16; index += 1) {
    petals.push(
      svg('path', {
        d: 'M0 -26L7 -13L0 -6.5L-7 -13Z',
        transform: index === 0 ? null : `rotate(${index * 22.5})`,
      }),
    );
  }
  return svg(
    'g',
    { id: 'cover-shamsa', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.2 },
    svg('circle', { r: 34 }),
    svg('circle', { r: 26 }),
    svg('circle', { r: 9 }),
    petals,
  );
}

/**
 * Les motifs sont définis une seule fois pour tout le document, et chaque
 * couverture n'en porte qu'une référence. Une grille de trente vignettes ne
 * duplique donc pas trente fois la géométrie. L'injection est paresseuse : rien
 * ne dépend de l'ordre de démarrage, et un écran sans couverture ne paie rien.
 */
function ensureDefs() {
  if (document.getElementById(DEFS_ID)) return;
  const patterns = Object.entries(PATTERNS).map(([name, [tile, shapes]]) =>
    svg(
      'pattern',
      {
        id: `cover-pat-${name}`,
        width: tile,
        height: tile,
        patternUnits: 'userSpaceOnUse',
      },
      svg(
        'g',
        { fill: 'none', stroke: 'currentColor', 'stroke-width': 1 },
        shapes.map(([tag, props]) => svg(tag, props)),
      ),
    ),
  );
  document.body.append(
    svg(
      'svg',
      { id: DEFS_ID, width: 0, height: 0, 'aria-hidden': 'true', class: 'cover-defs' },
      svg('defs', {}, patterns, shamsa()),
    ),
  );
}

/** Le fond moiré d'une couverture : un seul rectangle, rempli par référence. */
function grain(pattern) {
  return h(
    'div',
    { class: 'cover__grain', 'aria-hidden': 'true' },
    svg(
      'svg',
      { width: '100%', height: '100%' },
      svg('rect', { width: '100%', height: '100%', fill: `url(#cover-pat-${pattern})` }),
    ),
  );
}

/**
 * Le même moiré, pour ce qui n'est pas un livre — la carte d'une collection.
 * Exporté plutôt que recopié : les six géométries et leurs `<defs>` n'existent
 * qu'ici, et une seconde tuile dessinée ailleurs dériverait de celle-ci.
 * La teinte est celle de `--cover-gilt`, que `.cover__grain` lit.
 */
export function coverGrain(pattern) {
  ensureDefs();
  return grain(pattern);
}

/* ----------------------------------------------------------------- reliures */

const title = (book) => h('div', { class: 'cover__title clamp-3' }, book?.title ?? '');

const author = (book) =>
  book?.authorName ? h('div', { class: 'cover__author truncate' }, book.authorName) : null;

/**
 * Une reliure par forme d'objet, de la plus légère à la plus lourde. Chacune
 * reçoit le livre et l'indicateur `showText` — les vignettes de rayonnage
 * n'affichent que la matière, mais elles gardent leur reliure : c'est elle qui
 * rend une étagère lisible de loin.
 */
const LAYOUTS = {
  // Un métn de moins de 120 pages : le titre est tout ce qu'il y a à dire.
  treatise: (book, showText, style) => [
    grain(style.pattern),
    showText && title(book),
    showText && h('div', { class: 'cover__rule' }),
    showText && author(book),
  ],

  book: (book, showText, style) => [
    grain(style.pattern),
    showText && title(book),
    showText && author(book),
  ],

  // Multi-tomes : l'objet de prestige, celui qui mérite le médaillon.
  compendium: (book, showText, style) => [
    grain(style.pattern),
    svg(
      'svg',
      { class: 'cover__shamsa', viewBox: '-40 -40 80 80', 'aria-hidden': 'true' },
      svg('use', { href: '#cover-shamsa' }),
    ),
    showText && h('div', { class: 'cover__cartouche' }, title(book)),
    showText && author(book),
  ],

  // Volume unique de plus de 400 pages : le caisson, dense et encadré.
  tome: (book, showText, style) => [
    grain(style.pattern),
    showText && h('div', { class: 'cover__band' }, title(book), author(book)),
  ],

  // Ce qui n'est pas un livre — رسالة جامعية, مجلة, دروس مفرغة. Seule reliure à
  // contraste inversé : papier clair, encre sombre, et la couleur de famille
  // reportée sur le dos — côté `inline-start`, donc à droite en RTL, là où se
  // relie un livre arabe.
  document: (book, showText, style) => [
    h(
      'div',
      { class: 'cover__spine', 'aria-hidden': 'true' },
      grain(style.pattern),
    ),
    showText &&
      h(
        'div',
        { class: 'cover__body' },
        book?.categoryLabel &&
          h('div', { class: 'cover__kicker truncate' }, book.categoryLabel),
        title(book),
        author(book),
      ),
  ],

};

/* -------------------------------------------------------------------- rendu */

export function cover(book, { showText = true, progress = null } = {}) {
  ensureDefs();
  const style = coverStyle(book);
  return h(
    'div',
    {
      class: `cover cover--${style.shape} cover--${style.family}`,
      style: {
        '--cover-from': style.from,
        '--cover-to': style.to,
        '--cover-gilt': `rgb(217 184 113 / ${(style.gilt * 100).toFixed(1)}%)`,
      },
      role: 'img',
      'aria-label': book?.title ?? '',
    },
    LAYOUTS[style.shape](book, showText, style),
    progress != null &&
      h(
        'div',
        { class: 'cover__progress' },
        h('span', { style: { width: `${Math.round(progress * 100)}%` } }),
      ),
  );
}
