import fs from 'node:fs';
import path from 'node:path';

/**
 * Relecture du design sans interaction : ouvre chaque route, attend que la vue
 * soit montée, prend une capture et signale les erreurs de console. Activé par
 * `npm run shot` (variable d'environnement `BEYT_CAPTURE`).
 */
/**
 * Les identifiants d'édition dépendent de la bibliothèque installée
 * (`ed-*` pour l'échantillon, `sh-*` pour le corpus Shamela) : on prend le
 * premier livre du catalogue plutôt que d'en coder un en dur.
 */
function routesFor(editionId) {
  return [
    ['home', '/home', '.home'],
    ['library', '/library', '.library__grid'],
    ['downloads', '/downloads', '.books-table'],
    ['explore', '/explore', '.explore__grid'],
    ['search', '/search', '.search__field'],
    ['notes', '/notes', '.notes__tabs'],
    ['settings', '/settings', '.settings__group'],
    ['collections', '/library', '.collections__row'],
    ['authors', '/authors', '.author-grid'],
    ['book-detail', `/book/${editionId}`, '.detail__main'],
    ['reader', `/reader/${editionId}`, '.reader__page p'],
  ];
}

async function firstEditionId(window) {
  const editionId = await window.webContents.executeJavaScript(
    `window.beytelhikma.repository
       .getBooks({ limit: 1 })
       .then((books) => books[0]?.editionId ?? null)`,
  );
  if (!editionId) throw new Error('catalogue vide : aucune édition à capturer');
  return editionId;
}

/**
 * Une édition qui porte une relation certaine — autre édition, recueil, ou les
 * textes d'un recueil. On balaie le début du catalogue plutôt que de coder un
 * identifiant en dur : ils diffèrent entre l'échantillon et le corpus Shamela.
 */
async function relatedEditionId(window, fallback) {
  const found = await window.webContents.executeJavaScript(
    `(async () => {
       const repository = window.beytelhikma.repository;
       const books = await repository.getBooks({ limit: 60 });
       for (const book of books) {
         const related = await repository.getRelatedBooks(book.editionId);
         const certain =
           related.editions.rows.length +
           related.partOf.rows.length +
           related.contains.rows.length;
         if (certain > 0) return book.editionId;
       }
       return null;
     })()`,
  );
  return found ?? fallback;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForSelector(contents, selector, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const found = await contents.executeJavaScript(
      `Boolean(document.querySelector(${JSON.stringify(selector)}))`,
    );
    if (found) return true;
    await wait(120);
  }
  return false;
}

async function shoot(window, name, route, selector, outDir, problems, { scrollTo = null } = {}) {
  await window.webContents.executeJavaScript(
    `location.hash = ${JSON.stringify(`#${route}`)}`,
  );
  if (!(await waitForSelector(window.webContents, selector))) {
    problems.push(`${name} : « ${selector} » jamais monté`);
  }
  // `capturePage` ne rend que la fenêtre : une section sous la ligne de flottaison
  // n'existe sur aucune image tant qu'on ne l'a pas amenée à l'écran.
  if (scrollTo) {
    await window.webContents.executeJavaScript(
      `document.querySelector(${JSON.stringify(scrollTo)})
         ?.scrollIntoView({ block: 'start' })`,
    );
    await wait(300);
  }
  // Une frame de plus pour laisser les transitions se poser.
  await wait(500);
  const image = await window.webContents.capturePage();
  const file = path.join(outDir, `${name}.png`);
  fs.writeFileSync(file, image.toPNG());
  console.log(`écrit : ${file} (${image.getSize().width}×${image.getSize().height})`);
}

/* Les outils du lecteur s'accrochent par `data-tool` : les infobulles portent
   leur raccourci et changent, l'attribut est le contrat. */
const tool = (key) => `document.querySelector('[data-tool="${key}"]').click()`;

/* Le lecteur cache plusieurs états derrière un clic : sommaire, réglages,
   recherche, notes, menu de sélection, fiche des raccourcis et fil continu. On
   les rejoue ici, sinon aucune capture ne les montre. */
