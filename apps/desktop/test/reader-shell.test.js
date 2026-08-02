import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  DEFAULT_PAGER_LAYOUT,
  PAGER_LAYOUTS,
  resolvePagerLayout,
} from '../src/shared/pager-layouts.js';
import { SWIPE_MIN, TURN_ZONE, swipeTurn, turnZone } from '../src/shared/page-turn.js';

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

// --------------------------------------------------- purge du fil vertical

/**
 * Le fil vertical a existé : un mode de lecture, un réglage dans `/settings`,
 * une touche `V`, une classe CSS, une capture. Deux tentatives — la page
 * continue, puis le livre entier monté — et on l'a jeté. Il ne reste qu'une
 * façon de lire : la page imprimée.
 *
 * Ce test tient la porte fermée. Ce qui gêne n'est pas le code mort, c'est
 * qu'un réglage à une seule valeur demande un choix qui n'en est pas un, et
 * qu'une classe qui ne distingue plus rien survit par habitude jusqu'à ce que
 * quelqu'un croie qu'elle sert.
 */
test('il ne reste aucune trace du fil vertical', () => {
  const interdits = [
    'reading-modes',
    'READING_MODES',
    'resolveReadingMode',
    'reader.mode',
    'reader--scroll',
    // `\b` et non la sous-chaîne nue : `reader--pager-*` reste, c'est le ruban
    // de pagination et non la façon de lire.
    /reader--page\b/,
    'data-reading-mode',
    'readingMode',
    '#showInFlow',
    '#extendEnd',
    '#extendStart',
    '#startBackfill',
    '#visibleBlock',
    '#syncChapters',
    'FLOW_KEEP',
    'FLOW_STEP',
    'BACKFILL',
  ];

  for (const chemin of [
    '../src/renderer/js/views/reader.js',
    '../src/renderer/js/views/settings.js',
    '../src/renderer/js/components/shortcuts.js',
    '../src/shared/pager-layouts.js',
    '../src/main/capture.js',
    '../src/renderer/styles/views.css',
    '../src/renderer/js/locales/ar.js',
    '../src/renderer/js/locales/en.js',
  ]) {
    const source = read(chemin);
    for (const motif of interdits) {
      const present = typeof motif === 'string' ? source.includes(motif) : motif.test(source);
      assert.equal(present, false, `${chemin} porte encore « ${motif} »`);
    }
  }

  // Le module qui portait les deux listes a pris le nom de celle qui reste :
  // l'ancien aurait promis un choix qui n'existe plus.
  const modes = fileURLToPath(new URL('../src/shared/reading-modes.js', import.meta.url));
  assert.equal(existsSync(modes), false, 'le module des façons de lire doit avoir disparu');

  // La touche `V` basculait le mode : elle n'a plus rien à basculer, ni dans
  // le lecteur ni dans la fiche qui la promettait.
  assert.equal(
    read('../src/renderer/js/components/shortcuts.js').includes("keys: ['V']"),
    false,
    'la fiche promet une touche qui ne fait plus rien',
  );
  assert.equal(
    read('../src/renderer/js/views/reader.js').includes("case 'v':"),
    false,
    'le lecteur écoute encore la touche du mode',
  );
});

/**
 * Les cartes `.mode-choices` tiraient leurs teintes de `--reader-*`, déclarées
 * sous `.reader` seulement. La règle avait déjà perdu son porteur une fois ;
 * elle ne doit pas revenir maintenant que le choix lui-même a disparu.
 */
test('la feuille de style ne garde pas de règle orpheline pour les cartes de mode', () => {
  const views = read('../src/renderer/styles/views.css');
  assert.equal(/^\.mode-choices/m.test(views), false, 'règle .mode-choices sans porteur');
});

/**
 * Des deux listes que portait le module, il n'en reste qu'une, et elle garde
 * son propriétaire unique : c'est de deux copies qu'étaient nées la police
 * orpheline et le thème `sepia` que plus aucune règle ne lisait.
 */
