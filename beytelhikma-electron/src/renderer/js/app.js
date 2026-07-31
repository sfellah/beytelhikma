import { defineRoutes, start } from './router.js';
import { placeholderView } from './shell.js';
import { authorsView } from './views/authors.js';
import { bookDetailView } from './views/book-detail.js';
import { downloadsView } from './views/downloads.js';
import { homeView } from './views/home.js';
import { collectionView, libraryView } from './views/library.js';
import { readerView } from './views/reader.js';

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
    // Hors périmètre v1 : la recherche.
    '/explore': placeholderView(
      'استكشاف',
      'الاستكشاف والبحث خارج نطاق هذه النسخة: الفهرس النصي جاهز في قواعد البيانات لكنه غير معروض بعد.',
      'explore',
    ),
    '/authors': authorsView,
    '/settings': placeholderView(
      'الإعدادات',
      'إعدادات القراءة متاحة داخل القارئ نفسه (حجم الخط، المظهر، نوع الخط).',
      'settings',
    ),
  },
  {
    fallback: placeholderView('الصفحة غير موجودة', 'تعذّر العثور على هذه الصفحة.', 'home'),
  },
);

start(document.getElementById('app'), { initial: '/home' });
