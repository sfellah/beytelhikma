import { h } from '../dom.js';

/**
 * Couverture composée : les données d'exemple n'embarquent pas d'images, on
 * dérive donc un dégradé stable de l'identifiant d'édition, comme le fait
 * `CoverImage` dans l'application Flutter.
 */
/* Reliures : émeraude, encre, cuir, bleu-vert. Mêmes familles que les jetons. */
const PALETTES = [
  ['#062621', '#0b3a32'],
  ['#0d2f39', '#1a4b57'],
  ['#3a2a12', '#7a5714'],
  ['#1c1710', '#3c3428'],
  ['#0b3a32', '#123b47'],
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