test('aucune vue ne redéclare la liste des rubans', () => {
  for (const view of [
    '../src/renderer/js/views/reader.js',
    '../src/renderer/js/views/settings.js',
  ]) {
    const source = read(view);
    assert.equal(/const PAGER_LAYOUTS\s*=/.test(source), false, `${view} redéclare la liste`);
    assert.ok(
      source.includes('shared/pager-layouts.js'),
      `${view} doit tenir la liste de son propriétaire unique`,
    );
  }
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

// ------------------------------------------------------------ ruban dressé

test('resolvePagerLayout ne reconnaît que les deux dispositions', () => {
  for (const layout of PAGER_LAYOUTS) {
    assert.equal(resolvePagerLayout(layout.key), layout.key);
  }
  for (const stored of ['vertical-rl', 'side', '', null, undefined, 0, {}]) {
    assert.equal(resolvePagerLayout(stored), DEFAULT_PAGER_LAYOUT);
  }
});

/**
 * Dressé, le ruban ne prend **pas** de place en plus : le pied s'en va, la
 * bande le remplace. Si la colonne de lecture gardait sa réserve basse tout en
 * cédant sa largeur, le réglage coûterait des deux côtés.
 */
test('le ruban dressé échange la hauteur contre la largeur', () => {
  const views = read('../src/renderer/styles/views.css');
  const bloc = (selector) => {
    const start = views.indexOf(`${selector} {`);
    assert.notEqual(start, -1, `règle absente : ${selector}`);
    return views.slice(start, views.indexOf('}', start));
  };

  const scroll = bloc('.reader--pager-vertical .reader__scroll');
  assert.equal(
    /padding-right/.test(scroll),
    false,
    'le ruban est posé sur la page : la colonne ne lui rend aucune largeur',
  );
  assert.ok(
    /padding-bottom:\s*calc\(var\(--space-xxl\)/.test(scroll),
    'et récupère la hauteur que le bandeau en pied lui prenait',
  );

  // Posé sur la page, il doit laisser voir dessous : un flou masquerait le
  // début de chaque ligne, là où un bandeau en pied ne masque qu'une marge.
  const bande = bloc('.reader--pager-vertical .reader__footer');
  assert.ok(/backdrop-filter:\s*none/.test(bande), 'la bande ne doit pas flouter le texte');
  assert.ok(/background:\s*color-mix/.test(bande), 'et ne porter qu’un voile');

  // Escamoté, il sort par son bord : le bas n'est plus le sien.
  assert.ok(
    /translateX\(100%\)/.test(bloc('.reader--pager-vertical .reader__footer.is-hidden')),
    'le ruban dressé doit sortir par le côté',
  );
});

/**
 * `[dir='rtl'] .reader__rail` repeint le dégradé « vers la gauche » à la même
 * spécificité : c'est exactement la panne du rail couché, et elle se rejouerait
 * si le sélecteur RTL n'était pas nommé ici aussi.
 */
test('le rail dressé nomme ses deux sélecteurs', () => {
  const views = read('../src/renderer/styles/views.css');
  assert.ok(
    views.includes(
      '.reader--pager-vertical .reader__rail,\n[dir=\'rtl\'] .reader--pager-vertical .reader__rail',
    ),
    'le rail dressé doit se déclarer pour les deux directions',
  );
  const start = views.indexOf('.reader--pager-vertical .reader__rail,');
  const rule = views.slice(start, views.indexOf('}', start));
  assert.ok(/writing-mode:\s*vertical-rl/.test(rule), 'le rail doit être dressé');
  // `writing-mode` dresse, `direction` décide du bout d'où part la valeur :
  // hérité en RTL, il envoyait la page 2 sur 230 au *bas* du rail.
  assert.ok(/direction:\s*ltr/.test(rule), 'la page 1 doit rester en haut dans les deux langues');
});

/**
 * Dressés, les chevrons désignent le haut et le bas. Ceux de direction
 * d'écriture annonceraient un geste qu'on ne fait pas. Un seul endroit en
 * décide — la bascule se fait en lisant, et une seconde décision au montage
 * divergerait au premier clic.
 */
test('un seul endroit décide du tracé des chevrons', () => {
  const reader = read('../src/renderer/js/views/reader.js');
  const start = reader.indexOf('#syncPager() {');
  assert.notEqual(start, -1, '#syncPager a disparu');
  const corps = reader.slice(start, reader.indexOf('\n  }', start));
  assert.ok(corps.includes("'chevronUp'"), 'la page précédente est en haut');
  assert.ok(corps.includes("'chevronDown'"), 'la page suivante est en bas');

  assert.equal(
    reader.split("'chevronUp'").length - 1,
    1,
    'le tracé dressé ne doit être décidé qu’une fois',
  );
});

/**
 * Le ruban se bascule aussi en lisant : c'est le seul des deux réglages de
 * `/settings` dont on veut voir l'effet sur la page qu'on a sous les yeux.
 * Deux portes, une seule valeur — comme la touche `V` et le mode de lecture.
 */
test('la barre du lecteur porte la bascule du ruban', () => {
  const reader = read('../src/renderer/js/views/reader.js');
  assert.ok(reader.includes("tool('pager'"), 'l’outil doit exister');
  assert.ok(reader.includes("setSetting('reader.pager'"), 'et écrire le réglage partagé');

  // L'icône montre la disposition qu'on obtiendra, comme celle du plein écran.
  const start = reader.indexOf('#syncPager() {');
  const corps = reader.slice(start, reader.indexOf('\n  }', start));
  assert.ok(
    /dresse \? 'pagerHorizontal' : 'pagerVertical'/.test(corps),
    'l’outil annonce la disposition suivante, pas celle qu’on voit déjà',
  );
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

/**
 * Le ruban dressé est posé sur le texte : il ne doit pas capter le doigt. En
 * RTL il couvre le bord où **commence** chaque ligne, et il avalait le geste
 * qui aurait démarré une sélection.
 */
test('le voile du ruban dressé laisse passer le doigt', () => {
  const views = read('../src/renderer/styles/views.css');
  const bloc = (selector) => {
    const start = views.indexOf(selector);
    assert.notEqual(start, -1, `règle absente : ${selector}`);
    return views.slice(start, views.indexOf('}', start));
  };

  const voile = bloc('.reader--pager-vertical .reader__footer,\n');
  assert.ok(/pointer-events:\s*none/.test(voile), 'le voile doit être transparent au doigt');

  const controles = bloc('.reader--pager-vertical .reader__tool,\n');
  assert.ok(/pointer-events:\s*auto/.test(controles), 'les chevrons et la jauge gardent leur prise');
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
