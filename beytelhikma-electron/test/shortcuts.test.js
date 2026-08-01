import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/**
 * `Ctrl+F` est le raccourci de recherche, et il est écouté à deux endroits : la
 * coquille, qui vise le champ de la barre haute, et le lecteur, qui ouvre la
 * recherche dans le livre ouvert. Les deux écouteurs vivent sur des cibles
 * différentes — `document` pour le lecteur, `window` pour la coquille — et
 * tous deux reçoivent la frappe.
 *
 * Ce qui les départage est une convention, pas une liste d'écrans : le premier
 * à répondre appelle `preventDefault()`, le second sort si `defaultPrevented`.
 * Une liste devrait être tenue à jour au prochain écran ; la convention, non.
 * Ces vérifications sont statiques, comme celles du thème et des polices.
 */

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const shell = read('../src/renderer/js/shell.js');
const reader = read('../src/renderer/js/views/reader.js');

/** Le seul écouteur global de la coquille. */
const globalHandler = () => {
  const start = shell.indexOf("addEventListener('keydown'");
  assert.notEqual(start, -1, 'shell.js doit porter un écouteur clavier global');
  return shell.slice(start, start + 600);
};

test("Ctrl+F ouvre la recherche, et l'indice affiché le dit", () => {
  const handler = globalHandler();
  assert.match(handler, /event\.key\.toLowerCase\(\) !== 'f'/, 'Ctrl+F doit être le raccourci');
  // Un indice qui annonce une autre touche est pire que pas d'indice : il
  // s'apprend, et ce qu'il apprend est faux.
  assert.match(shell, /'Ctrl F'/, "la barre haute doit annoncer le raccourci qu'elle écoute");
});

test('le raccourci global laisse la main à qui a déjà répondu', () => {
  const handler = globalHandler();
  const guard = handler.indexOf('event.defaultPrevented');
  const focus = handler.indexOf('searchField.focus()');
  assert.notEqual(guard, -1, 'shell.js doit tester defaultPrevented');
  assert.notEqual(focus, -1, 'shell.js doit viser le champ');
  assert.ok(guard < focus, 'la garde doit précéder le focus');
});

test('le lecteur marque son Ctrl+F comme traité', () => {
  const start = reader.indexOf(
    "(event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f'",
  );
  assert.notEqual(start, -1, 'le lecteur doit garder son Ctrl+F');
  assert.match(
    reader.slice(start, start + 200),
    /event\.preventDefault\(\)/,
    'sans preventDefault, les deux recherches s’ouvriraient ensemble',
  );
});
