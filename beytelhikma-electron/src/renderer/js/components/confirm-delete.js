import { confirmDialog } from './modal.js';

/**
 * Confirmation de suppression. Résout `'keep'` (garder la progression),
 * `'purge'` (tout effacer) ou `null`. Sans progression enregistrée, il n'y a
 * rien à conserver : un seul bouton, pas de choix vide à trancher.
 */
export function confirmDelete({ title, hasProgress }) {
  return confirmDialog({
    title: `حذف «${title}»؟`,
    message: hasProgress
      ? 'يمكنك حذف الملف مع الاحتفاظ بموضع قراءتك، أو حذف كل شيء نهائيًا.'
      : 'سيُحذف ملف الكتاب من جهازك.',
    actions: hasProgress
      ? [
          { value: 'keep', label: 'حذف مع الاحتفاظ بموضع القراءة', variant: 'filled' },
          { value: 'purge', label: 'حذف نهائي', variant: 'danger' },
        ]
      : [{ value: 'keep', label: 'حذف', variant: 'filled' }],
  });
}
