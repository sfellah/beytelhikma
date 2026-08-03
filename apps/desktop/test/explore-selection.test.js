import assert from 'node:assert/strict';
import test from 'node:test';

import { installFakeDom } from './fake-dom.js';

/**
 * Le mode sélection de `/explore`, et les cinq défauts qu'il corrige.
 *
 * - **La barre était dans le flux**, au-dessus des résultats : on cochait au
 *   quarantième livre et il fallait remonter tout l'écran pour agir. Elle est
 *   maintenant ancrée en pied d'écran, hors du flux, toujours sous le pouce.
 * - **Le geste retour quittait l'écran** alors qu'un mode était ouvert par
 *   dessus. Il ferme le mode, comme partout ailleurs : une couche à la fois.
 * - **Cocher redessinait toute la grille** — quarante cartes par tape. Une case
 *   ne touche plus que sa carte.
 * - **La case d'un livre installé était désactivée** : on ne pouvait ranger en
 *   collection que ce qu'on n'avait pas lu, l'inverse du geste voulu.
 * - **Le refus se disait après la tape**, par un message. Il se lit maintenant
 *   sur le bouton, avant.
 */

const { document, El } = installFakeDom();

const LIVRES = [
  { editionId: 'ed-1', title: 'الرسالة', downloadStatus: null },
  { editionId: 'ed-2', title: 'الموطأ', downloadStatus: 'installed' },
];

const appels = { peses: [], files: [], ranges: [] };

const repository = {
  exploreBooks: async () => ({ books: LIVRES, total: 2 }),
  getFacets: async () => ({
    categories: [],
    types: [],
    centuries: [],
    status: [],
    authors: [],
    publishers: [],
  }),
  getDownloads: async () => [],
  // Le dépôt ne pèse que ce qui manque : `ed-2` est là, il ne compte pas.
  getSelectionWeight: async (ids) => {
    appels.peses.push([...ids]);
    const manquants = ids.filter((id) => id !== 'ed-2');
    return { count: manquants.length, bytes: manquants.length * 1_000_000 };
  },
  downloadSelection: async (ids) => {
    appels.files.push([...ids]);
    return ids.filter((id) => id !== 'ed-2').length;
  },
  getCollections: async () => [{ id: 'col-1', name: 'قراءاتي', bookCount: 3 }],
  addToCollection: async (id, ids) => {
    appels.ranges.push([id, [...ids]]);
    return ids.length;
  },
  createCollection: async () => 'col-2',
  suggestValues: async () => [],
  getSettings: async () => ({}),
  saveSetting: async () => {},
};

globalThis.window.beytelhikma = { repository, onDownloadsChanged: () => () => {} };

const { exploreView } = await import('../src/renderer/js/views/explore.js');
const { bookCard } = await import('../src/renderer/js/components/book-card.js');
const { runBackIntent } = await import('../src/renderer/js/back-intent.js');
const { t } = await import('../src/renderer/js/i18n.js');
const { formatBytes } = await import('../src/renderer/js/components/download-action.js');
const { LONG_PRESS_MS } = await import('../src/shared/long-press.js');

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const CHARGE = 420;
/** L'antirebond de la pesée est de 200 ms. */
const PESEE = 260;

function clic(node) {
  node.dispatchEvent({ type: 'click', target: node });
}

function touche(node, type, extra = {}) {
  node.dispatchEvent({ type, target: node, pointerType: 'touch', isPrimary: true, ...extra });
}

async function monte() {
  const host = new El('div');
  document.body.append(host);
  const vue = exploreView(host, { query: {} });
  await pause(CHARGE);
  return { host, vue };
}

/** Entre en mode sélection par le bouton, et rend la barre ancrée. */
function selectionne(host) {
  clic(host.querySelector('.explore__select'));
  return host.querySelector('.action-bar');
}

function carte(host, titre) {
  return host.querySelectorAll('.book-card').find((noeud) => noeud.textContent.includes(titre));
}

function action(host, cle) {
  return host.querySelector('.action-bar').querySelector(`[data-action="${cle}"]`);
}

/** La croix de la barre : la sortie, qui n'est pas une action de la rangée. */
function croix(host) {
  return host.querySelector('.action-bar__dismiss');
}

/* ------------------------------------------------------- la carte se coche */

