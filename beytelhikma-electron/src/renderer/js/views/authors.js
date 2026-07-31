import { h } from '../dom.js';
import { arabicNumber, initial, ordinal } from '../format.js';
import { icon } from '../icons.js';
import { repository } from '../repository.js';
import { renderShell } from '../shell.js';
import { cover } from '../components/cover.js';
import { pagination, PAGE_SIZES } from '../components/pagination.js';
import { reveal, sectionHead } from '../components/section.js';
import { asyncView, emptyView, errorView, loadingView } from '../components/states.js';

/** Tris de l'index : le fonds, l'alphabet, la chronologie. */
const SORTS = [
  { key: 'name', label: 'أبجديًا' },
  { key: 'count', label: 'حسب عدد الكتب' },
  { key: 'death', label: 'حسب سنة الوفاة' },
];

/** Le haut de l'écran ne montre que les plus présents : c'est une vitrine. */
const PROMINENT = 7;

/** Les auteurs du catalogue : le plus présent, les suivants, les siècles, tous. */
export function authorsView(host) {
  const content = renderShell(host, { active: 'authors' });
  asyncView(content, load, render, { empty: 'لا يوجد مؤلف في الفهرس بعد' });
  return null;
}

/**
 * Le haut de l'écran et l'index sont deux lectures différentes du même fonds :
 * la vitrine veut les plus présents, l'index veut l'ordre alphabétique et une
 * page à la fois. Les compteurs, eux, sont comptés en SQL sur tout le fonds —
 * les déduire d'une page donnerait un total faux dès le premier écran.
 */
async function load() {
  const [stats, prominent, eras] = await Promise.all([
    repository.getAuthorStats(),
    repository.getAuthors({ limit: PROMINENT, sort: 'count' }),
    repository.getEras(),
  ]);
  const [lead] = prominent.rows;
  const leadBooks = lead
    ? (await repository.getBooksIn({ scope: 'author', id: lead.authorId, limit: 4 })).rows
    : [];
  return { stats, prominent: prominent.rows, lead, leadBooks, eras };
}

function render({ stats, prominent, lead, leadBooks, eras }) {
  if (!stats.authorCount) return null;
  return reveal(
    h(
      'div',
      { class: 'authors' },
      headerSection(stats),
      leadSection(lead, leadBooks),
      prominentSection(prominent.slice(1)),
      centuriesSection(eras),
      indexSection(),
    ),
  );
}

// ------------------------------------------------------------------ en-tête

function headerSection(stats) {
  const { authorCount, bookCount, firstCentury, lastCentury } = stats;
  return h(
    'section',
    { class: 'authors__header', 'aria-labelledby': 'authors-title', 'data-reveal': 0 },
    h('h1', { class: 'authors__title', id: 'authors-title' }, 'المؤلفون'),
    h(
      'p',
      { class: 'body-lg authors__lede' },
      firstCentury && lastCentury
        ? `${arabicNumber(authorCount)} مؤلفًا، ${arabicNumber(bookCount)} كتابًا،` +
          ` من ${ordinal(firstCentury)} إلى ${ordinal(lastCentury)} الهجري.`
        : `${arabicNumber(authorCount)} مؤلفًا، ${arabicNumber(bookCount)} كتابًا في الفهرس.`,
    ),
  );
}

// --------------------------------------------------------- le plus présent

const century = (author) => Math.floor((author.deathYearHijri - 1) / 100) + 1;

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
      lead.bio && leadBio(lead.bio),
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

/**
 * Les notices du corpus vont de deux lignes à plusieurs milliers de mots. Sans
 * repli, la plus longue poussait à elle seule tout le reste de l'écran — les
 * médaillons, les siècles et l'index — sous la ligne de flottaison.
 */
