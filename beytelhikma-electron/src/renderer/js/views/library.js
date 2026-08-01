import { h } from '../dom.js';
import { n, ordinal } from '../format.js';
import { t } from '../i18n.js';
import { arrowBackward, icon } from '../icons.js';
import { repository } from '../repository.js';
import { navigate } from '../router.js';
import { renderShell } from '../shell.js';
import { bookCard } from '../components/book-card.js';
import { pagination, PAGE_SIZES } from '../components/pagination.js';
import { emptyView, errorView, loadingView } from '../components/states.js';
import { collectionsStrip } from './collections.js';

const FILTERS = [
  { key: 'all', label: 'library.filter.all' },
  { key: 'reading', label: 'library.filter.reading' },
  { key: 'done', label: 'library.filter.done' },
];

const SORTS = [
  { key: 'recent', label: 'library.sort.recent' },
  { key: 'title', label: 'library.sort.title' },
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
    const lede = h('p', { class: 'body-md muted' }, t('library.lede'));

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
          h('span', {}, t(item.label)),
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
          sortButton.lastChild.textContent = t(next.label);
          this.#refresh();
        },
      },
      icon('sort', { size: 18 }),
      h('span', {}, t(SORTS[0].label)),
    );

    const toggle = h(
      'div',
      { class: 'view-toggle' },
      ['grid', 'list'].map((layout) =>
        h(
          'button',
          {
            class: layout === this.#query.layout ? 'is-active' : '',
            title: t(layout === 'grid' ? 'library.grid' : 'library.list'),
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
          h('div', {}, h('h1', { class: 'display-lg' }, t('library.title')), lede),
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
          h('span', {}, `${t(item.label)} (${n(counts[item.key] ?? 0)})`),
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
        ? t('library.counts', { total: counts.all, reading: counts.reading })
        : t('library.empty');

      this.#nodes.grid.replaceChildren(
        ...(rows.length
          ? rows.map((entry) =>
              bookCard(entry.book, {
                progress: entry.percent ?? 0,
                badge: (entry.percent ?? 0) === 0 ? t('library.new') : null,
                action: entry.percent > 0 ? 'read' : 'open',
              }),
            )
          : [emptyView(t(counts.all ? 'library.emptyScope' : 'library.empty'))]),
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
            arrowBackward({ size: 18 }),
            t('shell.backHome'),
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
    if (this.#scope === 'era') return t('scope.era', { century: ordinal(Number(this.#id)) });
    if (this.#scope === 'undated') return t('scope.undated');
    return label ?? t(this.#scope === 'author' ? 'scope.author' : 'scope.category');
  }

  #subtitle(total) {
    const count = t('scope.count', { total });
    if (this.#scope === 'era') return t('scope.eraHint', { count });
    if (this.#scope === 'undated') return t('scope.undatedHint', { count });
    if (this.#scope === 'category') return t('scope.categoryHint', { count });
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
        this.#host.replaceChildren(emptyView(t('scope.empty')));
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
