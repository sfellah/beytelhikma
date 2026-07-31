import { h } from '../dom.js';
import { icon } from '../icons.js';
import { navigate } from '../router.js';
import { cover } from './cover.js';

/**
 * Carte de livre commune à l'accueil, la bibliothèque et les listes.
 * [progress] affiche la barre sous la carte, [badge] la pastille « جديد ».
 */
export function bookCard(
  book,
  { progress = null, badge = null, action = 'read', onClick = null } = {},
) {
  const percent = progress == null ? null : Math.round(progress * 100);
  return h(
    'article',
    {
      class: 'book-card',
      onclick: onClick ?? (() => navigate(`/book/${book.editionId}`)),
    },
    h(
      'div',
      { class: 'book-card__media' },
      cover(book),
      badge && h('span', { class: 'book-card__badge' }, badge),
      statusBadge(book.downloadStatus),
      h(
        'div',
        { class: 'book-card__overlay' },
        h('span', {}, icon(action === 'read' ? 'play' : 'bookOpen', { size: 20 })),
      ),
    ),
    h(
      'div',
      { class: 'book-card__text' },
      h('h4', { class: 'book-card__title clamp-1' }, book.title),
      book.authorName &&
        h('p', { class: 'book-card__author truncate' }, book.authorName),
    ),
    progress != null &&
      h(
        'div',
        { class: 'progress' },
        h('span', { style: { width: `${percent}%` } }),
      ),
    progress != null &&
      percent > 0 &&
      h('span', { class: 'label-sm muted' }, `${percent}٪`),
  );
}

/** Pastille discrète d'état : installé ou en cours. Rien d'autre. */
function statusBadge(status) {
  if (status === 'installed') {
    return h('span', { class: 'book-card__status', title: 'مُنزَّل' }, icon('check', { size: 14 }));
  }
  if (status === 'downloading' || status === 'queued' || status === 'verifying') {
    return h(
      'span',
      { class: 'book-card__status book-card__status--busy', title: 'قيد التنزيل' },
      icon('download', { size: 14 }),
    );
  }
  return null;
}
