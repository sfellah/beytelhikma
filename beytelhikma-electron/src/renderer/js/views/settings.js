import { h } from '../dom.js';
import { icon } from '../icons.js';
import { currentLocale, LOCALES, n, setLocale, t } from '../i18n.js';
import { repository, setSetting, settings } from '../repository.js';
import { navigate } from '../router.js';
import { renderShell, toast } from '../shell.js';
import { copyField } from '../components/copy-field.js';
import { formatBytes } from '../components/download-action.js';
import { confirmDialog } from '../components/modal.js';
import { asyncView } from '../components/states.js';
import { themeChoices } from '../components/theme-choices.js';

const FONTS = [
  ['serif', 'settings.font.serif'],
  ['sans', 'settings.font.sans'],
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
      h('h1', { class: 'display-lg' }, t('settings.title')),
      languageSection(),
      appearanceSection(),
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
 * La langue de l'interface. Elle ne touche pas au contenu : les 8 568 éditions
 * sont arabes et le restent, l'aperçu de chiffres est là pour le montrer.
 *
 * Cet écran passera par `t()` à la refonte ; en attendant, seul ce groupe le
 * fait — c'est le premier à parler deux langues, et le seul qu'on puisse
 * relire dans les deux.
 */
function languageSection() {
  const active = currentLocale();
  const preview = h(
    'p',
    { class: 'label-sm muted', dir: 'auto' },
    t('settings.language.preview', { page: 42, total: 350 }),
  );

  const boutons = h(
    'div',
    { class: 'settings__choices' },
    LOCALES.map((locale) =>
      h(
        'button',
        {
          class: `button button--tonal${locale.key === active ? ' is-active' : ''}`,
          lang: locale.key,
          onclick: () => setLocale(locale.key),
        },
        locale.label,
      ),
    ),
  );

  return group(
    t('settings.language.title'),
    t('settings.language.hint'),
    row(t('settings.language.title'), h('div', { class: 'settings__slider' }, boutons, preview)),
  );
}

/**
 * Le thème n'a pas de valeur à recevoir en argument : `themeChoices` lit celui
 * qui est posé sur `<html>`, et c'est la seule vérité affichable — les
 * réglages peuvent avoir été chargés avant que `syncTheme` n'ait répondu.
 */
function appearanceSection() {
  return group(
    t('settings.appearance'),
    t('settings.appearanceHint'),
    row(t('settings.theme'), themeChoices().node, t('settings.themeHint')),
  );
}

/**
 * Les deux clés sont celles qu'écrit déjà le lecteur : les régler ici change
 * le point de départ des prochaines ouvertures, pas plus. Le thème, lui, est
 * passé au groupe المظهر ci-dessus — il ne se fait pas attendre.
 */
function readingSection(prefs) {
  const size = Number(prefs['reader.fontSize'] ?? 22);
  const value = h('span', { class: 'label-md' }, n(size));
  const slider = h('input', {
    type: 'range',
    min: MIN_FONT,
    max: MAX_FONT,
    value: String(size),
    oninput: (event) => {
      value.textContent = n(event.target.value);
    },
    onchange: (event) => setSetting('reader.fontSize', event.target.value),
  });

  const choices = (key, options, current) =>
    h(
      'div',
      { class: 'settings__choices' },
      options.map(([id, labelKey]) => {
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
          t(labelKey),
        );
        return button;
      }),
    );

  return group(
    t('settings.reading'),
    t('settings.readingHint'),
    row(t('settings.fontSize'), h('div', { class: 'settings__slider' }, slider, value)),
    row(t('settings.fontFamily'), choices('reader.font', FONTS, prefs['reader.font'] ?? 'serif')),
  );
}

