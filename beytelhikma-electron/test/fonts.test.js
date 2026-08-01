import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  DEFAULT_INTERFACE_FONT,
  DEFAULT_READER_FONT,
  FONTS,
  fontsForScript,
  resolveFont,
} from '../src/shared/fonts.js';
import { slugify } from '../src/main/font-installer.js';

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

test('chaque famille déclare une clé, une police, un script et un libellé', () => {
  for (const font of FONTS) {
    assert.match(font.key, /^[a-z0-9]+$/, `clé mal formée : ${font.key}`);
    assert.ok(font.family, `famille manquante pour ${font.key}`);
    assert.ok(['arab', 'latn'].includes(font.script), `script inconnu pour ${font.key}`);
    assert.match(font.label, /^fonts\./, `le libellé de ${font.key} doit être une clé de catalogue`);
  }
});

test('les clés sont uniques', () => {
  const keys = FONTS.map((font) => font.key);
  assert.equal(new Set(keys).size, keys.length);
});

test('trois familles arabes, trois latines', () => {
  assert.equal(fontsForScript('arab').length, 3);
  assert.equal(fontsForScript('latn').length, 3);
});

test('fontsForScript ne mélange jamais les écritures', () => {
  for (const font of fontsForScript('latn')) assert.equal(font.script, 'latn');
  for (const font of fontsForScript('arab')) assert.equal(font.script, 'arab');
});

/**
 * Les deux clés qu'écrivait l'ancien écran des réglages. Une base d'utilisateur
 * les porte, et elles ne doivent pas laisser le lecteur sans police.
 */
test('resolveFont replie les anciennes clés serif et sans', () => {
  assert.equal(resolveFont('serif', 'arab', DEFAULT_READER_FONT), 'amiri');
  assert.equal(resolveFont('sans', 'arab', DEFAULT_READER_FONT), 'plex');
  assert.equal(resolveFont('naskh', 'arab', DEFAULT_READER_FONT), 'naskh');
});

test('resolveFont replie l’inconnu et le hors-script sur le repli demandé', () => {
  for (const stored of ['vibes', '', ' ', null, undefined, 0, {}]) {
    assert.equal(resolveFont(stored, 'arab', DEFAULT_READER_FONT), DEFAULT_READER_FONT);
    assert.equal(
      resolveFont(stored, 'latn', DEFAULT_INTERFACE_FONT.latn),
      DEFAULT_INTERFACE_FONT.latn,
    );
  }
  // Une face latine choisie pour du texte arabe ne rendrait pas le corpus.
  assert.equal(resolveFont('garamond', 'arab', DEFAULT_READER_FONT), DEFAULT_READER_FONT);
  assert.equal(resolveFont('amiri', 'latn', DEFAULT_INTERFACE_FONT.latn), DEFAULT_INTERFACE_FONT.latn);
});

/**
 * Lire et manœuvrer ne demandent pas la même face. Un défaut unique a peint
 * les menus arabes en Amiri — une face de livre — et changé l'aspect de toute
 * l'application d'un coup.
 */
test('le défaut d’interface arabe n’est pas celui du lecteur', () => {
  assert.notEqual(DEFAULT_INTERFACE_FONT.arab, DEFAULT_READER_FONT);
  assert.equal(resolveFont(null, 'arab', DEFAULT_INTERFACE_FONT.arab), 'plex');
});

test('sans repli utilisable, resolveFont prend la première famille de l’écriture', () => {
  assert.equal(resolveFont(null, 'arab'), fontsForScript('arab')[0].key);
  assert.equal(resolveFont(null, 'latn', 'amiri'), fontsForScript('latn')[0].key);
});

/**
 * Parité table ↔ feuille de style. C'est faute d'un tel test que Noto Naskh
 * était restée orpheline : `views/reader.js` la proposait, `views/settings.js`
 * l'ignorait, et `.reader--font-naskh` existait sans que rien n'y mène.
 */
test('chaque famille arabe a son bloc de lecteur, et réciproquement', () => {
  const css = read('../src/renderer/styles/views.css');
  const declared = [...css.matchAll(/\.reader--font-([a-z0-9]+)/g)].map((match) => match[1]);
  const arabic = fontsForScript('arab').map((font) => font.key);

  for (const key of arabic) {
    assert.ok(declared.includes(key), `bloc .reader--font-${key} manquant`);
  }
  for (const key of declared) {
    assert.ok(arabic.includes(key), `bloc orphelin dans views.css : .reader--font-${key}`);
  }
});

test('chaque famille a ses fichiers de police embarqués', () => {
  const css = read('../src/renderer/styles/fonts.css');
  for (const font of FONTS) {
    assert.ok(
      css.includes(`font-family: '${font.family}'`),
      `${font.family} n’est pas déclarée dans fonts.css`,
    );
  }
});

test('les fichiers annoncés par fonts.css existent', () => {
  const css = read('../src/renderer/styles/fonts.css');
  for (const [, file] of css.matchAll(/url\('\.\.\/assets\/fonts\/([^']+)'\)/g)) {
    const full = fileURLToPath(new URL(`../src/renderer/assets/fonts/${file}`, import.meta.url));
    assert.ok(existsSync(full), `fichier de police manquant : ${file}`);
  }
});

/**
 * Le propriétaire est unique — la panne d'origine venait de deux listes.
 *
 * Ce qu'on interdit est le **littéral** : `const FONTS = fontsForScript('arab')`
 * est une vue de la liste partagée, pas une seconde liste, et ne peut pas
 * diverger.
 */
/**
 * Seules les polices **ajoutées** se suppriment ; les six embarquées restent.
 *
 * La garantie n'est pas un filtre dans la vue — la liste de suppression est
 * bâtie sur `user_fonts`, et les deux espaces de clés sont disjoints par
 * construction : `slugify` préfixe tout par `user-`, qu'aucune famille
 * embarquée ne porte. Une interface sans police de repli n'aurait plus de quoi
 * s'afficher.
 */
test('aucune police embarquée ne peut porter la clé d’une police ajoutée', () => {
  const embarquées = new Set(FONTS.map((font) => font.key));
  for (const font of FONTS) {
    assert.equal(font.key.startsWith('user-'), false, `${font.key} empiète sur les ajoutées`);
    const ajoutée = slugify(font.family);
    assert.ok(ajoutée.startsWith('user-'));
    assert.equal(embarquées.has(ajoutée), false, `collision de clés sur ${font.family}`);
  }
});

test('l’écran des réglages ne propose à la suppression que les polices ajoutées', () => {
  const source = read('../src/renderer/js/views/settings.js');
  const bloc = source.match(/function addedFontsRow\([\s\S]*?\n\}/)?.[0];
  assert.ok(bloc, 'addedFontsRow doit exister');
  // La liste vient de `userFonts()` — celle de `user.sqlite` — et de nulle part
  // ailleurs : `FONTS` ou `fontsForScript` ici mettrait les six embarquées à
  // portée d'un bouton de suppression qui ne peut pas aboutir.
  assert.ok(bloc.includes('userFonts()'), 'la liste doit venir de user.sqlite');
  assert.equal(/\bFONTS\b|fontsForScript|familiesFor/.test(bloc), false);
});

test('aucune vue ne redéclare la liste des polices', () => {
  for (const view of ['../src/renderer/js/views/reader.js', '../src/renderer/js/views/settings.js']) {
    const source = read(view);
    assert.equal(/const FONTS\s*=\s*\[/.test(source), false, `${view} redéclare FONTS`);
    assert.equal(/'Amiri'/.test(source), false, `${view} code une famille en dur`);
  }
});
