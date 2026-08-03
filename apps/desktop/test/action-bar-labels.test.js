import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { installFakeDom } from './fake-dom.js';

/**
 * La barre de lot, et la troisième forme d'un même défaut.
 *
 * Le commentaire du composant promettait « trois actions au plus, jamais de
 * défilement horizontal » : une action qu'il faut aller chercher n'est pas une
 * action. L'abrègement en est la variante silencieuse, et elle n'était pas
 * nommée. Sur un téléphone de 407 dp, la barre de `/downloads` affichait
 * « ٢ محدَّد » puis trois moignons — « ت… », « لا… », « إلغاء ال… ». Le calcul
 * tenait en une ligne : `width: max-content` borné à `min(94vw, 560px)`, le
 * décompte en `flex: none`, les trois boutons en `flex: 1 1 0` avec
 * `min-width: 0` et un `text-overflow: ellipsis` pour finir — une quarantaine
 * de dp de texte par bouton, une fois les icônes, les gouttières et le
 * rembourrage retirés. Une action qu'on ne peut pas lire ne vaut pas mieux
 * qu'une action hors champ : on la touche pour savoir ce qu'elle fait.
 *
 * La règle écrite ici : **un libellé d'action ne s'abrège jamais.** S'il ne
 * tient pas, c'est la barre qui se réorganise. Et la sortie du mode quitte la
 * rangée pour une croix — elle se lit sans mot, contrairement à
 * « télécharger » et « supprimer ».
 *
 * Vérifications statiques pour la mise en forme (elle est hors de portée d'un
 * test de comportement, comme celles du thème, des polices et des grilles), et
 * un montage réel pour la croix et le plafond d'actions.
 */

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const composants = read('../src/renderer/styles/components.css');

