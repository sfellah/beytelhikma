import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  DEFAULT_PAGER_LAYOUT,
  DEFAULT_READING_MODE,
  PAGER_LAYOUTS,
  READING_MODES,
  resolvePagerLayout,
  resolveReadingMode,
} from '../src/shared/reading-modes.js';

// Les fins de ligne du dépôt sont normalisées à la lecture : `core.autocrlf`
// rend des `\r\n` sous Windows, et un test qui cite deux lignes d'affilée
// échouerait sur la machine d'un contributeur et pas sur celle d'un autre.
const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8').replaceAll('\r\n', '\n');

// --------------------------------------------------------- mode de lecture

test('resolveReadingMode rend une clé connue telle quelle', () => {
  for (const mode of READING_MODES) {
    assert.equal(resolveReadingMode(mode.key), mode.key);
  }
});

test('resolveReadingMode replie tout le reste sur la page imprimée', () => {
  for (const stored of ['continuous', 'flow', '', ' ', null, undefined, 0, {}]) {
    assert.equal(resolveReadingMode(stored), DEFAULT_READING_MODE);
  }
});

/**
 * Le propriétaire est unique, comme pour les thèmes et les polices. Deux écrans
 * montrent maintenant ce choix — le panneau du lecteur ne le porte plus, mais
 * la touche `V` l'écrit encore — et c'est exactement la configuration dans
 * laquelle les listes recopiées avaient divergé.
 */
test('aucune vue ne redéclare la liste des modes de lecture', () => {
  for (const view of [
    '../src/renderer/js/views/reader.js',
    '../src/renderer/js/views/settings.js',
  ]) {
    const source = read(view);
    assert.equal(
      /const (MODES|READING_MODES)\s*=/.test(source),
      false,
      `${view} redéclare la liste des modes`,
    );
    assert.ok(
      source.includes('shared/reading-modes.js'),
      `${view} doit tenir la liste de son propriétaire unique`,
    );
  }
});

/**
 * Le mode se règle dans `/settings`, et le panneau du lecteur ne garde que ce
 * qui se touche en lisant. Sans ce test, un panneau qui le réintroduirait
 * rendrait la section des réglages redondante sans que rien ne le dise.
 */
test('le panneau du lecteur ne porte plus le mode de lecture', () => {
  const reader = read('../src/renderer/js/views/reader.js');
  assert.equal(reader.includes('mode-choices'), false, 'le lecteur remonte les cartes de mode');
  assert.equal(
    reader.includes("t('reader.modeLabel')"),
    false,
    'le lecteur remonte le libellé du mode',
  );

  const settings = read('../src/renderer/js/views/settings.js');
  assert.ok(settings.includes("t('reader.modeLabel')"), '/settings doit porter le réglage');
  assert.ok(
    settings.includes("marque: 'readingMode'"),
    'le contrat des captures est `data-reading-mode`',
  );
});

/**
 * Les cartes `.mode-choices` tiraient leurs teintes de `--reader-*`, déclarées
 * sous `.reader` seulement. Déplacées telles quelles dans les réglages, elles
 * s'y seraient peintes en transparent : la règle doit disparaître avec elles.
 */
test('la feuille de style ne garde pas de règle orpheline pour les cartes de mode', () => {
  const views = read('../src/renderer/styles/views.css');
  assert.equal(/^\.mode-choices/m.test(views), false, 'règle .mode-choices sans porteur');
});

// -------------------------------------------------------------- fil continu

/** Le corps d'une méthode, jusqu'à l'accolade fermante de son indentation. */
const methode = (source, entete) => {
  const start = source.indexOf(entete);
  assert.notEqual(start, -1, `méthode absente : ${entete}`);
  return source.slice(start, source.indexOf('\n  }', start));
};

/** Le corps d'une règle CSS nommée par son sélecteur exact. */
const regle = (source, selecteur) => {
  const start = source.indexOf(`${selecteur} {`);
  assert.notEqual(start, -1, `règle absente : ${selecteur}`);
  return source.slice(start, source.indexOf('}', start));
};

/**
 * Au fil, la page n'est plus une unité qu'on lise : le pied imprimé n'y
 * désigne rien. Il n'est donc **pas dessiné**, plutôt que dessiné puis masqué —
 * caché, il resterait dans l'arbre, dans la sélection et dans le texte copié,
 * au milieu d'une phrase que le fil vient de recoudre.
 */