const READER_STATES = [
  ['reader-toc', tool('toc')],
  ['reader-settings', tool('settings')],
  [
    'reader-search',
    `${tool('search')};
     const field = document.querySelector('.reader__search-field');
     // Les deux premiers mots d'une page réelle : le terme existe forcément.
     field.value = (document.querySelector('.reader__page p')?.textContent ?? '')
       .trim().split(/\\s+/).find((word) => word.length >= 4) ?? 'الله';
     field.dispatchEvent(new Event('input', { bubbles: true }));`,
  ],
  ['reader-annotations', tool('annotations')],
  ['reader-shortcuts', tool('help')],
  [
    'reader-selection',
    `const paragraph = document.querySelector('.reader__page p');
     const range = document.createRange();
     range.selectNodeContents(paragraph);
     const selection = getSelection();
     selection.removeAllRanges();
     selection.addRange(range);
     document
       .querySelector('.reader__scroll')
       .dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));`,
  ],
];

/**
 * Le seul état qui n'existe qu'après une écriture : un passage surligné, sa
 * note, et le panneau qui les liste.
 *
 * L'annotation est créée par le chemin normal — sélection, menu, couleur — puis
 * **retirée** à la fin : une campagne de captures tourne sur les vraies données
 * de l'utilisateur, elle n'a pas à y laisser de traces.
 */
async function shootAnnotationState(window, editionId, outDir, problems) {
  const contents = window.webContents;
  const idsOf = () =>
    contents.executeJavaScript(
      `window.beytelhikma.repository
         .getBookAnnotations(${JSON.stringify(editionId)})
         .then((all) => all.highlights.map((item) => item.highlightId))`,
    );

  await contents.executeJavaScript(`location.hash = '#/home'`);
  await waitForSelector(contents, '.home');
  await contents.executeJavaScript(
    `location.hash = ${JSON.stringify(`#/reader/${editionId}`)}`,
  );
  if (!(await waitForSelector(contents, '.reader__page p'))) {
    problems.push("reader-highlight : le lecteur n'est jamais monté");
    return;
  }
  await wait(400);

  let before = [];
  try {
    before = await idsOf();
    await contents.executeJavaScript(`(async () => {
      const paragraph = document.querySelector('.reader__page p');
      const range = document.createRange();
      range.selectNodeContents(paragraph);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document
        .querySelector('.reader__scroll')
        .dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 250));
      document.querySelector('.reader__highlights button').click();
      await new Promise((resolve) => setTimeout(resolve, 500));
      ${tool('annotations')};
    })()`);
  } catch (error) {
    problems.push(`reader-highlight : ${error?.message ?? error}`);
    return;
  }

  await wait(500);
  const image = await contents.capturePage();
  fs.writeFileSync(path.join(outDir, 'reader-highlight.png'), image.toPNG());
  console.log(`écrit : ${path.join(outDir, 'reader-highlight.png')}`);

  // Tant que l'annotation existe, l'écran transversal a quelque chose à montrer.
  await contents.executeJavaScript(`location.hash = '#/notes'`);
  if (await waitForSelector(contents, '.note-card')) {
    await wait(400);
    const notes = await contents.capturePage();
    fs.writeFileSync(path.join(outDir, 'notes-filled.png'), notes.toPNG());
    console.log(`écrit : ${path.join(outDir, 'notes-filled.png')}`);
  } else {
    problems.push("notes-filled : l'annotation créée n'apparaît pas dans « ملاحظاتي »");
  }

  // Ne retirer que ce que la capture a créé : les annotations de l'utilisateur
  // ne sont pas les nôtres.
  const after = await idsOf();
  const created = after.filter((id) => !before.includes(id));
  for (const id of created) {
    await contents.executeJavaScript(
      `window.beytelhikma.repository.deleteHighlight(${JSON.stringify(id)})`,
    );
  }
}

/**
 * Le fil continu. C'est un réglage persistant : on note celui de l'utilisateur,
 * on bascule, on capture, puis on le remet — sans quoi toutes les captures
 * suivantes, et sa prochaine lecture, se feraient dans un mode qu'il n'a pas
 * choisi.
 */
