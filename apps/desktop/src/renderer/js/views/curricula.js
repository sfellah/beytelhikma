import { h } from '../dom.js';
import { n } from '../format.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { repository } from '../repository.js';
import { navigate } from '../router.js';
import { renderShell, toast } from '../shell.js';
import { cover } from '../components/cover.js';
import { curriculumCard } from '../components/curriculum-card.js';
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
