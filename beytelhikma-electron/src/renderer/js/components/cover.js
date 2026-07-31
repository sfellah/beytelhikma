import { h } from '../dom.js';

/**
 * Couverture composée : les données d'exemple n'embarquent pas d'images, on
 * dérive donc un dégradé stable de l'identifiant d'édition, comme le fait
 * `CoverImage` dans l'application Flutter.
 */
const PALETTES = [
  ['#002d29', '#0c2a33'],
  ['#0c2a33', '#264d49'],
  ['#3f3020', '#735a35'],
  ['#1b1c19', '#2f4b54'],
  ['#264d49', '#0d2b34'],
];

function paletteFor(key) {
  let hash = 0;
  for (const char of key ?? '') hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PALETTES[hash % PALETTES.length];
}

export function cover(book, { showText = true, progress = null } = {}) {
  const [from, to] = paletteFor(book?.editionId ?? book?.title ?? '');
  return h(
    'div',
    {
      class: 'cover',
      style: { '--cover-from': from, '--cover-to': to },
      role: 'img',
      'aria-label': book?.title ?? '',
    },
    showText && h('div', { class: 'cover__title clamp-2' }, book?.title ?? ''),
    showText &&
      book?.authorName &&
      h('div', { class: 'cover__author truncate' }, book.authorName),
    progress != null &&
      h(
        'div',
        { class: 'cover__progress' },
        h('span', { style: { width: `${Math.round(progress * 100)}%` } }),
      ),
  );
}