function leadBio(text) {
  const paragraph = h('p', { class: 'body-md lead-card__bio is-clamped' }, text);
  const toggle = h(
    'button',
    {
      class: 'lead-card__bio-toggle label-md',
      onclick: () => {
        const clamped = paragraph.classList.toggle('is-clamped');
        toggle.textContent = clamped ? 'قراءة الترجمة كاملة' : 'طيّ الترجمة';
      },
    },
    'قراءة الترجمة كاملة',
  );
  return h('div', { class: 'lead-card__bio-wrap' }, paragraph, toggle);
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

/**
 * Le regroupement par siècle de décès est le classement usuel du patrimoine :
 * c'est aussi la seule donnée temporelle du catalogue (`death_year_hijri`).
 * Les décomptes viennent de `getEras`, comptés en SQL — les déduire d'une page
 * d'auteurs ne donnerait le bon chiffre que pour un fonds minuscule.
 */
function centuriesSection(eras) {
  const dated = eras.filter((era) => era.bookCount > 0);
  if (dated.length < 2) return null;

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
      { class: 'layers layers--compact' },
      dated.map((era) =>
        h(
          'li',
          { class: 'layer' },
          h(
            'a',
            { class: 'layer__label', href: `#/era/${era.century}` },
            h('span', { class: 'title-md layer__century' }, ordinal(era.century)),
            h('span', { class: 'label-sm muted' }, `${arabicNumber(era.bookCount)} كتاب`),
          ),
        ),
      ),
    ),
  );
}

// ------------------------------------------------------------------- index

/**
 * L'index complet, une page à la fois. Le corpus Shamela porte plusieurs
 * milliers d'auteurs : les rendre tous d'un coup, c'était autant de nœuds DOM
 * pour un écran qu'on ne lit jamais en entier.
 */
function indexSection() {
  const state = { offset: 0, limit: PAGE_SIZES[0], sort: 'name', text: '' };
  // `body` porte les quatre états ; la grille n'est montée que quand il y a
  // des lignes — un `<div>` d'état n'a rien à faire dans un `<ul>`.
  const body = h('div', { class: 'authors__index' }, loadingView());
  const pager = h('div', { class: 'authors__pager' });
  const subtitle = h('span', {});
  let timer = null;
  let token = 0;

  const refresh = async () => {
    const mine = ++token;
    try {
      const { rows, total } = await repository.getAuthors(state);
      if (mine !== token || !body.isConnected) return;

      subtitle.textContent = state.text
        ? `${arabicNumber(total)} مؤلفًا يطابق « ${state.text} »`
        : `${arabicNumber(total)} مؤلفًا في الفهرس`;

      body.replaceChildren(
        rows.length
          ? h('ul', { class: 'author-grid' }, rows.map(authorTile))
          : emptyView('لا مؤلف بهذا الاسم'),
      );
      pager.replaceChildren(
        total > state.limit
          ? pagination({
              total,
              offset: state.offset,
              limit: state.limit,
              onChange: (offset) => {
                state.offset = offset;
                refresh();
              },
              onPageSize: (limit) => {
                Object.assign(state, { limit, offset: 0 });
                refresh();
              },
            })
          : h('div', {}),
      );
    } catch (error) {
      if (mine !== token) return;
      body.replaceChildren(errorView(error, refresh));
    }
  };

  const search = h('input', {
    type: 'search',
    class: 'authors__search',
    placeholder: 'ابحث عن مؤلف…',
    oninput: (event) => {
      clearTimeout(timer);
      const value = event.target.value;
      timer = setTimeout(() => {
        Object.assign(state, { text: value.trim(), offset: 0 });
        refresh();
      }, 250);
    },
  });

  const sorts = h(
    'div',
    { class: 'segmented' },
    SORTS.map((entry) =>
      h(
        'button',
        {
          class: entry.key === state.sort ? 'is-active' : '',
          onclick: (event) => {
            Object.assign(state, { sort: entry.key, offset: 0 });
            for (const button of sorts.children) button.classList.remove('is-active');
            event.currentTarget.classList.add('is-active');
            refresh();
          },
        },
        entry.label,
      ),
    ),
  );

  refresh();

  return h(
    'section',
    {
      class: 'section-block',
      'aria-labelledby': 'index-title',
      'data-reveal': 4,
    },
    sectionHead('index-title', 'كل المؤلفين', subtitle),
    h(
      'div',
      { class: 'authors__toolbar' },
      sorts,
      h('div', { class: 'authors__search-box' }, icon('search', { size: 18 }), search),
    ),
    body,
    pager,
  );
}

function authorTile(author) {
  return h(
    'li',
    {},
    h(
      'a',
      { class: 'author-tile', href: `#/author/${author.authorId}` },
      h('span', { class: 'portrait portrait--sm' }, initial(author.shortName ?? author.fullName)),
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
  );
}
