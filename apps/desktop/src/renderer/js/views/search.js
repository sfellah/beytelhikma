import { h } from '../dom.js';
import { initial } from '../format.js';
import { t } from '../i18n.js';
import { arrowForward, icon } from '../icons.js';
import { repository } from '../repository.js';
import { navigate } from '../router.js';
import { renderShell } from '../shell.js';
import { bookCard } from '../components/book-card.js';
import { emptyView, errorView, loadingView } from '../components/states.js';
import { normalizeArabic } from '../../../shared/arabic.js';

/** Occurrences montrées par livre avant de renvoyer vers le lecteur. */
const PER_BOOK = 4;
/** Ce que montre chaque section : un aperçu, jamais la liste entière. */
const AUTHORS = 6;
const CURRICULA = 4;
const BOOKS = 12;
/** Pause de frappe avant de chercher. Voir `#run` pour ce qu'elle gouverne. */
const TYPING_PAUSE = 250;

/**
 * Recherche générale : un terme, cinq sections. Les trois premières viennent du
 * **catalogue** — auteurs, cursus, livres — les deux dernières du **texte des
 * livres installés** et des annotations personnelles.
 *
 * Ce sont deux vagues, et c'est délibéré : les trois requêtes de catalogue
 * reviennent en quelques millisecondes, le balayage plein texte ouvre chaque
 * livre installé l'un après l'autre. Les attendre ensemble laisserait l'écran
 * vide pendant des secondes pour des réponses déjà prêtes.
 *
 * Les facettes du catalogue — tranches, disciplines, sélection par lot — vivent
 * dans `/explore`, où mène chaque lien « voir tout ».
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
  /** La case « les plus connus seulement ». Ne porte que sur la première vague. */
  #popular = false;

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
    const catalog = h('div', { class: 'search__results' });
    const texts = h('div', { class: 'search__results' });
    const status = h('p', { class: 'body-md muted' });

    const field = h('input', {
      type: 'search',
      class: 'search__field',
      placeholder: t('search.field'),
      value: this.#term,
      oninput: (event) => {
        clearTimeout(this.#timer);
        this.#term = event.target.value;
        this.#timer = setTimeout(() => {
          if (this.#term.trim().length >= 2) this.#run();
          else this.#idle();
        }, TYPING_PAUSE);
      },
    });

    // La case ne porte que sur la **première** vague. Un passage n'est pas
    // populaire ou non : restreindre le balayage aux vingt-trois livres ferait
    // mentir l'annonce « n livres parcourus », qui compte les livres installés.
    const popularToggle = h(
      'label',
      { class: 'search__toggle' },
      h('input', {
        type: 'checkbox',
        onchange: (event) => {
          this.#popular = event.target.checked;
          if (this.#term.trim().length >= 2) this.#run();
        },
      }),
      h('span', {}, t('popular.filter')),
    );

    this.#nodes = { catalog, texts, status, field };

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
              title: t('search.toFiltersTitle'),
              onclick: () => this.#toExplore(),
            },
            icon('compass', { size: 18 }),
            h('span', {}, t('search.toFilters')),
          ),
        ),
        h('div', { class: 'search__box' }, icon('search', { size: 20 }), field),
        popularToggle,
        catalog,
        status,
        texts,
      ),
    );
    field.focus();
  }

  #toExplore() {
    const params = new URLSearchParams();
    const term = this.#term.trim();
    if (term) params.set('text', term);
    // Le filtre part avec : le perdre en chemin élargirait la réponse sans le
    // dire, et l'écran d'arrivée annoncerait un total qui n'est pas celui qu'on
    // vient de lire.
    if (this.#popular) params.set('popular', '1');
    const suffix = params.toString();
    navigate(`/explore${suffix ? `?${suffix}` : ''}`);
  }

  #idle() {
    this.#token += 1; // annule les deux vagues encore en vol
    this.#nodes.status.textContent = t('search.tooShort');
    this.#nodes.catalog.replaceChildren();
    this.#nodes.texts.replaceChildren();
  }

  /**
   * Les deux vagues partent ensemble et se peignent séparément. Le même jeton
   * les garde : une frappe pendant le balayage annule aussi les réponses de
   * catalogue déjà demandées, sinon l'écran mêlerait deux termes.
   */
  #run() {
    const token = ++this.#token;
    const term = this.#term.trim();
    this.#nodes.catalog.replaceChildren(loadingView());
    this.#nodes.status.textContent = t('search.running');
    this.#nodes.texts.replaceChildren(loadingView(t('search.slow')));
    this.#runCatalog(token, term);
    this.#runTexts(token, term);
  }

  #live(token) {
    return token === this.#token && this.#host.isConnected;
  }

  // ------------------------------------------------------------- catalogue

  async #runCatalog(token, term) {
    try {
      const [authors, curricula, books] = await Promise.all([
        repository.getAuthors({ text: term, limit: AUTHORS }),
        repository.getCurricula(),
        repository.exploreBooks({ text: term, limit: BOOKS, popular: this.#popular }),
      ]);
      if (!this.#live(token)) return;

      const matching = matchCurricula(curricula, term);
      const sections = [];

      if (authors.rows.length) {
        sections.push(
          this.#section(
            t('search.inAuthors'),
            h('ul', { class: 'search__authors' }, authors.rows.map(authorTile)),
            authors.total > authors.rows.length
              ? this.#more(t('search.seeAll', { count: authors.total }), () =>
                  navigate(`/authors?text=${encodeURIComponent(term)}`),
                )
              : null,
          ),
        );
      }
      if (matching.length) {
        // Le compte filtré *est* le total : les sept cursus tiennent en
        // mémoire, il n'y a pas de page suivante à promettre.
        sections.push(
          this.#section(
            t('search.inCurricula'),
            h(
              'div',
              { class: 'search__curricula' },
              matching.slice(0, CURRICULA).map(curriculumRow),
            ),
            matching.length > CURRICULA
              ? this.#more(t('search.seeAll', { count: matching.length }), () =>
                  navigate('/curricula'),
                )
              : null,
          ),
        );
      }
      if (books.books.length) {
        sections.push(
          this.#section(
            t('search.inCatalogBooks'),
            h('div', { class: 'search__grid' }, books.books.map((book) => bookCard(book))),
            books.total > books.books.length
              ? this.#more(t('search.seeAll', { count: books.total }), () => this.#toExplore())
              : null,
          ),
        );
      }

      this.#nodes.catalog.replaceChildren(
        sections.length ? h('div', {}, sections) : emptyView(t('search.noneInCatalog')),
      );
    } catch (error) {
      if (!this.#live(token)) return;
      this.#nodes.catalog.replaceChildren(
        errorView(error, () => {
          this.#nodes.catalog.replaceChildren(loadingView());
          this.#runCatalog(token, term);
        }),
      );
    }
  }

  // ------------------------------------------------------------ plein texte

  async #runTexts(token, term) {
    try {
      const [texts, annotations] = await Promise.all([
        repository.searchLibrary(term, { perBook: PER_BOOK }),
        repository.getAnnotations({ text: term, limit: 20 }),
      ]);
      if (!this.#live(token)) return;

      this.#nodes.status.textContent = this.#summary(texts, annotations.total);
      const sections = [];

      if (texts.results.length) {
        sections.push(
          this.#section(
            t('search.inBooks'),
            h(
              'div',
              { class: 'search__section-body' },
              texts.results.map((entry) => this.#bookGroup(entry)),
            ),
          ),
        );
      }
      if (annotations.items.length) {
        sections.push(
          this.#section(
            t('search.inNotes'),
            h(
              'div',
              { class: 'search__section-body' },
              annotations.items.map((item) => this.#annotationRow(item)),
            ),
          ),
        );
      }

      this.#nodes.texts.replaceChildren(
        sections.length
          ? h('div', {}, sections)
          : emptyView(t(texts.installed ? 'search.noneInBooks' : 'search.noBooks')),
      );
    } catch (error) {
      if (!this.#live(token)) return;
      this.#nodes.status.textContent = '';
      this.#nodes.texts.replaceChildren(
        errorView(error, () => {
          this.#nodes.texts.replaceChildren(loadingView(t('search.slow')));
          this.#runTexts(token, term);
        }),
      );
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

  #section(title, body, action = null) {
    return h(
      'div',
      { class: 'search__section' },
      h(
        'div',
        { class: 'search__section-head' },
        h('h2', { class: 'headline-lg' }, title),
        action,
      ),
      body,
    );
  }

  #more(label, onclick) {
    return h('button', { class: 'search__more label-md', onclick }, label, arrowForward({ size: 16 }));
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

