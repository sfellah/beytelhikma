import { COVER_FAMILIES, coverFamily } from '../../../shared/book-cover.js';
import { h } from '../dom.js';
import { excerpt, initial, n, ordinal, percent } from '../format.js';
import { t } from '../i18n.js';
import { arrowBackward, arrowForward, categoryIcon, icon } from '../icons.js';
import { repository } from '../repository.js';
import { navigate } from '../router.js';
import { renderShell } from '../shell.js';
import { bookCard } from '../components/book-card.js';
import { cover } from '../components/cover.js';
import { reveal, sectionHead } from '../components/section.js';
import { asyncView } from '../components/states.js';

/** Accueil : reprise de lecture, nouveautés, disciplines, auteur en vedette. */
export function homeView(host) {
  const content = renderShell(host, { active: 'home' });
  asyncView(content, load, render);
  return null;
}

async function load() {
  const [resume, library, recent, disciplines, eras, undated, featured] = await Promise.all([
    repository.getContinueReading(),
    // L'étagère est une bande, pas un inventaire : en demander une page évite
    // de joindre le catalogue pour chaque livre installé, dont on n'affichera
    // que quatre. Un de plus que `SHELF_LIMIT` : la reprise en sort.
    repository.getLibrary({ limit: SHELF_LIMIT + 1, sort: 'recent' }),
    repository.getRecentBooks({ limit: 12 }),
    repository.getTopCategories({ limit: DISCIPLINE_LIMIT, sample: DISCIPLINE_SAMPLE }),
    repository.getEras(),
    repository.getUndatedCount(),
    repository.getFeaturedAuthor(),
  ]);

  const [page, featuredBooks] = await Promise.all([
    resume?.progress?.pageId
      ? repository.getPageById(resume.book.editionId, resume.progress.pageId)
      : null,
    featured ? repository.getBooksByAuthor(featured.authorId, { limit: 3 }) : [],
  ]);

  return {
    resume,
    quote: page ? excerpt(page.bodyPlain) : null,
    // La reprise occupe déjà le héros : l'étagère montre le reste.
    shelf: library.rows
      .filter((entry) => entry.book.editionId !== resume?.book?.editionId)
      .slice(0, SHELF_LIMIT),
    libraryTotal: library.total,
    recent,
    disciplines,
    eras: eras.filter((era) => era.bookCount > 0),
    undated,
    featured,
    featuredBooks,
  };
}

function render(data) {
  if (!data.recent.length && !data.resume) return null;
  const root = h(
    'div',
    { class: 'home' },
    heroSection(data),
    // `data-reveal` 1 est libre : le héros compte pour deux blocs visuels.
    shelfSection(data.shelf, data.libraryTotal),
    recentSection(data.recent),
    disciplinesSection(data.disciplines),
    erasSection(data.eras, data.undated),
    featuredSection(data.featured, data.featuredBooks),
  );
  return reveal(root);
}

// ------------------------------------------------------------------- héros

function heroSection({ resume, quote, recent, shelf }) {
  const book = resume?.book ?? recent[0];
  if (!book) return null;
  const open = () => navigate(`/reader/${book.editionId}`);

  return h(
    'section',
    { class: 'hero', 'aria-labelledby': 'hero-title', 'data-reveal': 0 },
    h(
      'div',
      { class: 'section-header' },
      h(
        'div',
        { class: 'section-header__text' },
        h(
          'h1',
          { class: 'headline-lg', id: 'hero-title' },
          t(resume ? 'download.continue' : 'download.start'),
        ),
      ),
      h(
        'a',
        { class: 'link-action label-md', href: '#/library' },
        h('span', {}, t('home.showAll')),
      ),
    ),
    h(
      'div',
      { class: 'bento' },
      continueCard({ book, resume, quote, open }),
      h(
        'div',
        { class: 'bento__side' },
        shelfStatCard(shelf, resume),
        h(
          'a',
          { class: 'quick-card', href: '#/library' },
          h(
            'span',
            { class: 'quick-card__text' },
            h('span', { class: 'label-md quick-card__title' }, t('home.allLibrary')),
            h('span', { class: 'label-sm muted' }, t('home.allLibraryHint')),
          ),
          h('span', { class: 'quick-card__go' }, arrowForward({ size: 20 })),
        ),
      ),
    ),
  );
}