test('au fil continu, aucune page ne laisse de pied imprimé', () => {
  const reader = read('../src/renderer/js/views/reader.js');
  const corps = methode(reader, '#makeBlock(index, page) {');

  assert.ok(
    /const flow = this\.#prefs\.mode === 'scroll'/.test(corps),
    '#makeBlock doit savoir dans quel mode il monte',
  );
  assert.ok(
    /const foot = flow \? null : h\(/.test(corps),
    'le pied imprimé ne doit pas exister au fil',
  );
  assert.ok(
    /if \(foot\) \{/.test(corps),
    'et son libellé ne doit pas se calculer pour un nœud qu’on ne monte pas',
  );

  // En mode page, il reste : c'est là qu'il dit où l'on en est sur la feuille.
  assert.ok(corps.includes("t('reader.pageOf'"), 'la page imprimée garde son « N sur M »');
  assert.ok(corps.includes("t('reader.printedPage'"), 'et son numéro d’édition');
});

/**
 * Deux pages du fil se suivent comme deux paragraphes du même texte. Une
 * marge, même discrète, redessinerait la coupure que le fil défait : l'œil
 * compterait les pages au lieu de lire.
 */
test('au fil continu, aucune marge ne sépare deux pages', () => {
  const views = read('../src/renderer/styles/views.css');
  assert.ok(
    /margin-top:\s*0;/.test(regle(views, '.reader--scroll .reader__block + .reader__block')),
    'deux blocs du fil doivent se toucher',
  );

  // Le pied ayant quitté le fil, sa règle d'écart n'a plus de porteur : la
  // laisser rouvrirait la porte au premier pied qu'on remonterait par mégarde.
  assert.equal(
    /\.reader--scroll \.reader__page-foot\s*\{/.test(views),
    false,
    'règle d’écart pour un pied que le fil ne dessine plus',
  );
});

/**
 * Sans page à l'écran, les deux chevrons et la fraction « ١٢ / ٢٣٠ » ne
 * désignent plus rien de visible. Le ruban n'y garde que ce qui dit *où l'on
 * en est* : la jauge et le pourcentage.
 *
 * Ici une règle CSS et non un `if` au montage : les trois nœuds ont un sens en
 * mode page, et la touche `V` bascule le mode sans reconstruire la barre.
 */
test('au fil continu, le ruban perd les chevrons et la fraction, garde la jauge', () => {
  const views = read('../src/renderer/styles/views.css');
  assert.ok(
    /display:\s*none/.test(regle(views, '.reader--scroll .reader__pager')),
    'la pagination du ruban doit disparaître au fil',
  );

  // La jauge et le pourcentage ne sont visés par rien : ce sont eux qui restent.
  for (const garde of ['.reader__progress', '.reader__percent', '.reader__rail']) {
    assert.equal(
      new RegExp(`\\.reader--scroll [^{,]*\\${garde}\\b[^{]*\\{[^}]*display:\\s*none`).test(views),
      false,
      `${garde} doit rester au fil`,
    );
  }

  // Et le mode page n'est touché par personne : c'est la portée du sélecteur
  // qui le garantit, pas une seconde règle qui les remonterait.
  assert.equal(
    /\.reader--page[^{,]*\.reader__pager\b[^{]*\{[^}]*display:\s*none/.test(views),
    false,
    'le ruban de la page imprimée doit garder ses chevrons et sa fraction',
  );

  // Masqués, ils continuent d'être tenus à jour : au retour à la page imprimée
  // la fraction est juste sans attendre le prochain mouvement.
  const reader = read('../src/renderer/js/views/reader.js');
  const courant = methode(reader, '#setCurrent(index, page, { save = true } = {}) {');
  assert.ok(courant.includes('this.#nodes.pagerCurrent.textContent'), 'la fraction reste tenue');
  assert.ok(courant.includes('this.#nodes.previous.disabled'), 'et les chevrons aussi');
});

/**
 * Le titre de chapitre se répétait à chaque page : au fil, il reviendrait
 * toutes les vingt lignes et recouperait le texte en pages. Il n'annonce donc
 * que ce qui **commence** — et la comparaison se fait avec le bloc réellement
 * monté juste avant, jamais avec le cache des pages : celui-ci garde des pages
 * qui ont quitté l'écran, et un chapitre resterait tu par un voisin absent.
 */
test('le titre de chapitre se compare au bloc voisin monté, pas au cache des pages', () => {
  const reader = read('../src/renderer/js/views/reader.js');
  const corps = methode(reader, '#syncChapters() {');

  assert.ok(
    /this\.#blocks\.get\(block\.index - 1\)/.test(corps),
    'la comparaison doit lire le bloc monté juste avant',
  );
  assert.equal(
    /this\.#pages\.get\(/.test(corps),
    false,
    'le cache des pages n’est pas ce qui est à l’écran',
  );

  // Le fenêtrage démonte et remonte les deux bords du fil : chaque mouvement
  // doit redemander la décision, sinon la page devenue première du fil reste
  // muette et l'on ne sait plus dans quel chapitre on lit.
  for (const entete of ['async #extendEnd() {', 'async #extendStart() {']) {
    assert.ok(
      methode(reader, entete).includes('this.#syncChapters()'),
      `${entete} doit resynchroniser les titres`,
    );
  }
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
