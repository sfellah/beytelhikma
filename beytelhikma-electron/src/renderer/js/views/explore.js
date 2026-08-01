import { h } from '../dom.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { onDownloadsChanged, repository } from '../repository.js';
import { renderShell } from '../shell.js';
import { bookCard } from '../components/book-card.js';
import { collectionPickerButton } from '../components/collection-button.js';
import { confirmDialog } from '../components/modal.js';
import { formatBytes } from '../components/download-action.js';
import { facetPanel } from '../components/facet-panel.js';
import { emptyView, errorView, loadingView } from '../components/states.js';

const PAGE = 40;

const SORTS = [
  ['title', 'explore.sort.title'],
  ['recent', 'explore.sort.recent'],
  ['pages', 'explore.sort.pages'],
  ['size', 'explore.sort.size'],
];

/** Facettes à valeurs multiples, dans l'ordre des puces de filtres actifs. */
const MULTI = ['categories', 'types', 'centuries', 'authors', 'publishers'];

const EMPTY_QUERY = {
  text: '',
  categories: [],
  types: [],
  centuries: [],
  authors: [],
  publishers: [],
  years: null,
  status: null,
};

/** Décode l'état depuis le fragment d'URL, pour qu'un lien soit partageable. */
function readQuery(params) {
  const raw = params?.query ?? {};
  const list = (key) => (raw[key] ? raw[key].split(',').filter(Boolean) : []);
  const numbers = (key) => list(key).map(Number);
  const years = {};
  if (raw.from) years.from = Number(raw.from);
  if (raw.to) years.to = Number(raw.to);
  return {
    text: raw.text ?? '',
    categories: numbers('categories'),
    types: list('types'),
    centuries: numbers('centuries'),
    authors: list('authors'),
    publishers: list('publishers'),
    years: Object.keys(years).length ? years : null,
    status: raw.status ?? null,
    sort: raw.sort ?? 'title',
  };
}

/** Réécrit le fragment sans provoquer de navigation ni de re-rendu. */
function writeQuery(query) {
  const params = new URLSearchParams();
  if (query.text) params.set('text', query.text);
  for (const key of MULTI) {
    if (query[key]?.length) params.set(key, query[key].join(','));
  }
  if (query.years?.from != null) params.set('from', String(query.years.from));
  if (query.years?.to != null) params.set('to', String(query.years.to));
  if (query.status) params.set('status', query.status);
  if (query.sort && query.sort !== 'title') params.set('sort', query.sort);
  const suffix = params.toString();
  history.replaceState(null, '', `#/explore${suffix ? `?${suffix}` : ''}`);
}

function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Écran d'exploration : recherche, facettes, sélection multiple, mise en file.
 * L'état vit ici ; un changement de filtre ne redessine que les résultats et
 * les compteurs, jamais la coque.
 */
