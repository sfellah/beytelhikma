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

async function shoot(window, name, route, selector, outDir, problems) {
  await window.webContents.executeJavaScript(
    `location.hash = ${JSON.stringify(`#${route}`)}`,
  );
  if (!(await waitForSelector(window.webContents, selector))) {
    problems.push(`${name} : « ${selector} » jamais monté`);
  }
  // Une frame de plus pour laisser les transitions se poser.
  await wait(500);
  const image = await window.webContents.capturePage();
  const file = path.join(outDir, `${name}.png`);
  fs.writeFileSync(file, image.toPNG());
  console.log(`écrit : ${file} (${image.getSize().width}×${image.getSize().height})`);
}

/* Le lecteur cache trois états derrière un clic : le sommaire, les réglages et
   le menu de sélection. On les rejoue ici, sinon aucune capture ne les montre. */
const READER_STATES = [
  ['reader-toc', `document.querySelector('[title="فهرس المحتويات"]').click()`],
  ['reader-settings', `document.querySelector('[title="إعدادات القراءة"]').click()`],
  [
    'reader-search',
    `document.querySelector('[title="بحث في الكتاب"]').click();
     const field = document.querySelector('.reader__search-field');
     // Les deux premiers mots d'une page réelle : le terme existe forcément.
     field.value = (document.querySelector('.reader__page p')?.textContent ?? '')
       .trim().split(/\\s+/).find((word) => word.length >= 4) ?? 'الله';
     field.dispatchEvent(new Event('input', { bubbles: true }));`,
  ],
  [
    'reader-annotations',
    `document.querySelector('[title="ملاحظاتي في هذا الكتاب"]').click()`,
  ],
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
      document.querySelector('[title="ملاحظاتي في هذا الكتاب"]').click();
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

  await shootReaderStates(window, editionId, outDir, problems);
  await shootAnnotationState(window, editionId, outDir, problems);

  // La recherche transversale n'a d'écran que quand elle a cherché : sans
  // terme, la capture ne montre qu'un champ vide.
  await window.webContents.executeJavaScript(`location.hash = '#/search'`);
  if (await waitForSelector(window.webContents, '.search__field')) {
    await window.webContents.executeJavaScript(`(() => {
      const field = document.querySelector('.search__field');
      field.value = 'الله';
      field.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    // Le balayage ouvre chaque livre installé : il lui faut plus qu'une frame.
    await wait(6000);
    const image = await window.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, 'search-results.png'), image.toPNG());
    console.log(`écrit : ${path.join(outDir, 'search-results.png')}`);
  } else {
    problems.push("search-results : l'écran de recherche n'est jamais monté");
  }

  // Fenêtre haute : l'accueil entier, jusqu'aux disciplines et à l'auteur.
  window.setContentSize(width, 2700);
  await wait(500);
  await shoot(window, 'home-full', '/home', '.featured', outDir, problems);
  await shoot(window, 'authors-full', '/authors', '.author-grid', outDir, problems);
  // Les chemins de « عن التطبيق » sont sous la ligne de flottaison en 900 px.
  await shoot(window, 'settings-full', '/settings', '.meta-grid--paths', outDir, problems);

  // Fenêtre étroite : le rail cède la place aux barres haute et basse.
  window.setContentSize(430, 900);
  await wait(500);
  const narrow = new Set(['home', 'library', 'authors', 'reader']);
  for (const [name, route, selector] of routes.filter(([key]) => narrow.has(key))) {
    await shoot(window, `${name}-narrow`, route, selector, outDir, problems);
  }

  if (problems.length) {
    console.log('--- console ---');
    for (const problem of problems) console.log(problem);
  }
  return problems;
}
