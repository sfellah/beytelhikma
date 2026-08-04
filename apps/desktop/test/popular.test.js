import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { POPULAR_EDITION_IDS, isPopular, resolvePopular } from '../src/shared/popular.js';

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

test('vingt-trois éditions, sans doublon', () => {
  assert.equal(POPULAR_EDITION_IDS.length, 23);
  assert.equal(new Set(POPULAR_EDITION_IDS).size, 23);
});

test('chaque identifiant est une édition du corpus publié', () => {
  // Le point est exclu du motif, comme dans `assertEditionId` : l'admettre
  // laisserait passer `..`, et un identifiant désigne un nom de fichier.
  for (const id of POPULAR_EDITION_IDS) {
    assert.match(id, /^sh-\d+$/, `identifiant hors motif : ${id}`);
  }
});

test('resolvePopular écarte ce que le catalogue ne connaît pas et le compte', () => {
  // Sur les cinq livres d'exemple, aucun `sh-*` ne répond : la section
  // s'efface, comme celle des cursus. C'est une réponse, pas une panne.
  const rien = resolvePopular(new Set());
  assert.deepEqual(rien.ids, []);
  assert.equal(rien.missing, 23);

  const deux = resolvePopular(new Set(['sh-1458', 'sh-1462', 'sh-99999']));
  assert.deepEqual(deux.ids, ['sh-1458', 'sh-1462']);
  assert.equal(deux.missing, 21);
});

test('resolvePopular garde l’ordre de la liste, pas celui de l’argument', () => {
  const { ids } = resolvePopular(['sh-1462', 'sh-1458']);
  assert.deepEqual(ids, ['sh-1458', 'sh-1462']);
});

test('resolvePopular accepte un itérable autant qu’un Set', () => {
  assert.deepEqual(resolvePopular(['sh-1458']).ids, ['sh-1458']);
});

test('isPopular répond en temps constant, pas par balayage', () => {
  assert.equal(isPopular('sh-1458'), true);
  assert.equal(isPopular('sh-99999'), false);
  assert.equal(isPopular(null), false);
  assert.ok(
    /new Set\(POPULAR_EDITION_IDS\)/.test(read('../src/shared/popular.js')),
    'isPopular doit s’appuyer sur un Set construit une fois',
  );
});

test('aucune vue ne redéclare la liste', () => {
  // La règle de `theme.test.js` : deux copies d'une même liste ont déjà produit
  // le thème `sepia` mort et la police orpheline.
  const root = fileURLToPath(new URL('../src/renderer/js', import.meta.url));
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory)) {
      const full = path.join(directory, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.js')) files.push(full);
    }
  };
  walk(root);
  for (const file of files) {
    assert.ok(
      !/POPULAR_EDITION_IDS\s*=/.test(readFileSync(file, 'utf8')),
      `${path.relative(root, file)} redéclare POPULAR_EDITION_IDS`,
    );
  }
});
