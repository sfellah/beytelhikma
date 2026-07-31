import { defineRoutes, start } from './router.js';
import { placeholderView } from './shell.js';
import { bookDetailView } from './views/book-detail.js';
import { homeView } from './views/home.js';
import { collectionView, libraryView } from './views/library.js';
import { readerView } from './views/reader.js';

defineRoutes(
  {
    '/home': homeView,
    '/library': libraryView,
    '/book/:id': bookDetailView,
    '/reader/:id': readerView,
    '/category/:id': collectionView('category'),
    '/author/:id': collectionView('author'),
    // Hors périmètre v1 : la recherche et le gestionnaire de téléchargement.
    '/explore': placeholderView(
      'استكشاف',
      'الاستكشاف والبحث خارج نطاق هذه النسخة: الفهرس النصي جاهز في قواعد البيانات لكنه غير معروض بعد.',
      'explore',
    ),
    '/authors': placeholderView(
      'المؤلفون',
      'صفحة المؤلفين قيد الإنجاز. يمكنك الوصول إلى أعمال كل مؤلف من صفحة الكتاب.',
      'authors',
    ),
    '/settings': placeholderView(
      'الإعدادات',
      'إعدادات القراءة متاحة داخل القارئ نفسه (حجم الخط، المظهر، نوع الخط).',
      'settings',
    ),
    '/logout': placeholderView(
      'الحساب',
      'التطبيق يعمل محليًا بالكامل: لا حساب ولا اتصال بالشبكة.',
      'logout',
    ),
  },
  {
    fallback: placeholderView('الصفحة غير موجودة', 'تعذّر العثور على هذه الصفحة.', 'home'),
  },
);

start(document.getElementById('app'), { initial: '/home' });
