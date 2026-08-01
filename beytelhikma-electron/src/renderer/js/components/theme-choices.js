import { h } from '../dom.js';
import { currentTheme, setTheme, THEMES } from '../theme.js';

/**
 * Les trois pastilles de thème. Le lecteur et les réglages montrent le même
 * contrôle : c'est d'avoir eu deux rendus qu'était née la liste périmée des
 * réglages, qui proposait encore un `sepia` qu'aucune règle CSS ne lisait.
 *
 * `onPick` sert à qui doit réagir au-delà du thème lui-même — le lecteur y
 * garde ses propres boutons en accord quand le choix vient des réglages.
 */
export function themeChoices({ onPick } = {}) {
  const buttons = THEMES.map((theme) =>
    h(
      'button',
      {
        class: theme.key === currentTheme() ? 'is-active' : '',
        title: theme.label,
        'aria-label': theme.label,
        style: { background: theme.swatch },
        onclick: () => {
          setTheme(theme.key);
          buttons.forEach((button, index) =>
            button.classList.toggle('is-active', THEMES[index].key === theme.key),
          );
          onPick?.(theme.key);
        },
      },
      h('span', { style: { background: theme.dot } }),
    ),
  );

  return { node: h('div', { class: 'theme-choices' }, buttons), buttons };
}
