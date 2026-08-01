import { h } from '../dom.js';
import { n } from '../format.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { repository } from '../repository.js';
import { navigate } from '../router.js';
import { renderShell, toast } from '../shell.js';
import { coverStyle } from '../../../shared/book-cover.js';
import { cover } from '../components/cover.js';
import { asyncView, emptyView } from '../components/states.js';

/** Un cursus se nomme par sa clé : les libellés vivent dans les catalogues. */
const label = (id, part) => t(`curriculum.${id}.${part}`);

const percentLabel = (value) => t('format.percent', { value: Math.round(value * 100) });

/** Liste des cursus, avec l'avancement de chacun. */
export function curriculaView(host) {
  const content = renderShell(host, { active: 'curricula' });
  asyncView(content, () => repository.getCurricula(), render, {
    empty: t('curricula.empty'),
  });
  return null;

  function render(curricula) {
    if (!curricula.length) return emptyView(t('curricula.empty'));
    return h(
      'section',
      { class: 'curricula' },
      h(
        'div',
        { class: 'section-header' },
        h(
          'div',
          {},
          h('h1', { class: 'display-lg' }, t('curricula.title')),
          h('p', { class: 'body-md muted' }, t('curricula.subtitle')),
        ),
      ),
      h('div', { class: 'curricula__grid' }, curricula.map(curriculumCard)),
    );
  }
}

function curriculumCard(curriculum) {
  return h(
    'article',
    {
      class: 'curriculum-card',
      onclick: () => navigate(`/curriculum/${curriculum.id}`),
    },
    shelf(curriculum),
    h(
      'div',
      { class: 'curriculum-card__text' },
      h('h3', { class: 'title-md' }, label(curriculum.id, 'name')),
      h('p', { class: 'body-md muted clamp-1' }, label(curriculum.id, 'hint')),
      progressLine(curriculum),
    ),
  );
}

/* --------------------------------------------------------------- le rayon */

/**
 * Épaisseur et hauteur d'une tranche, en pixels. Un cursus mêle des métons de
 * trente pages et des sommes de huit mille : sans plancher ni plafond, le
 * premier serait un trait invisible et le second mangerait le rayon.
 */
const SPINE_MIN_WIDTH = 8;
const SPINE_MAX_WIDTH = 24;
/* La hauteur varie peu : des livres rangés ont des formats voisins. Une
   amplitude large redonnait un histogramme, où l'épaisseur ne se voyait plus. */
const SPINE_MIN_HEIGHT = 82;
const SPINE_MAX_HEIGHT = 106;
/** Largeur à partir de laquelle une tranche peut porter un fleuron. */
const SPINE_ORNATE_WIDTH = 15;
/** Au-delà, l'échelle est plate : c'est « une somme », le chiffre exact ne se voit plus. */
const SPINE_FULL_PAGES = 2000;

/** Racine, pas rapport brut : sinon un méton de 30 pages tombe sous son plancher. */
const spineScale = (pages) => Math.sqrt(Math.min(Number(pages) || 0, SPINE_FULL_PAGES) / SPINE_FULL_PAGES);

const between = (min, max, ratio) => Math.round(min + (max - min) * ratio);

/**
 * Les livres du cursus rangés debout, dans l'ordre, comme sur une étagère —
 * l'épaisseur dit le volume, la teinte vient de la discipline, la dorure du
 * siècle. Ce sont les trois canaux de `shared/book-cover.js`, vus par la
 * tranche : un cursus se reconnaît à sa silhouette avant de se lire.
 */
function shelf(curriculum) {
  return h(
    'div',
    { class: 'shelf' },
    h(
      'div',
      { class: 'shelf__books' },
      curriculum.steps.map(({ book, percent }) => {
        const style = coverStyle(book);
        const ratio = spineScale(book.pageCount);
        const width = between(SPINE_MIN_WIDTH, SPINE_MAX_WIDTH, ratio);
        return h('span', {
          class: [
            'shelf__spine',
            // Le fleuron ne se pose que sur une tranche assez large pour le
            // porter : sous quinze pixels il devient une tache.
            width >= SPINE_ORNATE_WIDTH ? 'shelf__spine--ornate' : null,
            percent >= 1 ? 'is-done' : null,
          ]
            .filter(Boolean)
            .join(' '),
          title: book.title,
          style: {
            width: `${width}px`,
            height: `${between(SPINE_MIN_HEIGHT, SPINE_MAX_HEIGHT, ratio)}px`,
            '--cover-from': style.from,
            '--cover-to': style.to,
            '--cover-gilt': `rgb(217 184 113 / ${(style.gilt * 100).toFixed(1)}%)`,
          },
        });
      }),
    ),
  );
}

