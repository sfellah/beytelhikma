/** Pourcentage entier, affiché avec le signe arabe. */
export function percent(value) {
  return `${Math.round((value ?? 0) * 100)}٪`;
}

const ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

/** Chiffres indo-arabes : le lecteur pagine comme un livre imprimé. */
export function arabicNumber(value) {
  return String(value ?? '').replace(/\d/g, (digit) => ARABIC_DIGITS[Number(digit)]);
}

/** Première phrase utile d'une page, pour la citation de l'accueil. */
export function excerpt(text, max = 180) {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max).trimEnd()}…`;
}

/** Initiale servant de portrait quand aucune image n'est fournie. */
export function initial(name) {
  return (name ?? '؟').trim().charAt(0);
}

const ORDINALS = [
  'الأول',
  'الثاني',
  'الثالث',
  'الرابع',
  'الخامس',
  'السادس',
  'السابع',
  'الثامن',
  'التاسع',
  'العاشر',
  'الحادي عشر',
  'الثاني عشر',
  'الثالث عشر',
  'الرابع عشر',
  'الخامس عشر',
];

/** « القرن الرابع » : les siècles se nomment, ils ne se numérotent pas. */
export function ordinal(value) {
  const name = ORDINALS[Number(value) - 1];
  return name ? `القرن ${name}` : `القرن ${value}`;
}

export function pageLabel(page) {
  return page?.printedPageNum ?? page?.sequenceNum ?? 0;
}
