/**
 * Les chaînes arabes de l'interface.
 *
 * Objet plat à clés pointées : c'est ce qui rend le test de parité avec `en.js`
 * trivial. Les clés restent en ASCII, elles servent d'identifiant dans le code.
 *
 * Ne portent ici que les chaînes de *coque* : titres d'œuvres, auteurs,
 * catégories et pages viennent du catalogue et restent arabes dans les deux
 * langues.
 */
export default {
  'app.name': 'بيت الحكمة',

  'format.percent': '{value}٪',
  'format.unknownInitial': '؟',
  'format.century': 'القرن {ordinal}',
  'format.ordinal.1': 'الأول',
  'format.ordinal.2': 'الثاني',
  'format.ordinal.3': 'الثالث',
  'format.ordinal.4': 'الرابع',
  'format.ordinal.5': 'الخامس',
  'format.ordinal.6': 'السادس',
  'format.ordinal.7': 'السابع',
  'format.ordinal.8': 'الثامن',
  'format.ordinal.9': 'التاسع',
  'format.ordinal.10': 'العاشر',
  'format.ordinal.11': 'الحادي عشر',
  'format.ordinal.12': 'الثاني عشر',
  'format.ordinal.13': 'الثالث عشر',
  'format.ordinal.14': 'الرابع عشر',
  'format.ordinal.15': 'الخامس عشر',

  'pagination.perPage': 'لكل صفحة',
  'pagination.previous': 'الصفحة السابقة',
  'pagination.next': 'الصفحة التالية',
  'pagination.results': '{total} نتيجة',

  'state.loading': 'جارٍ التحميل…',
  'state.empty': 'لا يوجد محتوى بعد',
  'state.error': 'تعذّر تحميل المحتوى',
  'state.retry': 'إعادة المحاولة',

  'action.cancel': 'إلغاء',
  'action.close': 'إغلاق',
  'action.save': 'حفظ',
  'action.delete': 'حذف',
  'note.placeholder': 'اكتب ملاحظتك…',

  'copy.aria': 'قيمة قابلة للنسخ',
  'copy.action': 'نسخ',
  'copy.done': 'نُسخ إلى الحافظة',
  'copy.failed': 'تعذّر النسخ — النص محدَّد',

  'nav.aria': 'التنقل الرئيسي',
  'nav.home': 'الرئيسية',
  'nav.library': 'مكتبتي',
  'nav.downloads': 'التنزيلات',
  'nav.explore': 'استكشاف',
  'nav.search': 'بحث في النصوص',
  'nav.notes': 'ملاحظاتي',
  'nav.authors': 'المؤلفون',
  'nav.settings': 'الإعدادات',

  'search.aria': 'البحث في المكتبة',
  'search.placeholder': 'البحث عن كتاب، مؤلف، طبعة…',
  'search.inText': 'في النصوص',
  'search.inTextTitle': 'البحث في نصوص الكتب المنزَّلة (Ctrl + Enter)',

  'shell.backHome': 'العودة للرئيسية',

  'settings.language.title': 'اللغة',
  'settings.language.hint': 'تُطبَّق على الواجهة فقط — الكتب تبقى بالعربية',
  'settings.language.preview': 'الصفحة {page} من {total}',
};
