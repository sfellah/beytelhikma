import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/**
 * « عن التطبيق », en pied de `/settings`.
 *
 * C'est le bloc qu'on recopie quand quelque chose ne va pas : version de
 * l'application, plateforme, moteur, puis ce que porte la bibliothèque. Les
 * deux applications montrent le **même** rendu — `prepare-www.mjs` le régénère
 * — donc ce qui est vérifié ici vaut pour Android autant que pour le bureau ;
 * c'est `apps/mobile/scripts/verify.mjs` qui tient l'autre bout, côté dépôt.
 */

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8').replaceAll('\r\n', '\n');

const view = read('../src/renderer/js/views/settings.js');
const main = read('../src/main/main.js');

test('la version vient en tête des informations, avant les décomptes', () => {
  const bloc = view.slice(view.indexOf('function aboutSection('), view.indexOf('function dangerSection('));
  const rang = (clé) => bloc.indexOf(clé);
  assert.ok(rang("t('settings.appVersion')") > 0, 'la version d’application n’est pas montrée');
  assert.ok(
    rang("t('settings.appVersion')") < rang("t('settings.editionCount')"),
    'la version doit précéder les décomptes du catalogue',
  );
  assert.ok(rang("t('settings.platform')") < rang("t('settings.editionCount')"));
  assert.ok(rang("t('settings.runtime')") < rang("t('settings.editionCount')"));
});

test('une information absente est tue, jamais écrite « — »', () => {
  // « — » en face de « إصدار التطبيق » se lit comme une application sans
  // version, alors que c'est le dépôt qui n'a pas su la dire.
  const bloc = view.slice(view.indexOf('function aboutSection('), view.indexOf('function dangerSection('));
  assert.match(bloc, /about\.appVersion && \[/);
  assert.match(bloc, /about\.platform && \[/);
  assert.match(bloc, /about\.runtime && \[/);
  assert.match(bloc, /\]\.filter\(Boolean\)/, 'les lignes nulles doivent quitter la grille');
});

test('le nom de la plateforme se traduit par une table écrite en clair', () => {
  // Une clé bâtie à l'exécution se déroberait à `test/i18n.test.js`, qui échoue
  // sur toute chaîne du catalogue que plus aucune source ne cite.
  assert.match(view, /'settings\.platformDesktop'/);
  assert.match(view, /'settings\.platformAndroid'/);
  assert.doesNotMatch(view, /t\(`settings\.platform\.\$\{/);
});

test('le processus principal dit son identité, le dépôt ne la devine pas', () => {
  // `book-repository.js` tourne aussi sous `node --test` : y importer
  // `electron` rendrait la moitié de la suite impossible à monter.
  assert.match(main, /appInfo: \{[\s\S]*?version: app\.getVersion\(\)/);
  assert.match(main, /platform: 'desktop'/);
  assert.match(main, /process\.versions\.electron/);
  const repository = read('../src/main/book-repository.js');
  assert.doesNotMatch(repository, /from 'electron'/);
});
