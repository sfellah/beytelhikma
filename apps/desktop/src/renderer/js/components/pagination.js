import { h } from '../dom.js';
import { n } from '../format.js';
import { t } from '../i18n.js';
import { chevronBackward, chevronForward } from '../icons.js';

/** Tailles de page proposées ; la première est le défaut des vues paginées. */
export const PAGE_SIZES = [25, 50, 100];

/**
 * Barre de pagination.
 *
 * Les chevrons suivent le sens de lecture : en arabe « précédent » pointe à
 * droite, en anglais à gauche. Une paire figée aurait donné, sous interface
 * anglaise, deux flèches qui désignent l'inverse de ce qu'elles font — c'est
 * la direction qui les décide, pas une convention écrite une fois.
 *
 * [onChange] reçoit le nouvel offset ; [onPageSize] est optionnel.
 */
export function pagination({ total, offset, limit, onChange, onPageSize = null }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  const current = Math.min(pages, Math.floor(offset / limit) + 1);
  const step = (delta, chevron, label) =>
    h(
      'button',
      {
        class: 'button--icon',
        title: label,
        'aria-label': label,
        disabled: delta < 0 ? current <= 1 : current >= pages,
        onclick: () => onChange(Math.max(0, (current - 1 + delta) * limit)),
      },
      chevron({ size: 20 }),
    );

  const sizePicker =
    onPageSize &&
    h(
      'label',
      { class: 'pagination__size label-sm' },
      h('span', {}, t('pagination.perPage')),
      h(
        'select',
        { onchange: (event) => onPageSize(Number(event.target.value)) },
        PAGE_SIZES.map((size) =>
          h('option', { value: size, selected: size === limit }, n(size)),
        ),
      ),
    );

  return h(
    'div',
    { class: 'pagination' },
    sizePicker,
    h(
      'div',
      { class: 'pagination__steps' },
      step(-1, chevronBackward, t('pagination.previous')),
      h(
        'span',
        { class: 'label-md' },
        `${n(current)} / ${n(pages)}`,
      ),
      step(1, chevronForward, t('pagination.next')),
    ),
    h('span', { class: 'label-sm muted' }, t('pagination.results', { total })),
  );
}
