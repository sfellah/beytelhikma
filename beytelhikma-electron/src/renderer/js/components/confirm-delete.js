import { h } from '../dom.js';

/**
 * Confirmation de suppression. Rendue en HTML, pas via `dialog.showMessageBox`,
 * pour garder la typographie arabe et le sens de lecture de l'application.
 * Résout `'keep'` (garder la progression), `'purge'` (tout effacer) ou `null`.
 */
export function confirmDelete({ title, hasProgress }) {
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

    const primary = h(
      'button',
      { class: 'button button--filled', onclick: () => settle('keep') },
      hasProgress ? 'حذف مع الاحتفاظ بموضع القراءة' : 'حذف',
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
        h('h3', { class: 'title-md' }, `حذف «${title}»؟`),
        h(
          'p',
          { class: 'body-md muted' },
          hasProgress
            ? 'يمكنك حذف الملف مع الاحتفاظ بموضع قراءتك، أو حذف كل شيء نهائيًا.'
            : 'سيُحذف ملف الكتاب من جهازك.',
        ),
        h(
          'div',
          { class: 'modal__actions' },
          primary,
          hasProgress &&
            h(
              'button',
              { class: 'button button--danger', onclick: () => settle('purge') },
              'حذف نهائي',
            ),
          h('button', { class: 'button button--tonal', onclick: () => settle(null) }, 'إلغاء'),
        ),
      ),
    );

    document.addEventListener('keydown', onKey);
    document.body.append(backdrop);
    primary.focus();
  });
}
