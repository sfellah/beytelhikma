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

/**
 * Chapitres montés d'un coup ; le défilement monte la tranche suivante.
 *
 * Un sommaire du corpus Shamela porte couramment des milliers d'entrées, et le
 * plus gros en compte ~96 000 : les monter toutes coûte autant de nœuds DOM
 * pour une liste qu'on ne parcourt presque jamais jusqu'au bout.
 */
const TOC_WINDOW = 60;

/** Distance au bas de la tranche, en pixels, qui monte la suivante. */
const TOC_EDGE = 160;

function tocSection(entries, openReader) {
  const roots = buildTree(entries);
  const list = h('div', { class: 'toc__list' });
  let shown = 0;

  const grow = () => {
    // Jamais `append(...tableau)` : une tranche est bornée, mais le même geste
    // sert aux sous-entrées, qui ne le sont pas — et autant d'arguments passés
    // d'un coup débordent la pile d'appels.
    const bloc = document.createDocumentFragment();
    for (const node of roots.slice(shown, shown + TOC_WINDOW)) {
      bloc.append(tocChapter(node, openReader));
      shown += 1;
    }
    list.append(bloc);
  };

  /**
   * Le dépliage suit le défilement, comme le panneau du lecteur : arriver au
   * bas de la tranche montée monte la suivante. Un bouton « voir plus » tous
   * les soixante chapitres, ce n'est pas parcourir une liste, c'est la faire
   * avancer à la main — et la boîte n'en montre que cinq à la fois.
   */
  list.addEventListener('scroll', () => {
    if (shown >= roots.length) return;
    if (list.scrollHeight - list.scrollTop - list.clientHeight <= TOC_EDGE) grow();
  });

  /**
   * Une tranche qui ne remplit pas la boîte ne défile pas : rien ne rappellerait
   * le gestionnaire, et la liste s'arrêterait là sans que rien ne le dise. On
   * complète jusqu'à ce qu'il y ait de quoi défiler, dix crans au plus — le
   * sommaire entier n'est pas le but.
   *
   * Après une image, et pas avant : la boîte n'est pas dans le document au
   * montage, ses deux hauteurs y valent zéro, et la comparaison monterait les
   * dix crans pour rien.
   */
  const fill = () => {
    if (!list.isConnected) return;
    for (let i = 0; i < 10 && shown < roots.length; i += 1) {
      if (list.scrollHeight > list.clientHeight) return;
      grow();
    }
  };

  grow();
  requestAnimationFrame(fill);

  return h(
    'section',
    { class: 'toc' },
    h(
      'h3',
      { class: 'title-md' },
      icon('toc', { size: 20 }),
      t('detail.toc'),
      // Le compte vient de l'arbre entier, jamais de la tranche montée : c'est
      // lui qui dit ce que la boîte laisse sous son bord.
      h('span', { class: 'label-sm muted' }, t('detail.chapters', { count: roots.length })),
    ),
    list,
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
        // Un chapitre du corpus peut porter des milliers de sous-entrées :
        // `append(...tableau)` les passerait toutes en arguments, ce qui déborde
        // la pile d'appels. Un fragment les pose en une seule insertion.
        const bloc = document.createDocumentFragment();
        for (const child of node.children) {
          bloc.append(
            h(
              'p',
              { class: 'toc__child', onclick: () => openReader(child.pageId) },
              h('span', {}, child.title),
              h('span', {}, tocPageLabel(child)),
            ),
          );
        }
        children.append(bloc);
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
