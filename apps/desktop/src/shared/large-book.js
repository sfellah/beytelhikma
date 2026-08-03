/**
 * Ce qui fait qu'un livre est **gros**, et qu'il faut le dire avant de le
 * faire attendre.
 *
 * Mesuré sur l'appareil, sur `خزانة التراث - فهرس مخطوطات` : 124 569 pages,
 * cent secondes entre la tape et la première ligne. Rien n'était cassé — le
 * sommaire se chargeait, ses ~96 000 entrées traversant le pont natif — mais un
 * écran qui tourne pendant une minute et demie sans un mot se lit comme une
 * panne, et l'on ferme l'application avant qu'elle ait fini.
 *
 * Les deux seuils ne se recouvrent pas : un index de manuscrits fait des
 * dizaines de milliers de pages courtes, une somme en fait mille très longues.
 * L'un ou l'autre suffit.
 *
 * Pur et partagé pour la raison de `turnZone` et de `clampSize` : c'est une
 * règle, elle s'éprouve sans DOM et sans base.
 */

/** Au-delà, le sommaire et la pagination coûtent visiblement. */
export const LARGE_PAGES = 1000;

/** Cent mégaoctets décompressés : le fichier que sql.js et le pont natif chargent en entier. */
export const LARGE_BYTES = 100 * 1024 * 1024;

/**
 * Le livre demande-t-il de la patience ?
 *
 * Une seule des deux mesures suffit, et une mesure absente ne compte pas :
 * `Number(null)` vaut zéro, pas « petit » — c'est le même piège que
 * `clampSize`, et ici il ferait taire l'avertissement sur les livres dont le
 * catalogue ne connaît pas la taille.
 */
export function isLargeBook({ pageCount = null, bytes = null } = {}) {
  return valeur(pageCount) >= LARGE_PAGES || valeur(bytes) >= LARGE_BYTES;
}

function valeur(raw) {
  if (raw === null || raw === undefined || raw === '') return 0;
  const number = Number(raw);
  return Number.isFinite(number) ? number : 0;
}
