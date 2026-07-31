import { h } from '../dom.js';
import { excerpt, initial, percent } from '../format.js';
import { categoryIcon, icon } from '../icons.js';
import { repository } from '../repository.js';
import { navigate } from '../router.js';
import { renderShell } from '../shell.js';
import { bookCard } from '../components/book-card.js';
import { cover } from '../components/cover.js';
import { asyncView } from '../components/states.js';

/** Accueil : reprise de lecture, nouveautés, disciplines, auteur en vedette. */
export function homeView(host) {
  const content = renderShell(host, { active: 'home' });
  asyncView(content, load, render);
  return null;
}

async function load() {
  const [resume, recent, categories, featured] = await Promise.all([
    repository.getContinueReading(),
    repository.getRecentBooks({ limit: 12 }),
    repository.getCategories(),
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
    recent,
    categories: categories.filter((category) => category.bookCount > 0),
    featured,
    featuredBooks,
  };
}

function render(data) {
  if (!data.recent.length && !data.resume) return null;
  return h(
    'div',
    { class: 'home' },
    heroSection(data),
    recentSection(data.recent),
    bentoSection(data),
  );
}

// ------------------------------------------------------------------- héros

function heroSection({ resume, quote, recent }) {
  const book = resume?.book ?? recent[0];
  if (!book) return null;
  const open = () => navigate(`/reader/${book.editionId}`);

  return h(
    'section',
    { class: 'hero' },
    h(
      'div',
      { class: 'hero__intro' },
      h('h1', { class: 'display-lg' }, resume ? 'أكمل القراءة..' : 'ابدأ القراءة..'),
      h(
        'p',
        { class: 'body-lg' },
        'لا تدع القصة تنتهي هنا. واصل قراءة كتابك الأخير وانغمس في عالم المعرفة والأدب.',
      ),
      h(
        'button',
        { class: 'button button--filled', onclick: open },
        h('span', {}, resume ? 'متابعة القراءة' : 'ابدأ القراءة'),
        icon('arrowUpRight', { size: 18 }),
      ),
    ),
    h('div', { class: 'hero__card' }, continueCard({ book, resume, quote, open })),
  );
}

function continueCard({ book, resume, quote, open }) {
  const progress = resume?.percent ?? 0;
  return h(
    'article',
    { class: 'continue-card', onclick: open },
    h('div', { class: 'continue-card__cover' }, cover(book, {
      showText: true,
      progress: resume ? progress : null,
    })),
    h(
      'div',
      { class: 'continue-card__body' },
      h(
        'div',
        { class: 'continue-card__head' },
        book.categoryLabel && h('span', { class: 'chip' }, book.categoryLabel),
        h('span', { class: 'muted' }, icon('more', { size: 20 })),
      ),
      h('h3', { class: 'title-md continue-card__title clamp-2' }, book.title),
      book.authorName &&
        h('p', { class: 'label-md continue-card__author' }, book.authorName),
      quote && h('p', { class: 'body-md quote clamp-2' }, `«${quote}»`),
      h(
        'div',
        { class: 'label-sm muted' },
        resume
          ? `${percent(progress)} مكتمل`
          : `${book.pageCount ?? 0} صفحة — لم تبدأ بعد`,
      ),
    ),
  );
}

// -------------------------------------------------------------- nouveautés

function recentSection(recent) {
  if (!recent.length) return null;
  const scroller = h(
    'div',
    { class: 'scroller no-scrollbar' },
    recent.map((book) => bookCard(book, { action: 'open' })),
    h(
      'button',
      { class: 'scroller__more', onclick: () => navigate('/library') },
      icon('plusSquare', { size: 30 }),
      h('span', {}, 'عرض كل الإصدارات الجديدة'),
    ),
  );

  const scrollBy = (direction) =>
    scroller.scrollBy({ left: direction * 320, behavior: 'smooth' });

  return h(
    'section',
    {},
    h(
      'div',
      { class: 'section-header' },
      h(
        'div',
        {},
        h('h2', { class: 'headline-lg' }, 'المجموعات الحديثة'),
        h('p', { class: 'body-md' }, 'أحدث المخطوطات والكتب المضافة للمكتبة'),
      ),
      h(
        'div',
        { class: 'section-header__actions' },
        h(
          'button',
          { class: 'button--icon', title: 'السابق', onclick: () => scrollBy(320) },
          icon('arrowRight', { size: 20 }),
        ),
        h(
          'button',
          { class: 'button--icon', title: 'التالي', onclick: () => scrollBy(-320) },
          icon('arrowLeft', { size: 20 }),
        ),
      ),
    ),
    scroller,
  );
}

// ------------------------------------------------------------------- bento

const BUBBLES = ['teal', 'gold', 'emerald'];

function bentoSection({ categories, featured, featuredBooks }) {
  return h(
    'section',
    { class: 'bento' },
    h(
      'div',
      {},
      h('h2', { class: 'headline-lg' }, 'التخصصات العلمية'),
      h(
        'div',
        { class: 'disciplines' },
        categories.map((category, index) =>
          h(
            'a',
            {
              class: 'discipline',
              href: `#/category/${category.categoryId}`,
            },
            h(
              'span',
              { class: `discipline__bubble discipline__bubble--${BUBBLES[index % 3]}` },
              icon(categoryIcon(category.label), { size: 22 }),
            ),
            h('span', { class: 'title-md' }, category.label),
            h('span', { class: 'label-sm muted' }, `${category.bookCount} كتاب`),
          ),
        ),
        h(
          'a',
          { class: 'discipline', href: '#/library' },
          h(
            'span',
            { class: 'discipline__bubble discipline__bubble--emerald' },
            icon('more', { size: 22 }),
          ),
          h('span', { class: 'title-md' }, 'المزيد'),
        ),
      ),
    ),
    featured &&
      h(
        'div',
        {},
        h('h2', { class: 'headline-lg' }, 'شخصية الشهر'),
        authorCard(featured, featuredBooks),
      ),
  );
}

function authorCard(author, books) {
  return h(
    'article',
    { class: 'author-card' },
    h(
      'div',
      { class: 'author-card__head' },
      h('div', { class: 'author-card__portrait' }, initial(author.shortName ?? author.fullName)),
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
    author.bio && h('p', { class: 'body-md author-card__bio' }, author.bio),
    books.length > 0 &&
      h(
        'div',
        { class: 'author-card__works' },
        h('h4', { class: 'label-md' }, 'أبرز مؤلفاته:'),
        books.map((book) =>
          h(
            'div',
            {
              class: 'author-work',
              onclick: () => navigate(`/book/${book.editionId}`),
            },
            h('span', { class: 'author-work__tile' }, icon('book', { size: 16 })),
            h('span', { class: 'label-md truncate' }, book.title),
          ),
        ),
      ),
  );
}
