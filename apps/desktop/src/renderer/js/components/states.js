import { h } from '../dom.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';

/**
 * Les quatre états que chaque vue doit traiter explicitement :
 * `loading / success / empty / error`.
 */
export function loadingView(message = null) {
  const text = message ?? t('state.loading');
  return h(
    'div',
    { class: 'state' },
    h('div', { class: 'spinner' }),
    h('p', { class: 'label-md' }, text),
  );
}

export function emptyView(message = null) {
  const text = message ?? t('state.empty');
  return h(
    'div',
    { class: 'state' },
    icon('bookOpen', { size: 32 }),
    h('p', { class: 'state__title' }, text),
  );
}

export function errorView(error, onRetry) {
  return h(
    'div',
    { class: 'state' },
    icon('close', { size: 30 }),
    h('p', { class: 'state__title' }, t('state.error')),
    h('p', { class: 'label-md muted' }, error?.message ?? String(error)),
    onRetry &&
      h(
        'button',
        { class: 'button button--tonal', onclick: onRetry },
        t('state.retry'),
      ),
  );
}

/**
 * Rend [load] dans [host] en passant par les quatre états. [render] reçoit la
 * donnée chargée et renvoie un nœud ; renvoyer `null` affiche l'état vide.
 */
export async function asyncView(host, load, render, { empty } = {}) {
  host.replaceChildren(loadingView());
  try {
    const data = await load();
    const node = render(data);
    host.replaceChildren(
      node ?? emptyView(empty),
    );
  } catch (error) {
    host.replaceChildren(
      errorView(error, () => asyncView(host, load, render, { empty })),
    );
  }
}
