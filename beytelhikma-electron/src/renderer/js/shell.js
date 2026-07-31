import { h } from './dom.js';
import { icon } from './icons.js';
import { onDownloadsChanged, repository } from './repository.js';
import { navigate } from './router.js';

const NAV = [
  { key: 'home', path: '/home', label: 'الرئيسية', icon: 'home' },
  { key: 'library', path: '/library', label: 'مكتبتي', icon: 'bookOpen' },
  { key: 'downloads', path: '/downloads', label: 'التنزيلات', icon: 'download' },
  { key: 'explore', path: '/explore', label: 'استكشاف', icon: 'compass' },
  { key: 'authors', path: '/authors', label: 'المؤلفون', icon: 'pen' },
];

/**
 * Nombre de travaux dans la file, tenu à jour pour la pastille de navigation.
 * La coque étant redessinée à chaque navigation, les pastilles sont repeintes
 * après chaque rendu plutôt que conservées d'un écran à l'autre.
 */
let activeDownloads = 0;

repository
  .getDownloads()
  .then((jobs) => {
    activeDownloads = jobs.length;
    paintBadges();
  })
  .catch(() => {});

onDownloadsChanged((jobs) => {
  activeDownloads = jobs.length;
  paintBadges();
});

function paintBadges() {
  for (const node of document.querySelectorAll('[data-nav="downloads"]')) {
    node.querySelector('.nav-badge')?.remove();
    if (activeDownloads > 0) {
      node.append(h('span', { class: 'nav-badge label-sm' }, String(activeDownloads)));
    }
  }
}

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
  paintBadges();
  return content;
}

/* Le champ de recherche est reconstruit à chaque navigation : un seul écouteur
   global qui vise le champ courant, plutôt qu'un écouteur par vue. */
let searchField = null;

addEventListener('keydown', (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return;
  if (!searchField?.isConnected) return;
  event.preventDefault();
  searchField.focus();
  searchField.select();
});

/**
 * Marque de l'application : le symbole du logo sert partout (rail, barre
 * supérieure, écrans vides) pour qu'il n'y ait qu'une seule identité à tenir.
 * Le nom reste du texte à côté — il doit rester net, traduisible, copiable.
 * Assets produits par `tools/gen_brand_assets.py` depuis `logo.png`.
 */
export function brandMark(size = 36) {
  return h('img', {
    class: 'brand-mark',
    src: 'assets/brand/mark.png',
    alt: '',
    style: { '--mark-size': `${size}px` },
  });
}

function railItem({ key, path, label, icon: name }, active) {
  const current = key === active;
  return h(
    'a',
    {
      class: `rail__item${current ? ' is-active' : ''}`,
      href: `#${path}`,
      title: label,
      dataset: { nav: key },
      'aria-current': current ? 'page' : null,
    },
    h('span', { class: 'rail__item-icon' }, icon(name, { size: 22 })),
    h('span', {}, label),
  );
}

function rail(active) {
  return h(
    'nav',
    { class: 'rail', 'aria-label': 'التنقل الرئيسي' },
    h(
      'div',
      { class: 'rail__brand' },
      h(
        'a',
        { href: '#/home', title: 'بيت الحكمة' },
        brandMark(40),
        h('span', { class: 'rail__wordmark' }, 'بيت الحكمة'),
      ),
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
    ),
  );
}

/**
 * Barre supérieure : la marque, la recherche, les réglages. Pas de compte ni
 * de notifications — l'application est locale, il n'y a personne à notifier.
 */
function topbar() {
  const field = h('input', {
    type: 'search',
    'aria-label': 'البحث في المكتبة',
    placeholder: 'البحث عن كتاب، مؤلف، طبعة…',
    onkeydown: (event) => {
      if (event.key !== 'Enter') return;
      const term = field.value.trim();
      navigate(`/explore${term ? `?text=${encodeURIComponent(term)}` : ''}`);
    },
  });
  searchField = field;

  return h(
    'header',
    { class: 'topbar' },
    h(
      'a',
      { class: 'topbar__brand', href: '#/home' },
      brandMark(34),
      h('span', {}, 'بيت الحكمة'),
    ),
    h(
      'div',
      { class: 'topbar__search' },
      icon('search', { size: 20 }),
      field,
      h('kbd', { class: 'topbar__hint label-sm' }, 'Ctrl K'),
    ),
    h(
      'div',
      { class: 'topbar__actions' },
      h(
        'a',
        {
          class: 'topbar__icon-button',
          href: '#/settings',
          title: 'الإعدادات',
          'aria-label': 'الإعدادات',
        },
        icon('sliders', { size: 22 }),
      ),
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
          dataset: { nav: item.key },
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
