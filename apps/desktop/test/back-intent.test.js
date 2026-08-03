import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { BACK_INTENT, pushBackHandler, runBackIntent } from '../src/renderer/js/back-intent.js';

const readerSource = readFileSync(
  fileURLToPath(new URL('../src/renderer/js/views/reader.js', import.meta.url)),
  'utf8',
);

/**
 * Le geste retour d'Android — glisser depuis le bord de l'écran — est le geste
 * le plus fait de l'appareil. Sans personne pour l'écouter, il retombe sur le
 * défaut de la WebView, `history.back()`, et emporte l'écran entier alors qu'un
 * panneau est ouvert par-dessus.
 *
 * La règle est **une couche à la fois**, la plus haute d'abord.
 */

test('la couche ouverte en dernier répond en premier', () => {
  const vus = [];
  const dropA = pushBackHandler(() => {
    vus.push('a');
    return false;
  });
  const dropB = pushBackHandler(() => {
    vus.push('b');
    return true;
  });

  assert.equal(runBackIntent(), true);
  // `b` a consommé : `a` n'est jamais interrogé. Une couche à la fois.
  assert.deepEqual(vus, ['b']);

  dropB();
  vus.length = 0;
  assert.equal(runBackIntent(), false);
  assert.deepEqual(vus, ['a']);
  dropA();
});

test('sans personne pour répondre, le geste passe', () => {
  assert.equal(runBackIntent(), false);
});

test('seul `true` consomme le geste', () => {
  // Une valeur oubliée — `undefined` d'une fonction qui ferme sans rien rendre —
  // ne doit pas avaler le geste : l'écran paraîtrait figé.
  const drop = pushBackHandler(() => undefined);
  assert.equal(runBackIntent(), false);
  drop();
});

test('un gestionnaire qui lève ne bloque pas le geste', () => {
  const dropSous = pushBackHandler(() => true);
  const dropCasse = pushBackHandler(() => {
    throw new Error('panneau cassé');
  });
  // Sans le filet, une exception dans une couche rendrait le retour matériel
  // inerte, et l'application paraîtrait figée alors qu'elle ne l'est pas.
  assert.equal(runBackIntent(), true);
  dropCasse();
  dropSous();
});

test('le retrait est idempotent', () => {
  const drop = pushBackHandler(() => true);
  drop();
  drop();
  assert.equal(runBackIntent(), false);
});

test("le nom de l'évènement est le contrat avec le portage mobile", () => {
  // `apps/mobile/src/repo/retour.js` émet ce nom-là, et `npm run verify` tient
  // la parité des deux littéraux. Le changer d'un seul côté rendrait le geste
  // muet sur l'appareil, sans qu'aucun écran ne le dise.
  assert.equal(BACK_INTENT, 'beyt:back');
});

/** --------------------------------------------------- la cascade du lecteur */

test('le lecteur inscrit sa cascade et la retire en partant', () => {
  assert.match(readerSource, /pushBackHandler\(\(\) => this\.#closeTopLayer\(\)\)/);
  assert.match(readerSource, /this\.#dropBackHandler\?\.\(\);/);
});

test('`Escape` et le geste retour partagent une seule cascade', () => {
  // Écrite deux fois, elle divergerait — et la seconde copie, celle de
  // l'appareil, n'est relue par personne. C'est la panne du thème `sepia`,
  // rejouée là où on ne la verrait pas.
  // La **définition**, pas le premier appel : `this.#closeTopLayer()` est cité
  // dès `start()`, et `#onKey` est référencé dès la déclaration du champ.
  const debut = readerSource.indexOf('#closeTopLayer() {');
  const fin = readerSource.indexOf('#onKey(event) {');
  assert.ok(debut > 0 && fin > debut, 'la cascade n’est pas là où on la cherche');
  const cascade = readerSource.slice(debut, fin);
  const ordre = ['#hideSelection()', '#closePanels()', 'exitFullscreen()'];
  let curseur = -1;
  for (const geste of ordre) {
    const at = cascade.indexOf(geste);
    assert.ok(at > curseur, `${geste} manque à la cascade, ou n'est pas à son rang`);
    curseur = at;
  }
  // La cascade ne quitte jamais le livre : `back()` reste le seul propriétaire
  // de la sortie, et le geste système la trouve seul quand rien n'est ouvert.
  assert.ok(!/return true;\s*}\s*\n\s*if \(document\.fullscreenElement\)[\s\S]*?back\(\)/.test(cascade));
  assert.match(readerSource, /if \(!this\.#closeTopLayer\(\)\) back\(\);/);
});
