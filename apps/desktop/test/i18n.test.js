import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { LOCALES } from '../src/shared/locale.js';
import { translate } from '../src/shared/translate.js';
import ar from '../src/renderer/js/locales/ar.js';
import en from '../src/renderer/js/locales/en.js';

const CATALOGS = { ar, en };

const placeholders = (value) => [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

test('les catalogues couvrent exactement les mêmes clés', () => {
  // Une clé d'un seul côté produit une interface trouée qui ne se voit qu'en
  // changeant de langue — donc jamais, pour qui développe en arabe.
  assert.deepEqual(Object.keys(ar).sort(), Object.keys(en).sort());
});

test('il existe un catalogue par locale déclarée', () => {
  for (const locale of LOCALES) {
    assert.ok(CATALOGS[locale.key], `catalogue manquant pour ${locale.key}`);
  }
});

test('aucune chaîne vide, aucune chaîne restée égale à sa clé', () => {
  for (const [name, catalog] of Object.entries(CATALOGS)) {
    for (const [key, value] of Object.entries(catalog)) {
      assert.equal(typeof value, 'string', `${name}.${key} n’est pas une chaîne`);
      assert.notEqual(value.trim(), '', `${name}.${key} est vide`);
      assert.notEqual(value, key, `${name}.${key} n’est pas traduite`);
    }
  }
});

test('les paramètres d’interpolation concordent entre les deux catalogues', () => {
  for (const key of Object.keys(ar)) {
    assert.deepEqual(
      placeholders(ar[key]),
      placeholders(en[key]),
      `paramètres divergents pour ${key}`,
    );
  }
});

test('les clés arabes ne portent que de l’ASCII', () => {
  // Les clés servent d'identifiant dans le code : elles restent lisibles pour
  // qui ne lit pas l'arabe, et se cherchent au grep.
  for (const key of Object.keys(ar)) {
    assert.match(key, /^[a-z][a-zA-Z0-9.]*$/, `clé mal formée : ${key}`);
  }
});

test('translate interpole et convertit les nombres selon la locale', () => {
  const catalog = { 'reader.page': 'الصفحة {page} من {total}' };
  assert.equal(
    translate(catalog, 'reader.page', { page: 42, total: 350 }, 'ar'),
    'الصفحة ٤٢ من ٣٥٠',
  );
  assert.equal(
    translate({ 'reader.page': 'Page {page} of {total}' }, 'reader.page', { page: 42, total: 350 }, 'en'),
    'Page 42 of 350',
  );
});

test('translate laisse le texte intact et ne convertit pas les chaînes', () => {
  // Une valeur déjà textuelle passe telle quelle : c'est ce qui protège les
  // chemins, les URL et les sha256, qui ne doivent jamais devenir arabes.
  const catalog = { 'about.root': 'المجلد {path}' };
  assert.equal(
    translate(catalog, 'about.root', { path: 'C:\\Users\\42\\data' }, 'ar'),
    'المجلد C:\\Users\\42\\data',
  );
});

test('translate rend la clé quand elle manque, sans lever', () => {
  assert.equal(translate({}, 'absente', {}, 'ar'), 'absente');
});

test('translate laisse en place un paramètre non fourni', () => {
  const catalog = { greet: 'مرحبا {name}' };
  assert.equal(translate(catalog, 'greet', {}, 'ar'), 'مرحبا {name}');
});

/**
 * Familles de clés bâties à l'exécution, avec le fichier qui les bâtit.
 *
 * L'exemption est **adossée à sa source** : le test vérifie que le gabarit
 * existe encore dans ce fichier. Une liste d'exceptions nue survivrait au code
 * qu'elle excuse, et rouvrirait la porte qu'elle prétend garder.
 */
const FAMILLES_DYNAMIQUES = [
  { prefixe: 'format.ordinal.', source: 'src/renderer/js/format.js', gabarit: '`format.ordinal.${' },
  {
    prefixe: 'curriculum.',
    source: 'src/renderer/js/components/curriculum-card.js',
    gabarit: '`curriculum.${',
  },
];

const RACINE = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function sources() {
  const trouves = [];
  const parcourir = (dossier) => {
    for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
      const chemin = path.join(dossier, entree.name);
      if (entree.isDirectory()) {
        parcourir(chemin);
      } else if (/\.(js|cjs|mjs|html)$/.test(entree.name) && !chemin.includes('locales')) {
        trouves.push(chemin);
      }
    }
  };
  parcourir(path.join(RACINE, 'src'));
  return trouves;
}

test('aucune clé du catalogue n’est orpheline', () => {
  // Une clé que plus personne n'appelle est un reste : elle a survécu à l'écran
  // qui l'affichait. Elle ne casse rien — c'est bien le problème. Deux listes
  // de polices mortes (`reader.font.*`, `settings.font.*`) ont vécu ainsi
  // pendant que `shared/fonts.js` était déjà la seule source de vérité.
  const blob = sources()
    .map((chemin) => fs.readFileSync(chemin, 'utf8'))
    .join('\n');

  for (const famille of FAMILLES_DYNAMIQUES) {
    const source = fs.readFileSync(path.join(RACINE, famille.source), 'utf8');
    assert.ok(
      source.includes(famille.gabarit),
      `${famille.source} ne bâtit plus « ${famille.prefixe}… » : l’exemption n’a plus lieu d’être`,
    );
  }

  const orphelines = Object.keys(ar).filter(
    (cle) =>
      !FAMILLES_DYNAMIQUES.some((famille) => cle.startsWith(famille.prefixe)) &&
      !blob.includes(`'${cle}'`),
  );

  assert.deepEqual(orphelines, [], `clés jamais citées : ${orphelines.join(', ')}`);
});
