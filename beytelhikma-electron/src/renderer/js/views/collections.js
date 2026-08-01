import { h } from '../dom.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { repository } from '../repository.js';
import { navigate } from '../router.js';
import { renderShell, toast } from '../shell.js';
import { bookCard } from '../components/book-card.js';
import { confirmDialog } from '../components/modal.js';
import { pagination, PAGE_SIZES } from '../components/pagination.js';
import { asyncView, emptyView } from '../components/states.js';

/**
 * Bandeau des collections, posé en tête de la bibliothèque. Une collection est
 * une liste de références : elle peut contenir des livres non installés, ce qui
 * en fait autant une liste d'envies qu'un rangement.
 */
export function collectionsStrip(onChanged) {
  const host = h('section', { class: 'collections' });

  async function refresh() {
    const collections = await repository.getCollections();
    host.replaceChildren(
      h(
        'div',
        { class: 'section-header' },
        h(
          'div',
          {},
          h('h2', { class: 'headline-lg' }, t('collections.title')),
          h('p', { class: 'body-md muted' }, t('collections.subtitle')),
        ),
      ),
      h(
        'div',
        { class: 'collections__row' },
        collections.map((entry) =>
          h(
            'button',
            {
              class: 'collection-card',
              onclick: () => navigate(`/collection/${entry.id}`),
            },
            h('span', { class: 'collection-card__icon' }, icon('rows', { size: 22 })),
            h('span', { class: 'collection-card__name truncate' }, entry.name),
            h(
              'span',
              { class: 'label-sm muted' },
              t('collections.counts', {
                books: entry.bookCount,
                installed: entry.installedCount,
              }),
            ),
          ),
        ),
        h(
          'button',
          {
            class: 'collection-card collection-card--new',
            onclick: async () => {
              const name = await askName(t('collections.newTitle'));
              if (!name) return;
              await repository.createCollection(name);
              await refresh();
              onChanged?.();
            },
          },
          h('span', { class: 'collection-card__icon' }, icon('plusSquare', { size: 22 })),
          h('span', { class: 'collection-card__name' }, t('collections.newTitle')),
        ),
      ),
    );
  }

  refresh();
  return host;
}

/**
 * Saisie d'un nom. Rendue à la main plutôt que par `confirmDialog` : celui-ci
 * ne rend qu'un choix parmi des actions, pas une valeur libre.
 */
function askName(title, initial = '') {
  return new Promise((resolve) => {
    let settle = (value) => {
      settle = () => {};
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
      resolve(value);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') settle(null);
    };

    const field = h('input', {
      type: 'text',
      class: 'picker__field',
      value: initial,
      onkeydown: (event) => {
        if (event.key === 'Enter') settle(field.value.trim() || null);
      },
    });

    const backdrop = h(
      'div',
      {
        class: 'modal',
        onclick: (event) => {
          if (event.target === backdrop) settle(null);
        },
      },
      h(
        'div',
        { class: 'modal__panel', role: 'dialog', 'aria-modal': 'true' },
        h('h3', { class: 'title-md' }, title),
        field,
        h(
          'div',
          { class: 'modal__actions' },
          h(
            'button',
            {
              class: 'button button--filled',
              onclick: () => settle(field.value.trim() || null),
            },
            t('action.save'),
          ),
          h('button', { class: 'button button--tonal', onclick: () => settle(null) }, t('action.cancel')),
        ),
      ),
    );

    document.addEventListener('keydown', onKey);
    document.body.append(backdrop);
    field.focus();
    field.select();
  });
}

/**
 * Contenu d'une collection : renommer, supprimer, télécharger ce qui manque.
 * Nom distinct de `collectionView` de `library.js`, qui est une fabrique de
 * vues de listes (catégorie, auteur, siècle) et n'a rien à voir.
 */
export function collectionDetailView(host, params) {
  const content = renderShell(host, { active: 'library' });
  const { id } = params;

  // Une collection peut porter tout le catalogue : on en montre une page, et
  // `missing` est compté sur l'ensemble — sinon « tout télécharger »
  // proposerait moins de livres qu'il n'y en a à prendre.
  const query = { offset: 0, limit: PAGE_SIZES[0] };

  const load = async () => ({
    collection: (await repository.getCollections()).find((entry) => entry.id === id) ?? null,
    page: await repository.getCollectionBooks(id, query),
  });

  const refresh = () => asyncView(content, load, render, { empty: t('collections.empty') });

  function render({ collection, page }) {
    if (!collection) return emptyView(t('collections.notFound'));

    const books = page.rows;
    const missing = page.missing;

    return h(
      'section',
      { class: 'collection-page' },
      h(
        'div',
        { class: 'section-header' },
        h(
          'div',
          {},
          h('h1', { class: 'display-lg' }, collection.name),
          h(
            'p',
            { class: 'body-md muted' },
            t('collections.counts', {
              books: collection.bookCount,
              installed: collection.installedCount,
            }),
          ),
        ),
        h(
          'div',
          { class: 'collection-page__actions' },
          missing.length > 0 &&
            h(
              'button',
              {
                class: 'button button--filled',
                onclick: async () => {
                  await repository.downloadSelection(missing);
                  toast(t('collections.queued', { count: missing.length }));
                  refresh();
                },
              },
              icon('download', { size: 18 }),
              h('span', {}, t('collections.downloadRest', { count: missing.length })),
            ),
          h(
            'button',
            {
              class: 'button button--tonal',
              onclick: async () => {
                const name = await askName(t('collections.rename'), collection.name);
                if (!name) return;
                await repository.renameCollection(id, name);
                refresh();
              },
            },
            t('collections.rename'),
          ),
          h(
            'button',
            {
              class: 'button button--tonal',
              onclick: async () => {
                const choice = await confirmDialog({
                  title: t('collections.deleteTitle', { name: collection.name }),
                  message: t('collections.deleteMessage'),
                  actions: [{ value: 'go', label: t('collections.deleteAction'), variant: 'danger' }],
                });
                if (choice !== 'go') return;
                await repository.deleteCollection(id);
                navigate('/library');
              },
            },
            t('action.delete'),
          ),
        ),
      ),
      books.length
        ? h(
            'div',
            { class: 'explore__grid' },
            books.map((book) =>
              bookCard(book, {
                action: book.downloadStatus === 'installed' ? 'read' : 'download',
              }),
            ),
          )
        : emptyView(t('collections.empty')),
      page.total > query.limit &&
        pagination({
          total: page.total,
          offset: query.offset,
          limit: query.limit,
          onChange: (offset) => {
            query.offset = offset;
            refresh();
          },
          onPageSize: (limit) => {
            Object.assign(query, { limit, offset: 0 });
            refresh();
          },
        }),
    );
  }

  refresh();
  return null;
}
