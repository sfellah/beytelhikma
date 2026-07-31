import { h } from '../dom.js';
import { ordinal } from '../format.js';
import { icon } from '../icons.js';
import { repository } from '../repository.js';
import { navigate } from '../router.js';
import { renderShell } from '../shell.js';
import { bookCard } from '../components/book-card.js';
import { asyncView, emptyView } from '../components/states.js';
import { collectionsStrip } from './collections.js';

const FILTERS = [
  { key: 'all', label: 'الكل', keep: () => true },
  { key: 'reading', label: 'قيد القراءة', keep: (e) => e.percent > 0 && e.percent < 1 },
  { key: 'done', label: 'مكتمل', keep: (e) => e.percent >= 1 },
];

const SORTS = [
  { key: 'recent', label: 'الأحدث' },
  { key: 'title', label: 'العنوان' },
];

/** Bibliothèque : les collections, puis les livres installés. */
export function libraryView(host) {
  const content = renderShell(host, { active: 'library' });
  // Le bandeau des collections reste visible même sans livre installé : une
  // collection peut n'être qu'une liste d'envies.
  const books = h('div', {});
  content.append(collectionsStrip(), books);
  asyncView(books, () => repository.getLibrary(), render, {
    empty: 'مكتبتك فارغة بعد',
  });
  return null;
}

function render(entries) {
  if (!entries.length) return null;

  const state = { filter: 'all', sort: 'recent', layout: 'grid' };
  const grid = h('section', { class: 'library__grid' });

  const paint = () => {
    const filter = FILTERS.find((item) => item.key === state.filter);
    const visible = entries.filter(filter.keep);
    if (state.sort === 'title') {
      visible.sort((a, b) => a.book.title.localeCompare(b.book.title, 'ar'));
    } else {
      visible.sort((a, b) => (b.lastOpenedAt ?? '').localeCompare(a.lastOpenedAt ?? ''));
    }
    grid.className = `library__grid${state.layout === 'list' ? ' library__grid--list' : ''}`;
    grid.replaceChildren(
      ...(visible.length
        ? visible.map((entry) =>
            bookCard(entry.book, {
              progress: entry.percent ?? 0,
              badge: (entry.percent ?? 0) === 0 ? 'جديد' : null,
              action: entry.percent > 0 ? 'read' : 'open',
            }),
          )
        : [emptyView('لا يوجد كتاب في هذا التصنيف')]),
    );
  };

  const segmented = h(
    'div',
    { class: 'segmented' },
    FILTERS.map((item) =>
      h(
        'button',
        {
          class: item.key === state.filter ? 'is-active' : '',
          onclick: (event) => {
            state.filter = item.key;
            for (const button of segmented.children) button.classList.remove('is-active');
            event.currentTarget.classList.add('is-active');
            paint();
          },
        },
        item.label,
      ),
    ),
  );

  const sortButton = h(
    'button',
    {
      class: 'button button--tonal',
      onclick: () => {
        const index = SORTS.findIndex((item) => item.key === state.sort);
        const next = SORTS[(index + 1) % SORTS.length];
        state.sort = next.key;
        sortButton.lastChild.textContent = next.label;
        paint();
      },
    },
    icon('sort', { size: 18 }),
    h('span', {}, SORTS[0].label),
  );

  const toggle = h(
    'div',
    { class: 'view-toggle' },
    ['grid', 'list'].map((layout) =>
      h(
        'button',
        {
          class: layout === state.layout ? 'is-active' : '',
          title: layout === 'grid' ? 'شبكة' : 'قائمة',
          onclick: (event) => {
            state.layout = layout;
            for (const button of toggle.children) button.classList.remove('is-active');
            event.currentTarget.classList.add('is-active');
            paint();
          },
        },
        icon(layout === 'grid' ? 'grid' : 'rows', { size: 20 }),
      ),
    ),
  );

  paint();

  return h(
    'div',
    { class: 'library' },
    h(
      'section',
      { class: 'library__header' },
      h(
        'div',
        {},
        h('h1', { class: 'display-lg' }, 'مكتبتي'),
        h('p', { class: 'body-md muted' }, 'تصفح وقراءة مجموعتك الخاصة من الكتب والمخطوطات.'),
      ),
      h('div', { class: 'library__tools' }, segmented, sortButton, toggle),
    ),
    grid,
  );
}

/**
 * Liste générique : livres d'une discipline (`/category/:id`) ou d'un auteur
 * (`/author/:id`). Même grille que la bibliothèque, sans filtres.
 */
export function collectionView(kind) {
  return (host, params) => {
    const content = renderShell(host, { active: kind === 'author' ? 'authors' : 'home' });
    asyncView(
      content,
      async () => {
        if (kind === 'era') {
          const century = Number(params.id);
          const books = await repository.getBooksByCentury(century, { limit: 60 });
          return {
            title: `${ordinal(century)} الهجري`,
            subtitle: `${books.length} كتاب لمؤلفين توفّوا في هذا القرن`,
            books,
          };
        }
        if (kind === 'category') {
          const categories = await repository.getCategories();
          const category = categories.find(
            (item) => String(item.categoryId) === String(params.id),
          );
          return {
            title: category?.label ?? 'التخصص',
            subtitle: `${category?.bookCount ?? 0} كتاب في هذا التخصص`,
            books: await repository.getBooksByCategory(Number(params.id), { limit: 60 }),
          };
        }
        const books = await repository.getBooksByAuthor(params.id, { limit: 60 });
        return {
          title: books[0]?.authorName ?? 'المؤلف',
          subtitle: `${books.length} كتاب`,
          books,
        };
      },
      ({ title, subtitle, books }) => {
        if (!books.length) return null;
        return h(
          'div',
          { class: 'library' },
          h(
            'div',
            { class: 'breadcrumb label-sm' },
            h(
              'button',
              { onclick: () => navigate('/home') },
              icon('arrowRight', { size: 18 }),
              ' العودة للرئيسية',
            ),
            h('span', { class: 'muted' }, '/'),
            h('span', { class: 'breadcrumb__current' }, title),
          ),
          h(
            'section',
            { class: 'library__header' },
            h(
              'div',
              {},
              h('h1', { class: 'display-lg' }, title),
              h('p', { class: 'body-md muted' }, subtitle),
            ),
          ),
          h(
            'section',
            { class: 'library__grid' },
            books.map((book) => bookCard(book, { action: 'open' })),
          ),
        );
      },
      { empty: 'لا يوجد كتاب هنا بعد' },
    );
    return null;
  };
}
