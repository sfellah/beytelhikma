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
import { settingChoice } from '../components/setting-choice.js';
import { asyncView } from '../components/states.js';
import { familiesFor, resolveAnyFont, syncUserFonts, userFonts } from '../user-fonts.js';
import { themeChoices } from '../components/theme-choices.js';
import { READING_MODES, resolveReadingMode } from '../../../shared/reading-modes.js';
import { resolveTapZones, TAP_ZONE_MODES } from '../../../shared/page-turn.js';
import {
  DEFAULT_FONT_SIZE,
  MAX_FONT,
  MIN_FONT,
} from '../../../shared/reader-size.js';
import { openShortcuts } from '../components/shortcuts.js';

/**
 * Réglages.
 *
 * Sept blocs, dans cet ordre : ce qu'on règle souvent d'abord, ce qui détruit
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
      readingSection(prefs),
      fontsSection(prefs, refresh),
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
  reading: 'bookOpen',
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
    // L'aperçu de chiffres est l'indice de la ligne, pas une note flottante
    // sous le contrôle : c'est ce que ce réglage change, dit à sa place.
    row(
      t('settings.language.title'),
      choices,
      t('settings.language.preview', { page: 42, total: 350 }),
    ),
    row(t('settings.theme'), themeChoices().node, t('settings.themeHint')),
  );
}

/**
 * Comment on parcourt un livre : **horizontal**, une page par écran qu'on
 * tourne, ou **vertical**, un fil qu'on défile.
 *
 * Il y avait ici un second réglage — l'orientation du ruban de pagination,
 * « أفقي / عمودي ». Deux lignes voisines avec les mêmes mots pour deux choses
 * différentes : on croyait choisir sa façon de lire et l'on déplaçait la barre.
 * Le ruban reste donc en bas, toujours, et son réglage a disparu.
 */
function readingSection(prefs) {


  return group(
    'reading',
    t('settings.reading'),
    t('settings.readingHint'),
    // Deux façons de lire, et c'est le premier choix : la feuille imprimée, où
    // l'on tourne, ou le fil, où l'on défile d'une page à l'autre. Le ruban ne
    // bouge pas d'un mode à l'autre — il reste en bas, et c'est le réglage
    // suivant, posé à la main, qui le dresse.
    row(
      t('reader.modeLabel'),
      settingChoice({
        liste: READING_MODES,
        valeur: resolveReadingMode(prefs['reader.mode']),
        label: 'reader.modeLabel',
        setting: 'reader.mode',
        marque: 'readingMode',
      }),
      t('settings.modeHint'),
    ),
    // Les côtés de la page tournent au doigt, et une main qui tient l'appareil
    // touche le bord : c'est le seul des gestes du lecteur qu'on déclenche sans
    // le vouloir. L'éteindre ne coûte rien — le glissement, les chevrons et les
    // flèches tournent toujours.
    row(
      t('settings.tapZonesLabel'),
      settingChoice({
        liste: TAP_ZONE_MODES,
        valeur: resolveTapZones(prefs['reader.tapZones']),
        label: 'settings.tapZonesLabel',
        setting: 'reader.tapZones',
        marque: 'tapZones',
      }),
      t('settings.tapZonesHint'),
    ),
    // La fiche des raccourcis a quitté la barre du lecteur : elle y prenait une
    // place de doigt pour une liste de touches que le tactile ne peut pas
    // frapper. On vient ici pour apprendre l'outil ; c'est là qu'elle se lit.
    row(
      t('reader.shortcutsTitle'),
      action('help', t('settings.showShortcuts'), () => openShortcuts()),
      t('settings.shortcutsHint'),
    ),
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
function fontsSection(prefs, refresh) {
  const script = interfaceScript();

  /**
   * Le nom de la police **est** son échantillon : « أميري » composé en Amiri
   * montre exactement ce qu'on choisit. Une phrase de démonstration répétée
   * sous chaque option n'apprenait rien de plus — c'est la forme de la lettre
   * qui distingue, pas le texte — et allongeait les segments jusqu'à les
   * rendre illisibles à 13 px.
   *
   * Une police ajoutée porte son propre nom : il vient de la feuille de Google
   * et n'a pas de clé de catalogue.
   */
  const options = (list) =>
    list.map((font) => ({
      value: font.key,
      label: h(
        'span',
        {
          class: 'settings__specimen',
          style: { fontFamily: font.stack },
          // Le tracé est le nom, mais il n'est pas *dit* : ce que la synthèse
          // vocale annonce reste le libellé traduit.
          'aria-label': font.user ? font.family : t(font.label),
        },
        font.specimen ?? font.family,
      ),
    }));

  const size = Number(prefs['reader.fontSize'] ?? DEFAULT_FONT_SIZE);
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
        options: options(familiesFor(script, fontsForScript(script))),
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
        value: resolveAnyFont(prefs['reader.font'], 'arab', DEFAULT_READER_FONT),
        options: options(familiesFor('arab', fontsForScript('arab'))),
        onPick: (key) => setSetting('reader.font', key),
      }),
      t('settings.readerFontHint'),
    ),
    row(t('settings.fontSize'), h('div', { class: 'settings__slider' }, slider, value)),
    addFontRow(refresh),
    addedFontsRow(prefs, refresh),
  );
}

