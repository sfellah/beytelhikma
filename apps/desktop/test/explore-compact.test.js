import assert from 'node:assert/strict';
import test from 'node:test';

import { installFakeDom } from './fake-dom.js';

/**
 * Sur un téléphone, `/explore` répondait sans qu'on le voie.
 *
 * L'entête empilait quatre rangées — un titre de 40 px, le total, le champ, le
 * tri —, puis les puces, puis la colonne de facettes dépliée en pleine hauteur :
 * six disciplines, deux types, quinze siècles, deux champs d'autocomplétion et
 * deux bornes d'années. Les premiers livres commençaient deux écrans plus bas.
 * On tapait un terme, on ne voyait rien bouger, et l'on concluait que la
 * recherche n'avait rien rendu.
 *
 * Ces tests tiennent la **forme** de ce qui reste en permanence sous les yeux —
 * une rangée : champ, tri, déclencheur de filtres — et le **comportement** de
 * la feuille qui porte désormais les facettes. Rien ici ne regarde le CSS : ce
 * qu'on éprouve est la structure que le CSS met en forme, et la bascule entre
 * les deux mises en forme est une media query, donc hors de portée d'un test.
 */

const { document, El } = installFakeDom();

/* --------------------------------------------------------- le pont bouchonné */

const catalogue = {
  facets: {
    categories: [
      { value: 1, label: 'الفقه', count: 12 },
      { value: 2, label: 'الحديث', count: 7 },
    ],
    types: [{ value: 'كتاب', label: 'كتاب', count: 12 }],
    centuries: [],
    status: [{ value: 'installed', label: 'مثبَّت', count: 2 }],
    authors: [{ value: 'a1', label: 'ابن حزم', count: 3 }],
    publishers: [],
  },
  // Une seule page de résultats, mais un total qui vient de SQL et le dépasse :
  // c'est le total qui doit s'afficher, jamais le compte des lignes reçues.
  books: [{ editionId: 'ed-1', title: 'الرسالة', downloadStatus: 'none' }],
  total: 8568,
};

const repository = {
  exploreBooks: async () => ({ books: catalogue.books, total: catalogue.total }),
  getFacets: async () => catalogue.facets,
  getDownloads: async () => [],
  getSelectionWeight: async () => ({ count: 0, bytes: 0 }),
  suggestValues: async () => [],
  getSettings: async () => ({}),
  saveSetting: async () => {},
};

globalThis.window.beytelhikma = {
  repository,
  onDownloadsChanged: () => () => {},
};

const { exploreView } = await import('../src/renderer/js/views/explore.js');
const { countActive } = await import('../src/renderer/js/components/facet-panel.js');
const { runBackIntent } = await import('../src/renderer/js/back-intent.js');
const { n, t } = await import('../src/renderer/js/i18n.js');

/* ------------------------------------------------------------------- outils */

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** L'antirebond du champ est de 250 ms, celui des facettes de 200 ms. */
const CHARGE = 420;

function clic(node) {
  node.dispatchEvent({ type: 'click', target: node });
}

async function monte(query = {}) {
  const host = new El('div');
  document.body.append(host);
  const vue = exploreView(host, { query });
  await pause(CHARGE);
  return { host, vue };
}

function puces(host) {
  return host.querySelector('.explore__chips').querySelectorAll('.chip--removable');
}

/* ------------------------------------------------- ce qui reste sous les yeux */

test('la rangée permanente porte le champ, le tri et le déclencheur de filtres', async () => {
  const { host, vue } = await monte();

  const barre = host.querySelector('.explore__toolbar');
  assert.ok(barre, 'la barre d’outils doit exister');

  // Les trois dans la **même** rangée : c'est ce qui les empêche de s'empiler.
  assert.ok(barre.querySelector('.explore__search'), 'le champ a quitté la rangée');
  assert.ok(barre.querySelector('.explore__sort'), 'le tri a quitté la rangée');
  assert.ok(barre.querySelector('.facets__trigger'), 'le déclencheur a quitté la rangée');

  // Et le déclencheur ne vit **pas** dans le panneau : sinon il disparaîtrait
  // avec lui quand la feuille est fermée, et rien ne l'ouvrirait plus.
  assert.equal(
    host.querySelector('.facets').querySelector('.facets__trigger'),
    null,
    'le déclencheur est resté dans le panneau',
  );

  vue.dispose();
  host.remove();
});

