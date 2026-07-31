import { h } from '../dom.js';
import { initial, ordinal } from '../format.js';
import { icon } from '../icons.js';
import { repository } from '../repository.js';
import { renderShell } from '../shell.js';
import { cover } from '../components/cover.js';
import { reveal, sectionHead } from '../components/section.js';
import { asyncView } from '../components/states.js';

/** Les auteurs du catalogue : le plus présent, les suivants, les siècles, tous. */
export function authorsView(host) {
  const content = renderShell(host, { active: 'authors' });
  asyncView(content, load, render, { empty: 'لا يوجد مؤلف في الفهرس بعد' });
  return null;
}

async function load() {
  const authors = await repository.getAuthors({ limit: 200 });
  const [lead] = authors;
  const leadBooks = lead
    ? await repository.getBooksByAuthor(lead.authorId, { limit: 4 })
    : [];
  return { authors, lead, leadBooks };
}

function render({ authors, lead, leadBooks }) {
  if (!authors.length) return null;
  return reveal(
    h(
      'div',
      { class: 'authors' },
      headerSection(authors),
      leadSection(lead, leadBooks),
      prominentSection(authors.slice(1, 7)),
      centuriesSection(authors),
      indexSection(authors),
    ),
  );
}

// ------------------------------------------------------------------ en-tête

function headerSection(authors) {
  const books = authors.reduce((total, author) => total + (author.bookCount ?? 0), 0);
  const centuries = new Set(
    authors.filter((author) => author.deathYearHijri).map(century),
  );
  const known = [...centuries].sort((a, b) => a - b);

  return h(
    'section',
    { class: 'authors__header', 'aria-labelledby': 'authors-title', 'data-reveal': 0 },
    h('h1', { class: 'authors__title', id: 'authors-title' }, 'المؤلفون'),
    h(
      'p',
      { class: 'body-lg authors__lede' },
      known.length
        ? `${authors.length} مؤلفًا، ${books} كتابًا، من ${ordinal(known[0])} إلى ${ordinal(known.at(-1))} الهجري.`
        : `${authors.length} مؤلفًا، ${books} كتابًا في الفهرس.`,
    ),
  );
}

// --------------------------------------------------------- le plus présent

function leadSection(lead, books) {
  if (!lead) return null;
  const name = lead.shortName ?? lead.fullName;

  return h(
    'section',
    {
      class: 'section-block author-lead',
      'aria-labelledby': 'lead-title',
      'data-reveal': 1,
    },
    sectionHead('lead-title', 'الأوفر حضورًا', 'أكثر مؤلف تمثيلًا في هذا الفهرس'),
    h(
      'article',
      { class: 'lead-card' },
      h(
        'div',
        { class: 'lead-card__identity' },
        h('div', { class: 'portrait portrait--lg' }, initial(name)),
        h(
          'div',
          { class: 'lead-card__names' },
          h('h3', { class: 'headline-lg lead-card__name' }, name),
          lead.fullName !== name &&
            h('p', { class: 'label-md muted' }, lead.fullName),
          h(
            'p',
            { class: 'label-md lead-card__meta' },
            lead.deathYearHijri
              ? `توفي سنة ${lead.deathYearHijri} هـ — ${ordinal(century(lead))}`
              : 'تاريخ الوفاة غير مثبت',
            ' — ',
            `${lead.bookCount} كتاب`,
          ),
        ),
      ),
      lead.bio && h('p', { class: 'body-md lead-card__bio' }, lead.bio),
      books.length > 0 &&
        h(
          'div',
          { class: 'lead-card__works' },
          books.map((book) =>
            h(
              'a',
              { class: 'work-tile', href: `#/book/${book.editionId}` },
              h('span', { class: 'work-tile__cover' }, cover(book, { showText: false })),
              h('span', { class: 'label-md work-tile__title clamp-2' }, book.title),
            ),
          ),
        ),
      h(
        'a',
        { class: 'button button--filled lead-card__cta', href: `#/author/${lead.authorId}` },
        h('span', {}, `كل كتب ${name}`),
        icon('arrowLeft', { size: 18 }),
      ),
    ),
  );
}

// ---------------------------------------------------------- les suivants