/**
 * Retirer une police **ajoutée**, et elle seule.
 *
 * Les six familles embarquées ne sont pas listées ici : elles vivent dans
 * `src/shared/fonts.js`, sont livrées avec l'application et n'ont pas de
 * fichiers dans `userData/fonts/`. Les proposer à la suppression offrirait un
 * geste qui ne peut pas aboutir — et une interface sans police de repli n'a
 * plus de quoi s'afficher.
 *
 * Pas de confirmation : une police ajoutée se réinstalle en recollant son
 * adresse, et le bouton porte le nom de la famille qu'il retire. La
 * confirmation est réservée à ce qui ne se refait pas — les livres, les notes.
 */
function addedFontsRow(prefs, refresh) {
  // Toutes écritures confondues : la liste dit ce qui est **installé**, pas ce
  // qui est proposé pour la langue du moment. Une police arabe resterait
  // invisible — donc indéboulonnable — sous une interface anglaise.
  const fonts = userFonts();
  if (!fonts.length) return null;

  const items = fonts.map((font) =>
    h(
      'li',
      { class: 'settings__font' },
      h(
        'span',
        {
          class: 'settings__specimen',
          style: { fontFamily: `'${font.family.replace(/'/g, '')}', serif` },
        },
        font.family,
      ),
      h(
        'button',
        {
          class: 'button button--icon',
          title: t('settings.removeFont', { family: font.family }),
          'aria-label': t('settings.removeFont', { family: font.family }),
          onclick: (event) => remove(font, event.currentTarget),
        },
        icon('trash', { size: 18 }),
      ),
    ),
  );

  async function remove(font, button) {
    button.disabled = true;
    const script = interfaceScript();
    // La question se pose **avant** le retrait : une fois la police sortie de
    // la liste chargée, `currentAppFont` répond déjà le repli, et l'interface
    // resterait peinte dans une famille que plus aucune règle ne déclare.
    const enService = currentAppFont(script) === font.key;

    try {
      await repository.removeFont(font.key);
      await syncUserFonts();

      if (enService) setAppFont(null, script);
      // Sans cette ligne le réglage garderait une clé morte : elle se replierait
      // à chaque rendu, mais l'écran continuerait d'annoncer un choix disparu.
      if (prefs['reader.font'] === font.key) {
        setSetting('reader.font', resolveFont(null, 'arab', DEFAULT_READER_FONT));
      }

      toast(t('settings.fontRemoved', { family: font.family }));
      refresh();
    } catch (error) {
      toast(error?.message ?? t('settings.fontRemoveFailed'));
      button.disabled = false;
    }
  }

  return row(
    t('settings.addedFonts'),
    h('ul', { class: 'settings__fonts' }, items),
    t('settings.addedFontsHint'),
  );
}

/**
 * Ajouter une police, c'est **l'installer**, pas la lier.
 *
 * Le processus principal lit la feuille une fois, dépose les `woff2` dans
 * `userData/fonts/` et n'y revient jamais. Ouvrir la CSP vers Google ferait
 * perdre ses polices à un lecteur hors ligne et émettrait une requête vers un
 * tiers à chaque lancement.
 */