/* ------------------------------------------------------------ les cursus */

/**
 * Les cursus se filtrent **ici**, pas au repository : leurs noms vivent dans
 * les catalogues de chaînes, que le processus principal n'a pas. Sept entrées
 * en mémoire — le coût est nul, et `getCurricula` reste sans argument.
 *
 * La comparaison passe par `normalizeArabic`, la même normalisation que les
 * colonnes du catalogue : sinon un terme vocalisé trouverait les livres et pas
 * les cursus, et l'écart ne se verrait qu'en arabe voyellé.
 */
function matchCurricula(curricula, term) {
  const needle = normalizeArabic(term);
  if (!needle) return [];
  return curricula.filter((curriculum) => {
    const haystack = normalizeArabic(
      `${t(`curriculum.${curriculum.id}.name`)} ${t(`curriculum.${curriculum.id}.hint`)}`,
    );
    return haystack.includes(needle);
  });
}

/** Ligne compacte : une petite section n'a pas la place du rayon de `/curricula`. */
function curriculumRow(curriculum) {
  return h(
    'a',
    { class: 'search__curriculum', href: `#/curriculum/${curriculum.id}` },
    h(
      'span',
      { class: 'search__curriculum-text' },
      h('span', { class: 'title-md clamp-1' }, t(`curriculum.${curriculum.id}.name`)),
      h(
        'span',
        { class: 'label-sm muted truncate' },
        t('curricula.progress', { done: curriculum.done, total: curriculum.resolved }),
      ),
    ),
    h(
      'span',
      { class: 'progress search__curriculum-progress' },
      h('span', { style: { width: `${Math.round(curriculum.percent * 100)}%` } }),
    ),
    arrowForward({ size: 16 }),
  );
}

/* ----------------------------------------------------------- les auteurs */

function authorTile(author) {
  const name = author.shortName ?? author.fullName;
  return h(
    'li',
    {},
    h(
      'a',
      { class: 'author-tile', href: `#/author/${author.authorId}` },
      h('span', { class: 'portrait portrait--sm' }, initial(name)),
      h(
        'span',
        { class: 'author-tile__text' },
        h('span', { class: 'title-md author-tile__name clamp-1' }, name),
        h(
          'span',
          { class: 'label-sm muted truncate' },
          author.deathYearHijri
            ? t('authors.deathAndBooks', {
                year: author.deathYearHijri,
                count: author.bookCount,
              })
            : t('authors.books', { count: author.bookCount }),
        ),
      ),
      h('span', { class: 'author-tile__chevron' }, arrowForward({ size: 16 })),
    ),
  );
}