async function shootScrollMode(window, editionId, outDir, problems) {
  const contents = window.webContents;
  const before = await contents.executeJavaScript(
    `window.beytelhikma.repository.getSettings().then((all) => all['reader.mode'] ?? 'page')`,
  );

  try {
    await contents.executeJavaScript(`location.hash = '#/home'`);
    await waitForSelector(contents, '.home');
    await contents.executeJavaScript(
      `location.hash = ${JSON.stringify(`#/reader/${editionId}`)}`,
    );
    if (!(await waitForSelector(contents, '.reader__page p'))) {
      problems.push("reader-scroll : le lecteur n'est jamais monté");
      return;
    }
    await wait(400);
    await contents.executeJavaScript(`(() => {
      ${tool('settings')};
      // Deuxième bouton de « نمط القراءة » : le fil continu.
      document.querySelectorAll('.mode-choices button')[1].click();
      document.querySelector('.reader__settings .reader__tool').click();
    })()`);
    // Le fil se remplit page par page : il lui faut plus qu'une frame.
    await wait(1200);
    await contents.executeJavaScript(
      `document.querySelector('.reader__scroll').scrollTop = 900`,
    );
    await wait(800);
    const image = await contents.capturePage();
    fs.writeFileSync(path.join(outDir, 'reader-scroll.png'), image.toPNG());
    console.log(`écrit : ${path.join(outDir, 'reader-scroll.png')}`);
  } catch (error) {
    problems.push(`reader-scroll : ${error?.message ?? error}`);
  } finally {
    // Remis par l'interface, pas seulement en base : le renderer garde les
    // réglages en cache, une écriture directe le laisserait mentir jusqu'à la
    // fin de la session.
    await contents
      .executeJavaScript(`(() => {
        const index = ${JSON.stringify(before)} === 'scroll' ? 1 : 0;
        ${tool('settings')};
        document.querySelectorAll('.mode-choices button')[index].click();
        document.querySelector('.reader__settings .reader__tool').click();
      })()`)
      .catch(() => {});
    await contents.executeJavaScript(
      `window.beytelhikma.repository.saveSetting('reader.mode', ${JSON.stringify(before)})`,
    );
  }
}

async function shootReaderStates(window, editionId, outDir, problems) {
  for (const [name, script] of READER_STATES) {
    // Repasser par l'accueil : sans changement de hash, la vue n'est pas
    // reconstruite et le panneau ouvert à l'étape précédente resterait ouvert.
    await window.webContents.executeJavaScript(`location.hash = '#/home'`);
    await waitForSelector(window.webContents, '.home');
    await window.webContents.executeJavaScript(
      `location.hash = ${JSON.stringify(`#/reader/${editionId}`)}`,
    );
    if (!(await waitForSelector(window.webContents, '.reader__page p'))) {
      problems.push(`${name} : le lecteur n'est jamais monté`);
    }
    await wait(400);
    // Un état du lecteur s'ouvre en cliquant un bouton. Si la page n'est pas
    // celle qu'on croit — livre absent du disque, par exemple — le sélecteur ne
    // trouve rien et `executeJavaScript` rejette : on le note et on continue,
    // plutôt que d'interrompre toute la campagne de captures.
    try {
      await window.webContents.executeJavaScript(`(() => { ${script} })()`);
    } catch (error) {
      problems.push(`${name} : ${error?.message ?? error}`);
      continue;
    }
    await wait(500);
    const image = await window.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, `${name}.png`), image.toPNG());
    console.log(`écrit : ${path.join(outDir, `${name}.png`)}`);
  }
}

/**
 * Le thème est global : une capture claire ne dit plus rien de l'ambiance
 * nuit, et une ambiance qu'aucune image ne montre est une ambiance qui dérive.
 * On passe par les pastilles de `/settings` plutôt que par `data-theme` :
 * c'est le chemin réel, écriture dans `user.sqlite` comprise. L'ordre du DOM
 * est parchemin, blanc, nuit — indépendant du sens de lecture.
 */