test('un livre installé se coche : sa case n’est pas désactivée', () => {
  const coches = [];
  const vignette = bookCard(LIVRES[1], {
    selectable: true,
    selected: false,
    onToggle: (id, valeur) => coches.push([id, valeur]),
  });

  const case_ = vignette.querySelector('.book-card__check');
  assert.ok(case_, 'la case a disparu de la carte');
  assert.equal(case_.attributes.has('disabled'), false, 'la case de l’installé est désactivée');

  clic(vignette);
  assert.deepEqual(coches, [['ed-2', true]], 'un clic sur la carte installée ne coche pas');
});

test('la case a sa cible de 44 px, portée par l’étiquette', () => {
  const vignette = bookCard(LIVRES[0], { selectable: true, selected: false });
  const cible = vignette.querySelector('.book-card__check-hit');
  assert.ok(cible, 'l’étiquette qui porte la cible manque');
  assert.ok(cible.querySelector('.book-card__check'), 'la case n’est pas dans son étiquette');
});

test('la carte installée porte la pastille qui le dit', () => {
  const installe = bookCard(LIVRES[1], {});
  const pastille = installe.querySelector('.book-card__status--installed');
  assert.ok(pastille, 'la pastille « déjà téléchargé » manque');
  assert.equal(pastille.attributes.get('aria-label'), t('book.installed'));

  const absent = bookCard(LIVRES[0], {});
  assert.equal(
    absent.querySelector('.book-card__status--installed'),
    null,
    'un livre non installé porte la pastille de l’installé',
  );
});

/* --------------------------------------------------------------- l’appui long */

test('un appui long ouvre la sélection et coche la carte visée', async () => {
  const { host, vue } = await monte();

  assert.equal(host.querySelector('.action-bar').hidden, true, 'la barre s’affiche d’elle-même');

  const cible = carte(host, 'الرسالة');
  touche(cible, 'pointerdown', { clientX: 10, clientY: 10 });
  await pause(LONG_PRESS_MS + 40);

  assert.equal(host.querySelector('.action-bar').hidden, false, 'le mode ne s’est pas ouvert');
  assert.ok(
    host.querySelector('.explore__context-count').textContent.includes(t('explore.selected', { count: 1 })),
    'la carte visée n’a pas été cochée',
  );

  vue.dispose();
  host.remove();
});

test('à la souris, maintenir n’ouvre rien : le bureau a son bouton', async () => {
  const { host, vue } = await monte();

  const cible = carte(host, 'الرسالة');
  cible.dispatchEvent({
    type: 'pointerdown',
    target: cible,
    pointerType: 'mouse',
    isPrimary: true,
    clientX: 10,
    clientY: 10,
  });
  await pause(LONG_PRESS_MS + 40);

  assert.equal(host.querySelector('.action-bar').hidden, true, 'la souris a ouvert la sélection');

  vue.dispose();
  host.remove();
});

test('un doigt qui glisse ne coche rien : c’est un défilement', async () => {
  const { host, vue } = await monte();

  const cible = carte(host, 'الرسالة');
  touche(cible, 'pointerdown', { clientX: 10, clientY: 10 });
  touche(cible, 'pointermove', { clientX: 10, clientY: 90 });
  await pause(LONG_PRESS_MS + 40);

  assert.equal(host.querySelector('.action-bar').hidden, true, 'un glissement a ouvert la sélection');

  vue.dispose();
  host.remove();
});

/* --------------------------------------------------- la barre et la bande */

test('la pastille est hors du flux, et l’entête cède la place', async () => {
  const { host, vue } = await monte();

  // Hors mode : l'entête est là, la bande et la pastille non.
  assert.equal(host.querySelector('.explore__header').hidden, false);
  assert.equal(host.querySelector('.explore__context').hidden, true);

  selectionne(host);
  assert.equal(host.querySelector('.explore__header').hidden, true, 'l’entête n’a pas cédé la place');
  assert.equal(host.querySelector('.explore__chips').hidden, true, 'les puces restent pendant qu’on coche');
  assert.equal(host.querySelector('.explore__actions').hidden, true, 'le bouton d’entrée reste visible');

  clic(carte(host, 'الرسالة'));
  await pause(PESEE);
  // Elle est **hors** du corps qui défile : c'est tout le propos.
  assert.equal(
    host.querySelector('.explore__body').querySelector('.action-bar'),
    null,
    'la pastille est retournée dans le flux des résultats',
  );

  vue.dispose();
  host.remove();
});

