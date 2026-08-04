import { localeDir } from '../../../shared/locale.js';
import { h } from '../dom.js';
import { currentLocale, t } from '../i18n.js';
import { arrowBackward, arrowForward } from '../icons.js';

/**
 * Une bande qui défile à l'horizontale, avec ses deux chevrons.
 *
 * Elle vit ici parce que **deux** sections de l'accueil en veulent une — les
 * nouveautés et les ouvrages de référence — et qu'une seconde copie de la
 * règle de direction serait la faute que le projet a déjà payée deux fois : le
 * thème `sepia` proposé par un écran et lu par aucune règle CSS, la liste de
 * polices déclarée dans deux vues.
 *
 * Ce qu'elle sait, et que l'appelant n'a plus à savoir :
 *
 * - `scrollLeft` est **négatif en RTL** sous Chromium. On raisonne donc en
 *   distance absolue au bord, jamais en signe, pour désactiver les chevrons.
 * - Le *sens de lecture* décide du signe du pas, jamais une constante. Écrit
 *   en dur pour l'arabe, « suivant » ne bougeait pas d'un pixel sous interface
 *   anglaise — un défaut qui coïncide avec la vérité dans la langue où l'on
 *   développe, donc invisible jusqu'à la bascule.
 * - `ResizeObserver` plutôt qu'un écouteur sur `window` : la vue est remplacée
 *   à chaque navigation, l'observateur disparaît avec elle.
 *
 * [items] sont des nœuds — le composant les enveloppe lui-même dans un
 * `role="listitem"`. [tail] est un nœud facultatif ajouté en fin de bande.
 */
export function horizontalScroller({ items, tail = null }) {
  const node = h(
    'div',
    { class: 'scroller no-scrollbar', tabindex: 0, role: 'list' },
    items.map((item) => h('div', { role: 'listitem' }, item)),
    tail,
  );

  const previous = h(
    'button',
    {
      class: 'button--icon',
      type: 'button',
      title: t('home.previous'),
      'aria-label': t('home.previous'),
    },
    arrowBackward({ size: 20 }),
  );
  const next = h(
    'button',
    {
      class: 'button--icon',
      type: 'button',
      title: t('home.next'),
      'aria-label': t('home.next'),
    },
    arrowForward({ size: 20 }),
  );

  const step = () => Math.max(240, node.clientWidth * 0.8);
  const avance = () => (localeDir(currentLocale()) === 'rtl' ? -1 : 1);
  previous.onclick = () => node.scrollBy({ left: -avance() * step(), behavior: 'smooth' });
  next.onclick = () => node.scrollBy({ left: avance() * step(), behavior: 'smooth' });

  const syncEdges = () => {
    const max = node.scrollWidth - node.clientWidth;
    const offset = Math.abs(node.scrollLeft);
    previous.disabled = offset <= 1;
    next.disabled = offset >= max - 1;
    node.classList.toggle('scroller--at-start', previous.disabled);
    node.classList.toggle('scroller--at-end', next.disabled);
  };
  node.addEventListener('scroll', syncEdges, { passive: true });
  requestAnimationFrame(syncEdges);
  new ResizeObserver(syncEdges).observe(node);

  return { node, previous, next };
}
