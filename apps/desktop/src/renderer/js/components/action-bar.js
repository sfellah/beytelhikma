import { h } from '../dom.js';
import { icon } from '../icons.js';

/**
 * Deux actions au plus dans la rangée. La sortie du mode n'en fait pas partie :
 * elle a sa croix, à part.
 */
export const MAX_ACTIONS = 2;

/**
 * Barre d'actions ancrée en pied d'écran, pour un lot d'objets choisis.
 *
 * Elle est **hors du flux**. Posée dans la page, au-dessus des résultats,
 * c'était la mécanique précédente : on cochait au quarantième livre et il
 * fallait remonter tout l'écran pour agir — et sur téléphone elle défilait
 * aussi de côté, si bien que l'action première commençait hors champ. Ancrée,
 * elle est là où le pouce est déjà, quel que soit l'endroit de la liste.
 *
 * Quatre règles la tiennent :
 *
 * - **un libellé d'action ne s'abrège jamais.** S'il ne tient pas, c'est la
 *   barre qui se réorganise : la rangée passe sous le décompte, et les actions
 *   passent l'une sous l'autre. Sur un téléphone de 407 dp, les trois actions
 *   du lot de `/downloads` se lisaient « ت… », « لا… », « إلغاء ال… » — trois
 *   moignons qu'on ne devine pas, et qu'on touche donc pour savoir. C'est la
 *   troisième forme du défaut d'à côté : une action qu'on ne peut pas lire ne
 *   vaut pas mieux qu'une action qu'il faut aller chercher.
 * - **deux actions au plus, jamais de défilement horizontal.** La sortie du
 *   mode ne compte pas : elle est la croix, et la croix se lit sans mot, quand
 *   « télécharger » et « supprimer » ne se devinent pas.
 * - **un refus se lit avant la tape.** Une action désactivée porte sa raison à
 *   la place de son libellé, au lieu d'ouvrir un message une fois touchée.
 * - **le fond ne prend pas le doigt** — `pointer-events: none` sur la boîte,
 *   `auto` sur les seuls boutons. La règle du voile, déjà écrite pour le
 *   lecteur et pour les pastilles du fil.
 *
 * Le patron est celui de `facetPanel` : l'état se reflète en attribut, le nœud
 * se met à jour en place, et rien n'est remplacé.
 */
export function actionBar({ label = '', dismiss = null } = {}) {
  const title = h('span', { class: 'action-bar__count label-md' }, label);
  const row = h('div', { class: 'action-bar__row' });

  let onDismiss = null;
  // La croix est **la sortie du mode**, pas une action sur ce qui est choisi :
  // elle ne se désactive pas, ne porte pas de raison de refus, et sa place ne
  // bouge pas. Elle vient donc avant le décompte, et jamais dans la rangée.
  const close = h(
    'button',
    {
      type: 'button',
      class: 'action-bar__dismiss',
      hidden: true,
      onclick: () => onDismiss?.(),
    },
    icon('close', { size: 20 }),
  );
  const node = h(
    'div',
    { class: 'action-bar', role: 'toolbar', hidden: true },
    h(
      'div',
      { class: 'action-bar__inner' },
      h('div', { class: 'action-bar__head' }, close, title),
      row,
    ),
  );

  /**
   * Pose la croix. Une icône seule ne se lit pas au lecteur d'écran : son
   * libellé est **exigé**, en nom accessible et en infobulle.
   */
  function setDismiss(next) {
    onDismiss = next?.onPick ?? null;
    close.hidden = !next;
    if (!next) return;
    close.setAttribute('aria-label', next.label);
    close.setAttribute('title', next.label);
  }

  setDismiss(dismiss);

  /**
   * Repeint la barre. [actions] est une liste de
   * `{ key, label, reason, icon, variant, disabled, onPick }` — au plus deux.
   * [dismiss] est `{ label, onPick }`, ou `null` pour retirer la croix ;
   * absent, il laisse celle qui est en place.
   *
   * Une action désactivée **reste affichée** : la faire disparaître déplacerait
   * l'autre sous le doigt entre deux tapes.
   */
  function update({ label: nextLabel, actions = [], dismiss: nextDismiss } = {}) {
    if (nextLabel != null) title.textContent = nextLabel;
    if (nextDismiss !== undefined) setDismiss(nextDismiss);
    row.replaceChildren(
      ...actions.slice(0, MAX_ACTIONS).map((action) =>
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