function addFontRow(refresh) {
  const field = h('input', {
    type: 'url',
    class: 'settings__field',
    dir: 'ltr',
    placeholder: 'https://fonts.googleapis.com/css2?family=Vibes&display=swap',
  });

  const bouton = action(
    'plusSquare',
    t('settings.addFont'),
    async (event) => {
      const url = field.value.trim();
      if (!url) return;
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const font = await repository.installFont(url);
        await syncUserFonts();
        field.value = '';
        toast(t('settings.fontAdded', { family: font.family }));
        refresh();
      } catch (error) {
        toast(error?.message ?? t('settings.fontFailed'));
      } finally {
        button.disabled = false;
      }
    },
    'filled',
  );

  return row(
    t('settings.addFont'),
    h('div', { class: 'settings__inline' }, field, bouton),
    t('settings.addFontHint'),
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
 * Ce que chaque raison de `decideUpdate` doit dire à qui a cliqué.
 *
 * `upToDate` est la seule qui parle du catalogue ; les autres parlent de la
 * source. Les confondre — ce que faisait un `if (action !== 'offer')` nu —
 * annonçait « à jour » à une application hors ligne, c'est-à-dire une
 * vérification qui n'a jamais eu lieu.
 */
const VERDICT_MESSAGES = {
  upToDate: 'settings.catalogUpToDate',
  noPointer: 'settings.catalogUnreachable',
  malformed: 'settings.catalogUnreadable',
  schemaTooNew: 'settings.catalogTooNew',
};

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
            // L'adresse est validée côté principal (https, ou boucle locale) :
            // un refus doit se dire, sinon le champ garde une valeur que rien
            // n'a enregistrée.
            try {
              await repository.setDownloadBaseUrl(field.value);
            } catch (error) {
              toast(error?.message ?? t('settings.sourceRefused'));
              return;
            }
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
            // `ignoreDeclined` : le refus fait taire une proposition, pas une
            // question posée. Qui clique ici repose la question.
            const verdict = await repository.checkCatalogUpdate({ ignoreDeclined: true });
            if (verdict.action !== 'offer') {
              // Le verdict porte sa raison, et les raisons ne se valent pas :
              // annoncer « à jour » à une application hors ligne lui ferait
              // croire qu'elle a vu le serveur. C'est la seule des trois
              // réponses sur laquelle on puisse compter.
              état.textContent = t(VERDICT_MESSAGES[verdict.reason] ?? 'settings.catalogUnreachable');
              return;
            }
            état.textContent = t('settings.catalogDownloading');
            const { catalogVersion } = await repository.installCatalogUpdate();
            // Une version nulle veut dire que le pointeur a bougé entre la
            // proposition et le clic : rien n'a été installé, et l'annoncer
            // « mis à jour vers null » serait pire que de ne rien dire.
            if (catalogVersion == null) {
              état.textContent = t('settings.catalogUpToDate');
              return;
            }
            toast(t('settings.catalogUpdated', { version: catalogVersion }));
            refresh();
          } catch (error) {
            // Sans cette branche, un échec laissait le libellé sur
            // « التنزيل… » indéfiniment : l'écran annonçait un téléchargement
            // qui n'aurait jamais lieu, et l'erreur ne se lisait qu'en console.
            état.textContent = t('settings.catalogFailed');
            toast(error?.message ?? t('settings.catalogFailed'));
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
    // Les polices ajoutées vivent dans `userData/fonts/` : aucune
    // réinstallation ne les nettoie, il faut un moyen de les reprendre.
    userFonts().length > 0 &&
      row(
        t('settings.removeFonts'),
        h(
          'div',
          { class: 'settings__choices' },
          userFonts().map((font) =>
            h(
              'button',
              {
                class: 'button button--danger',
                onclick: async () => {
                  const choice = await confirmDialog({
                    title: t('settings.removeFontTitle', { family: font.family }),
                    message: t('settings.removeFontMessage'),
                    actions: [{ value: 'go', label: t('action.delete'), variant: 'danger' }],
                  });
                  if (choice !== 'go') return;
                  await repository.removeFont(font.key);
                  await syncUserFonts();
                  refresh();
                },
              },
              icon('trash', { size: 16 }),
              h('span', {}, font.family),
            ),
          ),
        ),
        t('settings.removeFontsHint'),
      ),
  );
}
