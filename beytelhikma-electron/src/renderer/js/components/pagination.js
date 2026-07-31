import { h } from '../dom.js';
import { arabicNumber } from '../format.js';
import { icon } from '../icons.js';

/** Tailles de page proposées ; la première est le défaut des vues paginées. */
export const PAGE_SIZES = [25, 50, 100];

/**
 * Barre de pagination. Sens de lecture arabe : « précédent » pointe à droite,
 * « suivant » à gauche — les chevrons sont donc inversés par rapport au latin.
 *
 * [onChange] reçoit le nouvel offset ; [onPageSize] est optionnel.
 */
export function pagination({ total, offset, limit, onChange, onPageSize = null }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  const current = Math.min(pages, Math.floor(offset / limit) + 1);

  const step = (delta, name, label) =>
    h(
      'button',
      {
        class: 'button--icon',
        title: label,
        'aria-label': label,
        disabled: delta < 0 ? current <= 1 : current >= pages,
        onclick: () => onChange(Math.max(0, (current - 1 + delta) * limit)),
      },
      icon(name, { size: 20 }),
    );

  const sizePicker =
    onPageSize &&
    h(
      'label',
      { class: 'pagination__size label-sm' },
      h('span', {}, 'لكل صفحة'),
      h(
        'select',
        { onchange: (event) => onPageSize(Number(event.target.value)) },
        PAGE_SIZES.map((size) =>
          h('option', { value: size, selected: size === limit }, arabicNumber(size)),
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
      step(-1, 'chevronRight', 'الصفحة السابقة'),
      h(
        'span',
        { class: 'label-md' },
        `${arabicNumber(current)} / ${arabicNumber(pages)}`,
      ),
      step(1, 'chevronLeft', 'الصفحة التالية'),
    ),
    h('span', { class: 'label-sm muted' }, `${arabicNumber(total)} نتيجة`),
  );
}
