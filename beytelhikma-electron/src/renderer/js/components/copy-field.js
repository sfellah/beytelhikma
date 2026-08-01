import { h } from '../dom.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { toast } from '../shell.js';

/**
 * Valeur longue — un chemin de fichier, une URL — présentée sur une seule ligne
 * et copiable.
 *
 * Le texte est un `<input readonly>` plutôt qu'un `<span>` tronqué : il reste
 * sélectionnable et défilable au clavier, alors qu'une ellipse CSS perdrait la
 * fin du chemin sans recours. La direction est forcée en LTR — un chemin
 * Windows lu en RTL affiche ses segments à l'envers, même dans une interface
 * arabe.
 */
export function copyField(value, { label = null } = {}) {
  const text = String(value ?? '');
  const field = h('input', {
    class: 'copy-field__value',
    type: 'text',
    readonly: true,
    dir: 'ltr',
    value: text,
    title: text,
    'aria-label': label ?? t('copy.aria'),
    onfocus: (event) => event.target.select(),
  });

  const button = h(
    'button',
    {
      class: 'button--icon copy-field__button',
      type: 'button',
      title: t('copy.action'),
      'aria-label': t('copy.action'),
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(text);
          toast(t('copy.done'));
        } catch {
          // Le presse-papiers peut être refusé : la sélection reste un recours.
          field.select();
          toast(t('copy.failed'));
        }
      },
    },
    icon('copy', { size: 18 }),
  );

  return h('div', { class: 'copy-field' }, field, button);
}