/** Compte ce qui est réellement installé : rien n'est estimé ni inventé. */
function shelfStatCard(shelf, resume) {
  const entries = resume ? [resume, ...shelf] : shelf;
  if (!entries.length) return null;
  const done = entries.filter((entry) => entry.percent >= 1).length;
  const reading = entries.filter(
    (entry) => entry.percent > 0 && entry.percent < 1,
  ).length;
  const untouched = entries.length - done - reading;

  const parts = [];
  if (reading) parts.push(t('home.reading', { count: reading }));
  if (done) parts.push(t('home.done', { count: done }));
  if (untouched) parts.push(t('home.untouched', { count: untouched }));

  return h(
    'div',
    { class: 'stat-card' },
    h('span', { class: 'stat-card__mark' }, icon('bookOpen', { size: 32 })),
    h(
      'div',
      {},
      h('p', { class: 'label-md stat-card__label' }, t('home.onDevice')),
      h('p', { class: 'stat-card__value' }, t('home.bookCount', { count: entries.length })),
    ),
    h('p', { class: 'label-sm stat-card__note' }, parts.join(' — ')),
  );
}

function continueCard({ book, resume, quote, open }) {
  const progress = resume?.percent ?? 0;
  const read = Math.max(
    1,
    Math.round((book.pageCount ?? 0) * progress) || (resume ? 1 : 0),
  );

  return h(
    'article',
    { class: 'continue-card' },
    h(
      'div',
      { class: 'continue-card__cover' },
      cover(book, { showText: true, progress: null }),
    ),
    h(
      'div',
      { class: 'continue-card__body' },
      book.categoryLabel && h('span', { class: 'chip' }, book.categoryLabel),
      h('h3', { class: 'headline-md continue-card__title clamp-2' }, book.title),
      book.authorName &&
        h('p', { class: 'body-md continue-card__author' }, book.authorName),
      quote && h('p', { class: 'body-md quote clamp-2' }, `«${quote}»`),
      h(
        'div',
        { class: 'meter' },
        h(
          'div',
          { class: 'meter__row label-sm' },
          h('span', { class: 'meter__value' }, percent(progress)),
          h(
            'span',
            { class: 'muted' },
            resume
              ? t('home.pageOf', { read, total: book.pageCount ?? t('home.unknown') })
              : t('home.notStartedPages', { count: book.pageCount ?? 0 }),
          ),
        ),
        h(
          'div',
          { class: 'meter__track' },
          h('span', { style: { '--fill': progress } }),
        ),
      ),
      h(
        'button',
        { class: 'button button--filled', type: 'button', onclick: open },
        h('span', {}, t(resume ? 'home.continue' : 'download.start')),
      ),
    ),
  );
}

// ------------------------------------------------------------- votre étagère

const SHELF_LIMIT = 4;

/**
 * L'étagère montre quatre livres ; le sous-titre annonce, lui, tout ce qui est
 * installé. Les deux nombres ne viennent donc pas du même endroit : `total`
 * est compté par le dépôt, `entries` n'est que la page qu'on a demandée.
 */

/** Ce qui est *installé*, avec la progression réelle lue dans `user.sqlite`. */
function shelfSection(entries, total) {
  if (!entries.length) return null;
  const shown = entries.slice(0, SHELF_LIMIT);

  return h(
    'section',
    {
      class: 'section-block shelf',
      'aria-labelledby': 'shelf-title',
      'data-reveal': 2,
    },
    sectionHead(
      'shelf-title',
      t('home.shelf'),
      t('home.shelfHint', { count: total }),
      total > SHELF_LIMIT
        ? [
            h(
              'a',
              { class: 'button button--tonal', href: '#/library' },
              h('span', {}, t('home.allLibrary')),
            ),
          ]
        : null,
    ),
    h(
      'ul',
      { class: 'shelf__list' },
      shown.map((entry) => shelfRow(entry)),
    ),
  );
}

function shelfRow({ book, percent: value, progress }) {
  const done = value >= 1;
  const started = value > 0;
  const state = t(done ? 'home.stateDone' : started ? 'home.stateReading' : 'home.stateNotStarted');

  return h(
    'li',
    {},
    h(
      'a',
      { class: 'shelf-row', href: `#/reader/${book.editionId}` },
      h('span', { class: 'shelf-row__cover' }, cover(book, { showText: false })),
      h(
        'span',
        { class: 'shelf-row__text' },
        h('span', { class: 'title-md shelf-row__title clamp-1' }, book.title),
        book.authorName &&
          h('span', { class: 'label-md muted truncate' }, book.authorName),
      ),
      h(
        'span',
        { class: 'shelf-row__meter' },
        h(
          'span',
          { class: 'progress' },
          h('span', { style: { width: `${Math.round(value * 100)}%` } }),
        ),
        h(
          'span',
          { class: 'label-sm shelf-row__state' },
          started
            ? `${percent(value)} · ${state}`
            : t('home.pagesAndState', { count: book.pageCount ?? 0, state }),
        ),
      ),
      h(
        'span',
        { class: 'label-md shelf-row__action' },
        h('span', {}, t(progress?.pageId ? 'home.resume' : 'home.open')),
        arrowForward({ size: 16 }),
      ),
    ),
  );
}

// -------------------------------------------------------------- nouveautés

