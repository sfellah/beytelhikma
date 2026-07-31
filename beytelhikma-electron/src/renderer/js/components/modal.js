import { h } from '../dom.js';

const CLASSES = {
  filled: 'button button--filled',
  danger: 'button button--danger',
  tonal: 'button button--tonal',
};

/**
 * Confirmation générique. Rendue en HTML, pas via `dialog.showMessageBox`, pour
 * garder la typographie arabe et le sens de lecture de l'application.
 * Résout la `value` de l'action choisie, ou `null` si l'utilisateur renonce.
 */
export function confirmDialog({ title, message, actions }) {
  return new Promise((resolve) => {
    let settle = (value) => {
      settle = () => {}; // une seule issue, quel que soit le chemin
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
      resolve(value);
    };

    const onKey = (event) => {
      if (event.key === 'Escape') settle(null);
    };

    const buttons = actions.map((action) =>
      h(
        'button',
        {
          class: CLASSES[action.variant] ?? CLASSES.tonal,
          onclick: () => settle(action.value),
        },
        action.label,
      ),
    );

    const backdrop = h(
      'div',
      {
        class: 'modal',
        onclick: (event) => {
          if (event.target === backdrop) settle(null);
        },
      },
      h(
        'div',
        { class: 'modal__panel', role: 'dialog', 'aria-modal': 'true' },
        h('h3', { class: 'title-md' }, title),
        message && h('p', { class: 'body-md muted' }, message),
        h(
          'div',
          { class: 'modal__actions' },
          buttons,
          h('button', { class: CLASSES.tonal, onclick: () => settle(null) }, 'إلغاء'),
        ),
      ),
    );

    document.addEventListener('keydown', onKey);
    document.body.append(backdrop);
    buttons[0]?.focus();
  });
}
