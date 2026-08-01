import { DEFAULT_READER_FONT, fontsForScript, resolveFont } from '../../../shared/fonts.js';
import { currentAppFont, interfaceScript, setAppFont } from '../app-font.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { currentLocale, LOCALES, n, setLocale, t } from '../i18n.js';
import { repository, setSetting, settings } from '../repository.js';
import { navigate } from '../router.js';
import { renderShell, toast } from '../shell.js';
import { copyField } from '../components/copy-field.js';
import { formatBytes } from '../components/download-action.js';
import { confirmDialog } from '../components/modal.js';
import { segmented } from '../components/segmented.js';
import { asyncView } from '../components/states.js';
import { themeChoices } from '../components/theme-choices.js';

const MIN_FONT = 16;
const MAX_FONT = 34;

/**
 * Réglages.
 *
 * Six blocs, dans cet ordre : ce qu'on règle souvent d'abord, ce qui détruit
 * en dernier. « حذف كل الكتب » vivait au milieu de l'écran, entre deux boutons
 * « فتح » anodins — on pouvait l'atteindre en passant.
 */
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
      fontsSection(prefs),
      librarySection(usage),
      serverSection(prefs, refresh),
      aboutSection(about, usage),
      dangerSection(usage, refresh),
    );
  }

  return null;
}

/**
 * Un bloc. L'icône en tête n'est pas décorative : les six titres se
 * ressemblaient tous, et rien ne distinguait « المظهر » de « منطقة الخطر ».
 */
function group(name, title, description, ...rows) {
  return h(
    'section',
    { class: `settings__group settings__group--${name}` },
    h(
      'div',
      { class: 'settings__head' },
      h('span', { class: 'settings__badge' }, icon(SECTION_ICONS[name], { size: 20 })),
      h(
        'div',
        {},
        h('h2', { class: 'headline-lg' }, title),
        description && h('p', { class: 'body-md muted' }, description),
      ),
    ),
    ...rows,
  );
}

const SECTION_ICONS = {
  language: 'translate',
  fonts: 'type',
  library: 'bank',
  server: 'globe',
  about: 'help',
  danger: 'trash',
};

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

/** Action visible : icône **et** libellé, jamais un mot seul comme « حفظ ». */
function action(iconName, label, onclick, variant = 'tonal') {
  return h(
    'button',
    { class: `button button--${variant}`, onclick },
    icon(iconName, { size: 18 }),
    h('span', {}, label),
  );
}

/**
 * Langue et apparence.
 *
 * L'aperçu de chiffres est le seul endroit où se voit que la forme des
 * chiffres suit la langue — il n'y a pas de réglage de chiffres, et il ne doit
 * pas y en avoir : `٤٢` est une propriété de l'arabe, pas un goût.
 *
 * Le thème n'a pas de valeur à recevoir : `themeChoices` lit celui qui est posé
 * sur `<html>`, seule vérité affichable — les réglages peuvent avoir été
 * chargés avant que `syncTheme` n'ait répondu.
 */
function languageSection() {
  const preview = h(
    'p',
    { class: 'settings__preview label-sm muted' },
    t('settings.language.preview', { page: 42, total: 350 }),
  );

  const choices = segmented({
    ariaLabel: t('settings.language.title'),
    value: currentLocale(),
    options: LOCALES.map((locale) => ({ value: locale.key, label: locale.label })),
    onPick: (key) => setLocale(key),
  });

  // Contrat de la campagne de captures, comme `data-tool` l'est pour la barre
  // du lecteur : le libellé change avec la langue, pas l'attribut.
  for (const [index, button] of [...choices.children].entries()) {
    button.dataset.localeChoice = LOCALES[index].key;
  }

  return group(
    'language',
    t('settings.language.title'),
    t('settings.language.hint'),
    row(t('settings.language.title'), h('div', { class: 'settings__stack' }, choices, preview)),
    row(t('settings.theme'), themeChoices().node, t('settings.themeHint')),
  );
}

/**
 * Deux polices, deux domaines.
 *
 * Celle de l'interface suit la locale : les faces latines n'apparaissent qu'en
 * anglais, les arabes qu'en arabe. Proposer EB Garamond à une interface arabe
 * serait un choix sans effet visible.
 *
 * Chaque aperçu est rendu **dans sa propre face** — c'est la seule façon
 * honnête de choisir une police, et la seule qui vaudra encore pour celles
 * qu'on ajoutera depuis Google Fonts, dont on ne connaît que le nom.
 */
function fontsSection(prefs) {
  const script = interfaceScript();

  const sample = (stack, text) =>
    h('span', { class: 'settings__sample', style: { fontFamily: stack } }, text);

  const options = (list, sampleText) =>
    list.map((font) => ({
      value: font.key,
      label: t(font.label),
      preview: sample(font.stack, sampleText),
    }));

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

  return group(
    'fonts',
    t('settings.fonts'),
    t('settings.fontsHint'),
    row(
      t('settings.interfaceFont'),
      segmented({
        ariaLabel: t('settings.interfaceFont'),
        value: currentAppFont(script),
        options: options(fontsForScript(script), t('settings.language.preview', { page: 42, total: 350 })),
        onPick: (key) => setAppFont(key, script),
      }),
      t('settings.interfaceFontHint'),
    ),
    row(
      t('settings.readerFont'),
      segmented({
        ariaLabel: t('settings.readerFont'),
        // Le livre est arabe : seules les faces arabes sont proposées, quelle
        // que soit la langue de l'interface.
        value: resolveFont(prefs['reader.font'], 'arab', DEFAULT_READER_FONT),
        options: options(fontsForScript('arab'), t('settings.readerSample')),
        onPick: (key) => setSetting('reader.font', key),
      }),
      t('settings.readerFontHint'),
    ),
    row(t('settings.fontSize'), h('div', { class: 'settings__slider' }, slider, value)),
  );
}

function librarySection(usage) {
  return group(
    'library',
    t('settings.storage'),
    t('settings.storageHint', {
      count: usage.bookCount,
      size: formatBytes(usage.bytes) || t('format.zeroBytes'),
    }),
    row(
      t('settings.downloadsRow'),
      action('download', t('settings.open'), () => navigate('/downloads')),
      t('settings.downloadsHint'),
    ),
    row(
      t('notes.title'),
      action('notes', t('settings.open'), () => navigate('/notes')),
      t('settings.notesHint'),
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
    dir: 'ltr',
    value: prefs['distribution.base_url'] ?? '',
    placeholder: 'https://beytelhima-library.s3.eu-west-1.amazonaws.com',
  });

  const état = h('span', { class: 'label-sm muted' }, t('settings.catalogUnchecked'));

  return group(
    'server',
    t('settings.source'),
    t('settings.sourceHint'),
    row(
      t('settings.sourceUrl'),
      h(
        'div',
        { class: 'settings__inline' },
        field,
        action(
          'check',
          t('action.save'),
          async () => {
            await repository.setDownloadBaseUrl(field.value);
            toast(t('settings.sourceSaved'));
            refresh();
          },
          'filled',
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
        action('download', t('settings.checkUpdates'), async (event) => {
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
        }),
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
    'about',
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

/**
 * Zone de danger, en fin d'écran et dans son propre cadre.
 *
 * Ce qui est irréversible ne doit pas se croiser en chemin vers autre chose.
 */
function dangerSection(usage, refresh) {
  return group(
    'danger',
    t('settings.dangerZone'),
    t('settings.dangerHint'),
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
        icon('trash', { size: 18 }),
        h('span', {}, t('action.delete')),
      ),
      t('settings.deleteAllHint'),
    ),
  );
}