export function exploreView(host, params) {
  const content = renderShell(host, { active: 'explore' });
  const state = {
    query: readQuery(params),
    books: [],
    total: 0,
    facets: {},
    selecting: false,
    selection: new Set(),
    loading: true,
    error: null,
  };

  const nodes = {
    header: h('div', { class: 'explore__header' }),
    chips: h('div', { class: 'explore__chips' }),
    body: h('div', { class: 'explore__body' }),
  };
  content.append(h('section', { class: 'explore' }, nodes.header, nodes.chips, nodes.body));

  // Une requête lente ne doit jamais écraser le résultat d'une requête plus
  // récente : chaque chargement porte un jeton, seul le dernier écrit l'état.
  let token = 0;

  async function load({ append = false } = {}) {
    const mine = ++token;
    state.loading = true;
    drawResults();
    try {
      const offset = append ? state.books.length : 0;
      const [page, facets] = await Promise.all([
        repository.exploreBooks({ ...state.query, offset, limit: PAGE }),
        repository.getFacets(state.query),
      ]);
      if (mine !== token) return;
      state.books = append ? [...state.books, ...page.books] : page.books;
      state.total = page.total;
      state.facets = facets;
      state.error = null;
    } catch (error) {
      if (mine !== token) return;
      state.error = error;
    } finally {
      if (mine === token) {
        state.loading = false;
        draw();
      }
    }
  }

  function update(patch) {
    state.query = { ...state.query, ...patch };
    writeQuery(state.query);
    load();
  }

  const unsubscribe = onDownloadsChanged(() => {
    if (!content.isConnected) {
      unsubscribe();
      return;
    }
    load();
  });

  function draw() {
    nodes.header.replaceChildren(...header());
    nodes.chips.replaceChildren(...chips());
    nodes.body.replaceChildren(
      facetPanel({ facets: state.facets, query: state.query, onChange: update }),
      resultsNode(),
    );
  }

  function drawResults() {
    if (nodes.body.lastChild) nodes.body.lastChild.replaceWith(resultsNode());
  }

  // ------------------------------------------------------------------ entête

  function header() {
    const field = h('input', {
      type: 'search',
      class: 'explore__search',
      value: state.query.text,
      placeholder: t('explore.search'),
      oninput: debounce((event) => update({ text: event.target.value }), 250),
    });
    return [
      h(
        'div',
        {},
        h('h1', { class: 'display-lg' }, t('explore.title')),
        h('p', { class: 'body-md muted' }, t('pagination.results', { total: state.total })),
      ),
      field,
      h(
        'select',
        { class: 'explore__sort', onchange: (event) => update({ sort: event.target.value }) },
        SORTS.map(([value, label]) =>
          h('option', { value, selected: state.query.sort === value }, t(label)),
        ),
      ),
    ];
  }

  // -------------------------------------------------------- filtres actifs

  function labelOf(key, value) {
    return state.facets[key]?.find((entry) => entry.value === value)?.label ?? String(value);
  }

  function activeFilters() {
    const out = [];
    for (const key of MULTI) {
      for (const value of state.query[key] ?? []) {
        out.push({ key, value, label: labelOf(key, value) });
      }
    }
    if (state.query.status) {
      out.push({ key: 'status', value: null, label: labelOf('status', state.query.status) });
    }
    if (state.query.years) out.push({ key: 'years', value: null, label: t('facet.year') });
    return out;
  }

  function chips() {
    const active = activeFilters();
    const out = active.map((filter) =>
      h(
        'button',
        {
          class: 'chip chip--removable',
          onclick: () =>
            update(
              filter.value == null
                ? { [filter.key]: null }
                : { [filter.key]: state.query[filter.key].filter((v) => v !== filter.value) },
            ),
        },
        h('span', {}, filter.label),
        icon('close', { size: 14 }),
      ),
    );

    if (active.length || state.query.text) {
      out.push(
        h(
          'button',
          { class: 'button button--tonal', onclick: () => update({ ...EMPTY_QUERY }) },
          t('explore.clearAll'),
        ),
      );
    }

    out.push(state.selecting ? selectionBar() : selectButton());
    return out;
  }

  // ------------------------------------------------------------- sélection

  function selectButton() {
    return h(
      'button',
      {
        class: 'button button--tonal explore__select',
        onclick: () => {
          state.selecting = true;
          draw();
        },
      },
      icon('check', { size: 18 }),
      h('span', {}, t('explore.select')),
    );
  }

  function selectionBar() {
    const weight = h(
      'span',
      { class: 'label-md' },
      t('explore.selected', { count: state.selection.size }),
    );
    // Le poids demande une requête : on l'affiche dès qu'elle répond, sans
    // bloquer le rendu de la barre.
    repository.getSelectionWeight([...state.selection]).then(({ count, bytes }) => {
      if (weight.isConnected) {
        weight.textContent = t('explore.selectedSize', {
          count,
          size: formatBytes(bytes) || t('format.zeroBytes'),
        });
      }
    });

    return h(
      'div',
      { class: 'explore__selection' },
      weight,
      h(
        'button',
        {
          class: 'button button--tonal',
          onclick: () => {
            for (const book of state.books) {
              if (book.downloadStatus !== 'installed') state.selection.add(book.editionId);
            }
            draw();
          },
        },
        t('explore.selectPage'),
      ),
      h(
        'button',
        {
          class: 'button button--filled',
          disabled: state.selection.size === 0,
          onclick: () => downloadSelection(),
        },
        icon('download', { size: 18 }),
        h('span', {}, t('explore.downloadSelected')),
      ),
      collectionPickerButton(() => [...state.selection], { label: t('explore.addToCollection') }),
      h(
        'button',
        {
          class: 'button button--tonal',
          onclick: () => {
            state.selecting = false;
            state.selection.clear();
            draw();
          },
        },
        t('action.cancel'),
      ),
    );
  }

  async function downloadSelection() {
    const ids = [...state.selection];
    const { count, bytes } = await repository.getSelectionWeight(ids);
    const choice = await confirmDialog({
      title: t('explore.downloadTitle', { count }),
      message: t('explore.downloadSize', { size: formatBytes(bytes) || t('format.zeroBytes') }),
      actions: [{ value: 'go', label: t('explore.download'), variant: 'filled' }],
    });
    if (choice !== 'go') return;
    await repository.downloadSelection(ids);
    state.selection.clear();
    state.selecting = false;
    load();
  }

  // --------------------------------------------------------------- résultats

  function resultsNode() {
    if (state.error) return h('div', { class: 'explore__results' }, errorView(state.error, load));
    if (state.loading && !state.books.length) {
      return h('div', { class: 'explore__results' }, loadingView());
    }
    if (!state.books.length) {
      return h(
        'div',
        { class: 'explore__results' },
        emptyView(t('explore.noResults')),
        h(
          'button',
          { class: 'button button--tonal', onclick: () => update({ ...EMPTY_QUERY }) },
          t('explore.clearFilters'),
        ),
      );
    }

    const grid = h(
      'div',
      { class: 'explore__grid' },
      state.books.map((book) =>
        bookCard(book, {
          action: book.downloadStatus === 'installed' ? 'read' : 'download',
          selectable: state.selecting,
          selected: state.selection.has(book.editionId),
          onToggle: (editionId, checked) => {
            if (checked) state.selection.add(editionId);
            else state.selection.delete(editionId);
            draw();
          },
        }),
      ),
    );

    const more =
      state.books.length < state.total &&
      h(
        'button',
        {
          class: 'button button--tonal explore__more',
          disabled: state.loading,
          onclick: () => load({ append: true }),
        },
        t(state.loading ? 'state.loading' : 'explore.more'),
      );

    return h('div', { class: 'explore__results' }, grid, more);
  }

  draw();
  load();
  return { dispose: unsubscribe };
}
