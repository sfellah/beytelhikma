import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  DEFAULT_TAP_ZONES,
  SWIPE_MIN,
  TAP_ZONE_MODES,
  TURN_ZONE,
  resolveTapZones,
  swipeTurn,
  turnZone,
} from '../src/shared/page-turn.js';
import {
  DEFAULT_FONT_SIZE,
  MAX_FONT,
  MIN_FONT,
  PINCH_MIN_SPREAD,
  clampSize,
  pinchSize,
} from '../src/shared/reader-size.js';
import { DEFAULT_READING_MODE, resolveReadingMode } from '../src/shared/reading-modes.js';

// Les fins de ligne du dépôt sont normalisées à la lecture : `core.autocrlf`
// rend des `\r\n` sous Windows, et un test qui cite deux lignes d'affilée
// échouerait sur la machine d'un contributeur et pas sur celle d'un autre.
const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8').replaceAll('\r\n', '\n');

/** Le corps d'une méthode, jusqu'à l'accolade fermante de son indentation. */
const methode = (source, entete) => {
  const start = source.indexOf(entete);
  assert.notEqual(start, -1, `méthode absente : ${entete}`);
  return source.slice(start, source.indexOf('\n  }', start));
};

// ------------------------------------------------------ les deux façons de lire

/**
 * Le fil a existé, il avait été jeté, et il revient — demandé, cette fois, et
 * sur une fenêtre glissante plutôt que sur le livre entier, qui était la
 * version mesurée puis abandonnée.
 *
 * Ce qui l'avait fait tomber tenait en une phrase : le corpus est paginé, et
 * tout le reste l'est avec lui. Ces tests tiennent donc les deux bouts — le fil
 * existe, **et** la pagination reste entière dessous.
 */
test('les deux façons de lire vivent dans un module partagé, seul', () => {
  const modes = fileURLToPath(new URL('../src/shared/reading-modes.js', import.meta.url));
  assert.equal(existsSync(modes), true, 'le module des façons de lire doit exister');

  // Deux écrans montrent cette liste — le lecteur et `/settings`. La déclarer
  // deux fois est exactement ce qui avait produit la police orpheline et
  // l'ambiance morte.
  for (const chemin of ['../src/renderer/js/views/reader.js', '../src/renderer/js/views/settings.js']) {
    const source = read(chemin);
    assert.equal(
      /READING_MODES\s*=/.test(source),
      false,
      `${chemin} redéclare la liste des façons de lire`,
    );
    assert.match(source, /from '\.\.\/\.\.\/\.\.\/shared\/reading-modes\.js'/);
  }
});

/**
 * Le fil est le défaut, et c'est `resolveReadingMode` qui le dit.
 *
 * Trois entrées valent la même chose — absente, nulle, méconnue : une clé
 * jamais écrite, une base vierge et une valeur d'une version future se lisent
 * toutes « on n'a rien choisi », et rien ne justifierait qu'elles ouvrent trois
 * livres différemment.
 */
test('le fil est ce qu’on lit quand on n’a rien choisi', () => {
  assert.equal(DEFAULT_READING_MODE, 'scroll');
  for (const rien of [undefined, null, '', 'bidon', 'pager', 0]) {
    assert.equal(resolveReadingMode(rien), 'scroll', `${String(rien)} ne replie pas sur le fil`);
  }
  // Et ce qui a été choisi est rendu tel quel : le défaut n'écrase pas un choix.
  assert.equal(resolveReadingMode('page'), 'page');
  assert.equal(resolveReadingMode('scroll'), 'scroll');
});

/**
 * Le lecteur ne recopie aucun défaut : il monte sur `DEFAULT_READING_MODE` et
 * relit la préférence par `resolveReadingMode`. Un `'page'` écrit en dur à l'un
 * de ces deux endroits rendrait le module partagé décoratif.
 */
