/**
 * L'intention de revenir en arrière — celle qui vient du **système**, pas du
 * clavier.
 *
 * Sur Android il n'y a pas de croix : il y a un geste depuis le bord de l'écran,
 * et c'est de loin le geste le plus fait de l'appareil. Sans personne pour
 * l'écouter, il retombe sur le défaut de la WebView — `history.back()` — et
 * quitte donc le livre alors qu'un panneau est ouvert par-dessus. Le geste ne
 * ferme pas la couche qu'on voit ; il emporte l'écran entier.
 *
 * La règle est celle de tous les lecteurs : **une couche à la fois**, la plus
 * haute d'abord. C'est exactement ce que fait déjà `Escape` dans le lecteur ;
 * il ne manquait qu'une seconde porte vers la même cascade.
 *
 * ## Pourquoi un évènement et non un import
 *
 * Le rendu est partagé, et le seul fichier qui diffère sous Capacitor est
 * `js/repository.js`. Le module qui écoute le bouton natif vit donc dans
 * `apps/mobile/src/repo/`, un arbre où `../back-intent.js` ne désigne rien —
 * c'est le même obstacle qui a déjà fait charger `shared/arabic.js` par URL
 * calculée.
 *
 * Un évènement `document` supprime l'obstacle au lieu de le contourner, et il
 * reprend la convention que le projet a déjà retenue pour `Ctrl+F` : **le
 * premier à répondre appelle `preventDefault()`**, et celui qui a émis lit le
 * refus dans la valeur que rend `dispatchEvent`. Aucun côté n'importe l'autre.
 */

/** Le nom de l'évènement, cité des deux côtés du portage et nulle part ailleurs. */
export const BACK_INTENT = 'beyt:back';

/**
 * Les gestionnaires inscrits, du plus ancien au plus récent. On les interroge à
 * l'envers : la couche ouverte en dernier est celle qu'on voit, donc celle que
 * le geste vise.
 */
const handlers = [];

/**
 * Inscrit [handler] et rend de quoi le retirer.
 *
 * [handler] rend `true` s'il a **consommé** le geste — il a fermé quelque
 * chose, il n'y a rien d'autre à faire. Toute autre valeur laisse passer au
 * gestionnaire suivant, puis au comportement par défaut de la plateforme.
 */
export function pushBackHandler(handler) {
  handlers.push(handler);
  return () => {
    const at = handlers.indexOf(handler);
    if (at !== -1) handlers.splice(at, 1);
  };
}

/**
 * Fait descendre l'intention dans la pile. Rend `true` dès qu'une couche s'est
 * fermée.
 *
 * Un gestionnaire qui lève ne bloque pas le geste : on le tient pour n'ayant
 * rien consommé et on continue. Sans cela, une exception dans un panneau
 * rendrait le retour matériel inerte — l'application paraîtrait figée alors
 * qu'elle ne l'est pas.
 */
export function runBackIntent() {
  for (let at = handlers.length - 1; at >= 0; at -= 1) {
    try {
      if (handlers[at]() === true) return true;
    } catch {
      // rien : la couche suivante a sa chance
    }
  }
  return false;
}

/**
 * Le seul écouteur du module. Il est posé au chargement, et ne coûte rien là où
 * personne n'émet — sous Electron, aucun code ne dispatche `beyt:back`.
 */
if (globalThis.document?.addEventListener) {
  globalThis.document.addEventListener(BACK_INTENT, (event) => {
    if (runBackIntent()) event.preventDefault();
  });
}
