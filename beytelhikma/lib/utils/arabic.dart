/// Normalisation arabe. Reflet **exact** de `normalize_ar` dans
/// `tools/_common.py` et de `normalizeArabic` dans
/// `beytelhikma-electron/src/shared/arabic.js` : c'est ce contrat qui a produit
/// les colonnes normalisées du catalogue (`catalog_fts.title_normalized`,
/// `pages.body_search`). Toute divergence dégrade silencieusement tout ce qui
/// s'y appuie.
///
/// Les plages de harakāt sont celles de `HARAKAT` côté pipeline, obtenues par
/// énumération des points de code : U+0610–U+061A, U+064B–U+065F, U+0670,
/// U+06D6–U+06ED.
library;

final _harakat = RegExp('[ؐ-ًؚ-ٰٟۖ-ۭ]');
final _tatweel = RegExp('ـ');
final _alif = RegExp('[أإآٱ]');
final _spaces = RegExp(r'\s+');

String normalizeArabic(String? text) {
  if (text == null || text.isEmpty) return '';
  return text
      .replaceAll(_harakat, '')
      .replaceAll(_tatweel, '')
      .replaceAll(_alif, 'ا')
      .replaceAll('ى', 'ي')
      .replaceAll('ة', 'ه')
      .replaceAll(_spaces, ' ')
      .trim();
}
