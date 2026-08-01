import { t } from '../i18n.js';
import { confirmDialog } from './modal.js';

/**
 * Confirmation de suppression. Résout `'keep'` (garder la progression),
 * `'purge'` (tout effacer) ou `null`. Sans progression enregistrée, il n'y a
 * rien à conserver : un seul bouton, pas de choix vide à trancher.
 */
export function confirmDelete({ title, hasProgress }) {
  return confirmDialog({
    title: t('confirmDelete.title', { title }),
    message: hasProgress
      ? t('confirmDelete.withProgress')
      : t('confirmDelete.withoutProgress'),
    actions: hasProgress
      ? [
          { value: 'keep', label: t('confirmDelete.keep'), variant: 'filled' },
          { value: 'purge', label: t('confirmDelete.purge'), variant: 'danger' },
        ]
      : [{ value: 'keep', label: t('action.delete'), variant: 'filled' }],
  });
}
