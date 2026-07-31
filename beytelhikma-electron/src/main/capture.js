import fs from 'node:fs';
import path from 'node:path';

/**
 * Relecture du design sans interaction : ouvre chaque route, attend que la vue
 * soit montée, prend une capture et signale les erreurs de console. Activé par
 * `npm run shot` (variable d'environnement `BEYT_CAPTURE`).
 */
const ROUTES = [
  ['home', '/home', '.home'],
  ['library', '/library', '.library__grid'],
  ['book-detail', '/book/ed-muqaddima-01', '.detail__main'],
  ['reader', '/reader/ed-muqaddima-01', '.reader__page p'],
];

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

  for (const [name, route, selector] of ROUTES) {
    await shoot(window, name, route, selector, outDir, problems);
  }

  // Fenêtre haute : l'accueil entier, jusqu'aux disciplines et à l'auteur.
  window.setContentSize(width, 1700);
  await wait(500);
  await shoot(window, 'home-full', '/home', '.bento', outDir, problems);

  // Fenêtre étroite : le rail cède la place aux barres haute et basse.
  window.setContentSize(430, 900);
  await wait(500);
  for (const [name, route, selector] of [ROUTES[0], ROUTES[1], ROUTES[3]]) {
    await shoot(window, `${name}-narrow`, route, selector, outDir, problems);
  }

  if (problems.length) {
    console.log('--- console ---');
    for (const problem of problems) console.log(problem);
  }
  return problems;
}
