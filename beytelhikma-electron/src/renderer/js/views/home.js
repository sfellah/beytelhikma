import { h } from '../dom.js';
import { excerpt, initial, ordinal, percent } from '../format.js';
import { categoryIcon, icon } from '../icons.js';
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
  const [resume, library, recent, categories, eras, featured] = await Promise.all([
    repository.getContinueReading(),
    // L'étagère est une bande, pas un inventaire : en demander une page évite
    // de joindre le catalogue pour chaque livre installé, dont on n'affichera
    // que quatre. Un de plus que `SHELF_LIMIT` : la reprise en sort.
    repository.getLibrary({ limit: SHELF_LIMIT + 1, sort: 'recent' }),
    repository.getRecentBooks({ limit: 12 }),
    repository.getCategories(),
    repository.getEras(),
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
    categories: categories.filter((category) => category.bookCount > 0),
    eras: eras.filter((era) => era.bookCount > 0),
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
    disciplinesSection(data.categories),
    erasSection(data.eras),
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
          resume ? 'متابعة القراءة' : 'ابدأ القراءة',
        ),
      ),
      h(
        'a',
        { class: 'link-action label-md', href: '#/library' },
        h('span', {}, 'عرض الكل'),
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
            h('span', { class: 'label-md quick-card__title' }, 'كل المكتبة'),
            h('span', { class: 'label-sm muted' }, 'تصفّح، رتّب، تابع التقدّم'),
          ),
          h('span', { class: 'quick-card__go' }, icon('arrowLeft', { size: 20 })),
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
  if (reading) parts.push(`${reading} قيد القراءة`);
  if (done) parts.push(`${done} مكتمل`);
  if (untouched) parts.push(`${untouched} في الانتظار`);

  return h(
    'div',
    { class: 'stat-card' },
    h('span', { class: 'stat-card__mark' }, icon('bookOpen', { size: 32 })),
    h(
      'div',
      {},
      h('p', { class: 'label-md stat-card__label' }, 'على جهازك'),
      h('p', { class: 'stat-card__value' }, `${entries.length} كتاب`),
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
              ? `الصفحة ${read} من ${book.pageCount ?? '؟'}`
              : `${book.pageCount ?? 0} صفحة — لم تبدأ بعد`,
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
        h('span', {}, resume ? 'أكمل القراءة' : 'ابدأ القراءة'),
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
      'على رفّك',
      `${total} كتاب منزّل على هذا الجهاز`,
      total > SHELF_LIMIT
        ? [
            h(
              'a',
              { class: 'button button--tonal', href: '#/library' },
              h('span', {}, 'كل المكتبة'),
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
  const state = done ? 'مكتمل' : started ? 'قيد القراءة' : 'لم تبدأ بعد';

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
            : `${book.pageCount ?? 0} صفحة · ${state}`,
        ),
      ),
      h(
        'span',
        { class: 'label-md shelf-row__action' },
        h('span', {}, progress?.pageId ? 'أكمل' : 'افتح'),
        icon('arrowLeft', { size: 16 }),
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
      h('span', {}, 'عرض كل الإصدارات الجديدة'),
    ),
  );

  // `scrollLeft` est négatif en RTL sous Chromium : on raisonne en distance
  // absolue au bord, jamais en signe.
  const previous = h(
    'button',
    { class: 'button--icon', type: 'button', title: 'السابق', 'aria-label': 'السابق' },
    icon('arrowRight', { size: 20 }),
  );
  const next = h(
    'button',
    { class: 'button--icon', type: 'button', title: 'التالي', 'aria-label': 'التالي' },
    icon('arrowLeft', { size: 20 }),
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
      'المجموعات الحديثة',
      'أحدث المخطوطات والكتب المضافة للمكتبة',
      [previous, next],
    ),
    h('div', { class: 'scroller-frame' }, scroller),
  );
}

// ------------------------------------------------------------- disciplines

const BUBBLES = ['teal', 'gold', 'emerald'];

function disciplinesSection(categories) {
  if (!categories.length) return null;
  return h(
    'section',
    {
      class: 'section-block disciplines-section',
      'aria-labelledby': 'disciplines-title',
      'data-reveal': 4,
    },
    sectionHead(
      'disciplines-title',
      'التخصصات العلمية',
      'تصفّح المكتبة حسب الفن',
    ),
    h(
      'div',
      { class: 'disciplines' },
      categories.map((category, index) =>
        h(
          'a',
          { class: 'discipline', href: `#/category/${category.categoryId}` },
          h(
            'span',
            { class: `discipline__bubble discipline__bubble--${BUBBLES[index % 3]}` },
            icon(categoryIcon(category.label), { size: 22 }),
          ),
          h('span', { class: 'title-md discipline__label' }, category.label),
          h('span', { class: 'label-sm muted' }, `${category.bookCount} كتاب`),
        ),
      ),
      h(
        'a',
        { class: 'discipline discipline--more', href: '#/library' },
        h(
          'span',
          { class: 'discipline__bubble discipline__bubble--emerald' },
          icon('more', { size: 22 }),
        ),
        h('span', { class: 'title-md discipline__label' }, 'المزيد'),
        h('span', { class: 'label-sm muted' }, 'كل المكتبة'),
      ),
    ),
  );
}

// ------------------------------------------------------------------ siècles

/**
 * Le catalogue n'a pas de date de composition : le repère temporel du
 * patrimoine, c'est le siècle de décès de l'auteur (`authors.death_year_hijri`).
 */
function erasSection(eras) {
  if (eras.length < 2) return null;
  const max = Math.max(...eras.map((era) => era.bookCount));

  return h(
    'section',
    {
      class: 'section-block eras',
      'aria-labelledby': 'eras-title',
      'data-reveal': 5,
    },
    sectionHead('eras-title', 'المكتبة عبر القرون', 'حسب قرن وفاة المؤلف'),
    h(
      'ol',
      { class: 'timeline' },
      eras.map((era) =>
        h(
          'li',
          { class: 'timeline__item' },
          h(
            'a',
            { class: 'era', href: `#/era/${era.century}` },
            h('span', {
              class: 'era__bar',
              style: { '--fill': `${Math.round((era.bookCount / max) * 100)}%` },
            }),
            h('span', { class: 'title-md era__name' }, ordinal(era.century)),
            h('span', { class: 'label-sm muted' }, `${era.bookCount} كتاب`),
          ),
        ),
      ),
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
    sectionHead('featured-title', 'شخصية الشهر', 'مؤلف نقف عنده هذا الشهر'),
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
          author.deathYearHijri ? `توفي سنة ${author.deathYearHijri} هـ` : 'مؤلف',
        ),
      ),
    ),
    author.bio && h('p', { class: 'body-md author-card__bio clamp-4' }, author.bio),
    books.length > 0 &&
      h(
        'div',
        { class: 'author-card__works' },
        h('h4', { class: 'label-md author-card__works-title' }, 'أبرز مؤلفاته:'),
        books.map((book) =>
          h(
            'a',
            { class: 'author-work', href: `#/book/${book.editionId}` },
            h('span', { class: 'author-work__tile' }, icon('book', { size: 16 })),
            h('span', { class: 'label-md truncate' }, book.title),
            h('span', { class: 'author-work__chevron' }, icon('arrowLeft', { size: 16 })),
          ),
        ),
      ),
  );
}