function storageSection(usage, refresh) {
  return group(
    t('settings.storage'),
    t('settings.storageHint', {
      count: usage.bookCount,
      size: formatBytes(usage.bytes) || t('format.zeroBytes'),
    }),
    row(
      t('settings.downloadsRow'),
      h(
        'button',
        { class: 'button button--tonal', onclick: () => navigate('/downloads') },
        icon('download', { size: 18 }),
        h('span', {}, t('settings.open')),
      ),
      t('settings.downloadsHint'),
    ),
    row(
      t('notes.title'),
      h(
        'button',
        { class: 'button button--tonal', onclick: () => navigate('/notes') },
        icon('notes', { size: 18 }),
        h('span', {}, t('settings.open')),
      ),
      t('settings.notesHint'),
    ),
    row(
      t('settings.deleteAll'),
      h(
        'button',
        {
          class: 'button button--danger',
          disabled: usage.bookCount === 0,
          onclick: async () => {
            const choice = await confirmDialog({
              title: t('settings.deleteAllTitle'),
              message: t('settings.deleteAllMessage', { size: formatBytes(usage.bytes) }),
              actions: [{ value: 'go', label: t('settings.deleteAllAction'), variant: 'danger' }],
            });
            if (choice !== 'go') return;
            const removed = await repository.deleteAllBooks();
            toast(t('settings.deleted', { count: removed }));
            refresh();
          },
        },
        t('action.delete'),
      ),
      t('settings.deleteAllHint'),
    ),
  );
}

/**
 * `distribution.base_url` préfixe les clés du catalogue.
 *
 * Le catalogue ne porte plus d'hôte : changer cette seule valeur suffit à
 * servir la même bibliothèque depuis un autre bucket, sans rien retélécharger
 * de ce qui est déjà installé. Le réglage s'applique à la file sans redémarrage.
 */
function serverSection(prefs, refresh) {
  const field = h('input', {
    type: 'url',
    class: 'settings__field',
    value: prefs['distribution.base_url'] ?? '',
    placeholder: 'https://beytelhima-library.s3.eu-west-1.amazonaws.com',
  });

  const état = h('span', { class: 'label-sm muted' }, t('settings.catalogUnchecked'));

  return group(
    t('settings.source'),
    t('settings.sourceHint'),
    row(
      t('settings.sourceUrl'),
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
              toast(t('settings.sourceSaved'));
              refresh();
            },
          },
          t('action.save'),
        ),
      ),
      t('settings.sourceApplied'),
    ),
    row(
      t('settings.catalog'),
      h(
        'div',
        { class: 'settings__inline' },
        état,
        h(
          'button',
          {
            class: 'button',
            onclick: async (event) => {
              const bouton = event.currentTarget;
              bouton.disabled = true;
              état.textContent = t('settings.catalogChecking');
              try {
                const verdict = await repository.checkCatalogUpdate();
                if (verdict.action !== 'offer') {
                  état.textContent = t('settings.catalogUpToDate');
                  return;
                }
                état.textContent = t('settings.catalogDownloading');
                const { catalogVersion } = await repository.installCatalogUpdate();
                toast(t('settings.catalogUpdated', { version: catalogVersion }));
                refresh();
              } finally {
                bouton.disabled = false;
              }
            },
          },
          t('settings.checkUpdates'),
        ),
      ),
      t('settings.catalogHint'),
    ),
  );
}

/**
 * Les deux premières lignes portent des chemins absolus : ils débordaient de la
 * grille. Ils passent par `copyField`, qui les tient sur une ligne et les rend
 * copiables — c'est ce qu'on en fait quand on rapporte un problème.
 */
function aboutSection(about, usage) {
  const paths = [
    [t('settings.librarySource'), about.librarySource],
    [t('settings.dataFolder'), about.storageRoot],
  ];
  const facts = [
    [t('settings.editionCount'), n(about.editionCount)],
    [t('settings.categoryCount'), n(about.categoryCount)],
    // Le numéro de schéma se rapporte : il reste en chiffres latins, comme les
    // chemins et les URL de la grille au-dessus.
    [t('settings.schemaVersion'), String(about.schemaVersion)],
    [t('settings.usedSpace'), formatBytes(usage.bytes) || t('format.zeroBytes')],
  ];

  return group(
    t('settings.about'),
    null,
    h(
      'dl',
      { class: 'meta-grid meta-grid--paths' },
      paths.map(([label, value]) =>
        h('div', {}, h('dt', {}, label), h('dd', {}, copyField(value, { label }))),
      ),
    ),
    h(
      'dl',
      { class: 'meta-grid' },
      facts.map(([label, value]) => h('div', {}, h('dt', {}, label), h('dd', {}, value))),
    ),
  );
}
