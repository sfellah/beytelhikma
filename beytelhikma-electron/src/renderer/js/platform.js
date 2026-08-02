/**
 * Ce que la plateforme permet — et rien d'autre. Pas de réglages ici : un
 * réglage se choisit, ceci se constate.
 */

/**
 * Vrai quand l'écran est tactile et qu'aucune souris ne le survole : un
 * téléphone ou une tablette, pas un portable à écran tactile.
 *
 * Le signal n'est **pas** la largeur. Une fenêtre de bureau réduite à 400 px
 * garde son gestionnaire de fenêtres, sa touche F11 et tout son intérêt pour le
 * plein écran ; la rabattre au même régime qu'un téléphone lui retirerait une
 * fonction qui marche. `hover: none` et `pointer: coarse` réunis ne décrivent
 * qu'un doigt sur du verre, et ils ne changent pas quand on tourne l'appareil.
 */
export function isTouchPrimary() {
  return Boolean(globalThis.matchMedia?.('(hover: none) and (pointer: coarse)')?.matches);
}

/**
 * Le plein écran n'a de sens que là où il ajoute de la place.
 *
 * Sur un téléphone la fenêtre occupe déjà tout l'écran : l'API répond, la
 * promesse est tenue au sens du navigateur, et rien ne bouge — les barres du
 * système restent, la page ne gagne pas un pixel. Un bouton qui ne fait rien
 * est pire qu'un bouton absent, parce qu'on l'essaie deux fois avant de
 * conclure qu'il est cassé.
 *
 * `fullscreenEnabled` est interrogé en plus : il répond faux dans un cadre
 * imbriqué, et c'est la seule façon de le savoir avant d'essayer.
 */
export function canGoFullscreen() {
  return Boolean(globalThis.document?.fullscreenEnabled) && !isTouchPrimary();
}
