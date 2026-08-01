import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

import { estLienExterne, navigationPermise } from '../src/main/navigation.js';

const PAGE = pathToFileURL('/app/src/renderer/index.html').href;

test('la page de l’application est atteignable, fragment et requête compris', () => {
  for (const url of [PAGE, `${PAGE}#/reader/sh-1`, `${PAGE}?x=1#/home`]) {
    assert.equal(navigationPermise(url, PAGE), true, url);
  }
});

/**
 * La propriété qui compte : le preload s'attache à toute navigation de ce
 * `webContents`. Une page atteinte ici hériterait de `window.beytelhikma` en
 * entier — donc de la lecture et de l'écriture des trois bases.
 */
test('rien d’autre n’est atteignable', () => {
  const refusées = [
    'https://exemple.test/',
    'http://127.0.0.1:8080/',
    'data:text/html,<script>1</script>',
    'javascript:void 0',
    pathToFileURL('/app/src/renderer/autre.html').href,
    pathToFileURL('/tmp/piege.html').href,
    'about:blank',
    '',
    null,
  ];
  for (const url of refusées) {
    assert.equal(navigationPermise(url, PAGE), false, `permise à tort : ${String(url)}`);
  }
});

/**
 * `url.startsWith('http')` acceptait aussi `httpfoo://…`, que `openExternal`
 * aurait passé au gestionnaire de protocole du système.
 */
test('seuls http et https partent vers le navigateur du système', () => {
  assert.equal(estLienExterne('https://exemple.test/a'), true);
  assert.equal(estLienExterne('http://exemple.test/a'), true);
  for (const url of ['httpfoo://x', 'file:///C:/Windows/System32/calc.exe', 'ms-msdt:/id', '']) {
    assert.equal(estLienExterne(url), false, `externe à tort : ${url}`);
  }
});

/**
 * La CSP est la seule déclaration de ce que la page peut charger, et le schéma
 * des polices ajoutées y manquait : `font-installer.js` écrivait des règles
 * `userfont://…` que le navigateur refusait en silence — toute la
 * fonctionnalité était morte sans qu'aucun test ne le dise.
 */
test('la CSP autorise le schéma des polices ajoutées, et rien de plus', () => {
  const html = readFileSync(
    fileURLToPath(new URL('../src/renderer/index.html', import.meta.url)),
    'utf8',
  );
  const csp = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)?.[1];
  assert.ok(csp, 'aucune CSP déclarée dans index.html');

  assert.match(csp, /font-src [^;]*userfont:/);
  // Les autres directives ne bougent pas : une police ajoutée ne peut rien
  // exécuter ni styler.
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'self'\s*;/);
  assert.match(csp, /style-src 'self'\s*;/);
  assert.equal(/userfont:/.test(csp.replace(/font-src[^;]*/, '')), false);
});
