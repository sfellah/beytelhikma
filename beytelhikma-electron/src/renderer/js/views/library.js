import { h } from '../dom.js';
import { arabicNumber, ordinal } from '../format.js';
import { icon } from '../icons.js';
import { repository } from '../repository.js';
import { navigate } from '../router.js';
import { renderShell } from '../shell.js';
import { bookCard } from '../components/book-card.js';
import { pagination, PAGE_SIZES } from '../components/pagination.js';
import { emptyView, errorView, loadingView } from '../components/states.js';
import { collectionsStrip } from './collections.js';

const FILTERS = [
  { key: 'all', label: 'الكل' },
  { key: 'reading', label: 'قيد القراءة' },
  { key: 'done', label: 'مكتمل' },
];

const SORTS = [
  { key: 'recent', label: 'الأحدث' },
  { key: 'title', label: 'العنوان' },
];

/**
 * Bibliothèque : les collections, puis les livres installés, une page à la
 * fois. Le filtre, le tri et les décomptes sont faits par le dépôt : trier des
 * milliers de livres dans la vue obligeait à les charger tous, et à joindre le
 * catalogue pour chacun alors qu'un écran n'en montre que vingt-quatre.
 */
export function libraryView(host) {
  const content = renderShell(host, { active: 'library' });
  // Le bandeau des collections reste visible même sans livre installé : une
  // collection peut n'être qu'une liste d'envies.
  const books = h('div', {});
  content.append(collectionsStrip(), books);
  new LibraryScreen(books).start();
  return null;
}

class LibraryScreen {
  #host;
  #query = { filter: 'all', sort: 'recent', layout: 'grid', offset: 0, limit: PAGE_SIZES[0] };
  #nodes = {};
  #token = 0;

  constructor(host) {
    this.#host = host;
  }

  start() {
    this.#build();
    this.#refresh();
  }

  #build() {
    const grid = h('section', { class: 'library__grid' }, loadingView());
    const pager = h('div', { class: 'library__pager' });
    const lede = h('p', { class: 'body-md muted' }, 'تصفح وقراءة مجموعتك الخاصة.');

    const segmented = h(
      'div',
      { class: 'segmented' },
      FILTERS.map((item) =>
        h(
          'button',
          {
            class: item.key === this.#query.filter ? 'is-active' : '',
            onclick: (event) => {
              this.#query = { ...this.#query, filter: item.key, offset: 0 };
              for (const button of segmented.children) button.classList.remove('is-active');
              event.currentTarget.classList.add('is-active');
              this.#refresh();
            },
          },
          h('span', {}, item.label),
        ),
      ),
    );

    const sortButton = h(
      'button',
      {
        class: 'button button--tonal',
        onclick: () => {
          const index = SORTS.findIndex((item) => item.key === this.#query.sort);
          const next = SORTS[(index + 1) % SORTS.length];
          this.#query = { ...this.#query, sort: next.key, offset: 0 };
          sortButton.lastChild.textContent = next.label;
          this.#refresh();
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
            class: layout === this.#query.layout ? 'is-active' : '',
            title: layout === 'grid' ? 'شبكة' : 'قائمة',
            onclick: (event) => {
              this.#query = { ...this.#query, layout };
              for (const button of toggle.children) button.classList.remove('is-active');
              event.currentTarget.classList.add('is-active');
              // Le tiroir ne change que la classe : rien à redemander au dépôt.
              this.#applyLayout();
            },
          },
          icon(layout === 'grid' ? 'grid' : 'rows', { size: 20 }),
        ),
      ),
    );

    this.#nodes = { grid, pager, lede, segmented };

