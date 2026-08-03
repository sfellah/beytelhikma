import assert from 'node:assert/strict';
import test from 'node:test';

import { installFakeDom } from './fake-dom.js';

/**
 * Le clavier d'Android se fermait à chaque caractère tapé dans `/explore`.
 *
 * La cause n'était pas le clavier : c'était le champ. Une frappe déclenchait un
 * chargement, et la fin du chargement reconstruisait l'entête entier — donc un
 * `<input>` neuf, l'ancien arraché du document. Un champ arraché perd le focus,
 * et la WebView referme le clavier avec le champ qui l'a ouvert. Sous Electron
 * le même défaut ne coûtait qu'un curseur qui saute en fin de ligne : c'est
 * pourquoi il a vécu.
 *
 * Ces tests tiennent donc l'**identité du nœud**, jamais sa présence : un
 * `querySelector('.explore__search')` non nul passait déjà avant la correction.
 *
 * Le rendu n'a pas de DOM sous `node --test`. On en pose un ici, minimal mais
 * juste sur le point qui compte : **retirer un nœud du document rend le focus
 * au corps**, comme le fait un navigateur. Sans cette règle-là, le test
 * passerait sur le code fautif.
 */

/* ---------------------------------------------------------- un DOM minimal */

// Le bouchon vit dans `test/fake-dom.js`, seul : deux copies dérivent.
const { document, El } = installFakeDom();

/* --------------------------------------------------------- le pont bouchonné */

/** Ce que l'écran demande, et rien de plus : chaque appel est un aller-retour. */
const catalogue = {
  facets: {
    categories: [{ value: 1, label: 'الفقه', count: 12 }],
    types: [{ value: 'كتاب', label: 'كتاب', count: 12 }],
    centuries: [],
    status: [],
    authors: [{ value: 'a1', label: 'ابن حزم', count: 3 }],
    publishers: [],
  },
  books: [],
};

let downloadsListener = null;

const repository = {
  exploreBooks: async () => ({ books: catalogue.books, total: catalogue.books.length }),
  getFacets: async () => catalogue.facets,
  getDownloads: async () => [],
  getSelectionWeight: async () => ({ count: 0, bytes: 0 }),
  suggestValues: async () => [{ value: 'a2', label: 'ابن رشد', count: 5 }],
  getSettings: async () => ({}),
  saveSetting: async () => {},
};

globalThis.window.beytelhikma = {
  repository,
  onDownloadsChanged(callback) {
    downloadsListener = callback;
    return () => {
      downloadsListener = null;
    };
  },
};

const { exploreView } = await import('../src/renderer/js/views/explore.js');

/* ------------------------------------------------------------------- outils */

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** L'antirebond du champ est de 250 ms, celui des facettes de 200 ms. */
const APRES_LA_FRAPPE = 420;

function frappe(champ, texte) {
  champ.focus();
  champ.value = texte;
  champ.dispatchEvent({ type: 'input', target: champ });
}

function monte() {
  const host = new El('div');
  document.body.append(host);
  exploreView(host, { query: {} });
  return host;
}

/* -------------------------------------------------------------------- tests */

test('le champ de recherche survit à deux frappes : même nœud, focus gardé', async () => {
  const host = monte();
  await pause(APRES_LA_FRAPPE);

  const champ = host.querySelector('.explore__search');
  assert.ok(champ, 'le champ de recherche doit exister');

  frappe(champ, 'ا');
  await pause(APRES_LA_FRAPPE);

  // C'est ici que la version d'avant tombait : la fin du chargement
  // reconstruisait l'entête, et `querySelector` rendait un **autre** nœud.
  assert.equal(host.querySelector('.explore__search'), champ, 'le champ a été remplacé');
  assert.equal(champ.isConnected, true, 'le champ a quitté le document');
  assert.equal(document.activeElement, champ, 'le champ a perdu le focus');

  // Deuxième caractère : sans le premier nœud, on ne l'aurait jamais tapé sur
  // un téléphone — le clavier serait déjà refermé.
  frappe(champ, 'اب');
  await pause(APRES_LA_FRAPPE);

  assert.equal(host.querySelector('.explore__search'), champ, 'le champ a été remplacé');
  assert.equal(document.activeElement, champ, 'le champ a perdu le focus');
  assert.equal(champ.value, 'اب', 'la frappe a été écrasée par une réponse en retard');

  host.remove();
});

test('une réponse en retard ne repose pas un terme dépassé dans le champ', async () => {
  const host = monte();
  await pause(APRES_LA_FRAPPE);
  const champ = host.querySelector('.explore__search');

  // La frappe part, puis l'utilisateur continue de taper pendant l'aller-retour.
  frappe(champ, 'اب');
  await pause(300);
  champ.value = 'ابن';
  await pause(APRES_LA_FRAPPE);

  // Lu sur le champ **du document**, pas sur la référence gardée : un champ
  // remplacé emporte la frappe avec lui, et le nœud détaché garderait sa valeur
  // sans que personne ne la voie.
  const vivant = host.querySelector('.explore__search');
  assert.equal(vivant, champ, 'le champ a été remplacé');
  assert.equal(vivant.value, 'ابن', 'le champ a été rembobiné sous les doigts');
  host.remove();
});

test('les champs des facettes survivent à un redessin venu de la file', async () => {
  const host = monte();
  await pause(APRES_LA_FRAPPE);

  const facettes = host.querySelectorAll('.facet__search');
  assert.equal(facettes.length, 2, 'auteur et éditeur ont chacun leur champ');
  const [auteur] = facettes;
  const annees = host.querySelectorAll('.facet__year');
  assert.equal(annees.length, 2);

  frappe(auteur, 'ابن');
  // La file émet à chaque bloc reçu ; l'écran se recharge. C'est le chemin qui
  // arrachait le champ sans qu'on ait rien touché d'autre que le clavier.
  downloadsListener?.([]);
  await pause(APRES_LA_FRAPPE);

  assert.equal(host.querySelector('.facet__search'), auteur, 'le champ auteur a été remplacé');
  assert.equal(document.activeElement, auteur, 'le champ auteur a perdu le focus');
  assert.equal(auteur.value, 'ابن', 'la saisie du champ auteur a été perdue');
  assert.deepEqual([...host.querySelectorAll('.facet__year')], [...annees], 'les bornes d’années ont été remplacées');

  // Le panneau a bien fait son travail malgré tout : la suggestion est arrivée.
  assert.ok(host.querySelector('.facet__suggestion'), 'aucune suggestion peinte');

  host.remove();
});

test('un filtre coché ne remplace ni le champ ni le panneau', async () => {
  const host = monte();
  await pause(APRES_LA_FRAPPE);

  const champ = host.querySelector('.explore__search');
  const panneau = host.querySelector('.facets');
  const auteur = host.querySelector('.facet__search');
  const boite = host.querySelector('.facet__option')?.querySelector('input');
  assert.ok(boite, 'la facette des disciplines doit porter une case');

  boite.dispatchEvent({ type: 'change', target: boite });
  await pause(APRES_LA_FRAPPE);

  assert.equal(host.querySelector('.facets'), panneau, 'le panneau a été remplacé');
  assert.equal(host.querySelector('.explore__search'), champ, 'le champ a été remplacé');
  assert.equal(host.querySelector('.facet__search'), auteur, 'le champ auteur a été remplacé');
  // Le filtre est bien posé : la puce le dit.
  assert.ok(host.querySelector('.chip--removable'), 'aucune puce de filtre actif');

  host.remove();
});
