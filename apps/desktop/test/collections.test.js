import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';

import { AppDatabase } from '../src/main/app-database.js';
import { BookRepository } from '../src/main/book-repository.js';
import {
  COVER_FAMILIES,
  FAMILY_KEYS,
  familyForKey,
  hashKey,
  paletteFor,
} from '../src/shared/book-cover.js';

/**
 * Composer une collection.
 *
 * Deux gestes, et ils se tiennent. Créer une collection, c'est vouloir la
 * remplir : rester sur la liste obligeait à retrouver des yeux la carte qu'on
 * venait de créer. Et la remplir, c'est puiser dans **tout le catalogue** —
 * 8 589 livres —, pas dans les livres déjà installés : une collection est
 * autant une liste d'envies qu'un rangement.
 */

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const read = (relative) =>
  fs.readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8').replaceAll('\r\n', '\n');

const view = read('../src/renderer/js/views/collections.js');

let storageRoot;
let database;
let repository;

before(async () => {
  storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'beytelhikma-collections-'));
  database = new AppDatabase({
    librarySource: path.join(projectRoot, 'assets', 'sample'),
    storageRoot,
  });
  await database.initialize();
  repository = new BookRepository(database);
  repository.createDownloadQueue();
  await repository.reconcileLibrary();
});

after(() => {
  database.close();
  fs.rmSync(storageRoot, { recursive: true, force: true });
});

// --------------------------------------------------------------- le dépôt

test('créer une collection rend son identifiant à l’appelant', async () => {
  // Sans ce retour, l'écran ne peut pas entrer dans ce qu'il vient de créer :
  // il lui faudrait relire la liste et deviner laquelle est la nouvelle — ce
  // que deux collections du même nom rendent impossible.
  const id = await repository.createCollection('ما أريد قراءته');
  assert.equal(typeof id, 'string');
  assert.ok(id.length > 0);

  const collections = await repository.getCollections();
  assert.ok(collections.some((entry) => entry.id === id), 'l’identifiant rendu doit exister');

  await repository.deleteCollection(id);
});

test('l’appartenance se demande pour les livres affichés, et rend ceux-là seuls', async () => {
  const id = await repository.createCollection('نحو');
  const books = await repository.getBooks({ limit: 4 });
  const dedans = books.slice(0, 2).map((book) => book.editionId);
  await repository.addToCollection(id, dedans);

  const membership = await repository.getCollectionMembership(
    id,
    books.map((book) => book.editionId),
  );
  assert.deepEqual([...membership].sort(), [...dedans].sort());

  // Bornée par ce qu'on montre : une question posée sur un seul livre ne rend
  // jamais les autres membres de la collection.
  assert.deepEqual(await repository.getCollectionMembership(id, [books[0].editionId]), [
    books[0].editionId,
  ]);
  assert.deepEqual(await repository.getCollectionMembership(id, [books[3].editionId]), []);

  await repository.deleteCollection(id);
});

test('une page vide ne pose aucune question à la base', async () => {
  // `IN ()` est une erreur de syntaxe en SQLite : la liste vide se traite avant
  // la requête, pas dedans.
  const id = await repository.createCollection('فارغة');
  assert.deepEqual(await repository.getCollectionMembership(id, []), []);
  assert.deepEqual(await repository.getCollectionMembership(id), []);
  await repository.deleteCollection(id);
});

test('retirer un livre le sort de l’appartenance, sans toucher au reste', async () => {
  const id = await repository.createCollection('مؤقتة');
  const books = await repository.getBooks({ limit: 3 });
  const ids = books.map((book) => book.editionId);
  await repository.addToCollection(id, ids);

  await repository.removeFromCollection(id, ids[1]);
  const membership = await repository.getCollectionMembership(id, ids);
  assert.deepEqual([...membership].sort(), [ids[0], ids[2]].sort());

  // Le fichier du livre reste : une collection ne porte que des références.
  const library = await repository.getLibrary({ limit: 50 });
  assert.equal(typeof library.total, 'number');

  await repository.deleteCollection(id);
});

// ----------------------------------------------------------------- la vue

test('créer une collection y entre, au lieu de laisser sur la liste', () => {
  assert.match(
    view,
    /const id = await repository\.createCollection\(name\);/,
    'l’identifiant rendu par le dépôt doit être retenu',
  );
  assert.match(
    view,
    /navigate\(`\/collection\/\$\{id\}\?add=1`\)/,
    'la création doit mener dans la collection créée',
  );
});

