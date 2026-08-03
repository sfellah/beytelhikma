import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { app, BrowserWindow, ipcMain, net, protocol, shell } from 'electron';

import { AppDatabase, resolveLibrarySource } from './app-database.js';
import { BookRepository, REPOSITORY_METHODS } from './book-repository.js';
import { resolveUserFontPath } from './font-installer.js';
import { estLienExterne, navigationPermise } from './navigation.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(here, '..', '..');

let database;
let repository;

/**
 * Le schéma qui sert les polices ajoutées.
 *
 * Elles vivent dans `userData/fonts/`, hors du dossier de l'application : la
 * page étant chargée par `loadFile`, elles ne sont pas `'self'`. Ce schéma leur
 * ouvre une porte, et une seule — la CSP ne gagne que `font-src userfont:`,
 * `script-src` et `style-src` ne bougent pas. Une police ajoutée ne peut donc
 * jamais exécuter quoi que ce soit.
 *
 * Déclaré avant `app.whenReady()` : après, Electron refuse d'enregistrer un
 * schéma privilégié.
 */
protocol.registerSchemesAsPrivileged([
  { scheme: 'userfont', privileges: { standard: true, secure: true, supportFetchAPI: false } },
]);

/** Sert `userfont://fonts/<clé>/<fichier>.woff2`, et rien d'autre. */
function serveUserFont(request) {
  const url = new URL(request.url);
  // `resolveUserFontPath` est le seul rempart entre une URL et le disque : il
  // rend `null` dès que la cible sort de la racine ou n'est pas un `.woff2`.
  const file = resolveUserFontPath(path.join(database.root, 'fonts'), url.pathname.replace(/^\//, ''));
  if (!file) return new Response('', { status: 403 });
  return net.fetch(pathToFileURL(file).toString());
}

/**
 * D'où vient le catalogue au démarrage.
 *
 * En développement, d'un dossier de bibliothèque local (`dist/shamela` ou
 * `assets/sample`). Dans une application empaquetée, aucun des deux n'existe :
 * c'est la graine embarquée par `scripts/fetch-seed.mjs` qui l'apporte, et
 * `librarySource` reste nul — donc **aucun livre ne peut venir d'ailleurs que
 * du bucket**, ce qui est le comportement voulu en production.
 */
function resoudreOrigine() {
  try {
    const librarySource = resolveLibrarySource(projectRoot);
    console.log(`[beytelhikma] bibliothèque : ${librarySource}`);
    return { librarySource, seedArchive: null };
  } catch (erreur) {
    const seedArchive = app.isPackaged
      ? path.join(process.resourcesPath, 'catalog.sqlite.zst')
      : path.join(projectRoot, 'assets', 'catalog.sqlite.zst');
    console.log(`[beytelhikma] graine embarquée : ${seedArchive}`);
    if (!fs.existsSync(seedArchive)) throw erreur; // ni source ni graine : le message d'origine
    return { librarySource: null, seedArchive };
  }
}

async function openRepository() {
  const { librarySource, seedArchive } = resoudreOrigine();
  database = new AppDatabase({
    librarySource,
    seedArchive,
    storageRoot: path.join(app.getPath('userData'), 'library'),
  });
  await database.initialize();
  repository = new BookRepository(database, {
    // `app.getVersion()` et non le `package.json` lu à la main : empaquetée,
    // l'application n'a pas de `package.json` à côté d'elle, et la version qui
    // compte est celle qu'electron-builder a inscrite dans l'exécutable.
    appInfo: {
      version: app.getVersion(),
      platform: 'desktop',
      runtime: `Electron ${process.versions.electron} • Chromium ${process.versions.chrome}`,
    },
  });
  const downloads = repository.createDownloadQueue();

  // Réglage optionnel : pointer un autre bucket sans republier le catalogue.
  const settings = await repository.getSettings();
  downloads.setBaseUrl(settings['distribution.base_url'] ?? null);

  downloads.on('change', (jobs) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('downloads:changed', jobs);
    }
  });

  await repository.reconcileLibrary();
}

