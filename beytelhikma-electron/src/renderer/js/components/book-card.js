import { h } from '../dom.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { navigate } from '../router.js';
import { cover } from './cover.js';

/** Icône affichée dans le survol, selon ce que la carte permet de faire. */
const OVERLAY_ICON = { read: 'play', open: 'bookOpen', download: 'download' };

/**
 * Carte de livre commune à l'accueil, la bibliothèque et les listes.
 * [progress] affiche la barre sous la carte, [badge] la pastille « جديد ».
 * [selectable] fait entrer la carte en mode sélection : elle porte une case et
 * un clic coche au lieu d'ouvrir la fiche.
 */
export function bookCard(
  book,
  {
    progress = null,
    badge = null,
    action = 'read',
    onClick = null,
    selectable = false,
    selected = false,
    onToggle = null,
  } = {},
) {
  const percent = progress == null ? null : Math.round(progress * 100);
  const installed = book.downloadStatus === 'installed';
  return h(
    'article',
    {
      class: `book-card${selectable && selected ? ' is-selected' : ''}`,
      onclick: (event) => {
        // En mode sélection, un clic coche : un clic ne fait jamais deux choses
        // différentes selon l'endroit exact où il tombe.
        if (selectable) {
          if (installed) return;
          onToggle?.(book.editionId, !selected);
          return;
        }
        (onClick ?? (() => navigate(`/book/${book.editionId}`)))(event);
      },
    },
    h(
      'div',
      { class: 'book-card__media' },
      cover(book),
      badge && h('span', { class: 'book-card__badge' }, badge),
      statusBadge(book.downloadStatus),
      selectable &&
        h('input', {
          type: 'checkbox',
          class: 'book-card__check',
          checked: selected,
          disabled: installed,
          title: installed ? t('book.installedAlready') : null,
          onclick: (event) => {
            event.stopPropagation();
            onToggle?.(book.editionId, event.target.checked);
          },
        }),
      h(
        'div',
        { class: 'book-card__overlay' },
        h('span', {}, icon(OVERLAY_ICON[action] ?? 'bookOpen', { size: 20 })),
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
      h('span', { class: 'label-sm muted' }, t('format.percent', { value: percent })),
  );
}

/** Pastille discrète d'état : installé ou en cours. Rien d'autre. */
function statusBadge(status) {
  if (status === 'installed') {
    return h('span', { class: 'book-card__status', title: t('book.installed') }, icon('check', { size: 14 }));
  }
  if (status === 'downloading' || status === 'queued' || status === 'verifying') {
    return h(
      'span',
      { class: 'book-card__status book-card__status--busy', title: t('book.downloading') },
      icon('download', { size: 14 }),
    );
  }
  return null;
}
