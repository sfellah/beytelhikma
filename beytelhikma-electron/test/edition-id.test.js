import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { AppDatabase } from '../src/main/app-database.js';
import { assertEditionId, isEditionId } from '../src/main/edition-id.js';

test('les deux formes du corpus sont acceptées', () => {
  for (const id of ['sh-1', 'sh-8589', 'ed-bukhari-01', 'ed_muwatta_01', 'A1']) {
    assert.equal(isEditionId(id), true, id);
  }
});

/**
 * La liste noire qui compte : tout ce qui, collé derrière `books/`, désigne
 * autre chose que `books/<id>.sqlite`.
 */
test('rien de ce qui traverse un chemin ne passe', () => {
  const refusés = [
    '..',
    '../catalog',
    '../../user',
    'a/../../b',
    'books/x',
    'a\\b',
    'a/b',
    'C:/Windows/System32/x',
    '.hidden',
    'a.sqlite',
    '',
    null,
    undefined,
    '\u0000',
    'a'.repeat(65),
  ];
  for (const id of refusés) {
    assert.equal(isEditionId(id), false, `accepté à tort : ${String(id)}`);
    assert.throws(() => assertEditionId(id), /identifiant d'édition invalide/);
  }
});

/**
 * La propriété qu'on protège, vue du dehors : un identifiant qui traverse ne
 * doit pas pouvoir désigner un fichier hors de `books/`.
 */
test('AppDatabase.book refuse un identifiant qui sort du dossier', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'beyt-edition-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const db = new AppDatabase({ librarySource: null, storageRoot: root });
  fs.mkdirSync(path.join(root, 'books'), { recursive: true });
  // Une cible plausible juste à côté de `books/` : c'est elle que viserait un
  // identifiant qui remonte d'un cran.
  fs.writeFileSync(path.join(root, 'user.sqlite'), 'à ne pas ouvrir');

  await assert.rejects(() => db.book('../user'), /identifiant d'édition invalide/);
  assert.equal(fs.existsSync(path.join(root, 'user.sqlite')), true);
});