function registerIpc() {
  const exposed = new Set(REPOSITORY_METHODS);
  ipcMain.handle('repository', async (_event, method, args = []) => {
    if (!exposed.has(method)) throw new Error(`méthode inconnue : ${method}`);
    try {
      return await repository[method](...args);
    } catch (error) {
      // Une `Error` traverse mal l'IPC : on renvoie un message lisible côté UI.
      throw new Error(error?.what ? error.message : String(error?.message ?? error));
    }
  });
}

function createWindow({ capture = false } = {}) {
  const window = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 420,
    minHeight: 560,
    show: !capture,
    backgroundColor: '#fbf9f4',
    title: 'بيت الحكمة',
    icon: path.join(projectRoot, 'src', 'renderer', 'assets', 'brand', 'app-icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(projectRoot, 'src', 'preload', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      // Une fenêtre masquée ou couverte cesse de peindre : le rendu hors écran
      // garantit que `capturePage` renvoie bien l'écran demandé.
      offscreen: capture,
      backgroundThrottling: false,
    },
  });

  const page = path.join(projectRoot, 'src', 'renderer', 'index.html');
  window.loadFile(page);
  const pageUrl = pathToFileURL(page).href;

  // La fenêtre ne quitte jamais sa propre page.
  //
  // Le preload s'attache à **toute** navigation de ce `webContents` : une page
  // distante atteinte par un `location = …` hériterait de
  // `window.beytelhikma.repository` en entier — donc de la lecture et de
  // l'écriture des trois bases. Le routeur ne travaillant que par fragment,
  // aucune navigation légitime ne passe par ici.
  window.webContents.on('will-navigate', (event, url) => {
    if (!navigationPermise(url, pageUrl)) {
      event.preventDefault();
      console.warn(`[beytelhikma] navigation refusée : ${url}`);
    }
  });
  // Une `<webview>` rouvrirait la même porte, par un autre couloir.
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());

  // L'application est hors ligne : rien ne doit s'ouvrir dans une fenêtre
  // Electron, les liens externes partent vers le navigateur du système. Le
  // protocole est comparé, jamais préfixé : `startsWith('http')` acceptait
  // aussi `httpfoo://`, que `openExternal` aurait passé au gestionnaire de
  // protocole du système.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (estLienExterne(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  return window;
}

app.whenReady().then(async () => {
  await openRepository();
  protocol.handle('userfont', serveUserFont);
  registerIpc();
  const window = createWindow({ capture: Boolean(process.env.BEYT_CAPTURE) });

  // Relecture du design : `npm run shot` capture chaque écran puis quitte.
  if (process.env.BEYT_CAPTURE) {
    const { captureRoutes } = await import('./capture.js');
    window.webContents.once('did-finish-load', async () => {
      // La sortie doit être atteinte quoi qu'il arrive : sans ce `finally`, une
      // capture qui échoue laisse Electron pendu indéfiniment et un
      // `npm run shot` en intégration continue se bloque au lieu d'échouer.
      let failed = false;
      try {
        const problems = await captureRoutes(window, {
          outDir: path.join(projectRoot, 'build', 'screenshots'),
        });
        // Les erreurs de console doivent teinter le code de sortie, sinon la
        // campagne « réussit » en rapportant des écrans cassés.
        failed = problems.length > 0;
      } catch (error) {
        console.error('[beytelhikma] capture interrompue :', error);
        failed = true;
      } finally {
        // `app.exit` et non `app.quit` : ce dernier sort toujours par zéro et
        // ignore `process.exitCode`. Il court-circuite `window-all-closed`, donc
        // la base est fermée ici.
        database?.close();
        app.exit(failed ? 1 : 0);
      }
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  database?.close();
  if (process.platform !== 'darwin') app.quit();
});
