// Pont unique entre le rendu et le processus principal. Le rendu n'a ni Node ni
// accès au disque : il ne peut qu'appeler les méthodes du repository.
const { contextBridge, ipcRenderer } = require('electron');

const METHODS = [
  'getCategories',
  'getRecentBooks',
  'getBooks',
  'getBooksByCategory',
  'getBookDetail',
  'getFeaturedAuthor',
  'getBooksByAuthor',
  'getToc',
  'getPageCount',
  'getPages',
  'getPageById',
  'getLibrary',
  'getContinueReading',
  'getProgress',
  'saveProgress',
  'getSettings',
  'saveSetting',
];

const repository = {};
for (const method of METHODS) {
  repository[method] = (...args) =>
    ipcRenderer.invoke('repository', method, args);
}

contextBridge.exposeInMainWorld('beytelhikma', { repository });
