import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/**
 * La mise à jour du catalogue se propose au démarrage — c'était la dette
 * écrite noir sur blanc dans `CLAUDE.md` : « rien n'appelle `checkCatalogUpdate`
 * au démarrage », et `declineCatalogUpdate`, testé, n'avait aucun appelant.
 *
 * Le câblage vit dans le rendu **partagé** : le mobile régénère ce rendu, les
 * deux applications en profitent d'un coup. Vérifications statiques, comme
 * celles du thème, des polices et de la direction : elles lisent la source et
 * interdisent la régression.
 */

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const MODULE = '../src/renderer/js/catalog-update.js';
const app = read('../src/renderer/js/app.js');
const css = read('../src/renderer/styles/shell.css');

const modulePresent = existsSync(fileURLToPath(new URL(MODULE, import.meta.url)));
const source = modulePresent ? read(MODULE) : '';

test('le module de proposition existe dans le rendu partagé', () => {
  assert.ok(
    modulePresent,
    'src/renderer/js/catalog-update.js manquant : rien ne propose la mise à jour au démarrage',
  );
});

test('la vérification part après le premier rendu, jamais avant', () => {
  assert.ok(
    app.includes("import { proposeCatalogUpdate } from './catalog-update.js'"),
    'app.js doit importer la proposition de mise à jour',
  );
  const démarrage = app.indexOf('start(document.getElementById');
  const proposition = app.indexOf('proposeCatalogUpdate()');
  assert.ok(proposition > -1, 'app.js doit appeler proposeCatalogUpdate()');
  assert.ok(
    proposition > démarrage,
    'la proposition doit venir après start() : elle ne retarde rien',
  );
  assert.ok(
    !app.includes('await proposeCatalogUpdate'),
    'la proposition ne doit pas être attendue : le premier rendu passe devant',
  );
});

test('une vérification automatique respecte un refus passé', () => {
  // `ignoreDeclined` appartient au bouton de `/settings` : un refus tait une
  // proposition, pas une question posée. Le passer ici ferait revenir à chaque
  // lancement la bannière d'une version explicitement refusée.
  assert.ok(
    source.includes('repository.checkCatalogUpdate()'),
    'la vérification doit passer par checkCatalogUpdate, sans option',
  );
  assert.ok(
    !source.includes('checkCatalogUpdate({'),
    'une vérification automatique ne repose pas la question : aucune option, donc pas de ignoreDeclined',
  );
});

test('seule l’offre se voit : les cinq branches silencieuses ne montrent rien', () => {
  assert.ok(
    /if \(verdict\?\.action !== 'offer'\) return;/.test(source),
    'toute décision autre que « offer » doit sortir sans rien afficher',
  );
});

test('l’échec de la vérification n’empêche jamais l’application de s’ouvrir', () => {
  assert.ok(
    /catch\s*\{[^}]*return;[^}]*\}/s.test(source),
    'un checkCatalogUpdate qui lève doit se taire, pas remonter',
  );
});

test('écarter la bannière refuse cette version-là, pas les suivantes', () => {
  assert.ok(
    source.includes('declineCatalogUpdate(pointer.catalog_version)'),
    'le refus doit porter la version proposée : refuser la 2 ne fait pas taire la 3',
  );
});

test('accepter installe puis remonte l’écran, qui lit le catalogue au montage', () => {
  assert.ok(
    source.includes('repository.installCatalogUpdate()'),
    'le bouton doit passer par installCatalogUpdate, qui reprend la décision',
  );
  assert.ok(
    source.includes('remount()'),
    'sans remontée, l’écran continue de montrer le catalogue remplacé',
  );
});

test('la bannière est une bande écartable, stylée dans la coquille', () => {
  assert.ok(css.includes('.update-banner'), 'shell.css doit porter .update-banner');
  assert.ok(
    css.includes('.update-banner__actions'),
    'shell.css doit porter les actions de la bannière',
  );
  assert.ok(
    !source.includes('confirmDialog') && !source.includes("modal("),
    'une bande qu’on peut écarter, pas une boîte modale qui barre la route',
  );
});
