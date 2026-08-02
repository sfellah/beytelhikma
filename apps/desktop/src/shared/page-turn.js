/**
 * Ce qui décide qu'un geste tourne la page, et dans quel sens.
 *
 * Deux règles, deux fonctions pures — pas deux `if` enfouis dans un
 * gestionnaire d'évènements. Elles portent toutes les deux la même question :
 * **de quel côté va-t-on ?**, et la réponse dépend du sens d'écriture de
 * l'interface. Écrite en dur, elle ferait reculer le côté qui avance dès que
 * l'on bascule en anglais — la panne des flèches figées, rejouée au doigt.
 *
 * Pures et ici : c'est la seule façon de les vérifier dans les **deux**
 * directions. Enfermées dans le lecteur, elles auraient demandé un DOM, une
 * fenêtre et une locale pour qu'on puisse en douter.
 */

/**
 * Part de la colonne, à chaque bord, qui tourne la page au clic. Le reste — le
 * tiers du milieu — garde le geste qu'il avait : escamoter les barres, ou
 * refermer un panneau ouvert.
 */
export const TURN_ZONE = 1 / 3;

/** Distance minimale d'un glissement, en pixels, pour qu'il compte. */
export const SWIPE_MIN = 60;

/**
 * Combien de fois plus horizontal que vertical un glissement doit être. En
 * dessous, c'est un défilement **dans** la page : une page imprimée dépasse
 * souvent la hauteur de l'écran, ce geste-là doit rester libre.
 */
export const SWIPE_RATIO = 1.2;

/**
 * Le tiers de la colonne où tombe un clic — `-1` en arrière, `1` en avant,
 * `0` au milieu.
 *
 * [fraction] se compte depuis le bord **gauche** (0) vers le bord droit (1),
 * comme la mesure que rend le navigateur. C'est ici qu'elle devient logique :
 * le tiers où la ligne **commence** ramène en arrière, celui où elle **finit**
 * avance, et en arabe la ligne commence à droite.
 */
export function turnZone(fraction, rtl) {
  if (!Number.isFinite(fraction)) return 0;
  const part = rtl ? 1 - fraction : fraction;
  if (part < TURN_ZONE) return -1;
  if (part > 1 - TURN_ZONE) return 1;
  return 0;
}

/**
 * Le sens d'un glissement — `1` en avant, `-1` en arrière, `0` s'il ne tourne
 * rien.
 *
 * **La règle tient en une ligne** : on chasse la page dans le sens où le texte
 * s'écoule. En anglais on glisse vers la gauche pour avancer, en arabe vers la
 * droite.
 *
 * Trois refus avant elle : trop court, trop vertical, ou nul.
 */
export function swipeTurn(dx, dy, rtl) {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return 0;
  if (Math.abs(dx) < SWIPE_MIN) return 0;
  if (Math.abs(dx) < Math.abs(dy) * SWIPE_RATIO) return 0;
  const avance = rtl ? dx > 0 : dx < 0;
  return avance ? 1 : -1;
}
