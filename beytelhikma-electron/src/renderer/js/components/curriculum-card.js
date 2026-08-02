import { coverStyle } from '../../../shared/book-cover.js';
import { h } from '../dom.js';
import { t } from '../i18n.js';
import { navigate } from '../router.js';

/**
 * La carte d'un cursus — son rayon, son nom, son avancement.
 *
 * Elle vit ici et non dans `views/curricula.js` parce que deux écrans la
 * montrent : l'accueil en propose quelques-uns, la liste les montre tous. Une
 * seconde copie aurait divergé, comme la police orpheline et le thème `sepia`
 * avant elle.
 */

/** Un cursus se nomme par sa clé : les libellés vivent dans les catalogues. */
const label = (id, part) => t(`curriculum.${id}.${part}`);

export function curriculumCard(curriculum) {
  return h(
    'article',
    {
      class: 'curriculum-card',
      onclick: () => navigate(`/curriculum/${curriculum.id}`),
    },
    shelf(curriculum),
    h(
      'div',
      { class: 'curriculum-card__text' },
      h('h3', { class: 'title-md' }, label(curriculum.id, 'name')),
      h('p', { class: 'body-md muted clamp-1' }, label(curriculum.id, 'hint')),
      progressLine(curriculum),
    ),
  );
}

/* --------------------------------------------------------------- le rayon */

/**
 * Épaisseur et hauteur d'une tranche, en pixels. Un cursus mêle des métons de
 * trente pages et des sommes de huit mille : sans plancher ni plafond, le
 * premier serait un trait invisible et le second mangerait le rayon.
 */
const SPINE_MIN_WIDTH = 8;
const SPINE_MAX_WIDTH = 24;
/* La hauteur varie peu : des livres rangés ont des formats voisins. Une
   amplitude large redonnait un histogramme, où l'épaisseur ne se voyait plus. */
const SPINE_MIN_HEIGHT = 82;
const SPINE_MAX_HEIGHT = 106;
/** Largeur à partir de laquelle une tranche peut porter un fleuron. */
const SPINE_ORNATE_WIDTH = 15;
/** Au-delà, l'échelle est plate : c'est « une somme », le chiffre exact ne se voit plus. */
const SPINE_FULL_PAGES = 2000;

/** Racine, pas rapport brut : sinon un méton de 30 pages tombe sous son plancher. */
const spineScale = (pages) =>
  Math.sqrt(Math.min(Number(pages) || 0, SPINE_FULL_PAGES) / SPINE_FULL_PAGES);

const between = (min, max, ratio) => Math.round(min + (max - min) * ratio);

/**
 * Les livres du cursus rangés debout, dans l'ordre, comme sur une étagère —
 * l'épaisseur dit le volume, la teinte vient de la discipline, la dorure du
 * siècle. Ce sont les trois canaux de `shared/book-cover.js`, vus par la
 * tranche : un cursus se reconnaît à sa silhouette avant de se lire.
 */
function shelf(curriculum) {
  return h(
    'div',
    { class: 'shelf' },
    h(
      'div',
      { class: 'shelf__books' },
      curriculum.steps.map(({ book, percent }) => {
        const style = coverStyle(book);
        const ratio = spineScale(book.pageCount);
        const width = between(SPINE_MIN_WIDTH, SPINE_MAX_WIDTH, ratio);
        return h('span', {
          class: [
            'shelf__spine',
            // Le fleuron ne se pose que sur une tranche assez large pour le
            // porter : sous quinze pixels il devient une tache.
            width >= SPINE_ORNATE_WIDTH ? 'shelf__spine--ornate' : null,
            percent >= 1 ? 'is-done' : null,
          ]
            .filter(Boolean)
            .join(' '),
          title: book.title,
          style: {
            width: `${width}px`,
            height: `${between(SPINE_MIN_HEIGHT, SPINE_MAX_HEIGHT, ratio)}px`,
            '--cover-from': style.from,
            '--cover-to': style.to,
            '--cover-gilt': `rgb(217 184 113 / ${(style.gilt * 100).toFixed(1)}%)`,
          },
        });
      }),
    ),
  );
}

/**
 * L'avancement porte sur les étapes **retenues**, et `missing` dit à part
 * combien le catalogue installé ne connaît pas : un cursus amputé qui
 * afficherait « 4 sur 4 » se donnerait pour fini alors qu'il manque deux
 * livres.
 */
function progressLine(curriculum) {
  return h(
    'div',
    { class: 'curriculum-card__progress' },
    h(
      'div',
      { class: 'progress' },
      h('span', { style: { width: `${Math.round(curriculum.percent * 100)}%` } }),
    ),
    h(
      'p',
      { class: 'label-sm muted' },
      t('curricula.progress', { done: curriculum.done, total: curriculum.resolved }),
      curriculum.missing > 0 &&
        h(
          'span',
          { class: 'curriculum-card__missing' },
          t('curricula.missing', { count: curriculum.missing }),
        ),
    ),
  );
}
