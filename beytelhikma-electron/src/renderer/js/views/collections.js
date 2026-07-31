import { h } from '../dom.js';
import { icon } from '../icons.js';
import { repository } from '../repository.js';
import { navigate } from '../router.js';
import { renderShell, toast } from '../shell.js';
import { bookCard } from '../components/book-card.js';
import { confirmDialog } from '../components/modal.js';
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
          h('h2', { class: 'headline-lg' }, 'المجموعات'),
          h('p', { class: 'body-md muted' }, 'رتّب كتبك كما تشاء'),
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
              `${entry.bookCount} كتاب • ${entry.installedCount} مُنزَّل`,
            ),
          ),
        ),
        h(
          'button',
          {
            class: 'collection-card collection-card--new',
            onclick: async () => {
              const name = await askName('مجموعة جديدة');
              if (!name) return;
              await repository.createCollection(name);
              await refresh();
              onChanged?.();
            },
          },
          h('span', { class: 'collection-card__icon' }, icon('plusSquare', { size: 22 })),
          h('span', { class: 'collection-card__name' }, 'مجموعة جديدة'),
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
            'حفظ',
          ),
          h('button', { class: 'button button--tonal', onclick: () => settle(null) }, 'إلغاء'),
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

  const load = async () => ({
    collection: (await repository.getCollections()).find((entry) => entry.id === id) ?? null,
    books: await repository.getCollectionBooks(id),
  });

  const refresh = () => asyncView(content, load, render, { empty: 'هذه المجموعة فارغة' });

  function render({ collection, books }) {
    if (!collection) return emptyView('لم نجد هذه المجموعة');

    const missing = books.filter((book) => book.downloadStatus !== 'installed');

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
            `${collection.bookCount} كتاب • ${collection.installedCount} مُنزَّل`,
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
                  await repository.downloadSelection(missing.map((book) => book.editionId));
                  toast(`أُضيف ${missing.length} كتابًا إلى قائمة التنزيل`);
                  refresh();
                },
              },
              icon('download', { size: 18 }),
              h('span', {}, `تنزيل الباقي (${missing.length})`),
            ),
          h(
            'button',
            {
              class: 'button button--tonal',
              onclick: async () => {
                const name = await askName('إعادة تسمية', collection.name);
                if (!name) return;
                await repository.renameCollection(id, name);
                refresh();
              },
            },
            'إعادة تسمية',
          ),
          h(
            'button',
            {
              class: 'button button--tonal',
              onclick: async () => {
                const choice = await confirmDialog({
                  title: `حذف مجموعة «${collection.name}»؟`,
                  message: 'تُحذف المجموعة وحدها؛ الكتب تبقى في مكتبتك.',
                  actions: [{ value: 'go', label: 'حذف المجموعة', variant: 'danger' }],
                });
                if (choice !== 'go') return;
                await repository.deleteCollection(id);
                navigate('/library');
              },
            },
            'حذف',
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
        : emptyView('هذه المجموعة فارغة'),
    );
  }

  refresh();
  return null;
}
