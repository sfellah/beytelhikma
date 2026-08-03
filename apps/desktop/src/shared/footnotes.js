/**
 * Les notes de bas de page : les lire, et retrouver leur appel dans le texte.
 *
 * Le corpus est de l'édition savante — un texte classique et son appareil
 * critique. Les notes étaient déversées en bloc de texte brut au pied de la
 * page, et leurs appels ne renvoyaient à rien : sur un téléphone, où une page
 * fait trois à six écrans, on perdait sa ligne en descendant lire la note, et
 * on la reperdait en remontant. Apple Books et Kindle ouvrent la note **sur
 * place** ; c'est le geste que ce module rend possible.
 *
 * ## Ce que le corpus donne réellement
 *
 * Deux formes, et il faut les deux :
 *
 * - le jeu d'exemple porte un appel balisé, `<sup class="fn">1</sup>` ;
 * - le corpus Shamela, **non**. `tools/shamela/text.py` ne garde que `br`,
 *   `hr`, les images et les titres : toute autre balise est retirée, son texte
 *   conservé. L'appel y est donc du texte nu — « (١) » ou « (1) » — au milieu
 *   du paragraphe.
 *
 * Un module qui n'aurait connu que la première forme aurait marché sur les
 * cinq livres d'exemple et sur rien d'autre. C'est exactement le genre de
 * fonctionnalité qui se découvre morte chez l'utilisateur.
 *
 * ## Ce qui empêche les faux appels
 *
 * « (3) » dans un texte n'est pas forcément un appel de note : c'est parfois un
 * numéro de verset, une date, une énumération. La règle est donc la plus stricte
 * possible : **on ne marque un nombre que si la page porte une note qui lui
 * répond**. Sans note en pied, aucun appel — et le texte n'est jamais touché.
 *
 * Pur et partagé pour la raison de `turnZone` et de `pinchSize` : l'éprouver
 * dans le lecteur demanderait un DOM et une page de livre.
 */

/** `U+0660`–`U+0669`, dans l'ordre — le pendant de `toArabicDigits`. */
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/**
 * Les chiffres arabes-indiens ramenés à leur valeur.
 *
 * Le corpus mêle les deux formes, parfois dans la même page : la note peut être
 * numérotée « (1) » et son appel écrit « (١) ». Comparer les caractères ferait
 * manquer une note sur deux.
 */
export function toLatinDigits(text) {
  return String(text ?? '').replace(/[٠-٩]/g, (digit) => String(ARABIC_DIGITS.indexOf(digit)));
}

/**
 * Découpe le bloc de notes en notes numérotées.
 *
 * Une ligne ouvre une note quand elle commence par son numéro — « (1) », « ١) »,
 * « [1] ». Les suivantes lui appartiennent : une note longue se replie sur
 * plusieurs lignes, et les couper en deux notes en montrerait la moitié.
 *
 * Ce qui précède la première note numérotée est gardé sans numéro : c'est du
 * texte de pied de page qu'on ne peut pas appeler, mais qu'on ne peut pas
 * perdre non plus.
 */
export function parseFootnotes(raw) {
  const notes = [];
  if (!raw || typeof raw !== 'string') return notes;

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const opening = /^[([]?\s*([0-9٠-٩]{1,3})\s*[)\]]\s*(.*)$/.exec(trimmed);
    if (opening) {
      notes.push({ number: Number(toLatinDigits(opening[1])), text: opening[2].trim() });
      continue;
    }
    const last = notes.at(-1);
    if (last) last.text = `${last.text} ${trimmed}`.trim();
    else notes.push({ number: null, text: trimmed });
  }
  return notes;
}

/** Les notes appelables d'une page, par numéro. */
export function footnotesByNumber(raw) {
  const map = new Map();
  for (const note of parseFootnotes(raw)) {
    // La première gagne : un corpus qui répète un numéro sur la même page a une
    // note de trop, pas une note qui en remplace une autre.
    if (note.number !== null && note.text && !map.has(note.number)) map.set(note.number, note.text);
  }
  return map;
}

/**
 * Le motif qui trouve les appels dans le texte rendu.
 *
 * Parenthèses ou crochets, chiffres des deux écritures, et **rien d'autre** :
 * un nombre nu au fil du texte est un nombre, pas un appel. `null` quand la
 * page n'a aucune note — il n'y a alors rien à chercher.
 */
export function markerPattern(numbers) {
  if (!numbers?.size) return null;
  return /[([]\s*([0-9٠-٩]{1,3})\s*[)\]]/g;
}
