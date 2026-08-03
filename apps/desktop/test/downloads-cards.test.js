import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/**
 * La table des téléchargements sur un téléphone, et le défaut « je ne sais pas
 * ce que j'ai déjà ».
 *
 * Sept colonnes — case, livre, champ, pages, taille, statut, actions — réclament
 * près de 880 px pour tenir. En deçà, `.books-table__scroll` défile **de côté**
 * et « الحالة » est six colonnes plus loin : sur un appareil de 407 dp on ne voit
 * que la case et le titre, et rien ne distingue un livre installé d'un livre
 * absent. Une table qu'il faut pousser de côté ne se pousse jamais.
 *
 * Le remède est une repeinte, pas un second rendu : le même `<table>`, les mêmes
 * cellules, le même ordre dans le DOM, réordonnés par `grid-area`. Deux gabarits
 * en JS dériveraient l'un de l'autre — c'est la leçon du thème mort et de la
 * liste de polices déclarée deux fois.
 *
 * Vérifications statiques, comme celles de la densité des grilles, du thème et
 * des polices : la mise en forme est hors de portée d'un test de comportement.
 */

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const views = read('../src/renderer/styles/views.css');
const view = read('../src/renderer/js/views/downloads.js');
const icons = read('../src/renderer/js/icons.js');
const ar = read('../src/renderer/js/locales/ar.js');
const en = read('../src/renderer/js/locales/en.js');

/** Le corps de la règle @media qui contient [needle], et sa requête. */
function media(source, needle) {
  const marker = source.indexOf(needle);
  assert.notEqual(marker, -1, `introuvable dans la feuille : ${needle}`);
  const start = source.lastIndexOf('@media', marker);
  assert.notEqual(start, -1, `${needle} n'est sous aucune règle @media`);

  const open = source.indexOf('{', start);
  let depth = 0;
  let end = open;
  for (; end < source.length; end += 1) {
    if (source[end] === '{') depth += 1;
    else if (source[end] === '}' && (depth -= 1) === 0) break;
  }
  assert.ok(end > marker, `${needle} déborde de la règle @media qui le précède`);
  return {
    start,
    query: source.slice(start, open).trim(),
    body: source.slice(open + 1, end),
  };
}

/** Les déclarations de [selector] dans [source], commentaires retirés. */
function bloc(source, selector) {
  const nu = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const regles = [...nu.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((regle) =>
    regle[1]
      .split(',')
      .map((part) => part.trim())
      .includes(selector),
  );
  assert.notEqual(regles.length, 0, `sélecteur introuvable : ${selector}`);
  return regles.map((regle) => regle[2]).join('\n');
}

const fiches = media(views, '.books-table tbody {');

/* ------------------------------------------------------ le seuil, et un seul */

test('le seuil des fiches est celui du régime au doigt, pas un second point de rupture', () => {
  // 900 px couvre par construction toute la plage où les sept colonnes ne
  // tiennent pas (~880 px mesurés). Un seuil plus bas laisserait la table
  // défiler de côté entre les deux, c'est-à-dire laisserait le défaut intact ;
  // un seuil de plus serait une seconde valeur à tenir en accord avec la
  // première.
  assert.match(fiches.query, /@media \(max-width: 900px\)/);

  // Et c'est **le même** seuil que celui du régime au doigt, celui qui porte
  // déjà les cibles de 44 px : une valeur, pas deux à tenir en accord.
  const doigt = media(views, '  .books-table__check {\n    min-height: 44px;');
  assert.equal(fiches.query, doigt.query, 'la repeinte s’est donné un seuil à elle');
});

/* ------------------------------- le statut hors de toute boîte qui défile */

test('sous le seuil, rien du livre ne se lit derrière un défilement latéral', () => {
  // C'est tout le défaut : la pastille était six colonnes plus loin, dans une
  // boîte qu'il fallait pousser de côté.
  assert.match(bloc(fiches.body, '.books-table__scroll'), /overflow-x:\s*visible/);

  // Et la boîte ne peut pas revenir par une autre porte : aucune règle des
  // fiches ne rétablit un défilement.
  assert.doesNotMatch(fiches.body, /overflow-x:\s*(auto|scroll)/);
});

test('la pastille de statut est en tête de fiche, avant le titre', () => {
  const carte = bloc(fiches.body, '.books-table tbody tr');
  const zones = carte.match(/grid-template-areas:([^;]*);/);
  assert.ok(zones, 'la fiche ne déclare aucune disposition');

  const lignes = [...zones[1].matchAll(/'([^']*)'/g)].map(([, ligne]) => ligne.trim().split(/\s+/));
  assert.ok(lignes.length >= 3, 'la fiche a moins de trois lignes');
  assert.equal(lignes[0][0], 'state', 'la première ligne de la fiche n’est pas le statut');
  assert.ok(
    lignes.some((ligne) => ligne.includes('book')),
    'le titre a disparu de la fiche',
  );
  assert.ok(
    lignes.some((ligne) => ligne.includes('acts')),
    'les actions de ligne ont disparu de la fiche',
  );

  // Et la cellule du statut est bien celle qui prend cette place : sixième dans
  // le DOM, première à l'écran. C'est ce que `grid-area` permet, et c'est
  // pourquoi le rendu n'est pas dupliqué.
  assert.match(bloc(fiches.body, '.books-table tbody td:nth-child(6)'), /grid-area:\s*state/);
});

/* ------------------------------------------- le mot, jamais le dessin seul */

test('le statut porte son mot dans le DOM, et rien ne le masque', () => {
  // Une icône seule ne s'annonce pas au lecteur d'écran : le libellé est dans la
  // pastille, à côté du dessin.
  const ligne = view.slice(view.indexOf('  #bookRow(row) {'), view.indexOf('  #rowActions('));
  assert.match(ligne, /icon\(glyph, \{ size: 14 \}\)/);
  assert.match(ligne, /h\('span', \{\}, status === 'failed' \? \(row\.error \?\? t\(label\)\) : t\(label\)\)/);

  // Et la repeinte ne l'efface pas au passage : ni la pastille, ni le mot
  // qu'elle porte, ne sont cachés sous le seuil.
  const nu = fiches.body.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [, selecteurs, corps] of nu.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/display:\s*none/.test(corps)) continue;
    assert.ok(
      !/books-table__badge|books-table__status|nth-child\(6\)/.test(selecteurs),
      `la repeinte masque le statut : ${selecteurs.trim()}`,
    );
  }
});

