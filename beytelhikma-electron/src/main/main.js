import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain, shell } from 'electron';

import { AppDatabase, resolveLibrarySource } from './app-database.js';
import { BookRepository, REPOSITORY_METHODS } from './book-repository.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(here, '..', '..');

let database;
let repository;

async function openRepository() {
  const librarySource = resolveLibrarySource(projectRoot);
  console.log(`[beytelhikma] bibliothèque : ${librarySource}`);
  database = new AppDatabase({
    librarySource,
    storageRoot: path.join(app.getPath('userData'), 'library'),
  });
  await database.initialize();
  repository = new BookRepository(database);
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

  window.loadFile(path.join(projectRoot, 'src', 'renderer', 'index.html'));

  // L'application est hors ligne : rien ne doit s'ouvrir dans une fenêtre
  // Electron, les liens externes partent vers le navigateur du système.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });
  return window;
}

app.whenReady().then(async () => {
  await openRepository();
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
