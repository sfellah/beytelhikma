import { h } from '../dom.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { repository } from '../repository.js';
import { toast } from '../shell.js';
import { pickCollection } from './collection-picker.js';

/**
 * Bouton « ranger dans une collection », partagé par la fiche livre et le mode
 * sélection de l'exploration. [editionIds] est évalué au clic : la sélection
 * change entre le rendu et l'action.
 */
export function collectionPickerButton(editionIds, { label = null } = {}) {
  const text = label ?? t('collection.add');
  return h(
    'button',
    {
      class: 'button button--tonal',
      onclick: async () => {
        const ids = typeof editionIds === 'function' ? editionIds() : editionIds;
        if (!ids.length) return;
        const collectionId = await pickCollection();
        if (!collectionId) return;
        const added = await repository.addToCollection(collectionId, ids);
        toast(added ? t('collection.added', { count: added }) : t('collection.alreadyIn'));
      },
    },
    icon('plusSquare', { size: 20 }),
    h('span', {}, text),
  );
}
