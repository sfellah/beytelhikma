import { h } from '../dom.js';
import { initial, n } from '../format.js';
import { t } from '../i18n.js';
import { arrowBackward, chevronForward, icon } from '../icons.js';
import { repository } from '../repository.js';
import { navigate } from '../router.js';
import { renderShell } from '../shell.js';
import { bookCard } from '../components/book-card.js';
import { collectionPickerButton } from '../components/collection-button.js';
import { confirmDelete } from '../components/confirm-delete.js';
import { cover } from '../components/cover.js';
import { downloadAction } from '../components/download-action.js';
import { asyncView } from '../components/states.js';

/** Fiche livre : métadonnées présentes, volumes, sommaire hiérarchique. */
export function bookDetailView(host, params) {
  const content = renderShell(host, { active: 'library' });
  asyncView(content, () => load(params.id), render);
  return null;
}

async function load(editionId) {
  const detail = await repository.getBookDetail(editionId);
  const [toc, progress, related] = await Promise.all([
    repository.getToc(editionId).catch(() => []),
    repository.getProgress(editionId),
    repository.getRelatedBooks(editionId),
  ]);
  return { detail, toc, progress, related };
}

function render({ detail, toc, progress, related }) {
  const book = detail.summary;
  const author = detail.authors[0];
  const openReader = (pageId = null) =>
    navigate(`/reader/${book.editionId}${pageId ? `?page=${pageId}` : ''}`);

  return h(
    'div',
    { class: 'detail-page' },
    breadcrumb(book),
    h(
      'div',
      { class: 'detail' },
      h(
        'aside',
        { class: 'detail__aside' },
        h('div', { class: 'detail__cover' }, cover(book, { showText: true })),
        h(
          'div',
          { class: 'detail__actions' },
          downloadAction({
            book,
            download: detail.download,
            progress,
            onOpen: () => openReader(progress?.pageId ?? null),
            onDelete: async () => {
              const choice = await confirmDelete({
                title: book.title,
                hasProgress: Boolean(progress),
              });
              if (!choice) return;
              await repository.deleteBook(book.editionId, { keepProgress: choice === 'keep' });
              navigate(`/book/${book.editionId}`);
            },
          }),
          collectionPickerButton([book.editionId]),
          progress &&
            h(
              'div',
              { class: 'progress' },
              h('span', { style: { width: `${Math.round(progress.percent * 100)}%` } }),
            ),
        ),
      ),
      h(
        'div',
        { class: 'detail__main' },
        h(
          'div',
          {},
          tags(book, detail),
          h('h1', { class: 'display-lg detail__title' }, book.title),
          book.subtitle && h('p', { class: 'body-lg muted' }, book.subtitle),
          author && authorBadge(author),
        ),
        detail.bibliographyText &&
          h(
            'div',
            { class: 'detail__synopsis body-lg' },
            detail.bibliographyText
              .split('\n')
              .filter(Boolean)
              .map((paragraph) => h('p', {}, paragraph)),
          ),
        metadata(detail),
        toc.length > 0 && tocSection(toc, openReader),
      ),
    ),
    relatedSections(related, detail),
  );
}

function breadcrumb(book) {
  return h(
    'div',
    { class: 'breadcrumb label-sm' },
    h(
      'button',
      { onclick: () => navigate('/library') },
      arrowBackward({ size: 18 }),
      t('detail.backToLibrary'),
    ),
    book.categoryLabel &&
      h('span', { class: 'muted' }, '/'),
    book.categoryLabel &&
      h(
        'a',
        { href: `#/category/${book.categoryId}` },
        book.categoryLabel,
      ),
    h('span', { class: 'muted' }, '/'),
    h('span', { class: 'breadcrumb__current' }, book.title),
  );
}

function tags(book, detail) {
  const labels = [
    book.categoryLabel,
    detail.bookTypeLabel,
    detail.volumes.length > 1 ? t('detail.volumes', { count: detail.volumes.length }) : null,
  ].filter(Boolean);
  if (!labels.length) return null;
  return h(
    'div',
    { class: 'detail__tags' },
    labels.map((label, index) =>
      h('span', { class: index === 0 ? 'chip' : 'chip chip--muted' }, label),
    ),
  );
}