test('le total affiché est celui de SQL, jamais le compte des lignes reçues', async () => {
  const { host, vue } = await monte();

  const dit = host.querySelector('.explore__heading').textContent;
  assert.ok(dit.includes(n(catalogue.total)), `le total de SQL manque : ${dit}`);
  assert.equal(catalogue.books.length, 1, 'le bouchon doit rendre moins de lignes que le total');
  assert.ok(!dit.includes(n(1)), 'le compte des lignes reçues a été affiché');

  vue.dispose();
  host.remove();
});

/* ------------------------------------------------------- la feuille de filtres */

test('le déclencheur ouvre la feuille, la croix la referme', async () => {
  const { host, vue } = await monte();

  const panneau = host.querySelector('.facets');
  const declencheur = host.querySelector('.facets__trigger');

  assert.equal(panneau.hasAttribute('data-open'), false, 'la feuille s’ouvre d’elle-même');
  assert.equal(declencheur.getAttribute('aria-expanded'), 'false');

  clic(declencheur);
  assert.equal(panneau.hasAttribute('data-open'), true, 'la feuille ne s’est pas ouverte');
  assert.equal(declencheur.getAttribute('aria-expanded'), 'true');

  clic(host.querySelector('.facets__close'));
  assert.equal(panneau.hasAttribute('data-open'), false, 'la croix n’a pas refermé');
  assert.equal(declencheur.getAttribute('aria-expanded'), 'false');

  // Le même bouton bascule dans les deux sens.
  clic(declencheur);
  clic(declencheur);
  assert.equal(panneau.hasAttribute('data-open'), false, 'le déclencheur ne bascule pas');

  vue.dispose();
  host.remove();
});

test('une tape sur le voile referme, une tape dans la feuille non', async () => {
  const { host, vue } = await monte();
  const panneau = host.querySelector('.facets');

  clic(host.querySelector('.facets__trigger'));

  // Le voile **est** le panneau : ce qui l'atteint n'a touché aucune feuille.
  clic(panneau);
  assert.equal(panneau.hasAttribute('data-open'), false, 'le voile n’a pas refermé');

  clic(host.querySelector('.facets__trigger'));
  // La feuille bulle jusqu'au panneau, mais porte sa propre cible : c'est cette
  // distinction-là qui empêche de refermer en touchant un filtre.
  host.querySelector('.facets__sheet').dispatchEvent({ type: 'click' });
  assert.equal(panneau.hasAttribute('data-open'), true, 'une tape dans la feuille a refermé');

  vue.dispose();
  host.remove();
});

test('le bouton d’application referme et ramène les résultats sous les yeux', async () => {
  const { host, vue } = await monte();

  document.scrolledInto = null;
  clic(host.querySelector('.facets__trigger'));
  assert.equal(document.scrolledInto, null, 'ouvrir la feuille ne doit rien faire défiler');

  clic(host.querySelector('.facets__apply'));
  assert.equal(host.querySelector('.facets').hasAttribute('data-open'), false);
  assert.equal(
    document.scrolledInto,
    host.querySelector('.explore__results'),
    'les résultats ne sont pas revenus à l’écran',
  );

  vue.dispose();
  host.remove();
});