test('les six statuts ont chacun leur mot, leur teinte et leur dessin', () => {
  const table = view.slice(view.indexOf('const STATUS_LABELS = {'), view.indexOf('const MISSING_STATUS'));
  const etats = [
    ...[...table.matchAll(/(\w+): \['([^']+)', '([^']+)', '([^']+)'\]/g)].map(
      ([, clef, mot, teinte, dessin]) => ({ clef, mot, teinte, dessin }),
    ),
    (([, mot, teinte, dessin]) => ({ clef: 'missing', mot, teinte, dessin }))(
      view.match(/MISSING_STATUS = \['([^']+)', '([^']+)', '([^']+)'\]/) ?? [],
    ),
  ];

  // Cinq statuts de la file, plus l'absence — qui est un état, pas un défaut
  // d'état.
  assert.deepEqual(
    etats.map((etat) => etat.clef),
    ['installed', 'queued', 'downloading', 'verifying', 'failed', 'missing'],
  );

  for (const { clef, mot, teinte, dessin } of etats) {
    assert.match(ar, new RegExp(`'${mot}':`), `« ${clef} » n’a pas de mot en arabe`);
    assert.match(en, new RegExp(`'${mot}':`), `« ${clef} » n’a pas de mot en anglais`);
    assert.match(
      views,
      new RegExp(`\\.books-table__badge\\.${teinte} \\{`),
      `« ${clef} » porte une teinte qu’aucune règle ne peint`,
    );
    assert.match(
      icons,
      new RegExp(`^  ${dessin}:`, 'm'),
      `« ${clef} » porte un dessin qui n’existe pas`,
    );
  }

  // « je l'ai », « c'est en cours », « ça a échoué », « je ne l'ai pas » : quatre
  // réponses, quatre teintes. Sans quoi la couleur ne dirait plus rien.
  assert.equal(new Set(etats.map((etat) => etat.teinte)).size, 4);
});

/* -------------------------------------------- une seule table, une seule fois */

