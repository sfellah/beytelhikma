import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  DEFAULT_READING_MODE,
  READING_MODES,
  resolveReadingMode,
} from '../src/shared/reading-modes.js';

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

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
    settings.includes('dataset.readingMode'),
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
