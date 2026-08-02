import { h } from '../dom.js';

/**
 * En-tête de section partagé par l'accueil et les auteurs : filet au-dessus,
 * titre, sous-titre, actions optionnelles. C'est ce qui rend la césure lisible
 * d'une section à l'autre sans multiplier les décorations.
 */
export function sectionHead(id, title, lede, actions = null) {
  return h(
    'div',
    { class: 'section-header' },
    h(
      'div',
      { class: 'section-header__text' },
      h('h2', { class: 'headline-lg', id }, title),
      lede && h('p', { class: 'body-md' }, lede),
    ),
    actions && h('div', { class: 'section-header__actions' }, actions),
  );
}

/** Bloc de page : le filet et la respiration qui séparent deux sections. */
export function sectionBlock(props, ...children) {
  const { class: extra = '', ...rest } = props ?? {};
  return h('section', { class: `section-block ${extra}`.trim(), ...rest }, children);
}

/**
 * Un seul moment animé par page : chaque bloc marqué monte et se dénette à
 * l'entrée dans le viewport. L'état par défaut reste *visible* — si
 * l'observateur ou l'animation manquent, rien ne disparaît.
 */
export function reveal(root) {
  const blocks = root.querySelectorAll('[data-reveal]');
  if (!blocks.length) return root;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return root;
  if (typeof IntersectionObserver !== 'function') return root;

  for (const block of blocks) block.classList.add('is-pending');

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const index = Number(entry.target.dataset.reveal) || 0;
        entry.target.style.setProperty('--reveal-delay', `${index * 70}ms`);
        entry.target.classList.remove('is-pending');
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.05 },
  );
  for (const block of blocks) observer.observe(block);
  return root;
}
