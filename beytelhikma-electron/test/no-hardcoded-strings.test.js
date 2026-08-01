import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/**
 * Le garde-fou de l'extraction.
 *
 * Sans lui, la prochaine vue écrite réintroduira de l'arabe en dur, et
 * personne ne s'en apercevra tant que l'interface restera en arabe — le défaut
 * ne se verrait qu'en basculant en anglais, c'est-à-dire jamais pendant le
 * développement. C'est le même mécanisme que `theme.test.js`, qui interdit à
 * une vue de redéclarer la liste des thèmes.
 */

const ROOT = fileURLToPath(new URL('../src/renderer/js', import.meta.url));

/**
 * Les trois seules exceptions, et pourquoi.
 *
 * - `locales/ar.js` **est** le catalogue arabe : c'est là que l'arabe doit
 *   vivre.
 * - `icons.js` indexe ses pictogrammes par libellé de catégorie du catalogue
 *   (`التفسير`, `الحديث`…). Ce sont des **clés de données**, comparées à ce que
 *   rend `catalog.sqlite` ; les traduire casserait la correspondance.
 * - `؟` dans le lecteur est la **touche** du clavier arabe, comparée dans un
 *   `case` et affichée comme touche dans la fiche des raccourcis. Ce n'est pas
 *   une phrase.
 */
const ALLOWED = {
  'locales/ar.js': null, // fichier entier
  'icons.js': null, // table de catégories, clés de données
  'views/reader.js': new Set(['؟']),
};

const ARABIC = /[؀-ۿ]/;

function sources(directory) {
  const out = [];
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

/** Littéraux `'…'`, `"…"` et `` `…` ``, commentaires retirés au préalable. */
function literals(source) {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  return [...code.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)].map((match) => match[2]);
}

test('aucune vue ne porte de chaîne arabe en dur', () => {
  const offenders = [];

  for (const file of sources(ROOT)) {
    const relative = path.relative(ROOT, file).replaceAll('\\', '/');
    if (relative in ALLOWED && ALLOWED[relative] === null) continue;
    const allowed = ALLOWED[relative] ?? new Set();

    for (const value of literals(readFileSync(file, 'utf8'))) {
      if (!ARABIC.test(value) || allowed.has(value)) continue;
      offenders.push(`${relative} : « ${value} »`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `chaînes à extraire vers locales/ar.js :\n${offenders.join('\n')}`,
  );
});

/**
 * L'inverse du test ci-dessus : une exception qui ne sert plus doit disparaître,
 * sinon la liste s'allonge et finit par autoriser ce qu'elle ne décrit plus.
 */
test('les exceptions déclarées existent encore', () => {
  for (const relative of Object.keys(ALLOWED)) {
    const full = path.join(ROOT, relative);
    assert.doesNotThrow(() => statSync(full), `exception obsolète : ${relative}`);
  }
});