test('le fragment qui ouvre le mode d’édition s’efface une fois lu', () => {
  // Sans cela, un retour dans l'historique rouvrirait le mode qu'on vient de
  // quitter — l'écran refuserait obstinément de rester tel qu'on l'a laissé.
  assert.match(view, /open: params\?\.query\?\.add === '1'/);
  assert.match(view, /history\.replaceState\(null, '', `#\/collection\/\$\{encodeURIComponent\(id\)\}`\)/);
});

test('le mode d’édition puise dans tout le catalogue, jamais dans le disque', () => {
  // `getLibrary` ne montrerait que les livres installés : on ne pourrait plus
  // ranger dans une collection ce qu'on n'a pas encore téléchargé, ce qui est
  // pourtant l'usage premier d'une liste d'envies.
  assert.match(view, /repository\.exploreBooks\(\{/);
  assert.ok(!/repository\.getLibrary\(/.test(view), 'la source ne peut pas être la bibliothèque');
});

test('le mode d’édition ne monte jamais tout le corpus', () => {
  // 8 589 livres. Une page, et la page se tourne.
  assert.match(view, /const PICK_PAGE = \d+;/);
  const taille = Number(/const PICK_PAGE = (\d+);/.exec(view)[1]);
  assert.ok(taille > 0 && taille <= 100, `PICK_PAGE = ${taille} : une page, pas un corpus`);
  assert.match(view, /limit: PICK_PAGE/);
  assert.match(view, /pick\.total > PICK_PAGE &&\s*\n?\s*pagination\(\{/);
});

test('l’appartenance n’est demandée que pour la page affichée', () => {
  // La demander pour la collection entière ferait traverser le pont des
  // milliers d'identifiants à chaque page tournée, pour n'en éclairer que
  // vingt.
  const bloc = view.slice(view.indexOf('async function loadPicks()'), view.indexOf('function drawPicks()'));
  assert.match(bloc, /getCollectionMembership\(\s*\n?\s*id,\s*\n?\s*page\.books\.map\(\(book\) => book\.editionId\),/);
});

test('le mode d’édition traite les quatre états', () => {
  const bloc = view.slice(view.indexOf('function picksNode()'), view.indexOf('function pickRow('));
  for (const etat of ['errorView(', 'loadingView(', 'emptyView(']) {
    assert.ok(bloc.includes(etat), `état manquant dans le mode d’édition : ${etat}`);
  }
  assert.match(bloc, /collection-manage__list/, 'l’état plein doit dessiner la liste');
});

test('une réponse en retard n’écrase pas une plus récente', () => {
  // La règle du routeur et de `/explore` : deux frappes rapprochées lancent
  // deux requêtes, et c'est la dernière qui doit écrire.
  const bloc = view.slice(view.indexOf('async function loadPicks()'), view.indexOf('function drawPicks()'));
  assert.match(bloc, /const mine = \+\+pick\.token;/);
  assert.match(bloc, /if \(mine !== pick\.token\) return;/);
});

test('le mode d’édition se rouvre sur une collection existante', () => {
  // Il n'est pas réservé à la création : le bouton vit dans l'entête de la
  // collection, et il y reste.
  const bloc = view.slice(view.indexOf('function contentPage('), view.indexOf('function managePage('));
  assert.match(bloc, /t\('collections\.manage'\)/);
  assert.match(bloc, /pick\.open = true;/);
});

test('sortir du mode d’édition relit les décomptes en base', () => {
  // Un compte tenu de notre côté — « +1 par clic » — ne vient pas de SQL, et
  // c'est la règle que le projet s'est donnée pour tout décompte affiché.
  const bloc = view.slice(view.indexOf('function managePage('), view.indexOf('async function loadPicks()'));
  assert.match(bloc, /pick\.open = false;[\s\S]*?refresh\(\);/);
  assert.ok(
    !/bookCount \+/.test(view) && !/collection\.bookCount \+\+/.test(view),
    'le décompte affiché vient de SQL, jamais d’un compteur local',
  );
});

test('le champ de recherche survit à la frappe', () => {
  // Recréé à chaque résultat, il reprendrait le curseur à chaque lettre : seuls
  // les résultats se redessinent.
  assert.match(view, /pick\.results\.replaceChildren\(picksNode\(\)\)/);
  const bloc = view.slice(view.indexOf('function managePage('), view.indexOf('async function loadPicks()'));
  assert.match(bloc, /clearTimeout\(pick\.timer\)/, 'la frappe doit se calmer avant d’interroger');
});

test('le compte à rebours de la frappe ne survit pas à l’écran', () => {
  assert.match(view, /return \{ dispose: \(\) => clearTimeout\(pick\.timer\) \};/);
});

// ------------------------------------------------------------- la teinte

test('la même collection garde la même teinte, d’une session à l’autre', () => {
  // Une teinte tirée au hasard ou d'un compteur de montage repeindrait les
  // cartes à chaque rechargement : on ne reconnaîtrait plus la sienne.
  for (const key of ['ما أريد قراءته', 'c7f3-0011', 'نحو', '', 'Reading list']) {
    assert.deepEqual(paletteFor(key), paletteFor(key));
    assert.equal(hashKey(key), hashKey(key));
  }
  // Et la valeur elle-même est figée : ce n'est pas seulement stable dans une
  // exécution, c'est le même nombre à la prochaine.
  assert.equal(hashKey(''), 0x811c9dc5);
  assert.equal(hashKey('a'), 0xe40c292c);
});

test('la teinte vient du nom, jamais du rang dans la liste', () => {
  // Ajouter une collection en tête décale toutes les autres d'un cran : indexée
  // par position, chaque carte changerait de couleur pour une création qui ne
  // la concerne pas.
  const noms = ['أولى', 'ثانية', 'ثالثة'];
  const avant = noms.map(familyForKey);
  const apres = ['جديدة', ...noms].map(familyForKey).slice(1);
  assert.deepEqual(apres, avant);

  const view = read('../src/renderer/js/views/collections.js');
  assert.match(view, /paletteFor\(entry\.id \?\? entry\.name\)/);
  assert.ok(
    !/collections\.map\(\((entry|item)[^)]*,\s*(index|i)\)/.test(view),
    'la carte ne doit pas connaître son rang',
  );
});

test('les teintes se répartissent sur les neuf familles', () => {
  // Un hachage qui rendrait deux familles sur neuf donnerait un bandeau
  // monochrome : le but de la couleur est de distinguer.
  const total = 900;
  const compte = new Map();
  for (let index = 0; index < total; index += 1) {
    const famille = familyForKey(`مجموعة رقم ${index}`);
    compte.set(famille, (compte.get(famille) ?? 0) + 1);
  }
  assert.equal(FAMILY_KEYS.length, Object.keys(COVER_FAMILIES).length);
  assert.equal(compte.size, FAMILY_KEYS.length, 'toutes les familles doivent sortir');
  for (const [famille, part] of compte) {
    assert.ok(
      part <= total * 0.25,
      `${famille} rafle ${part}/${total} : la répartition est déséquilibrée`,
    );
  }
});

test('la vue réutilise la palette des couvertures, elle n’en invente pas une seconde', () => {
  // C'est la panne du thème `sepia` et celle des polices déclarées deux fois :
  // une seconde table de couleurs finit toujours par diverger de la première.
  const view = read('../src/renderer/js/views/collections.js');
  assert.match(view, /import \{ paletteFor \} from '\.\.\/\.\.\/\.\.\/shared\/book-cover\.js'/);
  assert.ok(!view.includes('COVER_FAMILIES = '), 'la vue ne redéclare pas la palette');

  for (const famille of Object.values(COVER_FAMILIES)) {
    assert.ok(
      !view.includes(famille.from) && !view.includes(famille.to),
      'une teinte de la palette est recopiée dans la vue',
    );
  }
});

test('aucune couleur n’est écrite en dur dans la vue', () => {
  // Une teinte citée en clair sur un fond qui suit le thème est un défaut connu
  // du projet : en nuit, les deux valaient la même chose et la note devenait
  // invisible. La vue ne pose que `--cover-from` et `--cover-to`.
  const view = read('../src/renderer/js/views/collections.js');
  for (const motif of [/#[0-9a-fA-F]{3,8}\b/, /\brgba?\(/, /\bhsla?\(/, /color-mix\(/]) {
    assert.ok(!motif.test(view), `couleur en dur dans collections.js : ${motif}`);
  }
});

test('le décor géométrique vient du jeu de motifs déjà tracé', () => {
  // Six géométries, leurs `<defs>` injectés une fois pour tout le document.
  // Une seconde tuile dessinée ici dériverait de celle des couvertures, et une
  // grille de cartes dupliquerait la géométrie autant de fois qu'il y a de
  // cartes.
  const view = read('../src/renderer/js/views/collections.js');
  const cover = read('../src/renderer/js/components/cover.js');
  assert.match(view, /import \{ coverGrain \} from '\.\.\/components\/cover\.js'/);
  assert.match(view, /coverGrain\(palette\.pattern\)/);
  assert.match(cover, /export function coverGrain\(pattern\) \{[\s\S]*?ensureDefs\(\);/);
  assert.ok(!/<svg|patternUnits|data:image/.test(view), 'la vue ne trace aucun motif elle-même');
});

test('la carte annonce des décomptes venus de SQL', () => {
  const view = read('../src/renderer/js/views/collections.js');
  const bloc = view.slice(view.indexOf('function collectionCard('), view.indexOf('function askName('));
  assert.match(bloc, /entry\.bookCount/);
  assert.match(bloc, /entry\.installedCount/);
  assert.ok(!/\.rows\.length|\.length \|\| 0/.test(bloc), 'un décompte affiché ne se compte pas côté vue');
});

test('les libellés de la carte existent dans les deux catalogues', () => {
  const ar = read('../src/renderer/js/locales/ar.js');
  const en = read('../src/renderer/js/locales/en.js');
  for (const cle of ['collections.cardBooks', 'collections.cardInstalled']) {
    assert.ok(ar.includes(`'${cle}'`), `ar.js ignore ${cle}`);
    assert.ok(en.includes(`'${cle}'`), `en.js ignore ${cle}`);
  }
});

test('le décor de la carte ne se retourne pas en LTR', () => {
  // Un décor n'a pas de sens de lecture à suivre : le dégradé est posé en
  // degrés, et rien de la carte n'est ancré à gauche ou à droite.
  const css = read('../src/renderer/styles/views.css');
  const bloc = css.slice(
    css.indexOf('\n.collection-card {'),
    css.indexOf('.collection-page {'),
  );
  assert.ok(bloc.length > 0, 'le bloc des cartes doit exister');
  assert.match(bloc, /linear-gradient\(160deg,/);
  for (const physique of ['margin-left', 'margin-right', 'padding-left', 'padding-right', 'left:', 'right:']) {
    assert.ok(!bloc.includes(physique), `propriété physique dans la carte : ${physique}`);
  }
  assert.match(bloc, /text-align: start/);
});

// ---------------------------------------------------------- le carrousel

test('la rangée des collections défile et s’accroche', () => {
  const css = read('../src/renderer/styles/views.css');
  const bloc = css.slice(css.indexOf('.collections__row {'), css.indexOf('\n.collection-card {'));
  assert.match(bloc, /overflow-x: auto/);
  assert.match(bloc, /scroll-snap-type: x mandatory/);
  assert.match(bloc, /scroll-snap-align: start/);
  // Le carrousel possède son axe : sans cela, sur du verre, le navigateur
  // arbitre la glissade en faveur du défilement de la page — la même mesure que
  // `pan-y` sur la colonne du lecteur.
  assert.match(bloc, /touch-action: pan-x/);

  const view = read('../src/renderer/js/views/collections.js');
  assert.match(view, /class: 'collections__row no-scrollbar'/, 'la barre de défilement ne se montre pas');
});

test('le carrousel des collections défile dans le sens de lecture', () => {
  // `scrollLeft` décroît en RTL et croît en LTR. Écrit en dur pour l'arabe, le
  // chevron « suivant » ne bougerait pas d'un pixel sous interface anglaise :
  // c'est le défaut de la bande des nouveautés, rejoué. Et la distance au bord
  // se mesure en valeur absolue, jamais en signe.
  const view = read('../src/renderer/js/views/collections.js');
  assert.match(
    view,
    /const avance = \(\) => \(localeDir\(currentLocale\(\)\) === 'rtl' \? -1 : 1\)/,
    'le sens du défilement doit se déduire de la direction de l’interface',
  );
  assert.match(view, /Math\.abs\(row\.scrollLeft\)/, 'la distance au bord se mesure sans signe');
  for (const fige of ['left: step()', 'left: -step()']) {
    assert.ok(!view.includes(fige), `le carrousel fige le sens du défilement : ${fige}`);
  }
});

test('les chevrons du carrousel sont directionnels', () => {
  // Un chevron figé désigne l'inverse de ce qu'il fait dès que l'interface
  // bascule : `icons.js` est le seul propriétaire du sens.
  const view = read('../src/renderer/js/views/collections.js');
  assert.match(view, /chevronBackward\(\{ size: 20 \}\)/);
  assert.match(view, /chevronForward\(\{ size: 20 \}\)/);
  for (const frozen of ['chevronLeft', 'chevronRight', 'arrowLeft', 'arrowRight']) {
    assert.ok(!view.includes(`'${frozen}'`), `collections.js nomme ${frozen} en dur`);
  }
});

test('les chevrons s’effacent quand il n’y a rien à faire défiler', () => {
  // Au large, le carrousel se lit comme une rangée : deux boutons qui ne
  // proposent rien s'essaient deux fois avant qu'on les croie morts.
  const view = read('../src/renderer/js/views/collections.js');
  const bloc = view.slice(view.indexOf('const syncEdges = ()'), view.indexOf('host.replaceChildren('));
  assert.match(bloc, /nav\.hidden = max <= 1;/, 'toute la barre disparaît si tout tient');
  assert.match(bloc, /previous\.disabled = offset <= 1;/);
  assert.match(bloc, /next\.disabled = offset >= max - 1;/);
  // Recalculé au redimensionnement : une fenêtre qu'on élargit peut faire tenir
  // ce qui débordait.
  assert.match(view, /new ResizeObserver\(syncEdges\)\.observe\(row\)/);
});

test('les chevrons tiennent la cible tactile', () => {
  const css = read('../src/renderer/styles/views.css');
  const bloc = css.slice(
    css.indexOf('.collections__chevron {'),
    css.indexOf('@media (prefers-reduced-motion: reduce) {', css.indexOf('.collections__chevron {')),
  );
  assert.match(bloc, /min-width: 44px/);
  assert.match(bloc, /min-height: 44px/);
});

test('« nouvelle collection » reste hors du carrousel', () => {
  // Posée en carte, elle serait sortie de l'écran dès la sixième collection —
  // et elle aurait allongé une liste dont elle n'est pas membre.
  const view = read('../src/renderer/js/views/collections.js');
  const rangee = view.slice(view.indexOf('const row = h('), view.indexOf('const previous = h('));
  assert.ok(!rangee.includes('collections.newTitle'), 'la création ne peut pas être une carte du carrousel');
  assert.match(view, /class: 'collections__tools'[\s\S]*?t\('collections\.newTitle'\)/);
  const css = read('../src/renderer/styles/views.css');
  assert.ok(!css.includes('.collection-card--new'), 'la carte de création n’a plus de style');
});

test('le carrousel reste une liste pour qui ne le voit pas', () => {
  const view = read('../src/renderer/js/views/collections.js');
  assert.match(view, /role: 'list'/);
  assert.match(view, /h\('div', \{ role: 'listitem' \}, collectionCard\(entry\)\)/);
  for (const cle of ['collections.previous', 'collections.next']) {
    assert.ok(view.includes(`t('${cle}')`), `le chevron doit se nommer : ${cle}`);
    for (const [nom, source] of [
      ['ar.js', read('../src/renderer/js/locales/ar.js')],
      ['en.js', read('../src/renderer/js/locales/en.js')],
    ]) {
      assert.ok(source.includes(`'${cle}'`), `${nom} ignore ${cle}`);
    }
  }
});

test('les deux ponts connaissent getCollectionMembership', () => {
  // Une méthode ajoutée d'un seul côté ne casse rien au démarrage : elle échoue
  // au premier clic. `test/repository.test.js` tient la parité bureau ;
  // celle-ci tient le troisième côté, le shim Capacitor, que `npm run verify`
  // compare ensuite à `preload.cjs`.
  const preload = read('../src/preload/preload.cjs');
  const shim = read('../../mobile/src/repository.capacitor.js');
  const mobile = read('../../mobile/src/repo/utilisateur.js');
  for (const [nom, source] of [
    ['preload.cjs', preload],
    ['repository.capacitor.js', shim],
    ['repo/utilisateur.js', mobile],
  ]) {
    assert.ok(source.includes('getCollectionMembership'), `${nom} ignore getCollectionMembership`);
  }
});