test('la repeinte est en CSS : le rendu ne connaît aucun seuil', () => {
  // Deux gabarits en JS dériveraient l'un de l'autre. Le DOM est le même des
  // deux côtés du seuil, à la feuille près.
  for (const piege of [/matchMedia/, /innerWidth/, /900/, /clientWidth/]) {
    assert.doesNotMatch(view, piege, `le rendu mesure la fenêtre : ${piege}`);
  }

  const dessin = view.slice(view.indexOf('  #drawTable({ rows }) {'), view.indexOf('  #bookRow(row) {'));
  assert.equal([...dessin.matchAll(/'table',/g)].length, 1, 'le rendu construit deux tables');
  assert.equal([...dessin.matchAll(/'tbody'/g)].length, 1);
});

test('les deux mots que la fiche ajoute sont posés une fois, et masqués par la feuille', () => {
  // La ligne d'en-tête perd ses libellés de colonnes : ce que coche sa case et
  // ce que compte le nombre de pages doivent alors se dire. Ils sont dans le
  // rendu unique, et c'est la feuille qui décide s'ils se voient.
  assert.match(view, /class: 'books-table__pick-text' \}, t\('downloads\.selectPage'\)/);
  assert.match(view, /class: 'books-table__unit' \}, t\('downloads\.pagesUnit'\)/);
  for (const catalogue of [ar, en]) {
    assert.match(catalogue, /'downloads\.pagesUnit':/);
  }

  // Masqués par défaut, montrés sous le seuil : jamais l'inverse, sinon la table
  // dirait deux fois la même chose.
  assert.match(
    views.slice(0, fiches.start),
    /\.books-table__pick-text,\s*\.books-table__unit \{\s*display: none;/,
  );
  assert.match(fiches.body, /\.books-table__pick-text,\s*\.books-table__unit \{\s*display: inline;/);
});

test('cocher la page reste possible en fiches : l’en-tête garde sa seule commande', () => {
  // Hors de la table, le `thead` n'a plus de colonnes à nommer — mais sa case
  // coche la page affichée, et c'est le seul endroit qui le fait.
  assert.match(fiches.body, /\.books-table thead th:not\(\.books-table__pick\) \{\s*display: none;/);
  assert.match(bloc(fiches.body, '.books-table th.books-table__pick'), /display:\s*block/);
});

/* -------------------------------------------------- rien ne déborde de côté */

test('les fiches ne rouvrent pas le débordement qu’elles réparent', () => {
  // Le plancher de la piste est borné par la largeur disponible : sans cette
  // borne, la grille déborderait au lieu de retomber sur une colonne, et ce
  // serait la page entière qui défilerait de côté.
  assert.match(
    bloc(fiches.body, '.books-table tbody'),
    /repeat\(auto-fill,\s*minmax\(min\(20rem,\s*100%\),\s*1fr\)\)/,
  );

  // Les cellules peuvent se comprimer : une piste `auto` a pour plancher son
  // mot le plus long, et un titre arabe agrandi par la taille d'affichage du
  // système pousserait la fiche hors de l'écran.
  assert.match(bloc(fiches.body, '.books-table tbody td'), /min-width:\s*0/);
  assert.match(bloc(fiches.body, '.books-table tbody tr'), /minmax\(0,\s*1fr\)/);
  assert.match(bloc(fiches.body, '.books-table__title'), /overflow-wrap:\s*anywhere/);

  // Et la largeur figée de la colonne des cases ne survit pas à la table.
  assert.match(bloc(fiches.body, '.books-table th.books-table__pick'), /width:\s*auto/);

  // Ce qui ne se coupait pas dans une colonne — une colonne s'élargit — doit se
  // replier dans une fiche, qui ne s'élargit pas. La pastille porte le message
  // d'échec, dont la longueur ne se devine pas.
  assert.match(bloc(fiches.body, '.books-table tbody .books-table__num'), /white-space:\s*normal/);
  assert.match(bloc(fiches.body, '.books-table tbody .books-table__badge'), /white-space:\s*normal/);
  assert.match(bloc(fiches.body, '.books-table tbody .books-table__badge'), /max-width:\s*100%/);
});

test('la repeinte ne pose aucun alignement physique', () => {
  // L'interface bascule RTL/LTR : le bord où commence une fiche n'est pas une
  // valeur, c'est une direction.
  for (const interdit of [
    'margin-left',
    'margin-right',
    'padding-left',
    'padding-right',
    'border-left',
    'border-right',
    'text-align: left',
    'text-align: right',
  ]) {
    assert.ok(!fiches.body.includes(interdit), `${interdit} dans la repeinte en fiches`);
  }
});