function recentSection(recent) {
  if (!recent.length) return null;

  const scroller = h(
    'div',
    { class: 'scroller no-scrollbar', tabindex: 0, role: 'list' },
    recent.map((book) =>
      h('div', { role: 'listitem' }, bookCard(book, { action: 'open' })),
    ),
    h(
      'button',
      { class: 'scroller__more', type: 'button', onclick: () => navigate('/library') },
      icon('plusSquare', { size: 30 }),
      h('span', {}, t('home.allNew')),
    ),
  );

  // `scrollLeft` est négatif en RTL sous Chromium : on raisonne en distance
  // absolue au bord, jamais en signe.
  const previous = h(
    'button',
    { class: 'button--icon', type: 'button', title: t('home.previous'), 'aria-label': t('home.previous') },
    arrowBackward({ size: 20 }),
  );
  const next = h(
    'button',
    { class: 'button--icon', type: 'button', title: t('home.next'), 'aria-label': t('home.next') },
    arrowForward({ size: 20 }),
  );

  const step = () => Math.max(240, scroller.clientWidth * 0.8);
  previous.onclick = () => scroller.scrollBy({ left: step(), behavior: 'smooth' });
  next.onclick = () => scroller.scrollBy({ left: -step(), behavior: 'smooth' });

  const syncEdges = () => {
    const max = scroller.scrollWidth - scroller.clientWidth;
    const offset = Math.abs(scroller.scrollLeft);
    previous.disabled = offset <= 1;
    next.disabled = offset >= max - 1;
    scroller.classList.toggle('scroller--at-start', previous.disabled);
    scroller.classList.toggle('scroller--at-end', next.disabled);
  };
  scroller.addEventListener('scroll', syncEdges, { passive: true });
  requestAnimationFrame(syncEdges);
  // `ResizeObserver` plutôt qu'un écouteur sur `window` : la vue est remplacée
  // à chaque navigation, l'observateur disparaît avec elle.
  new ResizeObserver(syncEdges).observe(scroller);

  return h(
    'section',
    {
      class: 'section-block recent',
      'aria-labelledby': 'recent-title',
      'data-reveal': 3,
    },
    sectionHead(
      'recent-title',
      t('home.recentTitle'),
      t('home.recentHint'),
      [previous, next],
    ),
    h('div', { class: 'scroller-frame' }, scroller),
  );
}

// ------------------------------------------------------------- disciplines

/**
 * Six disciplines, pas quarante. Le catalogue en compte quarante peuplées : les
 * dessiner toutes faisait de l'accueil un inventaire. Le repli porte le vrai
 * total, compté par SQL — six tuiles ne doivent jamais laisser croire à six
 * disciplines.
 */
const DISCIPLINE_LIMIT = 6;
const DISCIPLINE_SAMPLE = 3;

function disciplinesSection({ rows, total }) {
  if (!rows.length) return null;
  return h(
    'section',
    {
      class: 'section-block disciplines-section',
      'aria-labelledby': 'disciplines-title',
      'data-reveal': 4,
    },
    sectionHead('disciplines-title', t('home.disciplinesTitle'), t('home.disciplinesHint')),
    h(
      'div',
      { class: 'disciplines' },
      rows.map((category) => disciplineTile(category)),
    ),
    total > rows.length &&
      h(
        'a',
        { class: 'link-action label-md disciplines__more', href: '#/explore' },
        h('span', {}, t('home.browseFields', { total })),
        arrowForward({ size: 18 }),
      ),
  );
}

/**
 * La teinte vient de la famille de la discipline, pas de sa position dans la
 * liste : la bulle de الحديث porte la couleur des couvertures de الحديث. La
 * table est celle de `src/shared/book-cover.js`, jamais une seconde copie.
 */
function disciplineTile(category) {
  const { from, to } = COVER_FAMILIES[coverFamily(category.label)];

  return h(
    'a',
    {
      class: 'discipline',
      href: `#/category/${category.categoryId}`,
      style: { '--tint-from': from, '--tint-to': to },
    },
    category.books.length > 0 &&
      h(
        'span',
        { class: 'discipline__stack', 'aria-hidden': 'true' },
        category.books.map((book) =>
          h('span', { class: 'discipline__mini' }, cover(book, { showText: false })),
        ),
      ),
    h('span', { class: 'discipline__bubble' }, icon(categoryIcon(category.label), { size: 22 })),
    h('span', { class: 'title-md discipline__label' }, category.label),
    h(
      'span',
      { class: 'label-sm muted discipline__count' },
      t('home.categoryCount', {
        count: category.bookCount,
        share: Math.round(category.share * 100),
      }),
    ),
  );
}

// ------------------------------------------------------------------ siècles

/**
 * Le catalogue n'a pas de date de composition : le repère temporel du
 * patrimoine, c'est le siècle de décès de l'auteur (`authors.death_year_hijri`).
 */
