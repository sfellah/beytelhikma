import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain, shell } from 'electron';

import { AppDatabase } from './app-database.js';
import { BookRepository, REPOSITORY_METHODS } from './book-repository.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(here, '..', '..');

let database;
let repository;

async function openRepository() {
  database = new AppDatabase({
    assetsDir: path.join(projectRoot, 'assets'),
    storageRoot: path.join(app.getPath('userData'), 'library'),
  });
  await database.initialize();
  repository = new BookRepository(database);
  await repository.warmUp();
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
      await captureRoutes(window, {
        outDir: path.join(projectRoot, 'build', 'screenshots'),
      });
      app.quit();
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
