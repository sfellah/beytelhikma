/**
 * Où l'on en était **dans** une page.
 *
 * La progression retient la page ; elle ne retient pas l'endroit. Sur un
 * téléphone, une page du corpus Shamela fait couramment trois à six écrans :
 * rouvrir un livre renvoyait donc en haut de la page, jamais à la ligne qu'on
 * lisait. Kindle, Play Books, Kobo et Apple Books restaurent tous la position
 * exacte — c'est le premier geste d'un lecteur qu'on interrompt.
 *
 * Un **rapport**, jamais un pixel : la taille de la lettre se règle, et la
 * hauteur de la page avec elle. Un pixel enregistré à 34 px pointerait sur un
 * autre paragraphe une fois la lettre ramenée à 16.
 *
 * ## Pourquoi ici, et sous cette forme
 *
 * Pur et partagé, pour la raison de `turnZone` et de `pinchSize` : l'éprouver
 * dans le lecteur demanderait un DOM, une hauteur et un doigt. Rangé dans les
 * **réglages** et non dans le schéma : `settings()` et `setSetting` traversent
 * déjà le pont des deux côtés, quand une colonne de plus dans `reading_progress`
 * ferait passer `user.sqlite` en version 4 — un numéro écrit en dur dans les
 * deux clients, qu'un appareil resté en arrière lirait de travers.
 */

/**
 * Combien de livres gardent leur ancre. Au-delà, les plus anciennement touchés
 * tombent : c'est une commodité de reprise, pas un journal, et le réglage part
 * dans une seule ligne de `user.sqlite`.
 */
export const MAX_ANCHORS = 50;

/** Le nom du réglage. Cité ici et dans le lecteur, nulle part ailleurs. */
export const ANCHORS_SETTING = 'reader.anchors';

/**
 * Relit le réglage. Tout ce qui n'est pas une carte lisible rend une carte
 * vide : une ancre illisible ne vaut pas un écran d'erreur, elle vaut d'ouvrir
 * le livre en haut de sa page.
 */
export function readAnchors(raw) {
  if (!raw || typeof raw !== 'string') return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

  const anchors = {};
  for (const [editionId, value] of Object.entries(parsed)) {
    const anchor = cleanAnchor(value);
    if (anchor) anchors[editionId] = anchor;
  }
  return anchors;
}

/** L'ancre d'un livre, ou `null`. */
export function anchorFor(anchors, editionId) {
  return cleanAnchor(anchors?.[editionId]);
}

/**
 * Pose l'ancre d'un livre et rend la **nouvelle** carte — l'ancienne n'est
 * jamais modifiée, pour que l'appelant puisse comparer.
 *
 * Le livre touché repart en queue : les clés d'un objet gardent leur ordre
 * d'insertion, c'est donc lui qui dit ce qui est récent, et c'est par la tête
 * qu'on taille. Réécrire une clé en place la laisserait à son ancien rang, et
 * le livre qu'on lit tous les jours finirait par tomber avant celui qu'on a
 * ouvert une fois.
 */
export function rememberAnchor(anchors, editionId, anchor) {
  const clean = cleanAnchor(anchor);
  if (!editionId || !clean) return anchors ?? {};

  const next = {};
  for (const [key, value] of Object.entries(anchors ?? {})) {
    if (key !== editionId) next[key] = value;
  }
  next[editionId] = clean;

  const keys = Object.keys(next);
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_ANCHORS))) {
    delete next[key];
  }
  return next;
}

/**
 * Ce qui part dans le réglage.
 *
 * Pas de fonction pour oublier un livre : une ancre survit à la suppression du
 * fichier, et c'est sans conséquence — elle n'est rendue qu'à la page dont elle
 * porte l'identifiant, et la carte se taille toute seule à cinquante entrées.
 * Une fonction qu'aucun appelant n'a est une fonction qui dérive.
 */
export function serializeAnchors(anchors) {
  return JSON.stringify(anchors ?? {});
}

/**
 * Une ancre valable, ou `null`. Le rapport est borné à [0, 1] : une hauteur
 * mesurée pendant une recomposition peut rendre n'importe quoi, et une valeur
 * hors bornes ferait sauter la page à un bout au lieu de reprendre la lecture.
 */
function cleanAnchor(value) {
  if (!value || typeof value !== 'object') return null;
  // `Number(null)` et `Number('')` valent **zéro**, pas `NaN` — le même piège
  // que `clampSize` documente. Sans ce refus, une ancre sans page en désignerait
  // une : la page zéro, qui n'existe pas, et l'ancre survivrait à toute page.
  const pageId = numberOrNull(value.pageId);
  const ratio = numberOrNull(value.ratio);
  if (pageId === null || ratio === null) return null;
  return { pageId, ratio: Math.min(1, Math.max(0, ratio)) };
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
