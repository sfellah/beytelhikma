import { h } from '../dom.js';
import { icon } from '../icons.js';

/**
 * Barre d'actions ancrée en pied d'écran, pour un lot d'objets choisis.
 *
 * Elle est **hors du flux**. Posée dans la page, au-dessus des résultats,
 * c'était la mécanique précédente : on cochait au quarantième livre et il
 * fallait remonter tout l'écran pour agir — et sur téléphone elle défilait
 * aussi de côté, si bien que l'action première commençait hors champ. Ancrée,
 * elle est là où le pouce est déjà, quel que soit l'endroit de la liste.
 *
 * Trois règles la tiennent :
 *
 * - **trois actions au plus, jamais de défilement horizontal.** Une action
 *   qu'il faut aller chercher n'est pas une action ; c'est le défaut qu'on
 *   corrige.
 * - **un refus se lit avant la tape.** Une action désactivée porte sa raison à
 *   la place de son libellé, au lieu d'ouvrir un message une fois touchée.
 * - **le fond ne prend pas le doigt** — `pointer-events: none` sur la boîte,
 *   `auto` sur les seuls boutons. La règle du voile, déjà écrite pour le
 *   lecteur et pour les pastilles du fil.
 *
 * Le patron est celui de `facetPanel` : l'état se reflète en attribut, le nœud
 * se met à jour en place, et rien n'est remplacé.
 */
export function actionBar({ label = '' } = {}) {
  const title = h('span', { class: 'action-bar__count label-md' }, label);
  const row = h('div', { class: 'action-bar__row' });
  const node = h(
    'div',
    { class: 'action-bar', role: 'toolbar', hidden: true },
    h('div', { class: 'action-bar__inner' }, title, row),
  );

  /**
   * Repeint la barre. [actions] est une liste de
   * `{ key, label, reason, icon, variant, disabled, onPick }` — au plus trois.
   *
   * Une action désactivée **reste affichée** : la faire disparaître déplacerait
   * les deux autres sous le doigt entre deux tapes.
   */
  function update({ label: nextLabel, actions = [] } = {}) {
    if (nextLabel != null) title.textContent = nextLabel;
    row.replaceChildren(
      ...actions.slice(0, 3).map((action) =>
        // Une action peut apporter son propre bouton : `collectionPickerButton`
        // porte tout un flux — choisir, créer, ranger, puis mener à la
        // collection — qu'on ne va pas recopier ici pour l'habiller autrement.
        action.node ??
        h(
          'button',
          {
            type: 'button',
            class: `button button--${action.variant ?? 'tonal'} action-bar__action`,
            'data-action': action.key,
            disabled: Boolean(action.disabled),
            onclick: () => {
              if (action.disabled) return;
              action.onPick?.();
            },
          },
          action.icon ? icon(action.icon, { size: 18 }) : null,
          h('span', {}, action.disabled && action.reason ? action.reason : action.label),
        ),
      ),
    );
  }

  return {
    node,
    update,
    /** Montre ou cache la barre. Cachée, elle ne prend aucune place ni aucun doigt. */
    setVisible(visible) {
      node.hidden = !visible;
    },
    isVisible: () => !node.hidden,
  };
}