test('la pastille ne dit qu’une chose : tirer, ou vider', async () => {
  const { host, vue } = await monte();
  selectionne(host);
  clic(carte(host, 'الرسالة'));
  await pause(PESEE);

  const boutons = host.querySelector('.action-bar__row').childNodes;
  assert.equal(boutons.length, 1, 'la pastille porte plus que le tirage');
  assert.ok(action(host, 'download'), 'le tirage manque');
  // Le vidage a quitté la rangée pour la croix : ce n'est pas une action sur ce
  // qui est choisi, et son libellé prenait la place de celui du tirage — qui,
  // lui, porte un compte et une taille et ne se devine pas.
  assert.equal(croix(host).hidden, false, 'le vidage manque');
  assert.equal(croix(host).getAttribute('aria-label'), t('explore.clearSelection'));
  // Ranger dans une collection en est parti : ce n'est pas le geste qu'on fait
  // après avoir coché vingt livres du catalogue. On les prend, puis on les
  // range depuis `/collections` ou la fiche du livre, qui ont ce qu'il faut.
  assert.equal(
    host.querySelector('.action-bar').textContent.includes(t('collection.add')),
    false,
    'la pastille propose encore de ranger dans une collection',
  );

  vue.dispose();
  host.remove();
});

test('la pastille ne flotte que s’il y a quelque chose à en faire', async () => {
  const { host, vue } = await monte();

  selectionne(host);
  assert.equal(
    host.querySelector('.action-bar').hidden,
    true,
    'la pastille occupe le bas de l’écran pour dire qu’on ne peut rien faire',
  );

  clic(carte(host, 'الرسالة'));
  await pause(PESEE);
  assert.equal(host.querySelector('.action-bar').hidden, false, 'la pastille ne s’est pas montrée');
  assert.ok(
    host.querySelector('.action-bar__count').textContent.includes(t('explore.selected', { count: 1 })),
    'la pastille ne dit pas combien de livres sont cochés',
  );

  vue.dispose();
  host.remove();
});

/* --------------------------------------------------------- cocher et peser */

test('cocher une carte ne reconstruit pas la grille', async () => {
  const { host, vue } = await monte();
  selectionne(host);

  const avant = host.querySelectorAll('.book-card');
  clic(carte(host, 'الرسالة'));
  const apres = host.querySelectorAll('.book-card');

  assert.equal(apres.length, avant.length);
  for (const [rang, noeud] of avant.entries()) {
    assert.equal(apres[rang], noeud, `la carte ${rang} a été remplacée pour une case cochée`);
  }
  assert.ok(avant[0].classList.contains('is-selected'), 'la carte cochée ne le montre pas');

  vue.dispose();
  host.remove();
});

test('« cette page » prend aussi les livres installés, et se compte', async () => {
  const { host, vue } = await monte();
  selectionne(host);

  const page = host.querySelector('.explore__context-page');
  assert.equal(page.textContent, t('explore.selectPageCount', { count: 2 }));

  appels.peses.length = 0;
  clic(page);
  await pause(PESEE);

  const dernier = appels.peses.at(-1) ?? [];
  assert.deepEqual([...dernier].sort(), ['ed-1', 'ed-2'], 'l’installé a été écarté de la sélection');
  assert.equal(
    host.querySelector('.explore__context-count').textContent,
    t('explore.selected', { count: 2 }),
  );

  vue.dispose();
  host.remove();
});

test('le bouton de tirage ne pèse que ce qui manque', async () => {
  const { host, vue } = await monte();
  selectionne(host);

  clic(host.querySelector('.explore__context-page'));
  await pause(PESEE);

  assert.equal(
    action(host, 'download').textContent,
    t('explore.downloadCount', { count: 1, size: formatBytes(1_000_000) }),
    'les deux livres cochés ont été comptés comme deux tirages',
  );

  vue.dispose();
  host.remove();
});

