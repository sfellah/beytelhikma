import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { LARGE_BYTES, LARGE_PAGES, isLargeBook } from '../src/shared/large-book.js';
import { DEFAULT_READING_MODE, resolveReadingMode } from '../src/shared/reading-modes.js';

const reader = readFileSync(
  fileURLToPath(new URL('../src/renderer/js/views/reader.js', import.meta.url)),
  'utf8',
);

test('le fil est la façon de lire par défaut', () => {
  assert.equal(DEFAULT_READING_MODE, 'scroll');
  // Une valeur inconnue retombe dessus, comme partout ailleurs.
  for (const stored of ['horizontal', '', null, undefined, 0, {}]) {
    assert.equal(resolveReadingMode(stored), 'scroll');
  }
  // Et la feuille reste une réponse reconnue : le corpus est paginé.
  assert.equal(resolveReadingMode('page'), 'page');
});

test('une seule des deux mesures suffit à faire un gros livre', () => {
  assert.equal(isLargeBook({ pageCount: LARGE_PAGES }), true);
  assert.equal(isLargeBook({ bytes: LARGE_BYTES }), true);
  assert.equal(isLargeBook({ pageCount: LARGE_PAGES - 1, bytes: LARGE_BYTES - 1 }), false);
  // L'index de manuscrits mesuré sur l'appareil : 124 569 pages.
  assert.equal(isLargeBook({ pageCount: 124569, bytes: null }), true);
});

test('une mesure absente ne vaut pas « petit »', () => {
  // `Number(null)` vaut zéro, pas « petit » — le piège de `clampSize`. Ici il
  // ferait taire l'avertissement sur les livres dont on ignore la taille.
  assert.equal(isLargeBook({}), false);
  assert.equal(isLargeBook(), false);
  assert.equal(isLargeBook({ pageCount: 'beaucoup', bytes: null }), false);
  // Mais une mesure présente décide, même si l'autre manque.
  assert.equal(isLargeBook({ pageCount: null, bytes: LARGE_BYTES + 1 }), true);
});

test('le lecteur prévient avant de faire attendre, et pas après', () => {
  // La ligne se pose sur l'écran de chargement, donc **avant** les lectures
  // qu'elle annonce.
  assert.match(reader, /isLargeBook\(\{/);
  const avertissement = reader.indexOf("t('reader.largeBook')");
  const lecture = reader.indexOf('repository.getPageCount(');
  assert.ok(avertissement > 0 && avertissement < lecture, 'la note arrive après l’attente');
});

test('le sommaire ne retient plus l’ouverture', () => {
  // Cent secondes mesurées sur 124 569 pages : tant qu'elles étaient dans le
  // `Promise.all` d'ouverture, elles se passaient devant un rouet, sans rien à
  // quitter. Le sommaire part donc **après** la première page.
  const ouverture = reader.slice(
    reader.indexOf('  async start() {'),
    reader.indexOf('  async #loadToc() {'),
  );
  assert.ok(!ouverture.includes('repository.getToc('), 'le sommaire est encore dans l’ouverture');
  assert.match(ouverture, /this\.#loadToc\(\);/);
  const page = ouverture.indexOf('await this.#show(');
  const sommaire = ouverture.indexOf('this.#loadToc();');
  assert.ok(page > 0 && page < sommaire, 'le sommaire part avant la première page');
});

test('un sommaire qui arrive après le départ du lecteur ne touche rien', () => {
  const charge = reader.slice(
    reader.indexOf('  async #loadToc() {'),
    reader.indexOf('  #refreshChapters() {'),
  );
  const attente = charge.indexOf('await repository.getToc(');
  const garde = charge.indexOf('if (this.#disposed) return;');
  const pose = charge.indexOf('this.#toc = toc;');
  assert.ok(attente > 0, 'le sommaire n’est plus chargé là');
  assert.ok(garde > attente, '`#disposed` est relu avant l’attente, donc jamais après');
  assert.ok(pose > garde, 'le sommaire se pose avant que la garde ne parle');
  // Et ce qui en dérive se repeint : sinon la page ouverte garde son entête
  // vide jusqu'à ce qu'on la quitte.
  assert.match(charge, /this\.#tocByPage = null;/);
  assert.match(charge, /this\.#refreshChapters\(\);/);
  assert.match(charge, /this\.#nodes\.tocReady\?\.\(\);/);
});

test('le panneau du sommaire dit qu’il charge, au lieu de dire qu’il n’y en a pas', () => {
  assert.match(reader, /'reader\.tocLoading'/);
  assert.match(reader, /this\.#tocLoading\n?\s*\?\s*'reader\.tocLoading'/);
});