test('le lecteur monte sur le fil, et ne pose aucun défaut de son cru', () => {
  const reader = read('../src/renderer/js/views/reader.js');
  assert.match(reader, /#mode = DEFAULT_READING_MODE;/);
  assert.match(reader, /this\.#mode = resolveReadingMode\(prefs\['reader\.mode'\]\);/);
  // `/settings` affiche la valeur repliée, jamais un défaut recopié.
  assert.match(read('../src/renderer/js/views/settings.js'), /resolveReadingMode\(prefs\['reader\.mode'\]\)/);
});

/**
 * Le piège vécu : les deux clients partagent `resolveReadingMode`, mais le shim
 * Capacitor pose ses propres valeurs de base vierge **avant** ce qu'il lit en
 * base. Un `'reader.mode': 'page'` y recouvrait le défaut partagé — le bureau
 * ouvrait dans le fil, l'APK sur la feuille, et aucun test ne le voyait.
 *
 * Le shim ne peut pas importer `shared/reading-modes.js` (ses fabriques n'ont
 * aucun `import`) : la seule parade est donc l'**absence** de la clé, comme
 * pour les clés de police. Deux fichiers portent ces tables.
 */
test('aucun shim mobile ne repose un défaut de façon de lire', () => {
  for (const chemin of ['../../mobile/src/repository.capacitor.js', '../../mobile/src/repo/utilisateur.js']) {
    assert.equal(
      /'reader\.mode'\s*:/.test(read(chemin)),
      false,
      `${chemin} repose un défaut de façon de lire, qui recouvre DEFAULT_READING_MODE`,
    );
  }
});

test('le ruban reste en bas, et rien ne le déplace plus', () => {
  const views = read('../src/renderer/styles/views.css');
  // Un réglage l'a dressé contre le bord un temps. Il portait « أفقي / عمودي »
  // à une ligne des mots de la façon de lire, et l'on croyait choisir sa
  // lecture en déplaçant la barre. Le réglage a disparu ; la règle reste.
  assert.equal(
    /\.reader--(scroll|page)\b[^{]*\.reader__footer\s*\{/.test(views),
    false,
    'un mode déplace le ruban',
  );
  assert.equal(/reader--pager/.test(views), false, 'le ruban dressé est revenu');
  assert.equal(
    existsSync(fileURLToPath(new URL('../src/shared/pager-layouts.js', import.meta.url))),
    false,
    'le module du ruban dressé doit avoir disparu',
  );
});

test('le fil monte une fenêtre, jamais le livre entier', () => {
  const reader = read('../src/renderer/js/views/reader.js');
  assert.match(reader, /windowAround\(/);
  assert.match(reader, /outOfWindow\(/);
  // Les plus gros livres du corpus passent le millier de pages, et les deux
  // clients chargent une base de livre entièrement en mémoire.
  const fenetre = reader.slice(
    reader.indexOf('async #mountWindow(center, token) {'),
    reader.indexOf('#visibleIndex() {'),
  );
  assert.ok(fenetre.length > 0, 'la fenêtre du fil a disparu');
  assert.match(fenetre, /this\.#blocks\.delete\(index\)/);
});

test('le fil ne remonte pas la page qu’on a déjà sous les yeux', () => {
  const reader = read('../src/renderer/js/views/reader.js');
  const move = reader.slice(reader.indexOf('#move(direction) {'), reader.indexOf('#previewJump(index) {'));
  // La remonter ferait clignoter la colonne et perdrait ce qui est au-dessus —
  // c'est précisément ce que le fil promet de garder.
  assert.match(move, /scrollTo\(\{ top, behavior: 'smooth' \}\)/);
});

test('l’animation de feuilletage ne joue que sur la feuille', () => {
  const views = read('../src/renderer/styles/views.css');
  assert.match(views, /\.reader--scroll \.reader__block\.is-turned-next[\s\S]*?animation: none;/);
});

test('la touche `V` bascule la façon de lire', () => {
  assert.match(read('../src/renderer/js/views/reader.js'), /case 'v':/);
});

// -------------------------------------------------------- tourner au clic

/**
 * Trois zones, et leur sens vient de la **direction de l'interface**, jamais du
 * bord de l'écran. `turnZone` reçoit une fraction physique — 0 au bord gauche,
 * 1 au bord droit, ce que rend le navigateur — et c'est elle qui la rend
 * logique. Vérifié dans les deux directions : un `left` écrit en dur passerait
 * la moitié des cas, exactement comme les flèches figées d'avant.
 */
test('les trois zones tournent selon le sens de lecture, pas selon le bord', () => {
  // En anglais la ligne commence à gauche : le bord gauche ramène en arrière.
  assert.equal(turnZone(0.05, false), -1);
  assert.equal(turnZone(0.95, false), 1);
  // En arabe elle commence à droite : tout s'inverse.
  assert.equal(turnZone(0.05, true), 1);
  assert.equal(turnZone(0.95, true), -1);

  // Le tiers du milieu garde le geste qu'il avait, dans les deux directions.
  for (const rtl of [false, true]) {
    assert.equal(turnZone(0.5, rtl), 0);
    assert.equal(turnZone(TURN_ZONE + 0.01, rtl), 0);
    assert.equal(turnZone(1 - TURN_ZONE - 0.01, rtl), 0);
  }

  // Une colonne sans largeur ne tourne rien plutôt que de tourner au hasard.
  assert.equal(turnZone(Number.NaN, false), 0);
});

/**
 * L'ordre des gardes du clic est celui des défauts vécus. Chacune passe
 * **avant** la zone : sans quoi la tape qui défait une sélection tournerait la
 * page, et l'on ne pourrait plus rien sélectionner du tout.
 */
test('un clic ne tourne la page qu’après toutes les gardes', () => {
  const corps = methode(read('../src/renderer/js/views/reader.js'), '#onContentClick(event) {');
  const rang = (motif) => {
    const index = corps.indexOf(motif);
    assert.notEqual(index, -1, `garde absente : ${motif}`);
    return index;
  };
  const zone = rang('this.#zoneOf(');

  // Ce qui a déjà son geste : un bouton, un lien, un passage surligné qui
  // ouvre sa note, la feuille des couleurs.
  assert.ok(
    corps.includes("closest('button, a, input, mark, .reader__selection')"),
    'un clic sur un surlignage ouvre sa note, il ne tourne pas la page',
  );
  // Le clic résiduel d'un glissement : la page a déjà tourné.
  assert.ok(rang('this.#swiped') < zone, 'le clic laissé par un glissement passe avant');
  // La sélection défaite à l'appui, puis celle qui vit encore.
  assert.ok(rang('this.#selectionAtPress') < zone, 'la garde de sélection passe avant');
  assert.ok(rang('selection.isCollapsed') < zone, 'et la sélection vivante aussi');
  // Un panneau ouvert se referme ; il ne tourne pas la page sous lui.
  assert.ok(rang('this.#panelsOpen()') < zone, 'un panneau ouvert passe avant');
  // Et le milieu escamote les barres, comme avant.
  assert.ok(zone < rang("classList.toggle('is-hidden')"), 'le tiers du milieu garde son geste');
});

// --------------------------------------------- les côtés, qu'on peut éteindre

test('resolveTapZones ne reconnaît que les deux réponses', () => {
  for (const mode of TAP_ZONE_MODES) {
    assert.equal(resolveTapZones(mode.key), mode.key);
  }
  for (const stored of ['oui', '', null, undefined, 0, {}]) {
    assert.equal(resolveTapZones(stored), DEFAULT_TAP_ZONES);
  }
  // Les côtés tournent par défaut : c'est le geste que la maquette annonce.
  assert.equal(DEFAULT_TAP_ZONES, 'on');
});

/**
 * Le refus est posé **dans** `#zoneOf`, et non dans le clic : les trois tiers
 * redeviennent alors un seul, et toucher le bord escamote les barres au lieu de
 * ne rien faire du tout. Une zone morte se touche deux fois avant qu'on la
 * croie voulue — c'est l'argument du bouton de plein écran grisé, rejoué.
 */
test('les côtés éteints rendent le tiers du milieu, jamais une zone morte', () => {
  const reader = read('../src/renderer/js/views/reader.js');
  const corps = methode(reader, '#zoneOf(clientX) {');
  assert.ok(corps.includes("this.#prefs.tapZones === 'off'"), 'le réglage doit se lire ici');
  const refus = corps.indexOf("tapZones === 'off'");
  assert.ok(refus < corps.indexOf('turnZone('), 'et passer avant la mesure');
  assert.ok(/return 0;/.test(corps.slice(refus)), 'éteint, le côté vaut le milieu');

  // Une seule liste, deux écrans — la règle qui a coûté la police orpheline.
  assert.equal(/const TAP_ZONE_MODES\s*=/.test(reader), false, 'le lecteur redéclare la liste');
  const settings = read('../src/renderer/js/views/settings.js');
  assert.equal(/const TAP_ZONE_MODES\s*=/.test(settings), false, '/settings redéclare la liste');
  assert.ok(settings.includes("setting: 'reader.tapZones'"), '/settings doit écrire le réglage');
});

// ------------------------------------------------------- pincer pour agrandir

/**
 * Le pincement se mesure en **rapport** d'écartements, jamais en pixels : le
 * geste doit valoir la même chose sur un téléphone et sur une tablette, et
 * c'est l'écart relatif que la main perçoit.
 */
test('le pincement multiplie la taille de départ par le rapport des écartements', () => {
  assert.equal(pinchSize(20, 1), 20, 'sans écartement, rien ne bouge');
  assert.equal(pinchSize(20, 1.5), 30, 'écarter agrandit');
  assert.equal(pinchSize(30, 0.6), 18, 'resserrer rétrécit');

  // Les bornes tiennent des deux côtés : un geste large ne sort pas de l'échelle.
  assert.equal(pinchSize(MAX_FONT, 4), MAX_FONT);
  assert.equal(pinchSize(MIN_FONT, 0.1), MIN_FONT);

  // Deux doigts posés l'un sur l'autre donneraient un rapport qui explose.
  for (const impossible of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(pinchSize(24, impossible), 24, 'un rapport illisible ne change rien');
  }
  assert.ok(PINCH_MIN_SPREAD > 0, 'un pincement doit partir d’un écartement mesurable');
});

/**
 * Une taille illisible rend le **défaut**, pas la borne basse : un réglage
 * absent n'est pas un lecteur qui a demandé la plus petite lettre.
 */
test('clampSize borne, et se replie sur le défaut', () => {
  assert.equal(clampSize(MIN_FONT - 5), MIN_FONT);
  assert.equal(clampSize(MAX_FONT + 5), MAX_FONT);
  assert.equal(clampSize('24'), 24, 'le réglage revient de SQLite en chaîne');
  assert.equal(clampSize(21.6), 22, 'la taille est un entier de pixels');
  for (const rien of [undefined, null, '', 'grand', Number.NaN]) {
    assert.equal(clampSize(rien), DEFAULT_FONT_SIZE);
  }
});

/**
 * Les bornes vivaient **en double**, une copie par écran, avec la valeur de
 * départ écrite en clair à trois endroits. C'est la configuration qui avait
 * produit la police orpheline et le thème `sepia` mort.
 */
test('les deux écrans tiennent les bornes de leur propriétaire unique', () => {
  for (const view of [
    '../src/renderer/js/views/reader.js',
    '../src/renderer/js/views/settings.js',
  ]) {
    const source = read(view);
    assert.equal(/const MIN_FONT\s*=/.test(source), false, `${view} redéclare la borne basse`);
    assert.equal(/const MAX_FONT\s*=/.test(source), false, `${view} redéclare la borne haute`);
    assert.ok(source.includes('shared/reader-size.js'), `${view} doit tenir les bornes d’ailleurs`);
  }
});

/**
 * Un pincement produit une taille par image. L'écrire à chaque pas enverrait
 * des dizaines d'écritures dans `user.sqlite` pour un seul geste — et
 * `user.sqlite` est le seul fichier qu'on ne puisse pas retélécharger. La
 * taille se pose sans s'écrire, et s'écrit une fois quand les doigts se lèvent.
 */
test('le pincement pose la taille sans l’écrire, et l’écrit une fois', () => {
  const reader = read('../src/renderer/js/views/reader.js');

  const applique = methode(reader, '#applySize(value) {');
  assert.ok(applique.includes('--reader-size'), 'la taille se pose sur la page');
  assert.equal(applique.includes('setSetting('), false, 'poser la taille ne l’écrit pas');

  const bouge = methode(reader, '#onPointerMove(event) {');
  assert.ok(bouge.includes('this.#applySize('), 'le geste pose, il n’écrit pas');
  assert.ok(bouge.includes('pinchSize('), 'le rapport vient de son propriétaire unique');
  assert.equal(bouge.includes('setSetting('), false, 'une écriture par image est de trop');

  const leve = methode(reader, '#endPinch() {');
  assert.ok(leve.includes("setSetting('reader.fontSize'"), 'la taille s’écrit quand on lâche');
  assert.ok(
    methode(reader, '#endPointer(event) {').includes('this.#endPinch()'),
    'un doigt levé achève le pincement',
  );

  // Un doigt levé hors de la colonne n'y laisse pas de `pointerup` : le premier
  // doigt du geste suivant est le seul instant sûr pour oublier les traînards,
  // sans quoi deux gestes de suite feraient un pincement fantôme.
  const bas = methode(reader, '#onPointerDown(event) {');
  assert.ok(bas.includes('this.#pointers.clear()'), 'les doigts fantômes doivent s’oublier');
  assert.ok(bas.includes('this.#endPinch()'), 'et le pincement resté ouvert doit s’écrire');

  // Deux doigts, deux positions : le navigateur n'en livre qu'une par message.
  assert.ok(/#pointers = new Map\(\)/.test(reader), 'le lecteur doit tenir les deux doigts');
  assert.ok(/addEventListener\('pointermove'/.test(reader), 'le pincement se mesure en chemin');
});

/**
 * Un pincement n'est pas un glissement, et le `click` qu'il laisse derrière lui
 * ne doit pas tourner la page — le même défaut que le clic résiduel du
 * glissement, avec deux doigts au lieu d'un.
 */
test('un pincement ne tourne aucune page', () => {
  const reader = read('../src/renderer/js/views/reader.js');
  const depart = methode(reader, '#startPinch() {');
  assert.ok(depart.includes('this.#swipeFrom = null'), 'le glissement en cours est abandonné');
  const bouge = methode(reader, '#onPointerMove(event) {');
  assert.ok(bouge.includes('this.#swiped = true'), 'le clic résiduel doit être avalé');
});

// ------------------------------------------------------- tourner au doigt

/**
 * **La règle en une ligne** : on chasse la page dans le sens où le texte
 * s'écoule — vers la gauche en anglais, vers la droite en arabe. Les deux sens
 * sont vérifiés : c'est tout l'intérêt d'avoir sorti la règle du gestionnaire
 * d'évènements.
 */
test('le glissement chasse la page dans le sens où le texte s’écoule', () => {
  const long = SWIPE_MIN + 20;
  assert.equal(swipeTurn(-long, 0, false), 1, 'LTR : vers la gauche pour avancer');
  assert.equal(swipeTurn(long, 0, false), -1, 'LTR : vers la droite pour revenir');
  assert.equal(swipeTurn(long, 0, true), 1, 'RTL : vers la droite pour avancer');
  assert.equal(swipeTurn(-long, 0, true), -1, 'RTL : vers la gauche pour revenir');
});

/**
 * Une page imprimée dépasse souvent la hauteur de l'écran : le défilement
 * **dans** la page doit rester libre. Un geste plus vertical qu'horizontal ne
 * tourne donc rien, et un geste trop court non plus.
 */
test('un glissement vertical ou trop court ne tourne rien', () => {
  const long = SWIPE_MIN + 20;
  for (const rtl of [false, true]) {
    assert.equal(swipeTurn(long, long * 2, rtl), 0, 'c’est un défilement dans la page');
    assert.equal(swipeTurn(-long, long * 2, rtl), 0);
    assert.equal(swipeTurn(SWIPE_MIN - 1, 0, rtl), 0, 'trop court pour être un geste');
    assert.equal(swipeTurn(0, 0, rtl), 0);
  }
  // Franchement horizontal, une dérive verticale ne l'annule pas.
  assert.equal(swipeTurn(-long, long / 4, false), 1);
});

/**
 * Le glissement est au doigt. À la souris, un déplacement horizontal sur du
 * texte **est** une sélection : y tourner la page rendrait le texte
 * insélectionnable, et la souris a déjà les zones, les chevrons et les flèches.
 *
 * Et il abandonne sur une sélection : les poignées natives avalent les
 * évènements tactiles (`docs/spikes/react-native-contre-webview.md`), ce qu'on
 * lirait serait un geste tronqué.
 */
test('le glissement est au doigt, jamais à la souris, jamais sur une sélection', () => {
  const reader = read('../src/renderer/js/views/reader.js');

  const bas = methode(reader, '#onPointerDown(event) {');
  assert.ok(
    bas.includes("event.pointerType === 'mouse'"),
    'la souris sélectionne, elle ne glisse pas',
  );
  assert.ok(bas.includes('event.isPrimary'), 'un second doigt n’est pas un second geste');
  assert.ok(bas.includes('this.#selectionAtPress'), 'un geste né sur une sélection est abandonné');
  // La trace s'efface au départ du geste suivant : un glissement ne laisse pas
  // toujours un clic, et le drapeau resté levé avalerait un clic étranger.
  assert.ok(bas.includes('this.#swiped = false'), 'la trace du glissement s’efface au départ');

  const haut = methode(reader, '#onPointerUp(event) {');
  assert.ok(
    haut.includes('selection.isCollapsed'),
    'une sélection posée par le geste n’en est pas un',
  );
  assert.ok(haut.includes('swipeTurn('), 'le sens vient de son propriétaire unique');

  // `pointer*` et non `touch*` : le même rendu tourne sous Capacitor.
  assert.ok(/addEventListener\('pointerup'/.test(reader), 'les évènements sont des pointeurs');
  assert.ok(/addEventListener\('pointercancel'/.test(reader), 'un geste interrompu doit se ranger');
});

/**
 * Deux gestes sur une seule surface, et c'est le navigateur qui arbitre. Sans
 * `touch-action`, il arbitre en sa faveur : `auto` le laisse revendiquer le
 * geste pour un défilement dès le seuil franchi — quelle que soit sa
 * direction — et il annule alors le pointeur avant que `#onPointerUp` n'ait pu
 * tourner. Rien ne défile pour autant, la colonne n'a pas de largeur en trop :
 * sur un vrai doigt, le glissement ne faisait donc rien du tout, pas même de
 * travers. Aucun test de geste ne l'aurait vue : à la souris le chemin est
 * mort, et c'est le doigt sur du verre qui déclenche l'arbitrage — ce que ce
 * test tient est la ligne CSS elle-même, pas un comportement observable ici.
 *
 * `pan-y` est la seule façon de garder l'axe horizontal : `preventDefault()`
 * sur un évènement de pointeur n'annule pas un défilement, et un `touchmove`
 * non passif trancherait l'axe au même instant, sur les mêmes pixels.
 */
test('la colonne ne concède au navigateur que le défilement vertical', () => {
  const views = read('../src/renderer/styles/views.css');
  const start = views.indexOf('.reader__scroll {');
  assert.notEqual(start, -1, 'la colonne de lecture a disparu');
  const bloc = views.slice(start, views.indexOf('}', start));

  assert.ok(
    /touch-action:\s*pan-y(\s+pinch-zoom)?\s*;/.test(bloc),
    'sans touch-action, le navigateur avale le glissement et annule le pointeur',
  );
  // `pan-x` rendrait la ligne inutile — le navigateur reprendrait l'axe qu'on
  // vient de lui refuser ; `none` coûterait le défilement dans la page.
  assert.equal(/pan-x/.test(bloc), false, 'l’axe horizontal appartient au lecteur');
  assert.equal(/touch-action:\s*none/.test(bloc), false, 'la page doit rester défilable');

  // La règle et les écouteurs doivent porter sur le même élément : posée sur
  // un enfant, elle ne gouvernerait pas le geste ; posée ailleurs, rien.
  const reader = read('../src/renderer/js/views/reader.js');
  assert.ok(/class:\s*'reader__scroll/.test(reader), 'la colonne écoutée est bien .reader__scroll');
  assert.ok(/scroll\.addEventListener\('pointerdown'/.test(reader), 'le glissement part de la colonne');
  assert.ok(/scroll\.addEventListener\('pointerup'/.test(reader), 'et s’y achève');
});

// -------------------------------------------------- défilement dans la page

/**
 * Le fil est parti, pas le défilement : une page imprimée dépasse souvent la
 * hauteur de l'écran. `#onScroll` ne fait plus qu'une chose, et doit la faire.
 */
test('la colonne garde son défilement, et le masquage des barres avec', () => {
  const corps = methode(read('../src/renderer/js/views/reader.js'), '#onScroll(scroll) {');
  assert.ok(corps.includes("classList.add('is-hidden')"), 'descendre escamote les barres');
  assert.ok(corps.includes('this.#showChrome()'), 'remonter les rappelle');

  // Allégé, pas jeté : il ne cherche plus quelle page est à l'écran — il n'y
  // en a qu'une — et n'allonge plus rien.
  assert.equal(corps.includes('#visibleBlock'), false, 'il n’y a plus de page à chercher');
  assert.equal(corps.includes('#extend'), false, 'le fil ne s’allonge plus');
  assert.equal(corps.includes('#setCurrent'), false, 'défiler dans une page ne change pas de page');

  const views = read('../src/renderer/styles/views.css');
  const start = views.indexOf('.reader__scroll {');
  assert.notEqual(start, -1, 'la colonne de lecture a disparu');
  assert.ok(
    /overflow-y:\s*auto/.test(views.slice(start, views.indexOf('}', start))),
    'la colonne doit garder son défilement',
  );
});

// -------------------------------------------------- les chevrons de la barre

/**
 * Les deux chevrons désignent le début et la fin de ligne, et suivent donc le
 * sens d'écriture. Ils n'ont plus qu'un tracé : le ruban ne se dresse plus, et
 * les flèches haut/bas qu'il réclamait annonçaient un geste qu'on ne fait pas.
 */
test('les chevrons suivent le sens d’écriture, et rien d’autre', () => {
  const reader = read('../src/renderer/js/views/reader.js');
  assert.match(reader, /tool\('previous', chevronBackward/);
  assert.match(reader, /tool\('next', chevronForward/);
  assert.equal(/chevronUp|chevronDown/.test(reader), false, 'un tracé dressé subsiste');
});

// ------------------------------------------------------------ plein écran

/**
 * `canGoFullscreen` est le seul juge, et il ne regarde **pas** la largeur : une
 * fenêtre de bureau réduite garde son gestionnaire de fenêtres et sa touche
 * F11. Le signal est le pointeur.
 */
test('le plein écran est refusé au tactile et offert à la souris', async () => {
  const original = { matchMedia: globalThis.matchMedia, document: globalThis.document };

  const poser = (media, fullscreenEnabled = true) => {
    globalThis.matchMedia = (query) => ({ matches: query === media });
    globalThis.document = { fullscreenEnabled };
  };

  try {
    const { canGoFullscreen, isTouchPrimary } = await import('../src/renderer/js/platform.js');

    poser('(hover: none) and (pointer: coarse)');
    assert.equal(isTouchPrimary(), true);
    assert.equal(canGoFullscreen(), false, 'un téléphone ne gagne pas un pixel en plein écran');

    poser('(hover: hover)');
    assert.equal(isTouchPrimary(), false);
    assert.equal(canGoFullscreen(), true);

    // Un cadre imbriqué répond faux : inutile de l'apprendre en essayant.
    poser('(hover: hover)', false);
    assert.equal(canGoFullscreen(), false);
  } finally {
    globalThis.matchMedia = original.matchMedia;
    globalThis.document = original.document;
  }
});

/**
 * L'outil est **absent**, pas désactivé, et la fiche des raccourcis ne promet
 * pas la touche : un bouton grisé demande encore pourquoi.
 */
test('le lecteur ne monte le plein écran que là où il existe', () => {
  const reader = read('../src/renderer/js/views/reader.js');
  assert.ok(
    /this\.#fullscreen\s*\r?\n?\s*\?\s*tool\('fullscreen'/.test(reader),
    'le bouton doit être monté sous condition, pas désactivé',
  );
  assert.ok(
    /event\.key === 'F11' && this\.#fullscreen/.test(reader),
    'la touche F11 ne doit pas être avalée là où elle ne sert à rien',
  );

  const fiche = read('../src/renderer/js/components/shortcuts.js');
  assert.ok(
    fiche.includes("needs: 'fullscreen'"),
    'la ligne F11 de la fiche doit dire de quoi elle dépend',
  );
  assert.ok(
    fiche.includes('canGoFullscreen()'),
    'et la fiche doit interroger le même juge que la barre',
  );
});

/**
 * La fiche des raccourcis a quitté la barre du lecteur : elle y prenait une
 * place de doigt pour une liste de touches que le tactile ne peut pas frapper.
 * Un seul propriétaire de la liste, deux appelants — la touche `؟` en lecture,
 * le bouton de `/settings` — comme pour les thèmes et les modes.
 */
test('la fiche des raccourcis n’est plus un outil de la barre', () => {
  const reader = read('../src/renderer/js/views/reader.js');
  assert.equal(
    reader.includes("tool('help'"),
    false,
    'la barre du lecteur ne doit plus porter l’outil « ؟ »',
  );
  assert.equal(
    /const SHORTCUTS\s*=/.test(reader),
    false,
    'le lecteur ne doit plus détenir la liste',
  );
  assert.ok(reader.includes('openShortcuts'), 'la touche « ؟ » doit passer par le propriétaire');

  const settings = read('../src/renderer/js/views/settings.js');
  assert.ok(settings.includes('openShortcuts'), '/settings doit porter le bouton');

  // Les captures cliquaient l'outil disparu : elles frappent la touche.
  const capture = read('../src/main/capture.js');
  assert.equal(capture.includes("tool('help')"), false, 'la campagne clique un outil disparu');
});

// --------------------------------------------------- fermeture des panneaux

/**
 * Un panneau ouvert se referme au premier contact avec le texte : sa croix est
 * à l'autre bout de l'écran, et revenir au livre est de toute façon le geste
 * suivant. Le clic s'arrête là — escamoter les barres dans la foulée ferait
 * deux choses pour un seul geste.
 */
test('un clic sur le texte referme le panneau ouvert, et rien de plus', () => {
  const reader = read('../src/renderer/js/views/reader.js');
  // La **définition**, pas l'abonnement : celui-ci vient d'abord dans le fichier.
  const start = reader.indexOf('#onContentClick(event) {');
  assert.notEqual(start, -1, '#onContentClick a disparu');
  const corps = reader.slice(start, reader.indexOf('\n  }', start));

  const fermeture = corps.indexOf('#closePanels()');
  const barres = corps.indexOf("classList.toggle('is-hidden')");
  assert.notEqual(fermeture, -1, 'le clic doit refermer les panneaux');
  assert.notEqual(barres, -1, 'et sinon escamoter les barres');
  assert.ok(fermeture < barres, 'la fermeture passe avant, et sort');
  assert.ok(
    /#closePanels\(\);\s*\r?\n\s*return;/.test(corps),
    'le clic ne doit pas aussi escamoter les barres',
  );
});

// -------------------------------------------------------------- sélection

/**
 * Mesuré sur l'appareil : le navigateur défait la sélection **entre**
 * `mousedown` et `mouseup`.
 *
 *     mousedown   sélection vide = false   « ومعاني القرآ »
 *     mouseup     sélection vide = true    « »
 *     click       sélection vide = true    « »
 *
 * Une garde posée au `click` ne peut donc jamais protéger la tape qui vient de
 * défaire une sélection : elle lit toujours du vide et escamote les barres. On
 * ne pouvait plus rien sélectionner — la moindre touche rappelait les outils.
 */
test('la tape qui défait une sélection ne rappelle pas les barres', () => {
  const reader = read('../src/renderer/js/views/reader.js');
  assert.ok(
    /addEventListener\('pointerdown'/.test(reader),
    'l’état doit se relever au pointerdown, seul moment où il est encore vrai',
  );

  const start = reader.indexOf('#onContentClick(event) {');
  const corps = reader.slice(start, reader.indexOf('\n  }', start));
  const releve = corps.indexOf('this.#selectionAtPress');
  const barres = corps.indexOf("classList.toggle('is-hidden')");
  assert.notEqual(releve, -1, 'le clic doit consulter l’état relevé à l’appui');
  assert.ok(releve < barres, 'et le consulter avant de toucher aux barres');
  assert.ok(
    /if \(pressee\) \{\s*\r?\n\s*this\.#hideSelection\(\);\s*\r?\n\s*return;/.test(corps),
    'une tape qui défait une sélection ne fait que cela',
  );
});

/**
 * `selectionchange` est le seul évènement qui arrive **pendant** qu'une
 * sélection existe. Le lecteur n'écoutait que `mouseup`, un évènement de l'ère
 * souris : au doigt, l'appui long est piloté par la couche native du WebView,
 * et la feuille des couleurs ne s'ouvrait donc jamais. Le spike mobile l'avait
 * mesuré ; la correction n'avait pas été reportée ici.
 */
test('la sélection se détecte par selectionchange, pas par mouseup seul', () => {
  const reader = read('../src/renderer/js/views/reader.js');
  assert.ok(
    /addEventListener\('selectionchange', this\.#selectionHandler\)/.test(reader),
    'il faut écouter selectionchange sur document',
  );
  assert.ok(
    /removeEventListener\('selectionchange', this\.#selectionHandler\)/.test(reader),
    'et le retirer en partant',
  );
  assert.ok(
    /clearTimeout\(this\.#selectionTimer\)/.test(reader),
    'l’antirebond doit être annulé en partant',
  );

  // Sans antirebond, une sélection qui s'étire ferait sauter la feuille à
  // chaque caractère : `selectionchange` en émet un par pas.
  assert.ok(/SELECTION_SETTLE/.test(reader), 'la mesure doit attendre que la sélection se pose');
});

// --------------------------------------------------------- marges système

/**
 * Sur l'appareil, la fenêtre occupe tout l'écran — Android 15 impose le bord à
 * bord — et la barre d'état se pose par-dessus : mesuré à 42 px sur un Xiaomi
 * sous Android 16. Toute barre ancrée à un bord doit donc écarter le retrait,
 * sinon elle passe sous l'heure et le réseau. `env()` valant 0 partout
 * ailleurs, la règle est unique et ce test la tient aux deux bouts.
 */
test('les quatre retraits système ont un jeton, et il vient de env()', () => {
  const tokens = read('../src/renderer/styles/tokens.css');
  for (const [name, inset] of [
    ['--safe-top', 'safe-area-inset-top'],
    ['--safe-bottom', 'safe-area-inset-bottom'],
    ['--safe-left', 'safe-area-inset-left'],
    ['--safe-right', 'safe-area-inset-right'],
  ]) {
    assert.ok(
      new RegExp(`${name}:\\s*env\\(${inset}, 0px\\)`).test(tokens),
      `${name} doit valoir env(${inset}, 0px)`,
    );
  }
});

test('toute barre ancrée à un bord écarte le retrait du système', () => {
  const shell = read('../src/renderer/styles/shell.css');
  const views = read('../src/renderer/styles/views.css');

  /**
   * Toutes les déclarations qui portent sur [selector], réunies. Une seule
   * règle ne suffit pas : `.reader__header` et `.reader__footer` partagent un
   * bloc groupé pour les côtés et en ont chacun un pour le leur, et le test
   * n'a pas à savoir lequel des deux dit quoi.
   */
  const block = (source, selector) => {
    // Les commentaires portent des accolades et des virgules : les laisser
    // ferait passer tout un paragraphe pour un sélecteur.
    const sansCommentaires = source.replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [...sansCommentaires.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((rule) =>
      rule[1]
        .split(',')
        .map((part) => part.trim())
        .includes(selector),
    );
    assert.notEqual(rules.length, 0, `sélecteur introuvable : ${selector}`);
    return rules.map((rule) => rule[2]).join('\n');
  };

  assert.ok(block(shell, '.topbar').includes('var(--safe-top)'), 'la barre haute');
  assert.ok(block(shell, '.bottom-nav').includes('var(--safe-bottom)'), 'la barre d’onglets');
  assert.ok(block(views, '.reader__header').includes('var(--safe-top)'), 'le voile haut');
  assert.ok(block(views, '.reader__footer').includes('var(--safe-bottom)'), 'le voile bas');

  // La colonne de lecture réserve la place des deux voiles : ceux-ci ayant
  // grandi, sa réserve suit, sinon la première ligne se lit sous la barre.
  const scroll = block(views, '.reader__scroll');
  assert.ok(scroll.includes('var(--safe-top)'), 'la réserve haute de la colonne');
  assert.ok(scroll.includes('var(--safe-bottom)'), 'la réserve basse de la colonne');
});

/**
 * Le voile est **rembourré**, jamais décalé. Un `top` égal au retrait aurait
 * laissé le texte défiler à découvert dans la bande du système.
 */
test('le voile haut du lecteur monte jusqu’au bord de la fenêtre', () => {
  const views = read('../src/renderer/styles/views.css');
  const start = views.indexOf('.reader__header {');
  const rule = views.slice(start, views.indexOf('}', start));
  assert.ok(/top:\s*0;/.test(rule), 'le voile doit rester ancré à 0');
  assert.ok(/padding-top:\s*var\(--safe-top\)/.test(rule), 'et écarter le retrait par le padding');
});

/**
 * Sur le fil, le geste qui fait passer d'une page à l'autre est le défilement,
 * et lui seul. Les trois tiers et le glissement sont des gestes de la feuille :
 * les garder ferait deux façons de faire la même chose, dont une qu'on
 * déclenche sans la vouloir.
 *
 * Ce qui reste, en revanche : les deux chevrons et la jauge, en bas de l'écran,
 * comme sur la feuille.
 */
test('sur le fil, on défile — on ne tourne pas', () => {
  const reader = read('../src/renderer/js/views/reader.js');
  const zone = reader.slice(reader.indexOf('#zoneOf(clientX) {'), reader.indexOf('#onPointerDown(event) {'));
  assert.match(zone, /if \(this\.#mode === 'scroll'\) return 0;/);

  const up = reader.slice(reader.indexOf('#onPointerUp(event) {'), reader.indexOf('#endPointer(event) {'));
  const refus = up.indexOf("this.#mode === 'scroll'");
  const appel = up.indexOf('swipeTurn(');
  assert.ok(refus > 0 && refus < appel, 'le glissement tourne encore la page sur le fil');
});

test('un filet sépare deux pages du fil', () => {
  const views = read('../src/renderer/styles/views.css');
  const couture = views.slice(views.indexOf('.reader--scroll .reader__block + .reader__block'));
  assert.match(couture.slice(0, 200), /border-top: 1px solid var\(--reader-rule\)/);
});

// ------------------------------------------ un seul panneau de réglages

/**
 * Le panneau du lecteur regroupe tout ce qui change l'aspect du livre : la
 * façon de lire, la taille, l'ambiance, la face, les côtés qui tournent la
 * page. Ils vivent aussi dans `/settings` — c'est voulu, on règle en lisant ou
 * avant d'ouvrir — mais **une seule liste et un seul rendu** les portent.
 */
test('les cinq réglages sont dans le panneau du lecteur', () => {
  const panneau = methode(read('../src/renderer/js/views/reader.js'), '#settingsPanel(refs) {');
  for (const label of [
    "t('reader.modeLabel')",
    "t('reader.sizeLabel')",
    "t('reader.themeLabel')",
    "t('reader.fontLabel')",
    "t('settings.tapZonesLabel')",
  ]) {
    assert.ok(panneau.includes(label), `le panneau ne porte pas ${label}`);
  }
});

test('le panneau et /settings partagent le même contrôle', () => {
  // Deux écrans qui montrent la même liste sont exactement la configuration
  // qui a produit la police orpheline et l'ambiance morte.
  for (const chemin of ['../src/renderer/js/views/reader.js', '../src/renderer/js/views/settings.js']) {
    const source = read(chemin);
    assert.match(source, /from '\.\.\/components\/setting-choice\.js'/);
    // Les deux listes fermées passent par le composant, jamais par un rendu
    // local : c'est là que la seconde copie serait née.
    for (const liste of ['READING_MODES', 'TAP_ZONE_MODES']) {
      if (!source.includes(liste)) continue;
      const at = source.indexOf(`liste: ${liste}`);
      assert.notEqual(at, -1, `${chemin} montre ${liste} sans passer par settingChoice`);
      assert.ok(
        source.lastIndexOf('settingChoice({', at) > source.lastIndexOf('segmented({', at),
        `${chemin} rend ${liste} avec son propre contrôle`,
      );
    }
  }
});

test('les côtés se règlent dans les deux modes', () => {
  // Un réglage qui disparaît selon l'écran se cherche, et l'on finit par croire
  // qu'il n'a jamais existé.
  const panneau = methode(read('../src/renderer/js/views/reader.js'), '#settingsPanel(refs) {');
  const bloc = panneau.slice(panneau.indexOf("t('settings.tapZonesLabel')"));
  assert.equal(/#mode === 'page'|#mode === 'scroll'/.test(bloc), false, 'le réglage dépend du mode');
});

test('l’outil annonce ce qu’il ouvre', () => {
  const reader = read('../src/renderer/js/views/reader.js');
  // « Aa » annonçait de la typographie ; le panneau porte maintenant la façon
  // de lire et l'ambiance.
  assert.match(reader, /tool\('settings', 'sliders'/);
  assert.equal(/'formatSize'/.test(reader), false, 'l’ancienne icône est restée');
});

test('la bascule de mode a deux portes et une seule mécanique', () => {
  const reader = read('../src/renderer/js/views/reader.js');
  // Le contrôle écrit le réglage lui-même ; la touche `V` passe par
  // `#setReadingMode`, qui écrit puis applique. Une seule remontée.
  assert.match(reader, /onPick: \(key\) => this\.#applyReadingMode\(key\)/);
  const bascule = methode(reader, '#setReadingMode(key) {');
  assert.match(bascule, /setSetting\('reader\.mode', mode\)/);
  assert.match(bascule, /this\.#applyReadingMode\(mode\)/);
  const applique = methode(reader, '#applyReadingMode(key) {');
  assert.equal(/setSetting/.test(applique), false, 'la pose écrit aussi : deux écritures pour un clic');
});
