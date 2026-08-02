import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { CURRICULA, CURRICULUM_IDS, resolveCurriculum } from '../src/shared/curricula.js';

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const locale = (name) =>
  fs.readFileSync(path.join(projectRoot, 'src', 'renderer', 'js', 'locales', name), 'utf8');

test('un cursus est une liste ordonnée, sans doublon ni identifiant vide', () => {
  assert.ok(CURRICULA.length >= 5);
  assert.equal(new Set(CURRICULUM_IDS).size, CURRICULA.length, 'identifiants uniques');

  for (const curriculum of CURRICULA) {
    assert.ok(curriculum.steps.length >= 3, `${curriculum.id} : un cursus de deux livres n'en est pas un`);
    assert.equal(
      new Set(curriculum.steps).size,
      curriculum.steps.length,
      `${curriculum.id} : une étape répétée fausserait l'avancement`,
    );
    for (const editionId of curriculum.steps) {
      assert.match(editionId, /^[a-z0-9-]+$/, `${curriculum.id} : identifiant douteux`);
    }
  }
});

test('chaque cursus a son nom et son intitulé dans les deux langues', () => {
  // La panne du thème `sepia` rejouée : un cursus sans chaîne s'afficherait
  // sous sa clé brute, et rien ne le dirait avant de changer de langue.
  const catalogs = { 'ar.js': locale('ar.js'), 'en.js': locale('en.js') };
  for (const [name, source] of Object.entries(catalogs)) {
    for (const id of CURRICULUM_IDS) {
      for (const part of ['name', 'hint']) {
        assert.ok(
          source.includes(`'curriculum.${id}.${part}'`),
          `${name} : clé curriculum.${id}.${part} absente`,
        );
      }
    }
  }
});

test('les étapes absentes du catalogue sont écartées, et comptées', () => {
  const curriculum = { id: 'x', steps: ['a', 'b', 'c', 'd'] };

  const complet = resolveCurriculum(curriculum, new Set(['a', 'b', 'c', 'd']));
  assert.deepEqual(complet.steps, ['a', 'b', 'c', 'd']);
  assert.equal(complet.missing, 0);

  // L'ordre déclaré prime : il ne se déduit d'aucune donnée du catalogue.
  const partiel = resolveCurriculum(curriculum, new Set(['d', 'b']));
  assert.deepEqual(partiel.steps, ['b', 'd']);
  assert.equal(partiel.missing, 2);

  const vide = resolveCurriculum(curriculum, new Set());
  assert.deepEqual(vide.steps, []);
  assert.equal(vide.missing, 4);
});

test('une liste d’identifiants vaut un ensemble', () => {
  const curriculum = { id: 'x', steps: ['a', 'b'] };
  assert.deepEqual(resolveCurriculum(curriculum, ['b']).steps, ['b']);
});
