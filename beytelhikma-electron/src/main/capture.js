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
    ['downloads', '/downloads', '.downloads'],
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
    await window.webContents.executeJavaScript(`(() => { ${script} })()`);
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

  // Fenêtre haute : l'accueil entier, jusqu'aux disciplines et à l'auteur.
  window.setContentSize(width, 2700);
  await wait(500);
  await shoot(window, 'home-full', '/home', '.featured', outDir, problems);
  await shoot(window, 'authors-full', '/authors', '.author-grid', outDir, problems);

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