test('une sélection entièrement installée porte son refus sur le bouton', async () => {
  const { host, vue } = await monte();
  selectionne(host);

  clic(carte(host, 'الموطأ'));
  await pause(PESEE);

  const tirage = action(host, 'download');
  assert.ok(tirage.attributes.has('disabled'), 'le bouton reste actif sur du déjà installé');
  assert.equal(tirage.textContent, t('explore.allInstalled'), 'le refus ne se lit pas sur le bouton');

  // Et une tape dessus ne demande rien à confirmer, ni n'affiche de message.
  appels.files.length = 0;
  clic(tirage);
  await pause(30);
  assert.equal(document.querySelector('.modal'), null, 'une boîte a demandé de confirmer zéro livre');
  assert.equal(document.querySelector('.toast'), null, 'un message a été affiché après la tape');
  assert.deepEqual(appels.files, [], 'une sélection déjà installée a été mise en file');

  vue.dispose();
  host.remove();
});

test('effacer vide la sélection sans quitter le mode', async () => {
  const { host, vue } = await monte();
  selectionne(host);

  clic(carte(host, 'الرسالة'));
  await pause(PESEE);
  clic(croix(host));
  await pause(PESEE);

  // Le mode reste ouvert — la bande le prouve — mais la pastille se retire :
  // il n'y a plus rien à en faire.
  assert.equal(host.querySelector('.explore__context').hidden, false, 'effacer a quitté le mode');
  assert.equal(host.querySelector('.action-bar').hidden, true, 'la pastille reste sur du vide');
  assert.equal(
    host.querySelector('.explore__context-count').textContent,
    t('explore.selected', { count: 0 }),
  );
  assert.equal(
    carte(host, 'الرسالة').classList.contains('is-selected'),
    false,
    'la carte est restée cochée',
  );

  vue.dispose();
  host.remove();
});

/* ------------------------------------------------------------- les sorties */

test('le geste retour ferme le mode, et ne quitte pas l’écran', async () => {
  const { host, vue } = await monte();

  // Hors mode, l'écran ne consomme rien : le geste appartient à la plateforme.
  assert.equal(runBackIntent(), false, 'le geste a été consommé sans mode ouvert');

  selectionne(host);
  assert.equal(runBackIntent(), true, 'le geste n’a pas été consommé');
  assert.equal(host.querySelector('.explore__context').hidden, true, 'le mode ne s’est pas fermé');
  assert.equal(host.querySelector('.explore__header').hidden, false, 'l’entête n’est pas revenu');

  // Et refermé, il ne consomme plus rien.
  assert.equal(runBackIntent(), false, 'le geste reste consommé après la sortie');

  vue.dispose();
  host.remove();
});

test('Escape et la croix passent par la même sortie', async () => {
  const { host, vue } = await monte();

  selectionne(host);
  document.dispatchEvent({ type: 'keydown', key: 'Escape' });
  assert.equal(host.querySelector('.explore__context').hidden, true, 'Escape n’a pas fermé le mode');

  selectionne(host);
  clic(host.querySelector('.explore__context-close'));
  assert.equal(host.querySelector('.explore__context').hidden, true, 'la croix n’a pas fermé le mode');

  vue.dispose();
  host.remove();
});

test('démonter la vue relâche le geste retour et l’écoute d’Escape', async () => {
  const { host, vue } = await monte();
  selectionne(host);

  vue.dispose();
  host.remove();

  assert.equal(runBackIntent(), false, 'un écran démonté consomme encore le geste retour');
});

/* -------------------------------------------------------------- la collection */

test('ranger dans une collection y mène — depuis le bouton, qui vit ailleurs', async () => {
  const { collectionPickerButton } = await import(
    '../src/renderer/js/components/collection-button.js'
  );

  appels.ranges.length = 0;
  globalThis.location.hash = '#/book/ed-1';
  const bouton = collectionPickerButton(['ed-1']);
  document.body.append(bouton);
  clic(bouton);
  await pause(20);

  const choix = document.querySelector('.picker__list').querySelectorAll('.picker__item');
  assert.ok(choix.length, 'la liste des collections est vide');
  clic(choix[0]);
  await pause(20);

  assert.deepEqual(appels.ranges, [['col-1', ['ed-1']]], 'les livres n’ont pas été rangés');
  assert.equal(
    globalThis.location.hash,
    '#/collection/col-1',
    'on est resté sur place au lieu d’aller voir la collection',
  );

  document.querySelector('.toast')?.remove();
  bouton.remove();
});

/* ------------------------------------------------------------ la mise en forme */