    this.#host.replaceChildren(
      h(
        'div',
        { class: 'library' },
        h(
          'section',
          { class: 'library__header' },
          h('div', {}, h('h1', { class: 'display-lg' }, 'مكتبتي'), lede),
          h('div', { class: 'library__tools' }, segmented, sortButton, toggle),
        ),
        grid,
        pager,
      ),
    );
    this.#applyLayout();
  }

  #applyLayout() {
    this.#nodes.grid.className =
      `library__grid${this.#query.layout === 'list' ? ' library__grid--list' : ''}`;
  }

  /** Les onglets portent leur décompte : sans lui, on clique pour voir si c'est vide. */
  #drawCounts(counts) {
    this.#nodes.segmented.replaceChildren(
      ...FILTERS.map((item) =>
        h(
          'button',
          {
            class: item.key === this.#query.filter ? 'is-active' : '',
            onclick: () => {
              this.#query = { ...this.#query, filter: item.key, offset: 0 };
              this.#refresh();
            },
          },
          h('span', {}, `${item.label} (${arabicNumber(counts[item.key] ?? 0)})`),
        ),
      ),
    );
  }

  async #refresh() {
    const mine = ++this.#token;
    try {
      const { rows, total, counts } = await repository.getLibrary(this.#query);
      if (mine !== this.#token || !this.#host.isConnected) return;

      this.#drawCounts(counts);
      this.#nodes.lede.textContent = counts.all
        ? `${arabicNumber(counts.all)} كتابًا في مكتبتك، ${arabicNumber(counts.reading)} قيد القراءة.`
        : 'مكتبتك فارغة بعد.';

      this.#nodes.grid.replaceChildren(
        ...(rows.length
          ? rows.map((entry) =>
              bookCard(entry.book, {
                progress: entry.percent ?? 0,
                badge: (entry.percent ?? 0) === 0 ? 'جديد' : null,
                action: entry.percent > 0 ? 'read' : 'open',
              }),
            )
          : [emptyView(counts.all ? 'لا يوجد كتاب في هذا التصنيف' : 'مكتبتك فارغة بعد')]),
      );
      this.#applyLayout();

      this.#nodes.pager.replaceChildren(
        total > this.#query.limit
          ? pagination({
              total,
              offset: this.#query.offset,
              limit: this.#query.limit,
              onChange: (offset) => {
                this.#query = { ...this.#query, offset };
                this.#refresh();
              },
              onPageSize: (limit) => {
                this.#query = { ...this.#query, limit, offset: 0 };
                this.#refresh();
              },
            })
          : h('div', {}),
      );
    } catch (error) {
      if (mine !== this.#token) return;
      this.#nodes.grid.replaceChildren(errorView(error, () => this.#refresh()));
    }
  }
}

/**
 * Liste générique : livres d'une discipline (`/category/:id`), d'un auteur
 * (`/author/:id`) ou d'un siècle (`/era/:id`). Même grille que la bibliothèque,
 * sans filtres, mais paginée : un auteur du corpus Shamela peut porter des
 * centaines d'éditions, et l'écran annonçait jusqu'ici le nombre qu'il avait
 * reçu plutôt que le nombre qu'il y a.
 */
export function collectionView(scope) {
  return (host, params) => {
    const content = renderShell(host, { active: scope === 'author' ? 'authors' : 'home' });
    new ScopeScreen(content, scope, params.id).start();
    return null;
  };
}

class ScopeScreen {
  #host;
  #scope;
  #id;
  #query = { offset: 0, limit: PAGE_SIZES[0] };
  #nodes = {};
  #token = 0;

  constructor(host, scope, id) {
    this.#host = host;
    this.#scope = scope;
    this.#id = id;
  }

  start() {
    this.#host.replaceChildren(loadingView());
    this.#refresh();
  }

  #build(title) {
    const grid = h('section', { class: 'library__grid' });
    const pager = h('div', { class: 'library__pager' });
    const heading = h('h1', { class: 'display-lg' }, title);
    const subtitle = h('p', { class: 'body-md muted' });

    this.#nodes = { grid, pager, heading, subtitle };

    this.#host.replaceChildren(
      h(
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
        h('section', { class: 'library__header' }, h('div', {}, heading, subtitle)),
        grid,
        pager,
      ),
    );
  }

  #title(label) {
    if (this.#scope === 'era') return `${ordinal(Number(this.#id))} الهجري`;
    if (this.#scope === 'undated') return 'غير مؤرّخ';
    return label ?? (this.#scope === 'author' ? 'المؤلف' : 'التخصص');
  }

  #subtitle(total) {
    const count = `${arabicNumber(total)} كتاب`;
    if (this.#scope === 'era') return `${count} لمؤلفين توفّوا في هذا القرن`;
    if (this.#scope === 'undated') return `${count} لا تُعرف سنة وفاة مؤلفها`;
    if (this.#scope === 'category') return `${count} في هذا التخصص`;
    return count;
  }

  async #refresh() {
    const mine = ++this.#token;
    try {
      const { rows, total, label } = await repository.getBooksIn({
        scope: this.#scope,
        id: this.#id,
        ...this.#query,
      });
      if (mine !== this.#token || !this.#host.isConnected) return;

      if (!total) {
        this.#nodes = {};
        this.#host.replaceChildren(emptyView('لا يوجد كتاب هنا بعد'));
        return;
      }

      if (!this.#nodes.grid) this.#build(this.#title(label));
      else this.#nodes.heading.textContent = this.#title(label);

      this.#nodes.subtitle.textContent = this.#subtitle(total);
      this.#nodes.grid.replaceChildren(
        ...rows.map((book) => bookCard(book, { action: 'open' })),
      );
      this.#nodes.pager.replaceChildren(
        total > this.#query.limit
          ? pagination({
              total,
              offset: this.#query.offset,
              limit: this.#query.limit,
              onChange: (offset) => {
                this.#query = { ...this.#query, offset };
                this.#refresh();
              },
              onPageSize: (limit) => {
                this.#query = { ...this.#query, limit, offset: 0 };
                this.#refresh();
              },
            })
          : h('div', {}),
      );
    } catch (error) {
      if (mine !== this.#token) return;
      this.#host.replaceChildren(errorView(error, () => this.#refresh()));
    }
  }
}
