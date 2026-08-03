import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LONG_PRESS_MS,
  MOVE_TOLERANCE,
  longPressAborted,
  longPressAllowed,
} from '../src/shared/long-press.js';

/**
 * La règle de l'appui long, éprouvée sans DOM.
 *
 * C'est la convention de `page-turn.js` : un geste enfermé dans un gestionnaire
 * d'évènements ne se vérifie qu'au doigt, sur du verre, et l'on ne s'en aperçoit
 * qu'en production — c'est ainsi que le glissement du lecteur est resté mort le
 * temps qu'un `touch-action` manquant se voie.
 */

test('les seuils sont ceux de la plateforme, et ne dérivent pas', () => {
  // 500 ms est la valeur d'Android. Plus court, une tape hésitante ouvre la
  // sélection ; plus long, on croit que rien ne répond.
  assert.equal(LONG_PRESS_MS, 500);
  assert.ok(MOVE_TOLERANCE > 0, 'à zéro, aucun doigt ne tient assez immobile');
});

test('un doigt immobile, ou presque, ne rompt pas l’appui', () => {
  assert.equal(longPressAborted(0, 0), false);
  assert.equal(longPressAborted(3, 4), false, '5 px de trajet restent un appui');
  assert.equal(longPressAborted(-6, 2), false);
});

test('un doigt qui part rompt l’appui, dans les quatre directions', () => {
  for (const [dx, dy] of [
    [40, 0],
    [-40, 0],
    [0, 40],
    [0, -40],
  ]) {
    assert.equal(longPressAborted(dx, dy), true, `${dx},${dy} devait rompre l’appui`);
  }
});

test('la rupture se compte en distance, pas axe par axe', () => {
  // Huit pixels sur chaque axe font onze pixels de trajet : deux comparaisons
  // séparées les laisseraient passer, et le geste survivrait à un glissement en
  // diagonale — celui, précisément, qu'on fait pour défiler une grille.
  assert.equal(longPressAborted(8, 8), true);
  assert.ok(Math.hypot(8, 8) > MOVE_TOLERANCE);
  assert.ok(8 < MOVE_TOLERANCE, 'le cas ne vaut que si chaque axe reste sous le seuil');
});

test('une mesure absente ne rompt rien : on ne conclut pas d’un trou', () => {
  assert.equal(longPressAborted(undefined, undefined), false);
  assert.equal(longPressAborted(Number.NaN, 0), false);
});

test('la souris n’a pas d’appui long : elle a déjà son bouton', () => {
  assert.equal(longPressAllowed('mouse'), false);
  assert.equal(longPressAllowed('touch'), true);
  assert.equal(longPressAllowed('pen'), true);
  // Un type absent est tenu pour tactile : c'est le seul cas où le geste sert.
  assert.equal(longPressAllowed(undefined), true);
});
