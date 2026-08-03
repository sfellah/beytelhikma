import { segmented } from './segmented.js';
import { setSetting } from '../repository.js';
import { t } from '../i18n.js';

/**
 * Un réglage à choix fermé, rendu en contrôle segmenté et écrit tout seul.
 *
 * Il vivait dans `views/settings.js`, en fonction locale. Le panneau du lecteur
 * montre maintenant les mêmes réglages — la façon de lire, les côtés qui
 * tournent la page — et deux écrans qui montrent la même chose sont exactement
 * la configuration qui a produit la police orpheline et l'ambiance morte. La
 * seule parade que ce projet applique : un propriétaire unique.
 *
 * [liste] vient d'un module partagé (`reading-modes.js`, `page-turn.js`) et
 * porte `{ key, label, hint }`. [marque] nomme l'attribut `data-*` que la
 * campagne de captures et les tests suivent : le libellé suit la langue,
 * l'attribut ne bouge pas.
 *
 * [onPick] est appelé **après** l'écriture, pour ce que l'écran doit faire
 * en plus. C'est ce qui permet au lecteur d'appliquer la bascule sur le livre
 * ouvert, sous les yeux, là où `/settings` n'a rien à repeindre.
 */
export function settingChoice({ liste, valeur, label, setting, marque, onPick = null }) {
  const node = segmented({
    ariaLabel: t(label),
    value: valeur,
    options: liste.map((entry) => ({ value: entry.key, label: t(entry.label) })),
    onPick: (key) => {
      setSetting(setting, key);
      onPick?.(key);
    },
  });

  for (const [index, button] of [...node.children].entries()) {
    button.dataset[marque] = liste[index].key;
    // L'indice porte la seconde ligne de l'option : le contrôle segmenté n'a
    // pas de place pour une explication sous le mot.
    button.title = t(liste[index].hint);
  }
  return node;
}
