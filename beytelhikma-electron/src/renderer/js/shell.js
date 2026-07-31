import { h } from './dom.js';
import { icon } from './icons.js';
import { navigate } from './router.js';

const NAV = [
  { key: 'home', path: '/home', label: 'الرئيسية', icon: 'home' },
  { key: 'library', path: '/library', label: 'مكتبتي', icon: 'bookOpen' },
  { key: 'explore', path: '/explore', label: 'استكشاف', icon: 'compass' },
  { key: 'authors', path: '/authors', label: 'المؤلفون', icon: 'pen' },
];

/**
 * Coquille commune (rail, barre supérieure, barre inférieure). Renvoie le
 * conteneur `<main>` où la vue dépose son contenu. Le lecteur ne l'utilise pas.
 */
export function renderShell(host, { active }) {
  const content = h('main', { class: 'main' });
  host.replaceChildren(
    h(
      'div',
      { class: 'shell' },
      rail(active),
      topbar(),
      content,
      bottomNav(active),
    ),
  );
  return content;
}

function railItem({ key, path, label, icon: name }, active) {
  return h(
    'a',
    {
      class: `rail__item${key === active ? ' is-active' : ''}`,
      href: `#${path}`,
      title: label,
    },
    icon(name, { size: 22 }),
    h('span', {}, label),
  );
}

function rail(active) {
  return h(
    'nav',
    { class: 'rail' },
    h(
      'div',
      { class: 'rail__brand' },
      h('a', { href: '#/home', title: 'بيت الحكمة' }, icon('book', { size: 30 })),
    ),
    h(
      'div',
      { class: 'rail__list' },
      NAV.map((item) => railItem(item, active)),
    ),
    h(
      'div',
      { class: 'rail__footer' },
      railItem(
        { key: 'settings', path: '/settings', label: 'الإعدادات', icon: 'sliders' },
        active,
      ),
      railItem(
        { key: 'logout', path: '/logout', label: 'خروج', icon: 'logout' },
        active,
      ),
    ),
  );
}

function topbar() {
  const field = h('input', {
    type: 'search',
    placeholder: 'البحث عن كتاب، مؤلف، طبعة…',
    onkeydown: (event) => {
      if (event.key !== 'Enter') return;
      toast('البحث غير مفعَّل في هذه النسخة');
    },
  });

  return h(
    'header',
    { class: 'topbar' },
    h(
      'a',
      { class: 'topbar__brand', href: '#/home' },
      icon('book', { size: 28 }),
      h('span', {}, 'بيت الحكمة'),
    ),
    h('div', { class: 'topbar__search' }, icon('search', { size: 20 }), field),
    h(
      'div',
      { class: 'topbar__actions' },
      h(
        'button',
        {
          class: 'topbar__icon-button',
          title: 'التنبيهات',
          onclick: () => toast('لا توجد تنبيهات'),
        },
        icon('bell', { size: 22 }),
        h('span', { class: 'topbar__badge' }),
      ),
      h(
        'div',
        { class: 'topbar__user' },
        h('span', { class: 'label-md' }, 'قارئ ضيف'),
        h('div', { class: 'avatar' }, icon('user', { size: 18 })),
      ),
      h('div', { class: 'avatar topbar__avatar-mobile' }, icon('user', { size: 18 })),
    ),
  );
}

function bottomNav(active) {
  return h(
    'nav',
    { class: 'bottom-nav' },
    NAV.map((item) =>
      h(
        'a',
        {
          class: `bottom-nav__item${item.key === active ? ' is-active' : ''}`,
          href: `#${item.path}`,
        },
        h('span', { class: 'bottom-nav__bubble' }, icon(item.icon, { size: 22 })),
        h('span', {}, item.label),
      ),
    ),
  );
}

/** Message éphémère : les écrans non implémentés le disent au lieu de rien. */
export function toast(message) {
  const existing = document.querySelector('.toast');
  existing?.remove();
  const node = h('div', { class: 'toast label-md' }, message);
  document.body.append(node);
  setTimeout(() => node.remove(), 2600);
}

/** Vue des sections encore hors périmètre (استكشاف، المؤلفون، الإعدادات). */
export function placeholderView(title, message, activeKey) {
  return (host) => {
    const content = renderShell(host, { active: activeKey });
    content.append(
      h(
        'section',
        {},
        h('h1', { class: 'display-lg', style: { color: 'var(--deep-emerald)' } }, title),
        h(
          'p',
          { class: 'body-lg muted', style: { marginTop: 'var(--space-md)' } },
          message,
        ),
        h(
          'button',
          {
            class: 'button button--filled',
            style: { marginTop: 'var(--space-xl)' },
            onclick: () => navigate('/home'),
          },
          'العودة للرئيسية',
        ),
      ),
    );
    return null;
  };
}
