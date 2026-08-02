/**
 * La forme des chiffres, seule.
 *
 * Il n'existe pas de réglage de chiffres : ils suivent la locale de
 * l'interface. Les chiffres arabes-indiens sont une propriété de la langue
 * arabe, pas un goût séparé — un lecteur anglophone n'a aucune raison de
 * vouloir `٤٢`, et un réglage distinct aurait produit quatre combinaisons dont
 * deux n'ont aucun sens.
 *
 * La conversion s'applique **au rendu**. Aucune valeur arabe-indienne n'entre
 * dans `user.sqlite`, ne part vers le bucket, ni ne sert de clé.
 */
import { localeDigits } from './locale.js';

/** `U+0660`–`U+0669`, dans l'ordre. */
const ARABIC = '٠١٢٣٤٥٦٧٨٩';

/** Convertit les chiffres latins d'un texte, et ne touche à rien d'autre. */
export function toArabicDigits(text) {
  return String(text).replace(/[0-9]/g, (digit) => ARABIC[Number(digit)]);
}

/**
 * Pas d'`Intl.NumberFormat` : son `ar` pose aussi un séparateur de milliers
 * (`٬`) et un signe décimal (`٫`) que rien dans l'interface n'attend, et son
 * comportement suit la version d'ICU embarquée dans Electron. Une table de dix
 * caractères est prévisible, et testable sans dépendre du moteur.
 */
export function formatNumber(value, locale) {
  const plain = String(value);
  return localeDigits(locale) === 'arab' ? toArabicDigits(plain) : plain;
}
