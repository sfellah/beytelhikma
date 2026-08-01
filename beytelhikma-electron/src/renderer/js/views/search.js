import { h } from '../dom.js';
import { n } from '../format.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { repository } from '../repository.js';
import { navigate } from '../router.js';
import { renderShell } from '../shell.js';
import { emptyView, errorView, loadingView } from '../components/states.js';

/** Occurrences montrées par livre avant de renvoyer vers le lecteur. */
const PER_BOOK = 4;

/**
 * Recherche transversale : le terme est cherché dans le texte de **tous les
 * livres installés**, puis dans les annotations personnelles.
 *
 * Le catalogue, lui, se cherche depuis l'exploration : ce sont deux gestes
 * différents — trouver un livre, ou trouver un passage — et les mélanger dans
 * une même liste rendrait les deux illisibles. Un lien mène de l'un à l'autre.
 */
export function searchView(host, params) {
  const content = renderShell(host, { active: 'search' });
  const screen = new SearchScreen(content, params?.query?.text ?? '');
  screen.start();
  return null;
}

class SearchScreen {
  #host;
  #term;
  #nodes = {};
  #timer = null;
  #token = 0;

  constructor(host, term) {
    this.#host = host;
    this.#term = term;
  }

  start() {
    this.#build();
    if (this.#term.trim().length >= 2) this.#run();
    else this.#idle();
  }

  #build() {
    const results = h('div', { class: 'search__results' });
    const status = h('p', { class: 'body-md muted' });

    const field = h('input', {
      type: 'search',
      class: 'search__field',
      placeholder: t('search.field'),
      value: this.#term,
      oninput: (event) => {
        clearTimeout(this.#timer);
        this.#term = event.target.value;
        // Le balayage ouvre chaque livre : on attend une vraie pause de frappe.
        this.#timer = setTimeout(() => {
          if (this.#term.trim().length >= 2) this.#run();
          else this.#idle();
        }, 450);
      },
    });

    this.#nodes = { results, status, field };

    this.#host.replaceChildren(
      h(
        'section',
        { class: 'search' },
        h(
          'div',
          { class: 'search__header' },
          h('h1', { class: 'display-lg' }, t('search.title')),
          h(
            'button',
            {
              class: 'button button--tonal',
              onclick: () =>
                navigate(
                  `/explore${this.#term.trim() ? `?text=${encodeURIComponent(this.#term.trim())}` : ''}`,
                ),
            },
            icon('compass', { size: 18 }),
            h('span', {}, t('search.inCatalog')),
          ),
        ),
        h('div', { class: 'search__box' }, icon('search', { size: 20 }), field),
        status,
        results,
      ),
    );
    field.focus();
  }

  #idle() {
    this.#token += 1; // annule un balayage encore en vol
    this.#nodes.status.textContent = t('search.tooShort');
    this.#nodes.results.replaceChildren();
  }

  async #run() {
    const token = ++this.#token;
    const term = this.#term.trim();
    this.#nodes.status.textContent = t('search.running');
    this.#nodes.results.replaceChildren(loadingView(t('search.slow')));

    try {
      const [texts, annotations] = await Promise.all([
        repository.searchLibrary(term, { perBook: PER_BOOK }),
        repository.getAnnotations({ text: term, limit: 20 }),
      ]);
      if (token !== this.#token || !this.#host.isConnected) return;

      this.#nodes.status.textContent = this.#summary(texts, annotations.total);
      const sections = [];

      if (texts.results.length) {
        sections.push(
          this.#section(
            t('search.inBooks'),
            texts.results.map((entry) => this.#bookGroup(entry, term)),
          ),
        );
      }
      if (annotations.items.length) {
        sections.push(
          this.#section(
            t('search.inNotes'),
            annotations.items.map((item) => this.#annotationRow(item)),
          ),
        );
      }

      this.#nodes.results.replaceChildren(
        sections.length
          ? h('div', {}, sections)
          : emptyView(
              t(texts.installed ? 'search.noneInBooks' : 'search.noBooks'),
            ),
      );
    } catch (error) {
      if (token !== this.#token) return;
      this.#nodes.status.textContent = '';
      this.#nodes.results.replaceChildren(errorView(error, () => this.#run()));
    }
  }

  /** Ce qui a été balayé, et surtout ce qui ne l'a pas été. */
  #summary(texts, annotationCount) {
    const parts = [
      t('search.summary.hits', { total: texts.total, books: texts.results.length }),
    ];
    if (annotationCount) parts.push(t('search.summary.notes', { count: annotationCount }));
    parts.push(
      t('search.summary.scanned', { scanned: texts.scanned, installed: texts.installed }),
    );
    if (texts.skipped) parts.push(t('search.summary.skipped', { count: texts.skipped }));
    return parts.join(' • ');
  }

  #section(title, children) {
    return h(
      'div',
      { class: 'search__section' },
      h('h2', { class: 'headline-lg' }, title),
      h('div', { class: 'search__section-body' }, children),
    );
  }

  #bookGroup(entry) {
    return h(
      'article',
      { class: 'search__book' },
      h(
        'div',
        { class: 'search__book-head' },
        h(
          'button',
          { class: 'search__book-title', onclick: () => navigate(`/book/${entry.editionId}`) },
          entry.title,
        ),
        h(
          'span',
          { class: 'label-sm muted' },
          t('search.matches', { count: entry.matchCount }),
        ),
      ),
      entry.pages.map((hit) =>
        h(
          'button',
          {
            class: 'search__hit',
            onclick: () => navigate(`/reader/${entry.editionId}?page=${hit.pageId}`),
          },
          h(
            'p',
            { class: 'search__snippet' },
            hit.snippet.before,
            h('mark', {}, hit.snippet.match),
            hit.snippet.after,
          ),
          h(
            'span',
            { class: 'label-sm muted' },
            t('search.page', { page: hit.printedPageNum ?? hit.sequenceNum }),
          ),
        ),
      ),
    );
  }

  #annotationRow(item) {
    const text =
      item.kind === 'note' ? item.content : item.kind === 'highlight' ? item.selectedText : item.label;
    const page = item.pageId ?? item.highlight?.pageId ?? null;
    return h(
      'button',
      {
        class: 'search__hit',
        onclick: () =>
          navigate(`/reader/${item.editionId}${page != null ? `?page=${page}` : ''}`),
      },
      h(
        'p',
        { class: 'search__snippet' },
        h('span', { class: 'label-sm muted' }, `${item.bookTitle} — `),
        text ?? '',
      ),
      icon(item.kind === 'note' ? 'noteAdd' : item.kind === 'highlight' ? 'highlight' : 'bookmark', {
        size: 18,
      }),
    );
  }
}