function erasSection(eras, undated) {
  if (eras.length < 2) return null;
  const max = Math.max(...eras.map((era) => era.bookCount));

  // L'axe se comble : `getEras` ne rend que les siècles peuplés, et une grille
  // qui les colle les uns aux autres prétendrait à une continuité que le
  // catalogue n'a pas. Un siècle sans livre doit se voir comme tel.
  const known = new Map(eras.map((era) => [era.century, era.bookCount]));
  const cells = [];
  for (let century = eras[0].century; century <= eras[eras.length - 1].century; century += 1) {
    cells.push({ century, bookCount: known.get(century) ?? 0 });
  }

  return h(
    'section',
    {
      class: 'section-block eras',
      'aria-labelledby': 'eras-title',
      'data-reveal': 5,
    },
    sectionHead('eras-title', t('home.erasTitle'), t('home.erasHint')),
    h(
      'ol',
      { class: 'timeline' },
      cells.map((era) => eraCell(era, max)),
      undated > 0 ? undatedCell(undated) : null,
    ),
  );
}

/**
 * La hauteur suit la racine du rapport, pas le rapport. Un siècle à un livre
 * face à un siècle à trente-neuf valait 2,5 % : la barre tombait sous son
 * plancher de 12 px et cessait de porter une valeur. En racine elle vaut 16 %,
 * sans que l'ordre des siècles en soit changé.
 */
function eraCell({ century, bookCount }, max) {
  const empty = bookCount === 0;
  const span = t('home.eraSpan', { from: (century - 1) * 100 + 1, to: century * 100 });
  const body = [
    h('span', {
      class: empty ? 'era__bar era__bar--none' : 'era__bar',
      style: empty ? null : { '--fill': `${Math.round(Math.sqrt(bookCount / max) * 100)}%` },
    }),
    h('span', { class: 'title-md era__name' }, ordinal(century)),
    h('span', { class: 'label-sm muted era__span' }, span),
    h(
      'span',
      { class: 'label-sm era__count' },
      empty ? t('home.eraEmpty') : t('home.eraCount', { count: bookCount }),
    ),
  ];

  return h(
    'li',
    { class: 'timeline__item' },
    empty
      ? h('span', { class: 'era era--empty' }, body)
      : h('a', { class: 'era', href: `#/era/${century}` }, body),
  );
}

/**
 * Le bout de l'axe : 29 % des éditions n'ont aucun auteur daté. Sans cette
 * cellule elles seraient absentes d'une section qui se donne pour une vue
 * d'ensemble. Elle ne porte pas de barre — elle n'a pas de position sur l'axe.
 */
function undatedCell(undated) {
  return h(
    'li',
    { class: 'timeline__item' },
    h(
      'a',
      { class: 'era era--undated', href: '#/undated' },
      h('span', { class: 'era__bar era__bar--none' }),
      h('span', { class: 'title-md era__name' }, t('home.undated')),
      h('span', { class: 'label-sm muted era__span' }, t('home.undatedHint')),
      h('span', { class: 'label-sm era__count' }, t('home.eraCount', { count: undated })),
    ),
  );
}

// -------------------------------------------------------- auteur en vedette

function featuredSection(featured, featuredBooks) {
  if (!featured) return null;
  return h(
    'section',
    {
      class: 'section-block featured',
      'aria-labelledby': 'featured-title',
      'data-reveal': 6,
    },
    sectionHead('featured-title', t('home.featuredTitle'), t('home.featuredHint')),
    authorCard(featured, featuredBooks),
  );
}

function authorCard(author, books) {
  return h(
    'article',
    { class: 'author-card' },
    h(
      'div',
      { class: 'author-card__head' },
      h(
        'div',
        { class: 'author-card__portrait' },
        initial(author.shortName ?? author.fullName),
      ),
      h(
        'div',
        {},
        h('h3', { class: 'title-md' }, author.shortName ?? author.fullName),
        h(
          'p',
          { class: 'label-sm muted' },
          author.deathYearHijri ? t('home.diedIn', { year: author.deathYearHijri }) : t('authors.one'),
        ),
      ),
    ),
    author.bio && h('p', { class: 'body-md author-card__bio clamp-4' }, author.bio),
    books.length > 0 &&
      h(
        'div',
        { class: 'author-card__works' },
        h('h4', { class: 'label-md author-card__works-title' }, t('home.majorWorks')),
        books.map((book) =>
          h(
            'a',
            { class: 'author-work', href: `#/book/${book.editionId}` },
            h('span', { class: 'author-work__tile' }, icon('book', { size: 16 })),
            h('span', { class: 'label-md truncate' }, book.title),
            h('span', { class: 'author-work__chevron' }, arrowForward({ size: 16 })),
          ),
        ),
      ),
  );
}
