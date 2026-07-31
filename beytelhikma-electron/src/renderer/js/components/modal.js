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

/**
 * Fiche des raccourcis. Purement informative : elle se ferme au clic dehors,
 * à `Esc` ou par son bouton. Un `toast` ne pouvait pas porter quinze lignes.
 *
 * Renvoie de quoi la refermer : elle est posée sur `body`, un changement de
 * route ne l'emporterait pas — c'est à l'écran qui l'a ouverte de la ranger.
 *
 * `keys` décrit une combinaison (`Ctrl + F`) ; `sep: '/'` marque des touches
 * interchangeables (`Home / End`), qu'un « + » ferait passer pour un accord.
 */
export function shortcutsDialog({ title, shortcuts }) {
  let settle = () => {};

  const onKey = (event) => {
    if (event.key === 'Escape') settle();
  };

  const close = h('button', { class: CLASSES.tonal, onclick: () => settle() }, 'إغلاق');

  const backdrop = h(
    'div',
    {
      class: 'modal',
      onclick: (event) => {
        if (event.target === backdrop) settle();
      },
    },
    h(
      'div',
      { class: 'modal__panel modal__panel--wide', role: 'dialog', 'aria-modal': 'true' },
      h('h3', { class: 'title-md' }, title),
      h(
        'dl',
        { class: 'modal__shortcuts' },
        ...shortcuts.flatMap((entry) => [
          h(
            'dt',
            {},
            ...entry.keys.flatMap((key, position) => [
              position ? h('span', { class: 'modal__key-sep' }, entry.sep ?? '+') : null,
              h('kbd', {}, key),
            ]),
          ),
          h('dd', { class: 'body-md' }, entry.label),
        ]),
      ),
      h('div', { class: 'modal__actions' }, close),
    ),
  );

  settle = () => {
    settle = () => {};
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
  };

  document.addEventListener('keydown', onKey);
  document.body.append(backdrop);
  close.focus();
  return () => settle();
}

/**
 * Saisie d'une note. Résout le texte saisi, `''` si l'utilisateur demande la
 * suppression d'une note existante, ou `null` s'il renonce.
 *
 * `Ctrl+Entrée` enregistre : dans une zone de texte, `Entrée` doit rester un
 * retour à la ligne.
 */
export function noteDialog({ title, quote = null, value = '', canDelete = false } = {}) {
  return new Promise((resolve) => {
    let settle = (result) => {
      settle = () => {};
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
      resolve(result);
    };

    const field = h('textarea', {
      class: 'modal__textarea',
      rows: 5,
      placeholder: 'اكتب ملاحظتك…',
      oninput: () => {
        save.disabled = !field.value.trim();
      },
    });
    field.value = value;

    const onKey = (event) => {
      if (event.key === 'Escape') settle(null);
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && field.value.trim()) {
        settle(field.value.trim());
      }
    };

    const save = h(
      'button',
      {
        class: CLASSES.filled,
        disabled: !value.trim(),
        onclick: () => settle(field.value.trim()),
      },
      'حفظ',
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
        quote && h('blockquote', { class: 'modal__quote body-md' }, quote),
        field,
        h(
          'div',
          { class: 'modal__actions' },
          save,
          canDelete &&
            h('button', { class: CLASSES.danger, onclick: () => settle('') }, 'حذف'),
          h('button', { class: CLASSES.tonal, onclick: () => settle(null) }, 'إلغاء'),
        ),
      ),
    );

    document.addEventListener('keydown', onKey);
    document.body.append(backdrop);
    field.focus();
  });
}