async function shootNightTheme(window, editionId, outDir, problems) {
  const contents = window.webContents;
  await contents.executeJavaScript(`location.hash = '#/settings'`);
  if (!(await waitForSelector(contents, '.theme-choices button'))) {
    problems.push("thème nuit : les pastilles ne sont jamais montées");
    return;
  }

  const pick = (index) =>
    contents.executeJavaScript(
      `document.querySelectorAll('.theme-choices button')[${index}].click()`,
    );

  try {
    await pick(2);
    await wait(400);
    for (const [name, route, selector] of [
      ['settings-night', '/settings', '.settings'],
      ['home-night', '/home', '.featured'],
      ['reader-night', `/reader/${editionId}`, '.reader__page'],
    ]) {
      await shoot(window, name, route, selector, outDir, problems);
    }

    // Les disciplines et la frise des siècles sont sous la ligne de flottaison
    // en 900 px, et ce sont elles qui portent les teintes tirées des familles
    // de couvertures — les seules du lecteur à changer de recette en nuit.
    // Sans cette image, elles ne seraient vérifiées qu'en parchemin.
    window.setContentSize(1360, 3100);
    await wait(400);
    await shoot(window, 'home-night-full', '/home', '.featured', outDir, problems);
    window.setContentSize(1360, 900);
    await wait(300);
  } finally {
    // Sans ce retour au parchemin, toute la fin de la campagne partirait en
    // graphite et le réglage survivrait à la capture.
    await contents.executeJavaScript(`location.hash = '#/settings'`);
    if (await waitForSelector(contents, '.theme-choices button')) await pick(0);
    await wait(300);
  }
}

/**
 * Passe anglaise. Une langue qu'aucune image ne montre est une langue qui
 * dérive : la bascule change la direction de l'interface entière, et c'est
 * précisément ce qu'un développement mené en arabe ne voit jamais.
 *
 * Le choix passe par les vrais boutons de l'écran des réglages, comme la
 * campagne de nuit passe par les vraies pastilles — capturer un état posé à la
 * main vérifierait la capture, pas l'application.
 */
async function shootEnglish(window, editionId, outDir, problems) {
  const contents = window.webContents;
  await contents.executeJavaScript(`location.hash = '#/settings'`);
  if (!(await waitForSelector(contents, '[data-locale-choice]'))) {
    problems.push('langue : les boutons de langue ne sont jamais montés');
    return;
  }

  const pick = (key) =>
    contents.executeJavaScript(`document.querySelector('[data-locale-choice="${key}"]').click()`);

  try {
    await pick('en');
    await wait(400);
    for (const [name, route, selector] of [
      ['settings-en', '/settings', '.settings'],
      ['home-en', '/home', '.featured'],
      ['library-en', '/library', '.shell'],
      ['downloads-en', '/downloads', '.shell'],
      ['reader-en', `/reader/${editionId}`, '.reader__page'],
    ]) {
      await shoot(window, name, route, selector, outDir, problems);
    }
  } finally {
    // Sans ce retour à l'arabe, toute la fin de la campagne partirait en LTR et
    // le réglage survivrait à la capture.
    await contents.executeJavaScript(`location.hash = '#/settings'`);
    if (await waitForSelector(contents, '[data-locale-choice]')) await pick('ar');
    await wait(300);
  }
}

