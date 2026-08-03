/**
 * Les deux façons de lire.
 *
 * - `page` — la feuille imprimée : une page par écran, on tourne au clic, au
 *   clavier ou au doigt. C'est le mode qui colle au corpus, qui est paginé de
 *   bout en bout : le pied imprimé, la fraction du ruban, l'ancrage des notes
 *   et le `?page=` en dépendent tous.
 * - `scroll` — le fil : les pages s'enchaînent dans une seule colonne et l'on
 *   passe de l'une à l'autre en défilant, comme dans une application de
 *   lecture longue.
 *
 * ## Ce que le fil monte réellement
 *
 * Une **fenêtre glissante**, jamais le livre entier. Les plus gros livres du
 * corpus passent le millier de pages, et les deux clients chargent une base de
 * livre entièrement en mémoire (sql.js d'un côté, le pont natif de l'autre) :
 * monter tout le HTML d'un coup, c'est la version qui avait été mesurée puis
 * abandonnée. Le lecteur voit un fil continu, la mémoire reste bornée.
 *
 * ## Ce que le mode ne décide pas
 *
 * La place du ruban. Il reste **en bas dans les deux modes**, avec ses deux
 * chevrons, sa fraction et sa jauge. Un réglage l'a dressé contre le bord un
 * temps ; il portait les mots « أفقي / عمودي » à une ligne de ceux-ci, et l'on
 * croyait choisir sa façon de lire en déplaçant la barre. Il a disparu.
 *
 * Pur et partagé pour la raison de `turnZone` et de `clampSize` : deux écrans
 * montrent cette liste — le lecteur et `/settings` — et c'est exactement la
 * configuration qui avait produit la police orpheline et l'ambiance morte.
 */

/**
 * Les deux clés restent `page` et `scroll` — c'est ce qu'elles font. Les
 * **libellés**, eux, disent horizontal et vertical : c'est ainsi qu'on décrit
 * ces deux lectures quand on les demande, et l'axe est ce qu'on voit bouger.
 */
export const READING_MODES = [
  { key: 'page', label: 'reader.mode.page', hint: 'reader.mode.pageHint' },
  { key: 'scroll', label: 'reader.mode.scroll', hint: 'reader.mode.scrollHint' },
];

/**
 * Le fil est le défaut.
 *
 * Le corpus est paginé et le restera — le pied imprimé, la fraction du ruban,
 * l'ancrage des notes en dépendent — mais ce n'est pas une raison pour imposer
 * le geste de la feuille à qui ouvre un livre pour la première fois. On défile
 * partout ailleurs ; c'est ce que la main fait sans qu'on le lui apprenne.
 */
export const DEFAULT_READING_MODE = 'scroll';

/** La valeur relue vaut ce que la liste reconnaît ; sinon, le défaut. */
export function resolveReadingMode(value) {
  return READING_MODES.some((mode) => mode.key === value) ? value : DEFAULT_READING_MODE;
}

/**
 * La fenêtre du fil, en pages : ce qu'on monte avant et après celle qu'on lit,
 * et la distance au-delà de laquelle on démonte.
 *
 * Plus après qu'avant : on lit vers l'avant, et c'est de ce côté qu'un blanc
 * se verrait. `KEEP` est plus large que la fenêtre pour qu'un va-et-vient court
 * ne remonte pas sans cesse les mêmes pages.
 */
export const WINDOW_BEFORE = 2;
export const WINDOW_AFTER = 4;
export const WINDOW_KEEP = 8;

/**
 * Les rangs à monter autour de [center], bornés au livre.
 *
 * Pure, donc éprouvable sans DOM : c'est la seule façon de vérifier qu'aux deux
 * bouts du livre la fenêtre se replie au lieu de demander des pages absentes.
 */
export function windowAround(center, total) {
  if (!Number.isFinite(center) || !Number.isFinite(total) || total <= 0) return [];
  const first = Math.max(0, Math.min(center - WINDOW_BEFORE, total - 1));
  const last = Math.min(total - 1, Math.max(center + WINDOW_AFTER, 0));
  const indexes = [];
  for (let at = first; at <= last; at += 1) indexes.push(at);
  return indexes;
}

/** Un rang trop loin de [center] pour rester monté. */
export function outOfWindow(index, center) {
  return Math.abs(index - center) > WINDOW_KEEP;
}