test('la barre est ancrée, ne prend pas le doigt par son fond, et ne défile pas', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(
    new URL('../src/renderer/styles/components.css', import.meta.url),
    'utf8',
  );

  const barre = css.match(/\n\.action-bar \{[^}]*\}/)?.[0] ?? '';
  assert.match(barre, /position:\s*fixed/, 'la pastille est retournée dans le flux');
  assert.match(barre, /inset-inline:\s*0/, 'une propriété physique ne suit pas la bascule RTL');
  assert.match(barre, /--safe-bottom/, 'le retrait du système n’est pas respecté');
  assert.match(barre, /pointer-events:\s*none/, 'le fond de la pastille avalerait le doigt');
  assert.match(
    barre,
    /--safe-left/,
    'les retraits latéraux manquent : une encoche mangerait le bord de la pastille',
  );

  // Ancré en début de ligne : la même classe reparaît indentée sous
  // `prefers-reduced-motion`, et c'est ce bloc-là qu'on attrapait.
  const inner = css.match(/\n\.action-bar__inner \{[^}]*\}/)?.[0] ?? '';
  assert.match(inner, /pointer-events:\s*auto/, 'les boutons ne reçoivent plus le doigt');

  // Jamais de défilement horizontal : c'est le défaut qu'on corrige.
  const rangee = css.match(/\.action-bar__row \{[^}]*\}/)?.[0] ?? '';
  assert.ok(!/overflow-x/.test(rangee), 'la rangée d’actions défile de côté');
  const cible = css.match(/\.action-bar__row > \* \{[^}]*\}/)?.[0] ?? '';
  assert.match(cible, /min-height:\s*44px/, 'les actions n’atteignent pas la cible du pouce');
});

test('la liste se réserve la hauteur de la barre pendant la sélection', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('../src/renderer/styles/views.css', import.meta.url), 'utf8');

  const reserve =
    css.match(/\.explore\[data-selecting\] \.explore__body \{[^}]*\}/)?.[0] ?? '';
  assert.match(reserve, /padding-block-end:/, 'les derniers livres se liraient sous la pastille');
});

test('la pastille flotte au-dessus de la barre d’onglets, jamais dessous', async () => {
  const { readFile } = await import('node:fs/promises');
  const [composants, coque] = await Promise.all([
    readFile(new URL('../src/renderer/styles/components.css', import.meta.url), 'utf8'),
    readFile(new URL('../src/renderer/styles/shell.css', import.meta.url), 'utf8'),
  ]);

  const barre = composants.match(/\n\.action-bar \{[^}]*\}/)?.[0] ?? '';
  const nav = coque.match(/\n\.bottom-nav \{[^}]*\}/)?.[0] ?? '';

  const couche = (bloc) => Number(bloc.match(/z-index:\s*(\d+)/)?.[1] ?? 0);
  assert.ok(couche(nav) > 0, 'la barre d’onglets a perdu sa couche');
  assert.ok(
    couche(barre) > couche(nav),
    // C'est le défaut vécu : à z-index 40 contre 50, la pastille passait sous
    // les onglets. On cochait des livres et il n'y avait, à l'écran, aucune
    // action — le mode paraissait cassé.
    `la pastille (${couche(barre)}) passe sous les onglets (${couche(nav)})`,
  );
  assert.match(
    barre,
    /inset-block-end:\s*calc\(96px \+ var\(--safe-bottom\)\)/,
    'la pastille est collée au bord au lieu de flotter au-dessus des onglets',
  );
});

test('les champs de la barre d’outils tiennent l’écran, à hauteur de pouce', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('../src/renderer/styles/views.css', import.meta.url), 'utf8');

  for (const nom of ['.explore__search', '.explore__sort']) {
    const bloc = css.match(new RegExp(`\\${nom} \\{[^}]*\\}`))?.[0] ?? '';
    assert.match(bloc, /box-sizing:\s*border-box/, `${nom} déborde de sa rangée par sa bordure`);
    assert.match(bloc, /max-width:\s*100%/, `${nom} peut dépasser l’écran`);
    assert.match(bloc, /min-width:\s*0/, `${nom} garde une largeur plancher`);
    assert.match(bloc, /min-height:\s*48px/, `${nom} est trop bas pour le pouce`);
  }
});
