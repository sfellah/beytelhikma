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

/** Ce que la normalisation a fusionné, le motif doit le rouvrir. */
const CLASSES = {
  ا: '[اأإآٱ]',
  ي: '[يى]',
  ه: '[هة]',
};

/** Signes que la normalisation retire : le texte d'origine peut en porter. */
const SKIPPABLE = '[\\u0610-\\u061A\\u064B-\\u065F\\u0670\\u06D6-\\u06EDـ]*';

const escapeRegExp = (char) => char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Motif retrouvant un terme dans du texte **non normalisé**.
 *
 * `pages.body_search` est normalisé, `body_plain` ne l'est pas, et la
 * normalisation change la longueur : une position trouvée dans l'un ne vaut
 * rien dans l'autre. Ce motif s'applique donc au texte d'origine, ce qui donne
 * la position réelle — nécessaire pour extraire un extrait juste et pour
 * surligner au bon endroit.
 */
export function arabicSearchPattern(term, flags = 'g') {
  const normalized = normalizeArabic(term);
  // Un terme vide ne doit rien trouver : `new RegExp('')` filerait partout.
  if (!normalized) return /(?!)/;

  const body = [...normalized]
    .map((char) => {
      if (char === ' ') return '\\s+';
      return CLASSES[char] ?? escapeRegExp(char);
    })
    .join(SKIPPABLE);

  return new RegExp(`${SKIPPABLE}${body}`, flags);
}