/** Les règles dont le sélecteur cite [prefixe], commentaires retirés. */
function regles(source, prefixe) {
  const nu = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const trouvees = [...nu.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(([, selecteur, corps]) => [selecteur.trim(), corps])
    .filter(([selecteur]) => selecteur.includes(prefixe));
  assert.notEqual(trouvees.length, 0, `aucune règle ne cite ${prefixe}`);
  return trouvees;
}

/** Les déclarations de [selecteur] exactement, blocs réunis. */
function bloc(source, selecteur) {
  const corps = regles(source, selecteur)
    .filter(([nom]) =>
      nom
        .split(',')
        .map((part) => part.trim().replace(/^@media[^{]*\s/, ''))
        .includes(selecteur),
    )
    .map(([, body]) => body)
    .join('\n');
  assert.notEqual(corps, '', `sélecteur introuvable : ${selecteur}`);
  return corps;
}

/* ------------------------------------------- un libellé ne s'abrège jamais */

test('aucun libellé de la barre n’est coupé par une ellipse', () => {
  for (const [selecteur, corps] of regles(composants, '.action-bar')) {
    assert.ok(
      !/text-overflow/.test(corps),
      `${selecteur} coupe son texte : c'est le défaut qu'on corrige`,
    );
    // `nowrap` sans ellipse ne coupe pas les mots — il les fait déborder, ce
    // qui est pire : le texte sort de la pastille au lieu de passer à la ligne.
    assert.ok(!/white-space:\s*nowrap/.test(corps), `${selecteur} interdit à son texte de replier`);
  }
});

test('un bouton d’action part à sa taille naturelle, il ne s’écrase pas', () => {
  const cible = bloc(composants, '.action-bar__row > *');
  // C'est le couple `flex: 1 1 0` + `min-width: 0` qui autorisait un bouton à
  // descendre sous la largeur de son propre libellé.
  assert.ok(!/flex:\s*1 1 0/.test(cible), 'les actions se partagent encore la largeur au forceps');
  assert.ok(!/min-width:\s*0/.test(cible), 'une action peut encore passer sous sa largeur minimale');
  assert.match(cible, /min-height:\s*44px/, 'les actions n’atteignent pas la cible du pouce');

  // Et le texte a où couper si un mot dépasse à lui seul. `break-word` et non
  // `anywhere` : `anywhere` abaisse la largeur minimale du bouton à un
  // caractère, et il se laisserait alors écraser en colonne de lettres au lieu
  // de passer à la ligne suivante.
  const libelle = bloc(composants, '.action-bar__row > * > span');
  assert.match(libelle, /overflow-wrap:\s*break-word/);
});

/* --------------------------------------------- la barre se replie, elle ne déborde pas */

test('la barre se réorganise au lieu de rogner', () => {
  const inner = bloc(composants, '.action-bar__inner');
  assert.match(inner, /flex-wrap:\s*wrap/, 'la rangée ne peut pas passer sous le décompte');
  const rangee = bloc(composants, '.action-bar__row');
  assert.match(rangee, /flex-wrap:\s*wrap/, 'les deux actions ne peuvent pas passer l’une sous l’autre');
});

test('la largeur maximale se compte dans la boîte, retraits du système déduits', () => {
  const inner = bloc(composants, '.action-bar__inner');
  const [, maxi] = inner.match(/max-width:\s*([^;]+);/) ?? [];
  assert.ok(maxi, 'la pastille n’a plus de largeur maximale');
  // `vw` mesure la fenêtre entière, encoche comprise, alors que `.action-bar`
  // s'est déjà rentrée de `--safe-left` et `--safe-right` : la pastille se
  // promettait une largeur qu'elle n'avait pas.
  assert.ok(!/vw/.test(maxi), `la largeur maximale se mesure en fenêtre : ${maxi}`);
  assert.match(maxi, /100%/, 'la largeur maximale ne se borne pas à la boîte du parent');

  // Et les retraits sont bien posés, physiquement : une encoche ne change pas
  // de côté quand l'interface bascule en RTL.
  const barre = bloc(composants, '.action-bar');
  assert.ok(barre.includes('var(--safe-left)') && barre.includes('var(--safe-right)'));
  assert.ok(
    !/padding-inline-(start|end):[^;]*--safe-(left|right)/.test(barre),
    'un retrait latéral a été posé en propriété logique',
  );
});

test('rien dans la barre ne défile de côté', () => {
  for (const [selecteur, corps] of regles(composants, '.action-bar')) {
    assert.ok(!/overflow-x/.test(corps), `${selecteur} défile de côté`);
  }
});

/* -------------------------------------------------------------- la croix */

test('la croix atteint la cible du pouce, comme les actions', () => {
  const croix = bloc(composants, '.action-bar__dismiss');
  assert.match(croix, /inline-size:\s*44px/);
  assert.match(croix, /block-size:\s*44px/);
  // Elle ne se partage pas la largeur : sa place est fixe.
  assert.match(croix, /flex:\s*none/);
});

/* ------------------------------------------------------------ le composant */

const { document, El } = installFakeDom();
// Le composant tire les icônes, qui tirent la locale, qui tire le dépôt : le
// pont doit exister avant le premier import, comme dans les autres tests de vue.
globalThis.window.beytelhikma = {
  repository: { getSettings: async () => ({}), saveSetting: async () => {} },
  onDownloadsChanged: () => () => {},
};
const { actionBar, MAX_ACTIONS } = await import('../src/renderer/js/components/action-bar.js');

function monte(options) {
  const hote = new El('div');
  document.body.append(hote);
  const barre = actionBar(options);
  hote.append(barre.node);
  return { hote, barre };
}

test('la croix porte son libellé : une icône seule ne se lit pas', () => {
  const { hote, barre } = monte();
  const croix = hote.querySelector('.action-bar__dismiss');
  assert.ok(croix, 'la barre n’a pas de croix');
  // Sans sortie déclarée, elle n'est pas là du tout — un bouton qui ne fait
  // rien est pire qu'un bouton manquant.
  assert.equal(croix.hidden, true, 'une croix sans destination reste affichée');

  let sorties = 0;
  barre.update({ dismiss: { label: 'إلغاء التحديد', onPick: () => (sorties += 1) } });
  assert.equal(croix.hidden, false);
  assert.equal(croix.getAttribute('aria-label'), 'إلغاء التحديد');
  assert.equal(croix.getAttribute('title'), 'إلغاء التحديد');

  croix.dispatchEvent({ type: 'click', target: croix });
  assert.equal(sorties, 1, 'la croix ne fait rien');
  hote.remove();
});

test('la croix n’est pas une action : elle n’entre pas dans la rangée', () => {
  const { hote, barre } = monte();
  barre.update({
    label: '٢ محدَّد',
    dismiss: { label: 'إلغاء التحديد', onPick: () => {} },
    actions: [{ key: 'download', label: 'تنزيل' }],
  });
  const rangee = hote.querySelector('.action-bar__row');
  assert.equal(rangee.children.length, 1, 'la croix a été comptée comme une action');
  assert.equal(hote.querySelector('.action-bar__count').textContent, '٢ محدَّد');
  hote.remove();
});

test('la rangée est plafonnée à deux actions', () => {
  assert.equal(MAX_ACTIONS, 2);
  const { hote, barre } = monte();
  barre.update({
    actions: [
      { key: 'a', label: 'أ' },
      { key: 'b', label: 'ب' },
      { key: 'c', label: 'ج' },
    ],
  });
  assert.equal(hote.querySelector('.action-bar__row').children.length, MAX_ACTIONS);
  hote.remove();
});

/* ---------------------------------------------------------- les appelants */

/** L'objet littéral qui suit [ouverture] dans [source], accolades appariées. */
function objet(source, ouverture) {
  const debut = source.indexOf(ouverture);
  assert.notEqual(debut, -1, `appel introuvable : ${ouverture}`);
  let profondeur = 0;
  for (let index = debut + ouverture.length - 1; index < source.length; index += 1) {
    if (source[index] === '{') profondeur += 1;
    else if (source[index] === '}') {
      profondeur -= 1;
      if (profondeur === 0) return source.slice(debut, index + 1);
    }
  }
  throw new Error(`accolade non refermée : ${ouverture}`);
}

test('aucun appelant ne passe plus de deux actions', () => {
  // Le plafond du composant tronque en silence : un appelant qui en passe trois
  // en perdrait une sans que rien ne le dise. C'est ici qu'on l'apprend.
  const appelants = [
    ['downloads.js', '../src/renderer/js/views/downloads.js', 'this.#nodes.bulk.update({'],
    ['explore.js', '../src/renderer/js/views/explore.js', 'bar.update({'],
    ['collections.js', '../src/renderer/js/views/collections.js', 'bar.update({'],
  ];

  for (const [nom, chemin, appel] of appelants) {
    const bloc_ = objet(read(chemin), appel).replace(/\/\/[^\n]*/g, '');
    const actions = [...bloc_.matchAll(/\bkey:\s*'/g)].length;
    assert.ok(actions <= MAX_ACTIONS, `${nom} passe ${actions} actions à la barre`);
  }
});

test('les trois appelants sortent du mode par la croix', () => {
  for (const chemin of [
    '../src/renderer/js/views/downloads.js',
    '../src/renderer/js/views/explore.js',
    '../src/renderer/js/views/collections.js',
  ]) {
    const source = read(chemin);
    assert.match(source, /dismiss: \{/, `${chemin} n’offre aucune sortie de mode`);
    // Le libellé passe par `t()` : aucun littéral dans le rendu.
    assert.match(source, /dismiss: \{\s*label: t\(/, `${chemin} écrit le libellé de sa croix en dur`);
  }
});
