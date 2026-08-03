import { h } from '../dom.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { repository } from '../repository.js';
import { navigate } from '../router.js';
import { toast } from '../shell.js';
import { pickCollection } from './collection-picker.js';

/**
 * Bouton « ranger dans une collection », partagé par la fiche livre et le mode
 * sélection de l'exploration. [editionIds] est évalué au clic : la sélection
 * change entre le rendu et l'action.
 *
 * Une fois les livres rangés, **on va voir la collection**. Choisir — et
 * surtout créer — une collection est un geste qu'on fait pour la regarder ; y
 * ranger dix livres puis rester sur la grille d'où l'on vient ne laissait
 * qu'un message d'une seconde comme preuve que quelque chose avait eu lieu, et
 * la collection neuve n'était visible qu'en la cherchant. [goTo] à faux pour
 * les appelants qui rangent sans quitter leur écran.
 */
export function collectionPickerButton(editionIds, { label = null, goTo = true } = {}) {
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
        if (goTo) navigate(`/collection/${encodeURIComponent(collectionId)}`);
      },
    },
    icon('plusSquare', { size: 20 }),
    h('span', {}, text),
  );
}
