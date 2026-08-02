import { n, t } from './i18n.js';

/**
 * Mises en forme d'affichage. Les nombres passent tous par `n()` de `i18n.js`,
 * qui délègue à `shared/digits.js` : ce module a porté sa propre table de
 * chiffres arabes-indiens, doublon de celle du module partagé. Deux tables qui
 * font la même chose finissent par diverger — et celle-ci convertissait sans
 * regarder la locale, donc une interface anglaise aurait paginé en `٤٢`.
 */

/** Pourcentage entier. Le signe suit la langue : `٪` en arabe, `%` en anglais. */
export function percent(value) {
  return t('format.percent', { value: Math.round((value ?? 0) * 100) });
}

/** Première phrase utile d'une page, pour la citation de l'accueil. */
export function excerpt(text, max = 180) {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max).trimEnd()}…`;
}

/**
 * Initiale servant de portrait quand aucune image n'est fournie. Le nom vient
 * du catalogue, donc toujours arabe : seul le repli quand il manque se traduit.
 */
export function initial(name) {
  return (name ?? t('format.unknownInitial')).trim().charAt(0);
}

/**
 * « القرن الرابع » : en arabe les siècles se nomment, ils ne se numérotent pas.
 * L'anglais fait l'inverse, « 4th century » — et sa règle de suffixe a ses
 * exceptions (`11th`, `12th`, `13th`).
 *
 * Les deux formes vivent donc au catalogue, une clé par rang. Les siècles
 * hijri vont de 1 à 15 : quinze clés closes valent mieux que deux fonctions à
 * tenir d'accord, dont l'une n'aurait servi qu'à une seule langue. Au-delà, le
 * rang se replie sur le nombre nu.
 */
export function ordinal(value) {
  const number = Number(value) || 0;
  const key = `format.ordinal.${number}`;
  const word = t(key);
  return t('format.century', { ordinal: word === key ? n(number) : word });
}

export { n };
