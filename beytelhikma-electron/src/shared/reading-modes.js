/**
 * Les deux façons de parcourir un livre — la liste, et rien d'autre.
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
  { key: 'page', label: 'reader.mode.page', hint: 'reader.mode.pageHint', icon: 'book' },
  { key: 'scroll', label: 'reader.mode.scroll', hint: 'reader.mode.scrollHint', icon: 'rows' },
];

export const DEFAULT_READING_MODE = 'page';

/** La valeur relue vaut ce que la liste reconnaît ; sinon, le défaut. */
export function resolveReadingMode(value) {
  return READING_MODES.some((mode) => mode.key === value) ? value : DEFAULT_READING_MODE;
}
