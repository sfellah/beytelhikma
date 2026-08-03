import { LONG_PRESS_MS, longPressAborted, longPressAllowed } from '../../../shared/long-press.js';

/**
 * Pose l'appui long sur [node] et rend de quoi le retirer.
 *
 * La règle vit dans `shared/long-press.js` ; ici il n'y a que le branchement,
 * et les trois refus qu'un vrai doigt impose :
 *
 * - **la souris est exclue** — maintenir le bouton sur une carte y est le début
 *   d'un cliquer-glisser, et le bureau a son bouton d'entrée ;
 * - **le doigt qui bouge annule** — sinon défiler la grille ouvrirait la
 *   sélection à chaque fois qu'on s'attarde ;
 * - **le `click` résiduel est mangé**. Un appui long laisse un `click` derrière
 *   lui : sans cette garde, le geste ouvrirait la sélection puis la carte
 *   décocherait aussitôt ce qu'il vient de cocher. C'est le défaut de `#swiped`
 *   du lecteur, à l'identique.
 *
 * La garde passe par `consumeLongPress(node)`, que l'appelant interroge **en
 * tête** de son propre `click`, et non par un écouteur qui arrêterait la
 * propagation : les écouteurs se déclenchent dans l'ordre où on les pose, et
 * celui de la carte est posé à sa construction, donc avant celui-ci. Il aurait
 * couru le premier, et la garde n'aurait rien gardé.
 *
 * `pointer*` et non `touch*` : le même rendu tourne sous Capacitor.
 */
/** Les nœuds dont le dernier geste était un appui long, en attente de leur ombre. */
const fired = new WeakSet();

/**
 * Le prochain `click` de [node] est-il l'ombre d'un appui long ? Le dire
 * l'efface : une ombre ne se projette qu'une fois.
 */
export function consumeLongPress(node) {
  if (!fired.has(node)) return false;
  fired.delete(node);
  return true;
}

export function onLongPress(node, handler) {
  let timer = null;
  let origin = null;

  const stop = () => {
    clearTimeout(timer);
    timer = null;
    origin = null;
  };

  const onDown = (event) => {
    if (!longPressAllowed(event.pointerType)) return;
    // Un second doigt n'ouvre rien : c'est un pincement ou un défilement à deux
    // doigts, jamais un appui.
    if (event.isPrimary === false) {
      stop();
      return;
    }
    origin = { x: event.clientX ?? 0, y: event.clientY ?? 0 };
    fired.delete(node);
    timer = setTimeout(() => {
      timer = null;
      if (!origin) return;
      fired.add(node);
      handler(event);
    }, LONG_PRESS_MS);
  };

  const onMove = (event) => {
    if (!origin) return;
    if (longPressAborted((event.clientX ?? 0) - origin.x, (event.clientY ?? 0) - origin.y)) stop();
  };

  const onUp = () => stop();

  node.addEventListener('pointerdown', onDown);
  node.addEventListener('pointermove', onMove);
  node.addEventListener('pointerup', onUp);
  node.addEventListener('pointercancel', onUp);
  node.addEventListener('pointerleave', onUp);

  return () => {
    stop();
    fired.delete(node);
    node.removeEventListener('pointerdown', onDown);
    node.removeEventListener('pointermove', onMove);
    node.removeEventListener('pointerup', onUp);
    node.removeEventListener('pointercancel', onUp);
    node.removeEventListener('pointerleave', onUp);
  };
}
