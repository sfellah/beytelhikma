/**
 * Ce qui décide comment on parcourt un livre — les listes, et rien d'autre.
 *
 * La page imprimée, une par écran, est le défaut : c'est ce que le corpus
 * décrit, page par page, et c'est ce que citent les notes. Le fil continu
 * enchaîne les pages et ne garde le pied de page que comme séparation.
 *
 * Le choix se fait dans `/settings`, pas dans le panneau du lecteur : on ne le
 * change pas au fil des pages comme on agrandit une lettre. On le pose une
 * fois. Deux écrans le montrent donc, et c'est précisément pourquoi la liste
 * vit ici, seule — c'est de deux copies qu'étaient nées la police orpheline et
 * le thème `sepia` que plus aucune règle ne lisait.
 */
export const READING_MODES = [
  { key: 'page', label: 'reader.mode.page', hint: 'reader.mode.pageHint' },
  { key: 'scroll', label: 'reader.mode.scroll', hint: 'reader.mode.scrollHint' },
];

export const DEFAULT_READING_MODE = 'page';

/**
 * Où se pose le ruban de pagination.
 *
 * `horizontal` est le défaut : une barre en pied d'écran, comme la maquette.
 * `vertical` la dresse contre le bord — le chiffre de page, la jauge et le
 * pourcentage en colonne. Ce n'est pas une place *en plus* : le pied s'en va,
 * la bande le remplace, et c'est la largeur qui paie au lieu de la hauteur.
 * Sur un téléphone tenu à la main, c'est la hauteur qui manque.
 *
 * L'ancrage est **physique**, contre le bord droit, comme celui des panneaux
 * du lecteur : les deux se croiseraient sur le même bord dès que l'interface
 * bascule si l'un des deux suivait le sens d'écriture.
 */
export const PAGER_LAYOUTS = [
  { key: 'horizontal', label: 'reader.pager.horizontal', hint: 'reader.pager.horizontalHint' },
  { key: 'vertical', label: 'reader.pager.vertical', hint: 'reader.pager.verticalHint' },
];

export const DEFAULT_PAGER_LAYOUT = 'horizontal';

/** La valeur relue vaut ce que la liste reconnaît ; sinon, le défaut. */
export function resolveReadingMode(value) {
  return READING_MODES.some((mode) => mode.key === value) ? value : DEFAULT_READING_MODE;
}

export function resolvePagerLayout(value) {
  return PAGER_LAYOUTS.some((layout) => layout.key === value) ? value : DEFAULT_PAGER_LAYOUT;
}