test('le geste retour ferme la feuille avant de quitter l’écran', async () => {
  const { host, vue } = await monte();
  const panneau = host.querySelector('.facets');

  // Feuille fermée : le geste n'appartient pas à cet écran, il passe.
  assert.equal(runBackIntent(), false, 'le geste a été consommé sans rien à fermer');

  clic(host.querySelector('.facets__trigger'));
  assert.equal(runBackIntent(), true, 'le geste n’a pas été consommé');
  assert.equal(panneau.hasAttribute('data-open'), false, 'la feuille est restée ouverte');

  // Démonter l'écran retire le gestionnaire : sinon il fermerait une feuille
  // qui n'est plus au document, et mangerait le geste de l'écran suivant.
  vue.dispose();
  assert.equal(runBackIntent(), false, 'le gestionnaire a survécu au démontage');

  host.remove();
});

/* ------------------------------------------------- le compte des filtres posés */

test('countActive compte chaque valeur, le statut et la borne d’années', () => {
  assert.equal(countActive({}), 0);
  assert.equal(countActive({ categories: [1, 2], types: ['كتاب'] }), 3);
  // Le statut n'accepte qu'une valeur : il pèse un, pas la longueur d'un tableau.
  assert.equal(countActive({ status: 'installed' }), 1);
  // Les deux bornes d'années sont **un** filtre : c'est un intervalle.
  assert.equal(countActive({ years: { from: 300, to: 400 } }), 1);
  assert.equal(countActive({ years: { from: 300 } }), 1);
  // Le texte cherché n'est pas un filtre : il a son champ, toujours visible.
  assert.equal(countActive({ text: 'نحو' }), 0);
  assert.equal(
    countActive({ categories: [1], status: 'installed', years: { to: 400 }, publishers: ['p1'] }),
    4,
  );
});

test('le déclencheur annonce le nombre de filtres posés, et se tait à zéro', async () => {
  const { host, vue } = await monte({ categories: '1,2', status: 'installed' });

  const badge = host.querySelector('.facets__badge');
  assert.equal(badge.hidden, false, 'la pastille doit se voir quand un filtre est posé');
  assert.equal(badge.textContent, n(3), 'la pastille ne dit pas le bon compte');
  assert.equal(
    host.querySelector('.facets__trigger').getAttribute('aria-label'),
    t('explore.filtersCount', { count: 3 }),
    'le déclencheur ne dit pas ce que la pastille montre',
  );

  vue.dispose();
  host.remove();

  const vide = await monte();
  const muet = vide.host.querySelector('.facets__badge');
  assert.equal(muet.hidden, true, 'la pastille parle sans filtre');
  assert.equal(muet.textContent, '', 'la pastille garde un chiffre sans filtre');

  vide.vue.dispose();
  vide.host.remove();
});

/* --------------------------------------------- les puces des filtres actifs */

test('chaque filtre posé a sa puce, et une tape ne retire que celle-là', async () => {
  const { host, vue } = await monte({ categories: '1,2', types: 'كتاب' });

  const avant = puces(host);
  assert.equal(avant.length, 3, 'une puce par filtre posé');
  // La puce porte le libellé de la facette, pas la valeur brute du catalogue.
  assert.ok(avant[0].textContent.includes('الفقه'), 'la puce ne porte pas son libellé');

  clic(avant[0]);
  await pause(CHARGE);

  const apres = puces(host);
  assert.equal(apres.length, 2, 'la tape n’a pas retiré exactement une puce');
  assert.equal(
    apres.some((puce) => puce.textContent.includes('الفقه')),
    false,
    'la puce retirée est toujours là',
  );
  assert.equal(
    apres.some((puce) => puce.textContent.includes('الحديث')),
    true,
    'une puce voisine a été emportée',
  );

  // Et le compte du déclencheur suit : c'est le même état.
  assert.equal(host.querySelector('.facets__badge').textContent, n(2));

  vue.dispose();
  host.remove();
});

test('les puces restent visibles hors de la feuille : elles ne sont pas dans le panneau', async () => {
  const { host, vue } = await monte({ categories: '1' });

  const puce = puces(host)[0];
  assert.ok(puce, 'aucune puce peinte');
  assert.equal(puce.closest('.facets'), null, 'les puces se sont réfugiées dans la feuille');

  vue.dispose();
  host.remove();
});