function authorBadge(author) {
  return h(
    'div',
    { class: 'detail__author', style: { marginTop: 'var(--space-lg)' } },
    h('div', { class: 'detail__author-portrait' }, initial(author.shortName ?? author.fullName)),
    h(
      'div',
      {},
      h('p', { class: 'title-md' }, author.fullName),
      h(
        'p',
        { class: 'label-sm muted' },
        author.deathYearHijri
          ? t('detail.authorDied', { year: author.deathYearHijri })
          : t('detail.author'),
      ),
    ),
    h(
      'a',
      { class: 'detail__author-link', href: `#/author/${author.authorId}` },
      t('detail.otherWorks'),
    ),
  );
}

function metadata(detail) {
  const rows = [
    [t('detail.publisher'), detail.publisher],
    [t('detail.edition'), detail.editionLabel],
    [t('detail.year'), detail.publicationYear],
    [t('detail.pageCount'), detail.pageCount ? t('detail.pages', { count: detail.pageCount }) : null],
    [t('detail.volumeCount'), detail.volumes.length > 1 ? n(detail.volumes.length) : null],
    [t('detail.language'), detail.summary.language === 'ar' ? t('detail.arabic') : detail.summary.language],
  ].filter(([, value]) => value != null && value !== '');

  if (!rows.length) return null;
  return h(
    'dl',
    { class: 'meta-grid' },
    rows.map(([label, value]) => h('div', {}, h('dt', {}, label), h('dd', {}, String(value)))),
  );
}

// -------------------------------------------------------------- sommaire

