import { syncLocale } from './i18n.js';
import { defineRoutes, start } from './router.js';
import { placeholderView } from './shell.js';
import { syncTheme } from './theme.js';
import { authorsView } from './views/authors.js';
import { bookDetailView } from './views/book-detail.js';
import { collectionDetailView } from './views/collections.js';
import { downloadsView } from './views/downloads.js';
import { exploreView } from './views/explore.js';
import { homeView } from './views/home.js';
import { collectionView, libraryView } from './views/library.js';
import { notesView } from './views/notes.js';
import { readerView } from './views/reader.js';
import { searchView } from './views/search.js';
import { settingsView } from './views/settings.js';

defineRoutes(
  {
    '/home': homeView,
    '/library': libraryView,
    '/downloads': downloadsView,
    '/book/:id': bookDetailView,
    '/reader/:id': readerView,
    '/category/:id': collectionView('category'),
    '/author/:id': collectionView('author'),
    '/era/:id': collectionView('era'),
    '/undated': collectionView('undated'),
    '/collection/:id': collectionDetailView,
    '/explore': exploreView,
    '/search': searchView,
    '/notes': notesView,
    '/authors': authorsView,
    '/settings': settingsView,
  },
  {
    fallback: placeholderView('الصفحة غير موجودة', 'تعذّر العثور على هذه الصفحة.', 'home'),
  },
);

// L'écran est déjà peint depuis les miroirs (`js/theme.js` et `js/i18n.js`,
// chargés avant celui-ci). La réconciliation avec `user.sqlite` corrige un
// miroir absent ou périmé, sans retarder le premier rendu.
syncTheme();
syncLocale();

start(document.getElementById('app'), { initial: '/home' });
