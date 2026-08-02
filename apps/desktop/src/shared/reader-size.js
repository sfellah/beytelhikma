/**
 * La taille de la lettre du livre : ses bornes, son défaut, et la règle du
 * pincement.
 *
 * Les bornes vivaient **en double** — `views/reader.js` et `views/settings.js`
 * en déclaraient chacune sa copie, avec la valeur de départ écrite en clair à
 * trois endroits. C'est exactement la configuration qui avait produit la police
 * orpheline et le thème `sepia` mort : deux écrans montrent la même glissière,
 * et rien n'obligeait les deux extrémités à concorder.
 */
export const MIN_FONT = 16;
export const MAX_FONT = 34;
export const DEFAULT_FONT_SIZE = 22;

/**
 * La taille relue vaut ce que les bornes acceptent. Une valeur illisible rend
 * le **défaut** et non la borne basse : un réglage absent n'est pas un lecteur
 * qui a demandé la plus petite lettre.
 */
export function clampSize(value) {
  // `Number(null)` et `Number('')` valent **zéro**, pas `NaN` : sans ce refus,
  // un réglage absent se replierait sur la borne basse — la plus petite lettre
  // pour qui n'a jamais rien demandé.
  if (value === null || value === undefined || value === '') return DEFAULT_FONT_SIZE;
  const size = Math.round(Number(value));
  if (!Number.isFinite(size)) return DEFAULT_FONT_SIZE;
  return Math.min(MAX_FONT, Math.max(MIN_FONT, size));
}

/**
 * Écartement minimal, en pixels, pour qu'un pincement compte. Deux doigts posés
 * l'un sur l'autre donneraient un rapport qui explose au premier pixel.
 */
export const PINCH_MIN_SPREAD = 24;

/**
 * La taille que produit un pincement : celle qu'on avait au moment où les deux
 * doigts se sont posés, multipliée par le rapport des écartements.
 *
 * Un **rapport**, jamais une différence de pixels : le geste doit valoir la
 * même chose sur un téléphone et sur une tablette, et c'est l'écart relatif que
 * la main perçoit. Pure et ici pour la même raison que `turnZone` : la vérifier
 * dans le lecteur demanderait un DOM et deux doigts.
 */
export function pinchSize(base, ratio) {
  if (!Number.isFinite(ratio) || ratio <= 0) return clampSize(base);
  return clampSize(Number(base) * ratio);
}
