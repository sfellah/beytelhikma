/**
 * Normalisation arabe pour la recherche souple. Reflet **exact** de
 * `normalize_ar` dans `tools/_common.py` : c'est ce contrat qui a produit la
 * colonne `catalog_fts.title_normalized`. Toute divergence dégrade la recherche
 * sans rien casser de visible — d'où la table de parité de `test/arabic.test.js`.
 *
 * Les plages de harakāt sont celles de `HARAKAT`, obtenues par énumération des
 * points de code et non par transcription à vue de la classe de caractères :
 * U+0610–U+061A, U+064B–U+065F, U+0670, U+06D6–U+06ED.
 */
const HARAKAT = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;
const TATWEEL = /ـ/g;
const ALIF = /[أإآٱ]/g;

export function normalizeArabic(text) {
  if (!text) return '';
  return String(text)
    .normalize('NFC')
    .replace(HARAKAT, '')
    .replace(TATWEEL, '')
    .replace(ALIF, 'ا')
    .replaceAll('ى', 'ي')
    .replaceAll('ة', 'ه')
    .replace(/\s+/g, ' ')
    .trim();
}
