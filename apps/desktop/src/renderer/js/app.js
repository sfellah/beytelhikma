import { syncAppFont } from './app-font.js';
import { syncUserFonts } from './user-fonts.js';
import { syncLocale } from './i18n.js';
import { defineRoutes, start } from './router.js';
import { placeholderView } from './shell.js';
import { syncTheme } from './theme.js';
import { authorsView } from './views/authors.js';
import { bookDetailView } from './views/book-detail.js';
import { collectionDetailView } from './views/collections.js';
import { curriculaView, curriculumDetailView } from './views/curricula.js';
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
    '/curricula': curriculaView,
    '/curriculum/:id': curriculumDetailView,
    '/explore': exploreView,
    '/search': searchView,
    '/notes': notesView,
    '/authors': authorsView,
    '/settings': settingsView,
  },
  {
    // Des clés, pas des chaînes : `defineRoutes` s'exécute à l'import, donc un
    // texte traduit ici serait figé dans la langue du démarrage.
    fallback: placeholderView('route.notFound.title', 'route.notFound.message', 'home'),
  },
);

// L'écran est déjà peint depuis les miroirs (`js/theme.js` et `js/i18n.js`,
// chargés avant celui-ci). La réconciliation avec `user.sqlite` corrige un
// miroir absent ou périmé, sans retarder le premier rendu.
syncTheme();
syncLocale();
// Les polices ajoutées d'abord : sans leurs règles `@font-face`, `syncAppFont`
// poserait une famille que rien ne déclare et l'interface tomberait sur le
// repli système sans que rien ne le dise.
syncUserFonts().then(syncAppFont);

start(document.getElementById('app'), { initial: '/home' });
