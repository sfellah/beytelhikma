import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * Le routeur démonte la vue précédente avant de monter la suivante. Comme les
 * vues sont asynchrones, deux navigations rapprochées se chevauchent : la
 * seconde commence pendant que la première attend encore ses données.
 *
 * Ce test tient la propriété qui compte — **aucune vue ne survit à son
 * remplacement**. La panne qu'il interdit était silencieuse : le lecteur pose
 * ses écouteurs sur `document` (flèches, `Ctrl+F`), et une vue jamais démontée
 * continuait de les avaler sur l'écran suivant.
 *
 * Le routeur ne touche ni au DOM ni à Electron : trois bouchons suffisent, et
 * les « vues » sont de simples objets.
 */

let onHashChange = null;
globalThis.window = {
  addEventListener: (type, handler) => {
    if (type === 'hashchange') onHashChange = handler;
  },
};
globalThis.location = { hash: '' };
globalThis.history = { length: 1, back() {} };

const { defineRoutes, start } = await import('../src/renderer/js/router.js');

/** Une vue qui ne rend son objet que lorsqu'on le lui dit. */
function vueDifferee(nom, journal) {
  let libere;
  const attente = new Promise((resolve) => {
    libere = resolve;
  });
  const vue = {
    nom,
    dispose() {
      journal.push(`dispose:${nom}`);
    },
  };
  return {
    vue,
    libere,
    view: async () => {
      journal.push(`monte:${nom}`);
      await attente;
      return vue;
    },
  };
}

test('une vue dépassée est démontée, et c’est la dernière qui reste courante', async () => {
  const journal = [];
  const a = vueDifferee('a', journal);
  const b = vueDifferee('b', journal);
  const c = vueDifferee('c', journal);

  defineRoutes({ '/a': a.view, '/b': b.view, '/c': c.view });
  // Le routeur garde son état d'un appel à l'autre : on part d'un fragment vide
  // pour que `start` se contente de le poser, sans résoudre au passage.
  globalThis.location.hash = '';
  start({}, { initial: '/a' });

  // Deux résolutions se chevauchent : la seconde part avant que la première
  // n'ait rendu sa vue. C'est l'enchaînement d'un double clic sur deux liens,
  // ou d'un `navigate` déclenché par une vue qui se monte.
  globalThis.location.hash = '#/a';
  const premiere = onHashChange();
  globalThis.location.hash = '#/b';
  const seconde = onHashChange();

  a.libere();
  b.libere();
  await Promise.all([premiere, seconde]);

  assert.deepEqual(journal, ['monte:a', 'monte:b', 'dispose:a']);

  // Troisième navigation : si `a` avait été inscrite après coup, c'est elle
  // qu'on démonterait ici — une deuxième fois — et `b` vivrait pour toujours.
  globalThis.location.hash = '#/c';
  const troisieme = onHashChange();
  c.libere();
  await troisieme;

  // L'ordre dit la règle : on démonte **avant** de monter, jamais après.
  assert.deepEqual(journal, ['monte:a', 'monte:b', 'dispose:a', 'dispose:b', 'monte:c']);
});
