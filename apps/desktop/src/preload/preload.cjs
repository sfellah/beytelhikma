// Pont unique entre le rendu et le processus principal. Le rendu n'a ni Node ni
// accès au disque : il ne peut qu'appeler les méthodes du repository.
const { contextBridge, ipcRenderer } = require('electron');

const METHODS = [
  'installFont',
  'listFonts',
  'removeFont',
  'getCategories',
  'getTopCategories',
  'getRecentBooks',
  'getBooks',
  'getBooksByCategory',
  'getBookDetail',
  'getRelatedBooks',
  'getFeaturedAuthor',
  'getAuthors',
  'getAuthorStats',
  'getBooksIn',
  'getEras',
  'getUndatedCount',
  'getBooksByCentury',
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
  'downloadBook',
  'cancelDownload',
  'retryDownload',
  'deleteBook',
  'getDownloads',
  'clearFailedDownloads',
  'getStorageUsage',
  'exploreBooks',
  'getFacets',
  'suggestValues',
  'getSelectionWeight',
  'downloadSelection',
  'searchInBook',
  'getCollections',
  'createCollection',
  'renameCollection',
  'deleteCollection',
  'addToCollection',
  'removeFromCollection',
  'getCollectionBooks',
  'getCurricula',
  'getCurriculum',
  'deleteAllBooks',
  'setDownloadBaseUrl',
  'checkCatalogUpdate',
  'installCatalogUpdate',
  'declineCatalogUpdate',
  'getAbout',
  'getBookAnnotations',
  'getAnnotations',
  'saveHighlight',
  'deleteHighlight',
  'saveNote',
  'deleteNote',
  'toggleBookmark',
  'deleteBookmark',
  'searchLibrary',
  'getManagedBooks',
  'deleteBooks',
];

const repository = {};
for (const method of METHODS) {
  repository[method] = (...args) =>
    ipcRenderer.invoke('repository', method, args);
}

/** Abonnement au canal poussé ; renvoie la fonction de désabonnement. */
function onDownloadsChanged(callback) {
  const listener = (_event, jobs) => callback(jobs);
  ipcRenderer.on('downloads:changed', listener);
  return () => ipcRenderer.off('downloads:changed', listener);
}

contextBridge.exposeInMainWorld('beytelhikma', { repository, onDownloadsChanged });
