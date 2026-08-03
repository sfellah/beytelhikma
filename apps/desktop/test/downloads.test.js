import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  BUSY,
  FINISHED_LIMIT,
  departures,
  rememberFinished,
} from '../src/shared/downloads-queue.js';

const view = readFileSync(
  fileURLToPath(new URL('../src/renderer/js/views/downloads.js', import.meta.url)),
  'utf8',
);

const styles = readFileSync(
  fileURLToPath(new URL('../src/renderer/styles/views.css', import.meta.url)),
  'utf8',
);

// --------------------------------------------------------- ce qui quitte la file

test('un travail qui disparaît de la file est un candidat, pas une certitude', () => {
  const watched = new Set(['a', 'b']);
  const { present, left } = departures(watched, [
    { editionId: 'a', status: 'downloading' },
    { editionId: 'c', status: 'queued' },
  ]);
  // `b` a quitté la file : installé, ou annulé — vu d'ici, rien ne les
  // distingue. C'est le dépôt qui tranchera.
  assert.deepEqual(left, ['b']);
  assert.deepEqual([...present].sort(), ['a', 'c']);
});

test('un travail encore en file n’a rien quitté, quel que soit son état', () => {
  for (const status of [...BUSY, 'failed']) {
    const { left } = departures(new Set(['a']), [{ editionId: 'a', status }]);
    assert.deepEqual(left, [], `« ${status} » est compté comme parti`);
  }
});

test('la première visite ne fabrique aucun candidat', () => {
  // Rien n'a été vu : les livres déjà installés depuis des semaines ne doivent
  // pas se présenter comme « tout juste téléchargés ».
  assert.deepEqual(departures(new Set(), [{ editionId: 'a', status: 'downloading' }]).left, []);
  assert.deepEqual(departures().left, []);
});

// ------------------------------------------------------------------- la mémoire

test('le dernier confirmé passe en tête, sans doublon', () => {
  let memory = rememberFinished(new Map(), [{ editionId: 'a', title: 'أ' }]);
  memory = rememberFinished(memory, [{ editionId: 'b', title: 'ب' }]);
  assert.deepEqual([...memory.keys()], ['b', 'a']);

  memory = rememberFinished(memory, [{ editionId: 'a', title: 'أ (2)' }]);
  assert.deepEqual([...memory.keys()], ['a', 'b']);
  assert.equal(memory.get('a').title, 'أ (2)');
});

test('la mémoire est bornée : la file en cours reste à l’écran', () => {
  let memory = new Map();
  for (let index = 0; index < FINISHED_LIMIT + 4; index += 1) {
    memory = rememberFinished(memory, [{ editionId: `book-${index}` }]);
  }
  assert.equal(memory.size, FINISHED_LIMIT);
  assert.equal([...memory.keys()][0], `book-${FINISHED_LIMIT + 3}`);
});

test('une ligne sans identifiant n’entre pas dans la mémoire', () => {
  const memory = rememberFinished(new Map(), [{ title: 'sans identifiant' }, null]);
  assert.equal(memory.size, 0);
});

// ------------------------------------------------------------------ l'écran

test('« lire » ne s’affiche qu’après confirmation du dépôt', () => {
  // La file efface un travail installé : l'écran ne peut pas déduire de sa
  // disparition qu'un fichier est là. Il redemande, filtré sur `installed`.
  const confirmation = view.slice(
    view.indexOf('  async #collectFinished(jobs, token) {'),
    view.indexOf('  #queryPayload() {'),
  );
  assert.match(confirmation, /repository\.getManagedBooks\(\{/);
  assert.match(confirmation, /ids: asked/);
  assert.match(confirmation, /status: 'installed'/);
  // Et la question est bornée : un lot d'échecs nettoyé d'un coup ferait un
  // `IN (?,?,…)` de mille paramètres.
  assert.match(confirmation, /left\.slice\(-FINISHED_LIMIT\)/);
  assert.match(confirmation, /rememberFinished\(this\.#finished, rows\)/);
});

test('la section « tout juste téléchargé » mène au lecteur', () => {
  const section = view.slice(
    view.indexOf('  #doneSection(rows) {'),
    view.indexOf('  #jobRow(job) {'),
  );
  assert.match(section, /t\('downloads\.group\.done'\)/);
  assert.match(section, /icon\('bookOpen'/);
  assert.match(section, /navigate\(`\/reader\/\$\{row\.editionId\}`\)/);
  // Et l'on peut l'écarter : c'est une proposition, pas une file de travail.
  assert.match(section, /t\('downloads\.dismiss'\)/);
  assert.match(section, /this\.#finished\.delete\(row\.editionId\)/);
});

test('dans la table, « lire » n’est offert qu’au livre installé', () => {
  const actions = view.slice(
    view.indexOf('  #rowActions(row, status) {'),
    view.indexOf('  #drawBulk({ rows }) {'),
  );
  const installed = actions.indexOf("if (status === 'installed')");
  const busy = actions.indexOf('if (BUSY.has(status))');
  assert.ok(busy > 0 && installed > busy, 'la branche « installé » a disparu');

  // Le lecteur n'est atteint que depuis cette branche : ni en cours de
  // téléchargement, ni sur un livre absent.
  const jumps = [...actions.matchAll(/\/reader\//g)];
  assert.equal(jumps.length, 1);
  assert.ok(jumps[0].index > installed, 'un autre statut mène au lecteur');
});

test('un livre effacé quitte aussi ce qu’on vient de télécharger', () => {
  const remove = view.slice(view.indexOf('repository.deleteBooks('), view.length);
  assert.match(remove, /this\.#finished\.delete\(row\.editionId\)/);
});

// ----------------------------------------------------------------- la place

test('la case de sélection ne grossit plus au doigt : son étiquette porte la cible', () => {
  // 22 px de case, c'était la place des deux boutons de la ligne. La cible
  // tactile est passée à l'étiquette, qui ne déplace rien.
  assert.doesNotMatch(styles, /\.books-table input\[type='checkbox'\]/);
  assert.doesNotMatch(styles, /\.downloads input\[type='checkbox'\]/);
  assert.match(styles, /\.books-table__check input\[type='checkbox'\] \{[^}]*width: 16px/);
  assert.match(styles, /\.books-table__check \{[^}]*min-height: 44px/);
});

test('les deux boutons d’une ligne sont posés en rangée', () => {
  // `.button--icon` est un bloc : nus dans la cellule, « lire » passait sous
  // « supprimer ».
  assert.match(styles, /\.books-table__row-actions \{[^}]*display: flex/);
  assert.match(view, /class: 'books-table__row-actions'/);
});

test('la table ne pose aucun alignement physique', () => {
  const block = styles.slice(
    styles.indexOf('.books-table__scroll'),
    styles.indexOf('.books-table__badge.is-failed'),
  );
  for (const forbidden of ['margin-left', 'margin-right', 'padding-left', 'padding-right']) {
    assert.ok(!block.includes(forbidden), `${forbidden} dans la table des téléchargements`);
  }
});