/** Reconstruit l'arbre du sommaire à partir de `parentTocId`. */
function buildTree(entries) {
  const byId = new Map(entries.map((entry) => [entry.tocId, { ...entry, children: [] }]));
  const roots = [];
  for (const node of byId.values()) {
    const parent = node.parentTocId != null ? byId.get(node.parentTocId) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/**
 * Ce qu'un sommaire affiche d'une entrée : le numéro imprimé, et à défaut le
 * rang de la page dans le livre. Jamais `pageId` — c'est l'identifiant source,
 * global au corpus, il ne veut rien dire pour un lecteur.
 */
const tocPageLabel = (node) => {
  const printed = node.printedPageNum ?? node.pageSequenceNum;
  return printed == null ? '' : t('detail.page', { page: printed });
};

/** Chapitres montés d'un coup ; au-delà, on déplie à la demande. */
const TOC_WINDOW = 60;

function tocSection(entries, openReader) {
  const roots = buildTree(entries);
  const list = h('div', { class: 'toc__list' });
  const more = h('div', { class: 'toc__more' });
  let shown = 0;

  // Un sommaire du corpus Shamela peut porter des milliers d'entrées : les
  // monter toutes coûtait autant de nœuds DOM pour une liste qu'on parcourt
  // rarement jusqu'au bout.
  const grow = () => {
    const next = roots.slice(shown, shown + TOC_WINDOW);
    list.append(...next.map((node) => tocChapter(node, openReader)));
    shown += next.length;
    more.replaceChildren(
      shown < roots.length
        ? h(
            'button',
            { class: 'button button--tonal', onclick: grow },
            h(
              'span',
              {},
              t('detail.showMore', { count: roots.length - shown }),
            ),
          )
        : h('span', {}),
    );
  };
  grow();

  return h(
    'section',
    { class: 'toc' },
    h(
      'h3',
      { class: 'title-md' },
      icon('toc', { size: 20 }),
      t('detail.toc'),
      h('span', { class: 'label-sm muted' }, t('detail.chapters', { count: roots.length })),
    ),
    list,
    more,
  );
}

/**
 * Un chapitre du sommaire. Les sous-entrées ne sont montées qu'à l'ouverture
 * du `<details>` : un chapitre replié n'a pas à peser dans le document.
 */
function tocChapter(node, openReader) {
  if (!node.children.length) {
    return h(
      'div',
      { class: 'toc__chapter' },
      h(
        'div',
        {
          class: 'toc__child',
          style: { padding: 'var(--space-md)' },
          onclick: () => openReader(node.pageId),
        },
        h('span', { class: 'label-md' }, node.title),
        h('span', { class: 'label-sm muted' }, tocPageLabel(node)),
      ),
    );
  }

  const children = h('div', { class: 'toc__children' });
  const details = h(
    'details',
    {
      class: 'toc__chapter',
      ontoggle: () => {
        if (!details.open || children.childElementCount) return;
        children.append(
          ...node.children.map((child) =>
            h(
              'p',
              { class: 'toc__child', onclick: () => openReader(child.pageId) },
              h('span', {}, child.title),
              h('span', {}, tocPageLabel(child)),
            ),
          ),
        );
      },
    },
    h(
      'summary',
      {},
      h(
        'span',
        { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
        chevronForward({ size: 18, className: 'icon--chevron' }),
        node.title,
      ),
      h(
        'span',
        {
          class: 'label-sm muted',
          title: t('detail.openPage'),
          onclick: (event) => {
            // Sans cela, le clic replierait aussi le chapitre.
            event.preventDefault();
            event.stopPropagation();
            openReader(node.pageId);
          },
        },
        tocPageLabel(node),
      ),
    ),
    children,
  );
  return details;
}

// ------------------------------------------------------- livres en relation

/**
 * Les bandes vont de la relation certaine au simple voisinage, et une bande
 * vide n'est pas dessinée. Sur le corpus publié, `same_group` ne concerne que
 * 7 % des livres et `part_of` 1 % : sans les deux dernières bandes, la section
 * serait absente de neuf fiches sur dix.
 */
function relatedSections(related, detail) {
  const authorId = detail.authors[0]?.authorId ?? null;
  const bands = [
    {
      band: related.editions,
      title: t('detail.relatedEditions'),
      hint: t('detail.relatedEditionsHint'),
      // La pastille dit le lien qui a fait venir la carte. L'intitulé de la
      // bande le dit aussi, mais une carte se lit seule : dans un défilement
      // horizontal, l'intitulé est déjà sorti de l'écran.
      tag: t('detail.tagEdition'),
      // Le titre d'une autre édition est le même : ce qui la distingue est sa
      // taille et son tirage, c'est donc cela qu'on écrit sous la carte.
      caption: editionCaption,
    },
    {
      band: related.partOf,
      title: t('detail.relatedPartOf'),
      hint: t('detail.relatedPartOfHint'),
      tag: t('detail.tagPartOf'),
    },
    {
      band: related.contains,
      title: t('detail.relatedContains'),
      hint: t('detail.relatedContainsHint'),
      tag: t('detail.tagContains'),
    },
    {
      band: related.sameAuthor,
      title: t('detail.relatedAuthor'),
      hint: t('detail.relatedAuthorHint'),
      tag: t('detail.tagAuthor'),
      href: authorId ? `#/author/${authorId}` : null,
    },
    {
      band: related.sameCategory,
      title: t('detail.related'),
      hint: t('detail.relatedHint'),
      tag: t('detail.tagCategory'),
      href: related.sameCategory.categoryId != null
        ? `#/category/${related.sameCategory.categoryId}`
        : null,
    },
  ].filter((entry) => entry.band?.rows?.length);

  if (!bands.length) return null;
  return h('div', { class: 'detail__relations' }, bands.map(relatedBand));
}

const editionCaption = (book) =>
  [
    book.pageCount ? t('detail.pages', { count: book.pageCount }) : null,
    book.volumeCount > 1 ? t('detail.volumes', { count: book.volumeCount }) : null,
  ]
    .filter(Boolean)
    .join(' · ');

function relatedBand({ band, title, hint, href, caption, tag }) {
  // `total` vient du dépôt, pas de `rows.length` : la bande n'affiche qu'une
  // tranche et doit dire combien elle laisse de côté.
  const rest = band.total - band.rows.length;
  return h(
    'section',
    { class: 'detail__related' },
    h(
      'div',
      { class: 'section-header' },
      h(
        'div',
        {},
        h('h2', { class: 'headline-lg' }, title),
        h('p', { class: 'body-md' }, hint),
      ),
      href &&
        rest > 0 &&
        h('a', { class: 'link-action label-md', href }, t('detail.seeAll', { count: band.total })),
    ),
    h(
      'div',
      { class: 'scroller no-scrollbar' },
      band.rows.map((book) =>
        bookCard(book, {
          action: 'open',
          badge: tag,
          caption: caption ? caption(book) : null,
        }),
      ),
    ),
  );
}
