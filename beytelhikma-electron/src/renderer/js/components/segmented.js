import { h } from '../dom.js';
import { icon } from '../icons.js';

/**
 * Contrôle segmenté : un cadre, N choix, un seul actif.
 *
 * Les réglages posaient jusqu'ici trois `button--tonal` flottants côte à côte.
 * Rien ne disait qu'ils formaient un ensemble ni qu'un seul pouvait valoir à la
 * fois — le cadre commun le dit, et la coche le confirme.
 *
 * [options] : `{ value, label, preview? }`. `preview` est un nœud rendu sous le
 * libellé — c'est ce qui permet à une police de se montrer dans sa propre
 * face, seule façon honnête de la choisir.
 */
export function segmented({ options, value, onPick, ariaLabel = null }) {
  const buttons = options.map((option) =>
    h(
      'button',
      {
        type: 'button',
        class: `segmented__item${option.value === value ? ' is-active' : ''}`,
        role: 'radio',
        'aria-checked': option.value === value ? 'true' : 'false',
        onclick: () => {
          buttons.forEach((button, index) => {
            const active = options[index].value === option.value;
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-checked', active ? 'true' : 'false');
          });
          onPick(option.value);
        },
      },
      h(
        'span',
        { class: 'segmented__text' },
        h('span', { class: 'segmented__label' }, option.label),
        option.preview ?? null,
      ),
      h('span', { class: 'segmented__check' }, icon('check', { size: 16 })),
    ),
  );

  return h(
    'div',
    { class: 'segmented', role: 'radiogroup', 'aria-label': ariaLabel },
    buttons,
  );
}
