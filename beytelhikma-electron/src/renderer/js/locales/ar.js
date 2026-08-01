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
  'settings.language.title': 'اللغة',
  'settings.language.hint': 'تُطبَّق على الواجهة فقط — الكتب تبقى بالعربية',
  'settings.language.preview': 'الصفحة {page} من {total}',
};