function prominentSection(authors) {
  if (!authors.length) return null;
  const max = Math.max(...authors.map((item) => item.bookCount ?? 0), 1);

  return h(
    'section',
    {
      class: 'section-block',
      'aria-labelledby': 'prominent-title',
      'data-reveal': 2,
    },
    sectionHead('prominent-title', 'أعلام المكتبة', 'مرتّبون حسب عدد الكتب في الفهرس'),
    h(
      'ul',
      { class: 'medallions' },
      authors.map((author) =>
        h(
          'li',
          {},
          h(
            'a',
            { class: 'medallion', href: `#/author/${author.authorId}` },
            h(
              'span',
              { class: 'portrait' },
              initial(author.shortName ?? author.fullName),
            ),
            h(
              'span',
              { class: 'medallion__text' },
              h(
                'span',
                { class: 'title-md medallion__name clamp-1' },
                author.shortName ?? author.fullName,
              ),
              h(
                'span',
                { class: 'label-sm muted' },
                author.deathYearHijri ? `ت ${author.deathYearHijri} هـ` : 'مؤلف',
              ),
              h('span', {
                class: 'medallion__bar',
                style: { '--fill': `${Math.round(((author.bookCount ?? 0) / max) * 100)}%` },
              }),
              h('span', { class: 'label-sm muted' }, `${author.bookCount} كتاب`),
            ),
          ),
        ),
      ),
    ),
  );
}

// ------------------------------------------------------------- par siècle

const century = (author) => Math.floor((author.deathYearHijri - 1) / 100) + 1;

/**
 * Le regroupement par siècle de décès est le classement usuel du patrimoine :
 * c'est aussi la seule donnée temporelle du catalogue (`death_year_hijri`).
 */
function centuriesSection(authors) {
  const dated = authors.filter((author) => author.deathYearHijri > 0);
  if (dated.length < 2) return null;

  const groups = new Map();
  for (const author of dated) {
    const key = century(author);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(author);
  }
  const ordered = [...groups.entries()].sort(([a], [b]) => a - b);

  return h(
    'section',
    {
      class: 'section-block',
      'aria-labelledby': 'centuries-title',
      'data-reveal': 3,
    },
    sectionHead('centuries-title', 'طبقات المؤلفين', 'حسب قرن الوفاة الهجري'),
    h(
      'ol',
      { class: 'layers' },
      ordered.map(([key, group]) =>
        h(
          'li',
          { class: 'layer' },
          h(
            'div',
            { class: 'layer__label' },
            h('a', { class: 'title-md layer__century', href: `#/era/${key}` }, ordinal(key)),
            h('span', { class: 'label-sm muted' }, `${group.length} مؤلف`),
          ),
          h(
            'div',
            { class: 'layer__people' },
            group
              .sort((a, b) => (a.deathYearHijri ?? 0) - (b.deathYearHijri ?? 0))
              .map((author) =>
                h(
                  'a',
                  { class: 'person-chip', href: `#/author/${author.authorId}` },
                  h('span', {}, author.shortName ?? author.fullName),
                  h('span', { class: 'person-chip__year' }, `ت ${author.deathYearHijri}`),
                ),
              ),
          ),
        ),
      ),
    ),
  );
}

// ------------------------------------------------------------------- index

function indexSection(authors) {
  const sorted = [...authors].sort((a, b) =>
    (a.shortName ?? a.fullName).localeCompare(b.shortName ?? b.fullName, 'ar'),
  );

  return h(
    'section',
    {
      class: 'section-block',
      'aria-labelledby': 'index-title',
      'data-reveal': 4,
    },
    sectionHead('index-title', 'كل المؤلفين', `${authors.length} مؤلفًا بالترتيب الأبجدي`),
    h(
      'ul',
      { class: 'author-grid' },
      sorted.map((author) =>
        h(
          'li',
          {},
          h(
            'a',
            { class: 'author-tile', href: `#/author/${author.authorId}` },
            h(
              'span',
              { class: 'portrait portrait--sm' },
              initial(author.shortName ?? author.fullName),
            ),
            h(
              'span',
              { class: 'author-tile__text' },
              h(
                'span',
                { class: 'title-md author-tile__name clamp-1' },
                author.shortName ?? author.fullName,
              ),
              h(
                'span',
                { class: 'label-sm muted truncate' },
                author.deathYearHijri
                  ? `ت ${author.deathYearHijri} هـ — ${author.bookCount} كتاب`
                  : `${author.bookCount} كتاب`,
              ),
            ),
            h('span', { class: 'author-tile__chevron' }, icon('arrowLeft', { size: 16 })),
          ),
        ),
      ),
    ),
  );
}