/**
 * L'avancement porte sur les étapes **retenues**, et `missing` dit à part
 * combien le catalogue installé ne connaît pas : un cursus amputé qui
 * afficherait « 4 sur 4 » se donnerait pour fini alors qu'il manque deux
 * livres.
 */
function progressLine(curriculum) {
  return h(
    'div',
    { class: 'curriculum-card__progress' },
    h(
      'div',
      { class: 'progress' },
      h('span', { style: { width: `${Math.round(curriculum.percent * 100)}%` } }),
    ),
    h(
      'p',
      { class: 'label-sm muted' },
      t('curricula.progress', { done: curriculum.done, total: curriculum.resolved }),
      curriculum.missing > 0 &&
        h('span', { class: 'curriculum-card__missing' }, t('curricula.missing', { count: curriculum.missing })),
    ),
  );
}

/** Un cursus : ses étapes dans l'ordre, chacune avec son avancement. */
export function curriculumDetailView(host, params) {
  const content = renderShell(host, { active: 'curricula' });
  const refresh = () =>
    asyncView(content, () => repository.getCurriculum(params.id), render);
  refresh();
  return null;

  function render(curriculum) {
    if (!curriculum.steps.length) return emptyView(t('curricula.empty'));
    const missingIds = curriculum.steps
      .filter((step) => step.book.downloadStatus !== 'installed')
      .map((step) => step.book.editionId);

    return h(
      'section',
      { class: 'curriculum' },
      h(
        'div',
        { class: 'section-header' },
        h(
          'div',
          {},
          h('h1', { class: 'display-lg' }, label(curriculum.id, 'name')),
          h('p', { class: 'body-md muted' }, label(curriculum.id, 'hint')),
          h(
            'p',
            { class: 'label-sm muted' },
            t('curricula.progress', { done: curriculum.done, total: curriculum.resolved }),
            curriculum.missing > 0 &&
              h(
                'span',
                { class: 'curriculum-card__missing' },
                t('curricula.missing', { count: curriculum.missing }),
              ),
          ),
        ),
        missingIds.length > 0 &&
          h(
            'button',
            {
              class: 'button button--filled',
              onclick: async () => {
                await repository.downloadSelection(missingIds);
                toast(t('collections.queued', { count: missingIds.length }));
                refresh();
              },
            },
            icon('download', { size: 18 }),
            h('span', {}, t('curricula.downloadRest', { count: missingIds.length })),
          ),
      ),
      h('ol', { class: 'curriculum__steps' }, curriculum.steps.map(step)),
    );
  }
}

function step({ position, book, percent }) {
  const installed = book.downloadStatus === 'installed';
  const done = percent >= 1;
  return h(
    'li',
    { class: `curriculum-step${done ? ' is-done' : ''}` },
    h(
      'span',
      { class: 'curriculum-step__rank label-sm' },
      done ? icon('check', { size: 16 }) : n(position),
    ),
    h(
      'div',
      { class: 'curriculum-step__cover', onclick: () => navigate(`/book/${book.editionId}`) },
      cover(book),
    ),
    h(
      'div',
      { class: 'curriculum-step__text' },
      h(
        'a',
        { class: 'title-md', href: `#/book/${book.editionId}` },
        book.title,
      ),
      book.authorName && h('p', { class: 'label-sm muted' }, book.authorName),
      h(
        'p',
        { class: 'label-sm muted' },
        [
          book.pageCount ? t('detail.pages', { count: book.pageCount }) : null,
          percent > 0 ? percentLabel(percent) : null,
        ]
          .filter(Boolean)
          .join(' · '),
      ),
      percent > 0 &&
        h(
          'div',
          { class: 'progress' },
          h('span', { style: { width: `${Math.round(percent * 100)}%` } }),
        ),
    ),
    h(
      'button',
      {
        class: `button ${installed ? 'button--filled' : 'button--tonal'}`,
        onclick: (event) => {
          event.stopPropagation();
          // Un livre non installé mène à sa fiche : c'est là que le
          // téléchargement s'explique — taille, éditeur, sommaire.
          navigate(installed ? `/reader/${book.editionId}` : `/book/${book.editionId}`);
        },
      },
      installed ? t('curricula.read') : t('curricula.get'),
    ),
  );
}
