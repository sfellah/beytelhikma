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
