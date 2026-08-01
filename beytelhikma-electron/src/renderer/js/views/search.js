import { h } from '../dom.js';
import { n } from '../format.js';
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
      placeholder: 'ابحث في نصوص كتبك المنزَّلة…',
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
          h('h1', { class: 'display-lg' }, 'البحث في النصوص'),
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
            h('span', {}, 'البحث في الفهرس'),
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
    this.#nodes.status.textContent = 'اكتب كلمتين على الأقل.';
    this.#nodes.results.replaceChildren();
  }

  async #run() {
    const token = ++this.#token;
    const term = this.#term.trim();
    this.#nodes.status.textContent = 'جارٍ البحث في الكتب المنزَّلة…';
    this.#nodes.results.replaceChildren(loadingView('قد يستغرق فتح الكتب بضع ثوانٍ…'));

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
            'في نصوص الكتب',
            texts.results.map((entry) => this.#bookGroup(entry, term)),
          ),
        );
      }
      if (annotations.items.length) {
        sections.push(
          this.#section(
            'في ملاحظاتي',
            annotations.items.map((item) => this.#annotationRow(item)),
          ),
        );
      }

      this.#nodes.results.replaceChildren(
        sections.length
          ? h('div', {}, sections)
          : emptyView(
              texts.installed
                ? 'لا نتائج في الكتب المنزَّلة'
                : 'لا كتب منزَّلة بعد — نزِّل كتابًا لتبحث في نصّه',
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
      `${n(texts.total)} موضعًا في ${n(texts.results.length)} كتابًا`,
    ];
    if (annotationCount) parts.push(`${n(annotationCount)} في الملاحظات`);
    parts.push(`فُحص ${n(texts.scanned)} من ${n(texts.installed)} كتابًا منزَّلًا`);
    if (texts.skipped) parts.push(`لم يُفحص ${n(texts.skipped)} كتابًا`);
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
          `${n(entry.matchCount)} موضعًا`,
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
            `ص ${n(hit.printedPageNum ?? hit.sequenceNum)}`,
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
