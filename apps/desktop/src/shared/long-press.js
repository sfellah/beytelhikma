/**
 * Ce qui fait qu'un appui devient un appui **long**.
 *
 * Deux seuils et une règle, purs et ici — pas trois nombres écrits dans un
 * gestionnaire d'évènements. C'est la convention de `page-turn.js`, et elle vaut
 * pour la même raison : un geste ne se vérifie qu'en le mesurant, et le mesurer
 * demande sinon un DOM, un doigt et de la patience.
 *
 * Le geste sert à entrer dans la sélection multiple sans qu'un bouton ait à
 * rester à l'écran en permanence. Il n'est offert **qu'au doigt et au stylet** :
 * à la souris, maintenir le bouton enfoncé sur une carte est le début d'un
 * cliquer-glisser, et la souris a déjà son bouton d'entrée.
 */

/**
 * Combien de temps le doigt doit rester posé. 500 ms est la valeur d'Android
 * (`ViewConfiguration.getLongPressTimeout`) : plus court, une tape hésitante
 * ouvrirait la sélection ; plus long, on croit que rien ne répond.
 */
export const LONG_PRESS_MS = 500;

/**
 * De combien le doigt peut bouger sans que l'appui cesse d'être un appui. Un
 * doigt posé n'est jamais parfaitement immobile — à zéro, le geste ne se
 * déclencherait jamais sur du verre.
 */
export const MOVE_TOLERANCE = 10;

/**
 * Le déplacement [dx], [dy] annule-t-il l'appui en cours ?
 *
 * La comparaison porte sur la **distance**, pas sur chaque axe pris à part :
 * huit pixels dans chaque direction font onze pixels de trajet, et deux tests
 * séparés les laisseraient passer.
 */
export function longPressAborted(dx, dy) {
  const x = Number(dx);
  const y = Number(dy);
  // Une mesure absente n'est pas une mesure nulle : sans point de départ, on ne
  // peut rien affirmer, et laisser courir l'appui vaut mieux que l'annuler.
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  return Math.hypot(x, y) > MOVE_TOLERANCE;
}

/**
 * Ce type de pointeur ouvre-t-il la sélection par appui long ?
 *
 * `pointerType` est vide sur les évènements bouchonnés et sur les navigateurs
 * qui ne le renseignent pas : on tient alors l'appui pour tactile, puisque
 * c'est le seul cas où le geste a une raison d'exister.
 */
export function longPressAllowed(pointerType) {
  return pointerType !== 'mouse';
}
