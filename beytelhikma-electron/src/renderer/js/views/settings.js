import { h } from '../dom.js';
import { icon } from '../icons.js';
import { repository, setSetting, settings } from '../repository.js';
import { navigate } from '../router.js';
import { renderShell, toast } from '../shell.js';
import { formatBytes } from '../components/download-action.js';
import { confirmDialog } from '../components/modal.js';
import { asyncView } from '../components/states.js';

const THEMES = [
  ['paper', 'ورقي'],
  ['sepia', 'بني'],
  ['night', 'ليلي'],
];

const FONTS = [
  ['serif', 'نسخي'],
  ['sans', 'حديث'],
];

const MIN_FONT = 16;
const MAX_FONT = 34;

/** Réglages : lecture, stockage, serveur, informations. */
export function settingsView(host) {
  const content = renderShell(host, { active: 'settings' });

  const load = async () => ({
    prefs: await settings(),
    usage: await repository.getStorageUsage(),
    about: await repository.getAbout(),
  });

  const refresh = () => asyncView(content, load, render);
  refresh();

  function render({ prefs, usage, about }) {
    return h(
      'section',
      { class: 'settings' },
      h('h1', { class: 'display-lg' }, 'الإعدادات'),
      readingSection(prefs),
      storageSection(usage, refresh),
      serverSection(prefs, refresh),
      aboutSection(about, usage),
    );
  }

  return null;
}

function group(title, description, ...rows) {
  return h(
    'section',
    { class: 'settings__group' },
    h(
      'div',
      {},
      h('h2', { class: 'headline-lg' }, title),
      description && h('p', { class: 'body-md muted' }, description),
    ),
    ...rows,
  );
}

function row(label, control, hint = null) {
  return h(
    'div',
    { class: 'settings__row' },
    h(
      'div',
      { class: 'settings__row-text' },
      h('p', { class: 'label-md' }, label),
      hint && h('p', { class: 'label-sm muted' }, hint),
    ),
    control,
  );
}

/**
 * Les trois clés sont celles qu'écrit déjà le lecteur : les régler ici change
 * le point de départ des prochaines ouvertures, pas plus.
 */
function readingSection(prefs) {
  const size = Number(prefs['reader.fontSize'] ?? 22);
  const value = h('span', { class: 'label-md' }, String(size));
  const slider = h('input', {
    type: 'range',
    min: MIN_FONT,
    max: MAX_FONT,
    value: String(size),
    oninput: (event) => {
      value.textContent = event.target.value;
    },
    onchange: (event) => setSetting('reader.fontSize', event.target.value),
  });

  const choices = (key, options, current) =>
    h(
      'div',
      { class: 'settings__choices' },
      options.map(([id, label]) => {
        const button = h(
          'button',
          {
            class: `button button--tonal${current === id ? ' is-active' : ''}`,
            onclick: () => {
              setSetting(key, id);
              for (const sibling of button.parentElement.children) {
                sibling.classList.toggle('is-active', sibling === button);
              }
            },
          },
          label,
        );
        return button;
      }),
    );

  return group(
    'القراءة',
    'تُطبَّق عند فتح كتاب جديد.',
    row('حجم الخط', h('div', { class: 'settings__slider' }, slider, value)),
    row('المظهر', choices('reader.theme', THEMES, prefs['reader.theme'] ?? 'paper')),
    row('نوع الخط', choices('reader.font', FONTS, prefs['reader.font'] ?? 'serif')),
  );
}

function storageSection(usage, refresh) {
  return group(
    'التخزين',
    `${usage.bookCount} كتابًا على هذا الجهاز • ${formatBytes(usage.bytes) || '0 ك.ب'}`,
    row(
      'قائمة التنزيل',
      h(
        'button',
        { class: 'button button--tonal', onclick: () => navigate('/downloads') },
        icon('download', { size: 18 }),
        h('span', {}, 'فتح'),
      ),
      'التنزيلات الجارية والمتعثّرة',
    ),
    row(
      'حذف كل الكتب',
      h(
        'button',
        {
          class: 'button button--danger',
          disabled: usage.bookCount === 0,
          onclick: async () => {
            const choice = await confirmDialog({
              title: 'حذف كل الكتب؟',
              message: `سيُحرَّر ${formatBytes(usage.bytes)}. مواضع القراءة والمجموعات تبقى كما هي.`,
              actions: [{ value: 'go', label: 'حذف الكل', variant: 'danger' }],
            });
            if (choice !== 'go') return;
            const removed = await repository.deleteAllBooks();
            toast(`حُذف ${removed} كتابًا`);
            refresh();
          },
        },
        'حذف',
      ),
      'تُحفظ مواضع القراءة، ويمكن إعادة التنزيل لاحقًا',
    ),
  );
}

/**
 * `minio.base_url` remplace l'origine des `download_url` du catalogue. Le
 * réglage s'applique immédiatement à la file, sans redémarrage.
 */
function serverSection(prefs, refresh) {
  const field = h('input', {
    type: 'url',
    class: 'settings__field',
    value: prefs['minio.base_url'] ?? '',
    placeholder: 'http://127.0.0.1:9000/beytelhikma',
  });

  return group(
    'الخادم',
    'اتركه فارغًا لاتّباع الروابط المسجّلة في الفهرس.',
    row(
      'عنوان الخادم',
      h(
        'div',
        { class: 'settings__inline' },
        field,
        h(
          'button',
          {
            class: 'button button--filled',
            onclick: async () => {
              await repository.setDownloadBaseUrl(field.value);
              toast('حُفظ عنوان الخادم');
              refresh();
            },
          },
          'حفظ',
        ),
      ),
      'يُطبَّق فورًا على التنزيلات التالية',
    ),
  );
}

function aboutSection(about, usage) {
  const rows = [
    ['مصدر المكتبة', about.librarySource],
    ['مجلد البيانات', about.storageRoot],
    ['عدد الطبعات في الفهرس', String(about.editionCount)],
    ['عدد التخصصات', String(about.categoryCount)],
    ['إصدار قاعدة المستخدم', String(about.schemaVersion)],
    ['المساحة المستخدمة', formatBytes(usage.bytes) || '0 ك.ب'],
  ];

  return group(
    'عن التطبيق',
    null,
    h(
      'dl',
      { class: 'meta-grid' },
      rows.map(([label, value]) => h('div', {}, h('dt', {}, label), h('dd', {}, value))),
    ),
  );
}
