/** Pourcentage entier, affiché avec le signe arabe. */
export function percent(value) {
  return `${Math.round((value ?? 0) * 100)}٪`;
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

export function pageLabel(page) {
  return page?.printedPageNum ?? page?.sequenceNum ?? 0;
}
