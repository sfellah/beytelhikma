/**
 * Où se pose le ruban de pagination — la liste, et rien d'autre.
 *
 * Ce module portait deux listes : celle-ci et celle des façons de parcourir un
 * livre. Le fil vertical a été essayé puis retiré, il ne reste qu'une façon de
 * lire — la page imprimée — et un réglage à une seule valeur est un réglage
 * mort. Le module a donc pris le nom de ce qu'il porte encore : garder
 * l'ancien aurait promis un choix qui n'existe plus.
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
 *
 * Deux écrans le montrent — `/settings` et la barre du lecteur — et c'est
 * précisément pourquoi la liste vit ici, seule : c'est de deux copies qu'étaient
 * nées la police orpheline et le thème `sepia` que plus aucune règle ne lisait.
 */
export const PAGER_LAYOUTS = [
  { key: 'horizontal', label: 'reader.pager.horizontal', hint: 'reader.pager.horizontalHint' },
  { key: 'vertical', label: 'reader.pager.vertical', hint: 'reader.pager.verticalHint' },
];

export const DEFAULT_PAGER_LAYOUT = 'horizontal';

/** La valeur relue vaut ce que la liste reconnaît ; sinon, le défaut. */
export function resolvePagerLayout(value) {
  return PAGER_LAYOUTS.some((layout) => layout.key === value) ? value : DEFAULT_PAGER_LAYOUT;
}