export async function captureRoutes(window, { outDir, width = 1360, height = 900 }) {
  fs.mkdirSync(outDir, { recursive: true });
  const problems = [];

  window.webContents.on('console-message', (event) => {
    if (event.level === 'error' || event.level === 'warning') {
      problems.push(`[${event.level}] ${event.message}`);
    }
  });
  window.webContents.on('render-process-gone', (_event, details) =>
    problems.push(`render-process-gone: ${JSON.stringify(details)}`),
  );

  window.setContentSize(width, height);
  await wait(700);

  const editionId = await firstEditionId(window);
  const routes = routesFor(editionId);
  console.log(`capture sur l'édition ${editionId}`);

  for (const [name, route, selector] of routes) {
    await shoot(window, name, route, selector, outDir, problems);
  }

  // Les bandes certaines ne concernent qu'une minorité de livres — 7 % pour
  // `same_group`, 1 % pour `part_of` : capturer le premier venu ne montrerait
  // que le repli par auteur et par discipline.
  // Les cursus pointent le corpus Shamela : sur le jeu d'exemple aucun ne se
  // résout, et une capture d'écran vide vaut moins que pas de capture du tout.
  const curriculumId = await window.webContents.executeJavaScript(
    `window.beytelhikma.repository
       .getCurricula()
       .then((list) => list[0]?.id ?? null)`,
  );
  if (curriculumId) {
    await shoot(window, 'curricula', '/curricula', '.curricula__grid', outDir, problems);
    await shoot(
      window,
      'curriculum',
      `/curriculum/${curriculumId}`,
      '.curriculum__steps',
      outDir,
      problems,
    );
  } else {
    console.log('cursus : aucun ne se résout sur cette bibliothèque — captures sautées');
  }

  const linked = await relatedEditionId(window, editionId);
  await shoot(
    window,
    'book-relations',
    `/book/${linked}`,
    '.detail__relations',
    outDir,
    problems,
    { scrollTo: '.detail__relations' },
  );

  // Les trois listes paginées (auteur, discipline, siècle) partagent un écran :
  // en capturer une suffit à voir la grille, le sous-titre et la barre de pages.
  const scoped = await window.webContents.executeJavaScript(
    `window.beytelhikma.repository
       .getFeaturedAuthor()
       .then((author) => author?.authorId ?? null)`,
  );
  if (scoped) {
    await shoot(window, 'author-books', `/author/${scoped}`, '.library__grid', outDir, problems);
  } else {
    problems.push("author-books : aucun auteur en vedette");
  }

  await shootReaderStates(window, editionId, outDir, problems);
  await shootScrollMode(window, editionId, outDir, problems);
  await shootAnnotationState(window, editionId, outDir, problems);

  // La recherche générale n'a d'écran que quand elle a cherché : sans terme,
  // la capture ne montre qu'un champ vide. Le terme doit toucher les deux
  // vagues — le catalogue *et* le texte des livres installés — sinon l'image
  // ne montre que la moitié de l'écran et les sections dérivent sans qu'aucune
  // capture ne le dise.
  await window.webContents.executeJavaScript(`location.hash = '#/search'`);
  if (await waitForSelector(window.webContents, '.search__field')) {
    await window.webContents.executeJavaScript(`(() => {
      const field = document.querySelector('.search__field');
      field.value = 'البخاري';
      field.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    // Deux vagues, deux attentes : les sections de catalogue reviennent tout de
    // suite, le balayage ouvre chaque livre installé l'un après l'autre. On
    // attend la seconde — c'est elle qui décide quand l'écran est complet.
    if (!(await waitForSelector(window.webContents, '.search__section-head'))) {
      problems.push("search-results : aucune section n'a répondu");
    }
    await wait(6000);
    const image = await window.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, 'search-results.png'), image.toPNG());
    console.log(`écrit : ${path.join(outDir, 'search-results.png')}`);
  } else {
    problems.push("search-results : l'écran de recherche n'est jamais monté");
  }

  // L'index des auteurs est paginé et vit en bas de l'écran : sans descendre,
  // aucune capture ne montre la barre de pages ni le champ de recherche.
  await shoot(window, 'authors', '/authors', '.author-grid', outDir, problems);
  await window.webContents.executeJavaScript(
    `document.querySelector('.authors__toolbar')?.scrollIntoView({ block: 'start' })`,
  );
  await wait(500);
  const authorsIndex = await window.webContents.capturePage();
  fs.writeFileSync(path.join(outDir, 'authors-index.png'), authorsIndex.toPNG());
  console.log(`écrit : ${path.join(outDir, 'authors-index.png')}`);

  await shootNightTheme(window, editionId, outDir, problems);
  await shootEnglish(window, editionId, outDir, problems);

  // Fenêtre haute : l'accueil entier, jusqu'aux disciplines, aux siècles et à
  // l'auteur. Trop courte, elle tranche la frise sans que rien ne le signale —
  // une section qu'aucune image ne montre est une section qui dérive.
  window.setContentSize(width, 3100);
  await wait(500);
  await shoot(window, 'home-full', '/home', '.featured', outDir, problems);
  await shoot(window, 'authors-full', '/authors', '.author-grid', outDir, problems);
  // Les chemins de « عن التطبيق » sont sous la ligne de flottaison en 900 px.
  await shoot(window, 'settings-full', '/settings', '.meta-grid--paths', outDir, problems);

  // Fenêtre étroite : le rail cède la place aux barres haute et basse.
  window.setContentSize(430, 900);
  await wait(500);
  // Les réglages en font partie depuis qu'ils portent des groupes segmentés :
  // c'est la largeur où ils débordent, et un écran qu'aucune image ne montre
  // est un écran qui dérive.
  const narrow = new Set(['home', 'library', 'authors', 'reader', 'settings']);
  for (const [name, route, selector] of routes.filter(([key]) => narrow.has(key))) {
    await shoot(window, `${name}-narrow`, route, selector, outDir, problems);
  }

  if (problems.length) {
    console.log('--- console ---');
    for (const problem of problems) console.log(problem);
  }
  return problems;
}
