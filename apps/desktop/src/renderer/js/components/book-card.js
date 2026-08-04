import { isPopular } from '../../../shared/popular.js';
import { h } from '../dom.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { navigate } from '../router.js';
import { consumeLongPress, onLongPress } from './long-press.js';
import { cover } from './cover.js';

/** Icône affichée dans le survol, selon ce que la carte permet de faire. */
const OVERLAY_ICON = { read: 'play', open: 'bookOpen', download: 'download' };

/**
 * Carte de livre commune à l'accueil, la bibliothèque et les listes.
 * [progress] affiche la barre sous la carte, [badge] la pastille « جديد ».
 * [selectable] fait entrer la carte en mode sélection : elle porte une case et
 * un clic coche au lieu d'ouvrir la fiche.
 * [caption] remplace le nom de l'auteur sous le titre : une liste d'autres
 * éditions d'un même livre porte partout le même auteur et le même titre, et
 * ne se distingue que par le tirage.
 * [onLongSelect] ouvre la sélection multiple par appui long, au doigt : sans
 * lui, il faudrait qu'un bouton d'entrée reste à l'écran en permanence.
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
    onLongSelect = null,
    caption = null,
  } = {},
) {
  const percent = progress == null ? null : Math.round(progress * 100);
  const installed = book.downloadStatus === 'installed';
  const check =
    selectable &&
    h('input', {
      type: 'checkbox',
      class: 'book-card__check',
      checked: selected,
      title: installed ? t('book.installedAlready') : null,
      onclick: (event) => {
        event.stopPropagation();
        onToggle?.(book.editionId, event.target.checked);
      },
    });

  const card = h(
    'article',
    {
      class: `book-card${selectable ? ' is-selecting' : ''}${
        selectable && selected ? ' is-selected' : ''
      }`,
      onclick: (event) => {
        // L'ombre d'un appui long : le geste a déjà coché, ce clic-ci
        // décocherait aussitôt ce qu'il vient de poser.
        if (consumeLongPress(card)) return;
        // En mode sélection, un clic coche : un clic ne fait jamais deux choses
        // différentes selon l'endroit exact où il tombe.
        //
        // Un livre **installé se coche aussi**. Le refuser supposait que
        // sélectionner ne servait qu'à télécharger — or c'est aussi ainsi qu'on
        // range dans une collection, et c'est précisément ce qu'on a déjà lu
        // qu'on veut y ranger. Ce sont les actions qui écartent l'installé, pas
        // la case : `downloadSelection` ne retélécharge rien.
        if (selectable) {
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
      // La pastille des ouvrages de référence. Elle est **à côté** de la
      // couverture et non dessus : la couverture composée porte déjà trois
      // canaux de sens — la forme de l'objet, la famille de la discipline, la
      // patine du siècle — tous tirés du corpus. Celui-ci vient de nous, et un
      // quatrième canal peint sur la couverture se lirait comme une donnée.
      isPopular(book.editionId) &&
        h(
          'span',
          {
            class: 'book-card__popular',
            title: t('popular.badge'),
            'aria-label': t('popular.badge'),
          },
          icon('star', { size: 12 }),
        ),
      // L'étiquette porte la cible de 44 px, la case garde sa taille : c'est la
      // convention du projet, et grossir la case ferait une pastille énorme sur
      // une vignette de 150 px.
      check && h('label', { class: 'book-card__check-hit' }, check),
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
      (caption || book.authorName) &&
        h('p', { class: 'book-card__author truncate' }, caption || book.authorName),
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

  // L'appui long ouvre la sélection **et coche cette carte** : ouvrir un mode
  // sans rien y mettre obligerait à refaire le geste.
  if (onLongSelect) onLongPress(card, () => onLongSelect(book.editionId));

  return card;
}

/**
 * Pastille d'état : installé ou en cours. Rien d'autre.
 *
 * L'installé est **plein**, pas discret : c'est la seule chose qui distingue,
 * dans une grille, le livre qu'on a déjà de celui qu'il faudra attendre. En
 * encre sombre sur fond clair, il se lisait comme une décoration, et l'on
 * remettait en file ce qui était déjà là.
 */
function statusBadge(status) {
  if (status === 'installed') {
    return h(
      'span',
      {
        class: 'book-card__status book-card__status--installed',
        title: t('book.installed'),
        'aria-label': t('book.installed'),
      },
      icon('check', { size: 14 }),
    );
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
