import { DEFAULT_READER_FONT, fontsForScript, resolveFont } from '../../../shared/fonts.js';
import { describeSelection, paintHighlights } from '../annotations.js';
import { renderBookHtml } from '../content-html.js';
import { h } from '../dom.js';
import { n } from '../format.js';
import { t } from '../i18n.js';
import { chevronBackward, chevronForward, icon, isRtl } from '../icons.js';
import { canGoFullscreen, isTouchPrimary } from '../platform.js';
import { repository, setSetting, settings } from '../repository.js';
import { back, navigate } from '../router.js';
import { toast } from '../shell.js';
import { confirmDialog, noteDialog } from '../components/modal.js';
import { openShortcuts } from '../components/shortcuts.js';
import { errorView, loadingView } from '../components/states.js';
import { themeChoices } from '../components/theme-choices.js';
import { arabicSearchPattern, normalizeArabic } from '../../../shared/arabic.js';
import {
  DEFAULT_PAGER_LAYOUT,
  PAGER_LAYOUTS,
  resolvePagerLayout,
} from '../../../shared/pager-layouts.js';
import {
  DEFAULT_TAP_ZONES,
  resolveTapZones,
  swipeTurn,
  turnZone,
} from '../../../shared/page-turn.js';
import {
  clampSize,
  DEFAULT_FONT_SIZE,
  MAX_FONT,
  MIN_FONT,
  PINCH_MIN_SPREAD,
  pinchSize,
} from '../../../shared/reader-size.js';

/**
 * Direction du **contenu**, qui n'est pas celle de l'interface : le corpus est
 * arabe, une page de livre reste RTL sous une interface anglaise. Elle se pose
 * explicitement — une direction implicite coïnciderait en `ar` et masquerait le
 * défaut jusqu'à la première bascule.
 */
const CONTENT_DIR = 'rtl';

/** Texte écrit par le lecteur : sa direction est celle de ce qu'il a tapé. */
const USER_DIR = 'auto';

const PAGE_WINDOW = 20;
const HINT_DELAY = 4000;

/**
 * Délai laissé à une sélection pour se poser avant qu'on la mesure. Une
 * sélection qui s'étire émet `selectionchange` à chaque caractère ; sans ce
 * répit, la feuille des couleurs sauterait sous le doigt qui la fabrique.
 */
const SELECTION_SETTLE = 250;

// Les deux règles qui décident du sens — les tiers au clic, le glissement au
// doigt — vivent dans `shared/page-turn.js`, pures et seules : c'est la seule
// façon de les vérifier dans les *deux* directions d'écriture sans un DOM.

/** Entrées de sommaire montées d'un coup ; au-delà, on déplie à la demande. */
const TOC_WINDOW = 80;

// Les familles de lecture viennent de `shared/fonts.js`, seul propriétaire de
// la liste : c'est d'une copie locale ici et d'une autre dans les réglages
// qu'était née la police orpheline. Le livre est arabe, donc seules les faces
// arabes sont proposées.
const FONTS = fontsForScript('arab');

/**
 * Palette « Serene Heritage » : les quatre teintes sortent des jetons du
 * projet (or antique, émeraude, argile, graphite) plutôt que d'un nuancier de
 * surligneur. Posées à faible opacité, elles teintent le fond sans jamais
 * toucher l'encre — le texte garde son contraste dans les trois ambiances.
 */
const HIGHLIGHTS = [
  { color: '#d9b26a', label: 'reader.highlight.gold' },
  { color: '#6a9e88', label: 'reader.highlight.emerald' },
  { color: '#c58a6b', label: 'reader.highlight.clay' },
  { color: '#8f9aa6', label: 'reader.highlight.stone' },
];

/** Onglets du panneau « ملاحظاتي » : le même vocabulaire que l'écran global. */
const ANNOTATION_KINDS = [
  { value: 'all', label: 'reader.tab.all', icon: 'notes' },
  { value: 'highlight', label: 'reader.tab.highlight', icon: 'highlight' },
  { value: 'note', label: 'reader.tab.note', icon: 'noteAdd' },
  { value: 'bookmark', label: 'reader.tab.bookmark', icon: 'bookmark' },
];

/**
 * Lecteur : page imprimée par écran ou fil continu, sélection de texte native,
 * taille de police réglable, ambiances, progression écrite dans `user.sqlite`.
 * Disposition et jeu d'icônes calqués sur `docs/maquettes/reader-v2.html`.
 */
export function readerView(host, params) {
  host.replaceChildren(loadingView(t('reader.opening')));
  const controller = new Reader(host, params.id, params.query?.page);
  controller.start();
  return { dispose: () => controller.dispose() };
}

class Reader {
  #host;
  #editionId;
  #requestedPageId;
  #pages = new Map();
  #pageCount = 0;
  #index = 0;
  #toc = [];
  #title = '';
  /** Le thème n'est plus une préférence de lecture : il est global (`theme.js`). */
  #prefs = {
    size: DEFAULT_FONT_SIZE,
    font: DEFAULT_READER_FONT,
    pager: DEFAULT_PAGER_LAYOUT,
    tapZones: DEFAULT_TAP_ZONES,
  };
  #saveTimer = null;
  #hintTimer = null;
  #nodes = {};
  /** Motif du terme cherché, réappliqué à chaque page affichée. */
  #highlight = null;
  /** Annotations du livre entier, chargées une fois puis tenues à jour. */
  #annotations = { highlights: [], notes: [], bookmarks: [] };
  /** Onglet courant du panneau des annotations. */
  #annotationKind = 'all';
  /**
   * Index dérivés, invalidés à chaque écriture d'annotation. Ils évitent de
   * rebalayer tout le livre pour chaque page montée ou chaque ligne du panneau.
   */
  #highlightsByPage = null;
  #tocByPage = null;
  #pagesById = null;
  /**
   * La page montée : une seule, toujours. Le lecteur n'a plus qu'une façon de
   * lire — la feuille imprimée — et une carte de blocs n'aurait plus qu'une
   * entrée.
   */
  #block = null;
  /** Page affichée, pour ancrer une annotation sans la rechercher. */
  #page = null;
  /**
   * Sélection décrite au moment où elle est faite : cliquer dans le menu la
   * défait, il est trop tard pour la mesurer. La page est retenue avec elle —
   * un panneau ouvert entre-temps peut avoir changé la page courante.
   */
  #pendingSelection = null;
  #pendingPage = null;
  /**
   * Départ du glissement en cours, et trace du dernier qui a tourné la page.
   *
   * Un glissement au doigt émet souvent un `click` en fin de course : sans
   * cette trace, la page tournerait deux fois — une fois par le geste, une fois
   * par le clic qu'il laisse derrière lui.
   */
  #swipeFrom = null;
  #swiped = false;
  /**
   * Les doigts posés sur la colonne, et le pincement qu'ils font peut-être.
   *
   * Le lecteur a besoin des **deux** pointeurs à la fois : un pincement n'est
   * pas un évènement, c'est la distance entre deux d'entre eux qui change. Le
   * navigateur, lui, n'en livre qu'un par message — la carte est la seule façon
   * de tenir l'autre.
   *
   * `touch-action: pan-y` interdit au navigateur d'agrandir la page lui-même :
   * le geste reste donc au lecteur, qui **recompose** le texte au lieu de le
   * grossir — les lignes se replient, la colonne ne déborde pas de l'écran.
   */
  #pointers = new Map();
  #pinch = null;
  /** Ferme la fiche des raccourcis, tant qu'elle est ouverte. */
  #closeShortcuts = null;
  #keyHandler = (event) => this.#onKey(event);
  #fullscreenHandler = () => this.#syncFullscreen();
  /**
   * Le plein écran est-il offert ? Constaté une fois à l'ouverture, pas relu à
   * chaque geste : ce n'est pas un réglage, et la réponse ne change pas sous
   * les doigts de celui qui lit.
   */
  #fullscreen = canGoFullscreen();
  /**
   * Une sélection était-elle vivante quand le doigt s'est posé ?
   *
   * Le navigateur défait la sélection **entre `mousedown` et `mouseup`** :
   * mesuré sur l'appareil, `mousedown` la voit encore, `mouseup` et `click`
   * lisent du vide. Une garde posée au `click` ne peut donc jamais protéger la
   * tape qui vient de défaire une sélection — elle voit toujours du vide et
   * escamote les barres. L'état se relève donc au `pointerdown`, seul moment
   * où il est encore vrai.
   */
  #selectionAtPress = false;
  #selectionTimer = null;
  /** Vrai dès que le routeur a démonté la vue : `start()` s'arrête là où elle en est. */
  #disposed = false;
  /**
   * `selectionchange` est le **seul** évènement qui arrive pendant qu'une
   * sélection existe. `mouseup` est un évènement de l'ère souris : il convient
   * au cliquer-glisser, où la sélection survit au relâchement, et pas au doigt,
   * où l'appui long est piloté par la couche native. C'est ce que le spike
   * mobile avait mesuré, et la correction n'avait jamais été reportée ici :
   * sans elle, le menu de surlignage ne s'ouvre pas au doigt.
   *
   * Antirebond : une sélection qui s'étire en émet des dizaines, et la feuille
   * sauterait à chaque caractère.
   */
  #selectionHandler = () => {
    clearTimeout(this.#selectionTimer);
    this.#selectionTimer = setTimeout(() => this.#onSelection(), SELECTION_SETTLE);
  };

  constructor(host, editionId, requestedPageId) {
    this.#host = host;
    this.#editionId = editionId;
    this.#requestedPageId = requestedPageId ? Number(requestedPageId) : null;
  }

  async start() {
    try {
      // Le contenu n'est lisible qu'une fois le fichier installé : sans lui, la
      // fiche est le seul endroit où l'on peut faire quelque chose.
      const detail = await repository.getBookDetail(this.#editionId);
      if (this.#disposed) return;
      if (detail.download?.status !== 'installed') {
        navigate(`/book/${this.#editionId}`);
        return;
      }

      const [count, toc, saved, prefs, annotations] = await Promise.all([
        repository.getPageCount(this.#editionId),
        repository.getToc(this.#editionId).catch(() => []),
        repository.getProgress(this.#editionId),
        settings(),
        repository
          .getBookAnnotations(this.#editionId)
          .catch(() => ({ highlights: [], notes: [], bookmarks: [] })),
      ]);
      if (this.#disposed) return;
      this.#annotations = annotations;

      this.#title = detail.summary.title;
      this.#pageCount = count;
      this.#toc = toc;
      this.#prefs = {
        size: clampSize(prefs['reader.fontSize']),
        font: resolveFont(prefs['reader.font'], 'arab', DEFAULT_READER_FONT),
        pager: resolvePagerLayout(prefs['reader.pager']),
        tapZones: resolveTapZones(prefs['reader.tapZones']),
      };

      let index = (saved?.sequenceNum ?? 1) - 1;
      if (this.#requestedPageId) {
        const page = await repository.getPageById(this.#editionId, this.#requestedPageId);
        if (page) index = page.sequenceNum - 1;
      }
      this.#index = clamp(index, 0, Math.max(0, count - 1));

      this.#build();
      await this.#show(this.#index, { save: false });
      if (this.#disposed) return;
      document.addEventListener('keydown', this.#keyHandler);
      // `selectionchange` ne se pose que sur `document` : c'est là qu'il naît.
      document.addEventListener('selectionchange', this.#selectionHandler);
      if (this.#fullscreen) document.addEventListener('fullscreenchange', this.#fullscreenHandler);
      this.#hintTimer = setTimeout(() => this.#hideHint(), HINT_DELAY);
    } catch (error) {
      // Livre supprimé pendant la lecture : la fiche, pas un écran d'erreur.
      if (String(error?.message ?? '').includes('livre non installé')) {
        navigate(`/book/${this.#editionId}`);
        return;
      }
      if (this.#disposed) return;
      this.#host.replaceChildren(
        errorView(error, () => navigate(`/book/${this.#editionId}`)),
      );
    }
  }

  dispose() {
    // `start()` court encore : elle est faite d'attentes, et le routeur peut
    // démonter la vue entre deux. Sans ce drapeau, elle reprenait après coup et
    // posait ses écouteurs sur `document` — un lecteur quitté continuait alors
    // d'avaler les flèches et le `Ctrl+F` de l'écran suivant.
    this.#disposed = true;
    document.removeEventListener('keydown', this.#keyHandler);
    document.removeEventListener('selectionchange', this.#selectionHandler);
    document.removeEventListener('fullscreenchange', this.#fullscreenHandler);
    clearTimeout(this.#saveTimer);
    clearTimeout(this.#hintTimer);
    clearTimeout(this.#selectionTimer);
    this.#closeShortcuts?.();
    this.#closeShortcuts = null;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }

  // ------------------------------------------------------------- structure

  #build() {
    // --- la page elle-même : entête discret, puis le fil des pages montées ---
    // Le corpus est arabe : titre, chapitres et pages restent RTL sous une
    // interface anglaise, et le disent. Une direction héritée du `<html>`
    // marcherait par coïncidence en `ar` et casserait en `en`.
    const pageHead = h(
      'div',
      { class: 'reader__page-head' },
      h('p', { class: 'headline-md', dir: CONTENT_DIR }, this.#title),
      h('span', { class: 'reader__hairline' }),
    );
    const flow = h('div', { class: 'reader__flow' });

    const scroll = h('div', { class: 'reader__scroll no-scrollbar' }, pageHead, flow);

    // --- barre haute : sortie au départ (droite RTL), titre au centre, outils à
    // l'autre bout. Quitter n'est pas un outil parmi les outils : c'est le geste
    // qu'on cherche en premier quand on ne veut plus lire, et une croix seule ne
    // dit pas où elle ramène.
    // `data-tool` est le point d'accroche stable des captures et des tests :
    // les infobulles portent maintenant leur raccourci, elles bougent.
    // `name` est un nom d'icône, ou une fabrique quand le tracé dépend de la
    // direction de l'interface (`chevronForward` et sa jumelle).
    const tool = (key, name, title, onclick) =>
      h(
        'button',
        { class: 'reader__tool', 'data-tool': key, title, onclick },
        typeof name === 'function' ? name({ size: 20 }) : icon(name, { size: 20 }),
      );

    // Sur un téléphone la fenêtre occupe déjà tout l'écran : le bouton
    // répondrait sans que rien ne bouge. Il n'est donc pas désactivé, il est
    // absent — un outil grisé demande encore pourquoi.
    const fullscreenButton = this.#fullscreen
      ? tool('fullscreen', 'fullscreen', t('reader.fullscreen'), () => this.#toggleFullscreen())
      : null;
    const bookmarkButton = tool('bookmark', 'bookmark', t('reader.bookmarkTool'), () =>
      this.#toggleBookmark(),
    );

    // Le ruban se bascule en lisant : c'est le seul des deux réglages de
    // `/settings` dont on veut voir l'effet tout de suite, sur la page qu'on a
    // sous les yeux. L'icône montre la disposition qu'on **obtiendra**, comme
    // celle du plein écran — pas celle qui est en place, qu'on voit déjà.
    const pagerButton = tool('pager', 'pagerVertical', '', () => this.#togglePager());

    // La sortie garde `data-tool="close"` : c'est le contrat que suivent les
    // captures et les tests, seul son habillage change. Le chevron pointe vers
    // le début de ligne — la droite en RTL, la gauche en LTR — comme tout
    // retour arrière : il suit la direction de l'interface, il n'est pas figé.
    const backButton = h(
      'button',
      {
        class: 'reader__back',
        'data-tool': 'close',
        title: t('reader.backTitle'),
        onclick: () => back(),
      },
      chevronBackward({ size: 20 }),
      h('span', { class: 'reader__back-label label-md' }, t('reader.back')),
    );

    const header = h(
      'header',
      { class: 'reader__header' },
      h(
        'div',
        { class: 'reader__bar' },
        h('div', { class: 'reader__lead' }, backButton),
        h(
          'div',
          { class: 'reader__titles' },
          h('h1', { class: 'truncate', dir: CONTENT_DIR }, this.#title),
        ),
        // Trois groupes, dans l'ordre où l'on s'en sert : **se repérer** dans
        // le livre (sommaire, recherche), **y laisser une trace** (signet,
        // notes), **régler l'affichage** (ruban, typographie). Les outils
        // étaient rangés dans l'ordre où ils avaient été écrits — signet entre
        // les notes et le sommaire, réglages entre le sommaire et la recherche.
        h(
          'div',
          { class: 'reader__tools' },
          tool('toc', 'toc', t('reader.tocTool'), () => this.#togglePanel('toc')),
          tool('search', 'search', t('reader.searchTool'), () => this.#togglePanel('search')),
          bookmarkButton,
          tool('annotations', 'annotate', t('reader.notesTool'), () =>
            this.#togglePanel('annotations'),
          ),
          pagerButton,
          tool('settings', 'formatSize', t('reader.settingsTool'), () => this.#togglePanel('settings')),
          fullscreenButton,
        ),
      ),
    );

    // --- barre basse : pagination puis jauge, comme la maquette ---
    const slider = h('input', {
      class: 'reader__rail',
      type: 'range',
      min: 1,
      max: Math.max(1, this.#pageCount),
      value: this.#index + 1,
      title: t('reader.position'),
      oninput: (event) => this.#show(Number(event.target.value) - 1),
    });

    // Les deux chevrons sont montés couchés puis redressés par `#syncPager`,
    // qui est le seul à décider de leur tracé : la bascule se fait en lisant,
    // et une seconde décision ici divergerait au premier clic.
    const previous = tool('previous', chevronBackward, t('reader.shortcut.previousPage'), () =>
      this.#move(-1),
    );
    const next = tool('next', chevronForward, t('reader.shortcut.nextPage'), () => this.#move(1));

    // Trois nœuds plutôt qu'une chaîne : dressé, le ruban empile la page
    // courante, un filet et le total. Une fraction écrite verticalement tient
    // dans la largeur d'un pouce, « ٢٣٠ / ١ » non.
    const pagerCurrent = h('span', { class: 'reader__pager-current' });
    const pagerTotal = h('span', { class: 'reader__pager-total' });
    const pagerLabel = h(
      'span',
      { class: 'reader__pager-label label-md' },
      pagerCurrent,
      h('span', { class: 'reader__pager-sep' }, '/'),
      pagerTotal,
    );
    const percent = h('span', { class: 'reader__percent label-sm' });

    const footer = h(
      'footer',
      { class: 'reader__footer' },
      h(
        'div',
        { class: 'reader__toolbar' },
        h('div', { class: 'reader__pager' }, previous, pagerLabel, next),
        h('div', { class: 'reader__progress' }, slider),
        percent,
      ),
    );

    const hint = h(
      'div',
      { class: 'reader__hint label-sm' },
      t('reader.hideTools'),
    );

    // Les références des panneaux sont collectées avant d'écraser `#nodes`.
    const refs = {};
    const panel = this.#settingsPanel(refs);
    const tocPanel = this.#tocPanel();
    const searchPanel = this.#searchPanel(refs);
    const annotationsPanel = this.#annotationsPanel(refs);
    const selection = this.#selectionMenu();

    const root = h(
      'div',
      {
        // Il n'y a plus de classe de façon de lire : il n'en reste qu'une, et
        // une classe qui ne distingue plus le lecteur de lui-même se garde par
        // habitude. Les animations de feuilletage se portent donc sur le bloc.
        class: `reader reader--font-${this.#prefs.font} reader--pager-${this.#prefs.pager}`,
        style: { '--reader-size': `${this.#prefs.size}px` },
      },
      header,
      scroll,
      footer,
      hint,
      panel,
      tocPanel,
      searchPanel,
      annotationsPanel,
      selection,
    );

    scroll.addEventListener('scroll', () => this.#onScroll(scroll));
    scroll.addEventListener('click', (event) => this.#onContentClick(event));
    scroll.addEventListener('wheel', (event) => this.#onWheel(event), { passive: false });
    // Le dernier moment où la sélection est encore lisible : `mouseup` et
    // `click` arrivent après que le navigateur l'a défaite. C'est aussi le
    // départ d'un glissement — les deux se relèvent au même instant.
    scroll.addEventListener('pointerdown', (event) => {
      const selection = window.getSelection();
      this.#selectionAtPress = Boolean(selection) && !selection.isCollapsed;
      this.#onPointerDown(event);
    });
    scroll.addEventListener('pointermove', (event) => this.#onPointerMove(event));
    scroll.addEventListener('pointerup', (event) => {
      this.#endPointer(event);
      this.#onPointerUp(event);
    });
    scroll.addEventListener('pointercancel', (event) => {
      this.#endPointer(event);
      this.#swipeFrom = null;
    });
    // Trois portes vers la même mesure, toutes antirebondies : `selectionchange`
    // porte le doigt, les deux autres achèvent un cliquer-glisser sans attendre
    // le répit.
    scroll.addEventListener('mouseup', this.#selectionHandler);
    scroll.addEventListener('touchend', this.#selectionHandler);

    this.#nodes = {
      root,
      flow,
      pageHead,
      pagerCurrent,
      pagerTotal,
      percent,
      slider,
      previous,
      next,
      header,
      footer,
      hint,
      scroll,
      panel,
      tocPanel,
      searchPanel,
      annotationsPanel,
      selection,
      fullscreenButton,
      bookmarkButton,
      pagerButton,
      lastScroll: 0,
      ...refs,
    };
    this.#syncPager();
    this.#host.replaceChildren(root);
  }

  #settingsPanel(refs) {
    const sizeValue = h('span', { class: 'label-md' }, `${this.#prefs.size}`);
    const sizeSlider = h('input', {
      type: 'range',
      min: MIN_FONT,
      max: MAX_FONT,
      value: this.#prefs.size,
      oninput: (event) => this.#setSize(Number(event.target.value)),
    });

    // Le thème est global : les pastilles repeignent tout l'écran, pas la
    // seule page. C'est ici qu'on en a le plus besoin — en lecture, le soir.
    const themes = themeChoices();

    const fontButtons = FONTS.map((font) =>
      h(
        'button',
        {
          class: font.key === this.#prefs.font ? 'is-active' : '',
          onclick: () => this.#setFont(font.key),
        },
        h('span', { style: { fontFamily: font.stack, fontSize: '18px' } }, t(font.label)),
        font.key === this.#prefs.font ? icon('check', { size: 16 }) : null,
      ),
    );

    Object.assign(refs, { sizeValue, sizeSlider, fontButtons });

    return h(
      'aside',
      { class: 'reader__settings reader__panel' },
      h(
        'div',
        { class: 'reader__panel-head' },
        h('h2', { class: 'title-md' }, t('reader.settingsTitle')),
        h(
          'button',
          {
            class: 'reader__tool',
            title: t('action.close'),
            onclick: () => this.#closePanels(),
          },
          icon('close', { size: 20 }),
        ),
      ),
      // Ce panneau ne porte que ce qui se règle **en lisant** : la taille de la
      // lettre, l'ambiance, la face. Le mode de lecture est parti dans
      // `/settings` — on le pose une fois, il n'a rien à faire ici.
      h(
        'div',
        { class: 'reader__panel-body' },
        h(
          'div',
          {},
          h('label', { class: 'label-md' }, t('reader.sizeLabel')),
          // Le pincement ne s'annonce que là où il existe : sur un écran tactile.
          // Une ligne qui promet un geste impossible se lit deux fois avant
          // qu'on la croie fausse — comme le bouton de plein écran grisé.
          isTouchPrimary() ? h('p', { class: 'label-sm muted' }, t('reader.pinchHint')) : null,
          h(
            'div',
            { class: 'font-size-control' },
            h(
              'button',
              { title: t('reader.shortcut.smaller'), onclick: () => this.#setSize(this.#prefs.size - 2) },
              icon('minus', { size: 16 }),
            ),
            sizeSlider,
            h(
              'button',
              { title: t('reader.shortcut.bigger'), onclick: () => this.#setSize(this.#prefs.size + 2) },
              icon('plus', { size: 20 }),
            ),
            sizeValue,
          ),
        ),
        h(
          'div',
          {},
          h('label', { class: 'label-md' }, t('reader.themeLabel')),
          themes.node,
        ),
        h(
          'div',
          {},
          h('label', { class: 'label-md' }, t('reader.fontLabel')),
          h('div', { class: 'font-choices' }, fontButtons),
        ),
      ),
    );
  }

  /**
   * Sommaire glissant : la même donnée que la fiche livre, à portée de page.
   *
   * Un sommaire du corpus Shamela porte couramment des milliers d'entrées : on
   * n'en monte qu'une tranche, et un champ y cherche par titre. Le filtre passe
   * par `title_normalized`, déjà produit par le pipeline — chercher sur le
   * titre brut manquerait toute variante de hamza.
   */
  #tocPanel() {
    const list = h('div', { class: 'reader__panel-body reader__toc-list' });
    const more = h('div', { class: 'reader__toc-more' });
    let matches = this.#toc;
    let shown = 0;

    const grow = () => {
      const next = matches.slice(shown, shown + TOC_WINDOW);
      list.append(
        ...next.map((entry) =>
          h(
            'button',
            {
              class: `reader__toc-item${entry.parentTocId != null ? ' is-child' : ''}`,
              onclick: () => this.#goToPage(entry.pageId),
            },
            h('span', { class: 'truncate', dir: CONTENT_DIR }, entry.title),
            h(
              'span',
              { class: 'label-sm muted' },
              // jamais `pageId` : c'est l'identifiant source, global au corpus
              t('reader.page', { page: entry.printedPageNum ?? entry.pageSequenceNum ?? '' }),
            ),
          ),
        ),
      );
      shown += next.length;
      more.replaceChildren(
        shown < matches.length
          ? h(
              'button',
              { class: 'button button--tonal', onclick: grow },
              h('span', {}, t('reader.showMore', { count: matches.length - shown })),
            )
          : h('span', {}),
      );
    };

    const apply = (term) => {
      const needle = normalizeArabic(term ?? '');
      matches = needle
        ? this.#toc.filter((entry) => normalizeArabic(entry.title ?? '').includes(needle))
        : this.#toc;
      shown = 0;
      list.replaceChildren();
      if (!matches.length) {
        list.append(
          h(
            'p',
            { class: 'label-md muted' },
            t(this.#toc.length ? 'reader.tocNoMatch' : 'reader.tocMissing'),
          ),
        );
        more.replaceChildren();
        return;
      }
      grow();
    };

    let timer = null;
    const field = h('input', {
      type: 'search',
      class: 'reader__search-field',
      placeholder: t('reader.tocSearch'),
      oninput: (event) => {
        clearTimeout(timer);
        const value = event.target.value;
        timer = setTimeout(() => apply(value), 200);
      },
    });

    apply('');

    return h(
      'aside',
      { class: 'reader__toc reader__panel' },
      h(
        'div',
        { class: 'reader__panel-head' },
        h('h2', { class: 'title-md' }, t('reader.tocTitle')),
        h(
          'button',
          { class: 'reader__tool', title: t('action.close'), onclick: () => this.#closePanels() },
          icon('close', { size: 20 }),
        ),
      ),
      this.#toc.length > TOC_WINDOW
        ? h('div', { class: 'reader__search-box' }, field)
        : null,
      list,
      more,
    );
  }

  /**
   * Panneau des annotations du livre : surlignages, notes et marques-pages,
   * dans l'ordre des pages. Il se redessine à chaque écriture plutôt que d'être
   * reconstruit — le panneau peut rester ouvert pendant qu'on annote.
   */
  #annotationsPanel(refs) {
    const tabs = h('div', { class: 'reader__annotation-tabs' });
    const list = h('div', { class: 'reader__panel-body reader__annotations' });
    refs.annotationsList = list;
    refs.annotationsTabs = tabs;

    return h(
      'aside',
      { class: 'reader__annotations-panel reader__panel' },
      h(
        'div',
        { class: 'reader__panel-head' },
        h('h2', { class: 'title-md' }, t('reader.notesTitle')),
        h(
          'button',
          { class: 'reader__tool', title: t('action.close'), onclick: () => this.#closePanels() },
          icon('close', { size: 20 }),
        ),
      ),
      tabs,
      list,
    );
  }

  /** Toutes les annotations du livre, page par page, dans un seul flux. */
  #drawAnnotations() {
    const list = this.#nodes.annotationsList;
    if (!list) return;

    const notesByHighlight = new Map(
      this.#annotations.notes
        .filter((note) => note.highlightId)
        .map((note) => [note.highlightId, note]),
    );

    const entries = [
      ...this.#annotations.highlights.map((highlight) => ({
        kind: 'highlight',
        pageId: highlight.pageId,
        highlight,
        note: notesByHighlight.get(highlight.highlightId) ?? null,
      })),
      ...this.#annotations.notes
        .filter((note) => !note.highlightId)
        .map((note) => ({ kind: 'note', pageId: note.pageId, note })),
      ...this.#annotations.bookmarks.map((bookmark) => ({
        kind: 'bookmark',
        pageId: bookmark.pageId,
        bookmark,
      })),
    ].sort((a, b) => (a.pageId ?? 0) - (b.pageId ?? 0));

    this.#drawAnnotationTabs(entries);

    // Un surlignage commenté compte pour les deux onglets : c'est la même
    // chose vue de deux côtés, la cacher sous « ملاحظات » serait un piège.
    const shown = entries.filter((entry) => {
      if (this.#annotationKind === 'all') return true;
      if (this.#annotationKind === 'note') return Boolean(entry.note ?? entry.kind === 'note');
      return entry.kind === this.#annotationKind;
    });

    if (!shown.length) {
      list.replaceChildren(
        h(
          'p',
          { class: 'label-md muted' },
          entries.length
            ? t('reader.annotationsNoneOfKind')
            : t('reader.annotationsEmpty'),
        ),
      );
      return;
    }

    list.replaceChildren(...shown.map((entry) => this.#annotationCard(entry)));
  }

  #drawAnnotationTabs(entries) {
    const tabs = this.#nodes.annotationsTabs;
    if (!tabs) return;

    const counts = {
      all: entries.length,
      highlight: entries.filter((entry) => entry.kind === 'highlight').length,
      note: entries.filter((entry) => Boolean(entry.note) || entry.kind === 'note').length,
      bookmark: entries.filter((entry) => entry.kind === 'bookmark').length,
    };

    tabs.replaceChildren(
      ...ANNOTATION_KINDS.map((kind) =>
        h(
          'button',
          {
            class: `reader__annotation-tab${kind.value === this.#annotationKind ? ' is-active' : ''}`,
            title: t(kind.label),
            onclick: () => {
              this.#annotationKind = kind.value;
              this.#drawAnnotations();
            },
          },
          icon(kind.icon, { size: 16 }),
          h('span', { class: 'label-sm' }, n(counts[kind.value] ?? 0)),
        ),
      ),
    );
  }

  /** Une entrée du panneau : ce qu'on a marqué, où, et de quoi l'amender. */
  #annotationCard(entry) {
    const open = () => entry.pageId != null && this.#goToPage(entry.pageId);
    const actions = h('div', { class: 'reader__annotation-actions' });
    const color = entry.highlight?.color ?? null;

    if (entry.kind === 'bookmark') {
      actions.append(
        this.#annotationAction('trash', t('action.delete'), async () => {
          try {
            await repository.deleteBookmark(entry.bookmark.bookmarkId);
          } catch (error) {
            toast(error?.message ?? t('reader.bookmarkDeleteFailed'));
            return;
          }
          this.#annotations.bookmarks = this.#annotations.bookmarks.filter(
            (item) => item.bookmarkId !== entry.bookmark.bookmarkId,
          );
          this.#afterAnnotationChange(entry.pageId);
        }),
      );
    } else if (entry.kind === 'highlight') {
      actions.append(
        this.#annotationAction('noteAdd', t(entry.note ? 'reader.editNote' : 'reader.addNote'), () =>
          this.#editNote(entry.highlight, entry.note),
        ),
        this.#annotationAction('trash', t('reader.deleteHighlight'), () =>
          this.#removeHighlight(entry.highlight),
        ),
      );
    } else {
      actions.append(
        this.#annotationAction('noteAdd', t('notes.edit'), () => this.#editNote(null, entry.note)),
        this.#annotationAction('trash', t('action.delete'), () => this.#removeNote(entry.note)),
      );
    }

    // Entête : de quoi il s'agit, puis la page — la même grammaire pour les
    // trois types, pour qu'une liste mêlée se lise d'un coup d'œil.
    const head = h(
      'div',
      { class: 'reader__annotation-head' },
      color
        ? h('span', { class: 'reader__annotation-dot', style: { background: color } })
        : icon(entry.kind === 'bookmark' ? 'bookmark' : 'noteAdd', { size: 14 }),
      h(
        'span',
        { class: 'label-sm' },
        t(
          entry.kind === 'bookmark'
            ? 'reader.kindBookmark'
            : entry.note
              ? 'reader.kindNote'
              : 'reader.kindHighlight',
        ),
      ),
      h('span', { class: 'reader__annotation-page label-sm' }, this.#pageLabelFor(entry.pageId)),
    );

    const body =
      entry.kind === 'bookmark'
        ? h(
            'p',
            { class: 'body-md', dir: USER_DIR },
            entry.bookmark.label ?? t('reader.savedPosition'),
          )
        : h(
            'div',
            { class: 'reader__annotation-text' },
            entry.highlight &&
              h(
                'p',
                {
                  class: 'reader__annotation-quote',
                  dir: CONTENT_DIR,
                  style: { '--highlight-color': entry.highlight.color },
                },
                entry.highlight.selectedText,
              ),
            entry.note && h('p', { class: 'body-md', dir: USER_DIR }, entry.note.content),
          );

    return h(
      'article',
      { class: `reader__annotation is-${entry.kind}` },
      h('button', { class: 'reader__annotation-open', onclick: open }, head, body),
      actions,
    );
  }

  #annotationAction(name, title, onclick) {
    return h(
      'button',
      { class: 'button--icon', title, 'aria-label': title, onclick },
      icon(name, { size: 18 }),
    );
  }

  /**
   * Numéro affichable d'une page à partir de son identifiant. Le sommaire porte
   * déjà la correspondance ; `pageId` lui-même ne se montre jamais.
   */
  #pageLabelFor(pageId) {
    if (pageId == null) return '';
    // Deux index, construits à la demande puis gardés : le panneau appelle
    // ceci une fois par annotation, et un livre peut porter des milliers
    // d'entrées de sommaire comme de pages en cache.
    this.#tocByPage ??= new Map(this.#toc.map((entry) => [entry.pageId, entry]));
    const entry = this.#tocByPage.get(pageId);
    const printed = entry?.printedPageNum ?? entry?.pageSequenceNum;
    if (printed != null) return t('reader.page', { page: printed });

    if (this.#pagesById?.size !== this.#pages.size) {
      this.#pagesById = new Map([...this.#pages.values()].map((item) => [item.pageId, item]));
    }
    const cached = this.#pagesById.get(pageId);
    const number = cached?.printedPageNum ?? cached?.sequenceNum;
    return number == null ? '' : t('reader.page', { page: number });
  }

  // ----------------------------------------------------------- annotations

  /**
   * Surlignages d'une page, marqués s'ils portent une note.
   *
   * L'index par page est construit une fois par écriture, pas une fois par
   * page affichée : en fil continu, quarante pages montées voulaient dire
   * quarante balayages de toutes les annotations du livre.
   */
  #highlightsFor(pageId) {
    if (!this.#highlightsByPage) {
      const noted = new Set(
        this.#annotations.notes.map((note) => note.highlightId).filter(Boolean),
      );
      this.#highlightsByPage = new Map();
      for (const highlight of this.#annotations.highlights) {
        const bucket = this.#highlightsByPage.get(highlight.pageId);
        const marked = { ...highlight, hasNote: noted.has(highlight.highlightId) };
        if (bucket) bucket.push(marked);
        else this.#highlightsByPage.set(highlight.pageId, [marked]);
      }
    }
    return this.#highlightsByPage.get(pageId) ?? [];
  }

  /**
   * Redessine le panneau, le signet, et **la seule page touchée**.
   *
   * Repeindre toutes les pages montées était tenable tant que le fil n'en
   * gardait qu'une tranche ; il porte maintenant le livre entier, et poser une
   * teinte sur trois mots relançait `renderBookHtml` sur des milliers de pages.
   * [pageId] est toujours connu de l'appelant — une annotation appartient à une
   * page. Nul par prudence : tout est repeint, ce qui est lent mais jamais faux.
   */
  #afterAnnotationChange(pageId = null) {
    this.#highlightsByPage = null;
    this.#drawAnnotations();
    this.#syncBookmark(pageId);
    const block = this.#block;
    if (block && (pageId == null || block.page.pageId === pageId)) this.#paintBlock(block);
  }

  /** Repeint le contenu d'une page montée : recherche puis annotations. */
  #paintBlock(block) {
    block.body.replaceChildren(renderBookHtml(block.page.bodyHtml));
    this.#applyHighlight(block.body);
    paintHighlights(block.body, this.#highlightsFor(block.page.pageId), {
      onClick: (highlight) => this.#openHighlight(highlight),
    });
  }

  /** Clic sur un passage surligné : sa note, sinon l'occasion d'en écrire une. */
  #openHighlight(highlight) {
    const note = this.#annotations.notes.find(
      (item) => item.highlightId === highlight.highlightId,
    );
    this.#editNote(highlight, note ?? null);
  }

  async #addHighlight(color) {
    const selected = this.#pendingSelection;
    const page = this.#pendingPage;
    this.#hideSelection();
    if (!selected || !page) return null;

    try {
      const saved = await repository.saveHighlight({
        editionId: this.#editionId,
        pageId: page.pageId,
        ...selected,
        color,
      });
      this.#annotations.highlights = [
        ...this.#annotations.highlights.filter((item) => item.highlightId !== saved.highlightId),
        saved,
      ];
      this.#afterAnnotationChange(page.pageId);
      return saved;
    } catch (error) {
      toast(error?.message ?? t('reader.highlightSaveFailed'));
      return null;
    }
  }

  /**
   * Écrit ou modifie une note. Une note attachée à un surlignage disparaît avec
   * lui ; une note de page vit seule.
   */
  async #editNote(highlight, existing) {
    const content = await noteDialog({
      title: t(existing ? 'reader.editNote' : 'reader.addNote'),
      quote: highlight?.selectedText ?? null,
      value: existing?.content ?? '',
      canDelete: Boolean(existing),
    });
    if (content === null) return;
    if (content === '') {
      if (existing) await this.#removeNote(existing);
      return;
    }

    try {
      const saved = await repository.saveNote({
        noteId: existing?.noteId ?? null,
        editionId: this.#editionId,
        pageId: highlight?.pageId ?? existing?.pageId ?? this.#page?.pageId ?? null,
        highlightId: highlight?.highlightId ?? existing?.highlightId ?? null,
        content,
      });
      this.#annotations.notes = [
        ...this.#annotations.notes.filter((note) => note.noteId !== saved.noteId),
        saved,
      ];
      this.#afterAnnotationChange(saved.pageId);
      toast(t('reader.noteSaved'));
    } catch (error) {
      toast(error?.message ?? t('reader.noteSaveFailed'));
    }
  }

  async #removeNote(note) {
    try {
      await repository.deleteNote(note.noteId);
    } catch (error) {
      toast(error?.message ?? t('reader.noteDeleteFailed'));
      return;
    }
    this.#annotations.notes = this.#annotations.notes.filter(
      (item) => item.noteId !== note.noteId,
    );
    this.#afterAnnotationChange(note.pageId);
  }

  async #removeHighlight(highlight) {
    const hasNote = this.#annotations.notes.some(
      (note) => note.highlightId === highlight.highlightId,
    );
    if (hasNote) {
      const choice = await confirmDialog({
        title: t('reader.deleteHighlightTitle'),
        message: t('reader.deleteHighlightMessage'),
        actions: [{ value: 'go', label: t('action.delete'), variant: 'danger' }],
      });
      if (choice !== 'go') return;
    }
    try {
      await repository.deleteHighlight(highlight.highlightId);
    } catch (error) {
      toast(error?.message ?? t('reader.highlightDeleteFailed'));
      return;
    }
    this.#annotations.highlights = this.#annotations.highlights.filter(
      (item) => item.highlightId !== highlight.highlightId,
    );
    this.#annotations.notes = this.#annotations.notes.filter(
      (note) => note.highlightId !== highlight.highlightId,
    );
    this.#afterAnnotationChange(highlight.pageId);
  }

  async #toggleBookmark() {
    if (!this.#page) return;
    const page = this.#page;
    try {
      const result = await repository.toggleBookmark({
        editionId: this.#editionId,
        pageId: page.pageId,
        label:
          this.#chapterFor(page) ??
          t('reader.page', { page: page.printedPageNum ?? page.sequenceNum }),
      });
      this.#annotations.bookmarks = result.added
        ? [...this.#annotations.bookmarks, result.bookmark]
        : this.#annotations.bookmarks.filter((item) => item.pageId !== page.pageId);
      this.#afterAnnotationChange(page.pageId);
      toast(t(result.added ? 'reader.bookmarkAdded' : 'reader.bookmarkRemoved'));
    } catch (error) {
      toast(error?.message ?? t('reader.bookmarkSaveFailed'));
    }
  }

  #isBookmarked(pageId) {
    return this.#annotations.bookmarks.some((item) => item.pageId === pageId);
  }

  /**
   * L'icône dit si la page courante porte une marque, et la page montée arbore
   * son signet : sans repère dans le texte, le bouton avait l'air de ne rien
   * faire.
   */
  #syncBookmark(pageId = null) {
    const block = this.#block;
    if (block && (pageId == null || block.page.pageId === pageId)) {
      block.root.classList.toggle('is-bookmarked', this.#isBookmarked(block.page.pageId));
    }
    this.#syncBookmarkButton();
  }

  /** L'icône de la barre haute seule : ce que la page courante change. */
  #syncBookmarkButton() {
    const button = this.#nodes.bookmarkButton;
    if (!button || !this.#page) return;
    const marked = this.#isBookmarked(this.#page.pageId);
    button.classList.toggle('is-active', marked);
    button.replaceChildren(icon('bookmark', { size: 20, fill: marked }));
    button.title = t(marked ? 'reader.bookmarkRemove' : 'reader.bookmarkTool');
  }

  /**
   * Recherche dans le livre. `pages_fts` n'est pas interrogeable — le build
   * sql.js embarqué ne contient pas FTS5 — le dépôt cherche donc sur les
   * colonnes normalisées `body_search` et `title_normalized`.
   */
  #searchPanel(refs) {
    const results = h('div', { class: 'reader__panel-body reader__search-results' });
    const summary = h('p', { class: 'label-sm muted' }, t('reader.searchTooShort'));
    let timer = null;

    const field = h('input', {
      type: 'search',
      class: 'reader__search-field',
      placeholder: t('reader.searchField'),
      oninput: () => {
        clearTimeout(timer);
        timer = setTimeout(() => this.#runSearch(field.value, { results, summary }), 250);
      },
    });

    refs.searchField = field;

    return h(
      'aside',
      { class: 'reader__search reader__panel' },
      h(
        'div',
        { class: 'reader__panel-head' },
        h('h2', { class: 'title-md' }, t('reader.searchTitle')),
        h(
          'button',
          { class: 'reader__tool', title: t('action.close'), onclick: () => this.#closePanels() },
          icon('close', { size: 20 }),
        ),
      ),
      h('div', { class: 'reader__search-box' }, field, summary),
      results,
    );
  }

  async #runSearch(term, { results, summary }) {
    const trimmed = term.trim();
    if (trimmed.length < 2) {
      this.#highlight = null;
      summary.textContent = t('reader.searchTooShort');
      results.replaceChildren();
      return;
    }

    summary.textContent = t('reader.searching');
    let found;
    try {
      found = await repository.searchInBook(this.#editionId, trimmed, { limit: 60 });
    } catch {
      summary.textContent = t('reader.searchFailed');
      return;
    }

    this.#highlight = arabicSearchPattern(trimmed);
    const total = found.chapters.length + found.pages.length;
    summary.textContent = total
      ? t('pagination.results', { total })
      : t('reader.searchNone');

    // Les chapitres d'abord : trouver un titre vaut mieux qu'une occurrence
    // perdue au milieu d'une page.
    results.replaceChildren(
      ...found.chapters.map((entry) =>
        h(
          'button',
          { class: 'reader__result is-chapter', onclick: () => this.#goToPage(entry.pageId) },
          h('span', { class: 'reader__result-title truncate', dir: CONTENT_DIR }, entry.title),
          h(
            'span',
            { class: 'label-sm muted' },
            t('reader.page', { page: entry.printedPageNum ?? entry.sequenceNum }),
          ),
        ),
      ),
      ...found.pages.map((entry) =>
        h(
          'button',
          { class: 'reader__result', onclick: () => this.#goToPage(entry.pageId) },
          h(
            'p',
            { class: 'reader__result-snippet', dir: CONTENT_DIR },
            entry.snippet.before,
            h('mark', {}, entry.snippet.match),
            entry.snippet.after,
          ),
          h(
            'span',
            { class: 'label-sm muted' },
            t('reader.page', { page: entry.printedPageNum ?? entry.sequenceNum }),
          ),
        ),
      ),
    );
  }

  /**
   * Enveloppe les occurrences du terme cherché dans la page affichée. On
   * parcourt les nœuds de texte plutôt que de manipuler du HTML : le contenu du
   * livre n'est jamais réinterprété.
   */
  #applyHighlight(root) {
    if (!this.#highlight) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const targets = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeValue.trim()) targets.push(node);
    }

    for (const node of targets) {
      const text = node.nodeValue;
      this.#highlight.lastIndex = 0;
      const fragment = document.createDocumentFragment();
      let cursor = 0;
      let match;
      while ((match = this.#highlight.exec(text))) {
        if (match.index > cursor) {
          fragment.append(document.createTextNode(text.slice(cursor, match.index)));
        }
        // Classé : sans cela le fond de recherche l'emporterait, par
        // spécificité, sur la couleur choisie pour un surlignage.
        fragment.append(h('mark', { class: 'reader__match' }, match[0]));
        cursor = match.index + match[0].length;
        // Un motif capable de correspondre au vide bouclerait sans fin.
        if (match[0].length === 0) this.#highlight.lastIndex += 1;
      }
      if (!cursor) continue;
      if (cursor < text.length) fragment.append(document.createTextNode(text.slice(cursor)));
      node.replaceWith(fragment);
    }
  }

  /** Menu contextuel de sélection, calqué sur la maquette (V2). */
  #selectionMenu() {
    const item = (name, label, onclick) =>
      h(
        'button',
        { class: 'reader__selection-item', onclick },
        icon(name, { size: 20 }),
        h('span', { class: 'label-md' }, label),
      );

    return h(
      'aside',
      { class: 'reader__selection' },
      // Une note sans surlignage flotterait sans ancre : on pose d'abord le
      // passage, puis on écrit dessus.
      item('noteAdd', t('reader.addNote'), async () => {
        const highlight = await this.#addHighlight(HIGHLIGHTS[0].color);
        if (highlight) this.#editNote(highlight, null);
      }),
      item('copy', t('reader.copy'), () => this.#copySelection()),
      // Pas d'entrée « traduire » : elle n'ouvrait qu'un message d'attente. Un
      // outil qui annonce son propre chantier prend la place d'un doigt et
      // n'apprend rien qu'on ne sache après le premier essai.
      item('search', t('reader.searchTitle'), () => this.#searchSelection()),
      h(
        'div',
        { class: 'reader__highlights' },
        HIGHLIGHTS.map((entry) =>
          h('button', {
            title: t('reader.highlightWith', { color: t(entry.label) }),
            'aria-label': t('reader.highlightWith', { color: t(entry.label) }),
            style: { background: entry.color },
            onclick: () => this.#addHighlight(entry.color),
          }),
        ),
      ),
    );
  }

  /** Le texte sélectionné devient le terme cherché, panneau ouvert. */
  #searchSelection() {
    const term = this.#pendingSelection?.selectedText?.trim() ?? '';
    this.#hideSelection();
    if (!term) return;
    if (!this.#nodes.searchPanel.classList.contains('is-open')) this.#togglePanel('search');
    const field = this.#nodes.searchField;
    if (!field) return;
    field.value = term;
    field.dispatchEvent(new Event('input'));
  }

  // ---------------------------------------------------------------- pages

  async #pageAt(index) {
    if (this.#pages.has(index)) return this.#pages.get(index);
    const offset = Math.floor(index / PAGE_WINDOW) * PAGE_WINDOW;
    const pages = await repository.getPages(this.#editionId, {
      offset,
      limit: PAGE_WINDOW,
    });
    pages.forEach((page, position) => this.#pages.set(offset + position, page));
    return this.#pages.get(index) ?? null;
  }

  /**
   * Monte une page : son titre de chapitre, son corps, ses notes de bas de
   * page, puis le pied imprimé.
   *
   * Chaque page rouvre son chapitre. C'est le seul repère de la feuille : on
   * n'y voit rien de ce qui précède, et taire le titre parce que la page
   * d'avant le portait laisserait le lecteur sans réponse à « où suis-je ».
   */
  #makeBlock(index, page) {
    const body = h('article', { class: 'reader__page', dir: CONTENT_DIR });
    const footnotes = h('aside', { class: 'reader__footnotes', dir: CONTENT_DIR });
    const chapter = h('h2', { class: 'reader__chapter', dir: CONTENT_DIR });
    const foot = h('div', { class: 'reader__page-foot label-sm' });
    const ribbon = h(
      'span',
      { class: 'reader__block-mark', title: t('reader.markedPage'), 'aria-hidden': 'true' },
      icon('bookmark', { size: 16, fill: true }),
    );

    const root = h(
      'section',
      { class: 'reader__block', 'data-index': String(index) },
      ribbon,
      chapter,
      body,
      footnotes,
      foot,
    );

    const title = this.#chapterFor(page);
    const block = { index, page, root, body, chapter, footnotes, foot, title };
    chapter.textContent = title ?? '';
    chapter.style.display = title ? '' : 'none';

    if (page.footnotes) {
      footnotes.replaceChildren(document.createTextNode(page.footnotes));
    } else {
      footnotes.style.display = 'none';
    }

    // `printed` est le numéro imprimé dans l'édition papier, `index` la
    // position dans le fichier : les deux diffèrent presque toujours, on ne
    // les mélange donc jamais dans un même « N sur M ».
    const printed = page.printedPageNum ?? page.sequenceNum;
    foot.textContent =
      t('reader.pageOf', { index: index + 1, total: this.#pageCount }) +
      t('reader.printedPage', { printed });

    root.classList.toggle('is-bookmarked', this.#isBookmarked(page.pageId));
    this.#paintBlock(block);
    return block;
  }

  // ------------------------------------------------------------- affichage

  /** Une page monte, l'ancienne s'en va. C'est la seule façon de lire. */
  async #show(index, { save = true } = {}) {
    index = clamp(index, 0, Math.max(0, this.#pageCount - 1));
    const page = await this.#pageAt(index);
    if (!page) return;

    // Sens du feuilletage. En RTL on avance vers la gauche : la page qui arrive
    // vient donc du bord gauche quand on avance, du bord droit quand on revient.
    // Une page rouverte au même rang — changement d'ambiance, de taille, de
    // police — ne bouge pas : rien n'a tourné.
    const turn = index === this.#index ? 0 : Math.sign(index - this.#index);

    const block = this.#makeBlock(index, page);
    this.#block = block;
    this.#nodes.flow.replaceChildren(block.root);
    if (turn) {
      block.root.classList.add(turn > 0 ? 'is-turned-next' : 'is-turned-previous');
    }
    // Une page imprimée dépasse souvent la hauteur de l'écran : la colonne
    // garde son défilement, et une page qui arrive s'ouvre à son début.
    this.#nodes.scroll.scrollTop = 0;
    this.#nodes.lastScroll = 0;
    this.#setCurrent(index, page, { save });
  }

  /** Synchronise la barre basse, le signet et la progression sur [index]. */
  #setCurrent(index, page, { save = true } = {}) {
    const changed = this.#index !== index || this.#page?.pageId !== page.pageId;
    this.#index = index;
    this.#page = page;

    this.#nodes.slider.value = String(index + 1);
    this.#nodes.pagerCurrent.textContent = n(index + 1);
    this.#nodes.pagerTotal.textContent = n(this.#pageCount);
    const done = Math.round(this.#percent() * 100);
    this.#nodes.percent.textContent = t('format.percent', { value: done });
    // Le rail n'a pas de remplissage natif une fois `appearance: none` posé :
    // c'est un dégradé, mis à jour ici, qui joue ce rôle.
    this.#nodes.root.style.setProperty('--reader-fill', `${done}%`);
    this.#nodes.previous.disabled = index === 0;
    this.#nodes.next.disabled = index >= this.#pageCount - 1;

    this.#syncBookmarkButton();
    if (changed) {
      this.#pendingSelection = null;
      this.#pendingPage = null;
      this.#hideSelection();
    }
    // La page qui arrive ramène les barres : c'est le moment où l'on regarde
    // où l'on en est.
    this.#showChrome();
    if (save) this.#scheduleSave(page);
    else this.#save(page);
  }

  #move(direction) {
    this.#show(this.#index + direction);
  }

  async #goToPage(pageId) {
    this.#closePanels();
    const page = await repository.getPageById(this.#editionId, pageId).catch(() => null);
    if (page) this.#show(page.sequenceNum - 1);
    else toast(t('reader.openPageFailed'));
  }

  /**
   * Le chapitre qui couvre [page] : la dernière entrée du sommaire dont la
   * page d'ouverture ne dépasse pas la sienne.
   *
   * Par dichotomie, et non par balayage. Le fil monte le livre entier, et cette
   * question se pose une fois par page montée : au balayage, le corpus donne
   * 54 millions de tours au 99ᵉ centile de `pages × sommaire`, et 17 milliards
   * sur le plus gros livre. Le sommaire est trié par `pageId` croissant —
   * l'ancien balayage s'arrêtait au premier dépassement, il le supposait déjà.
   */
  #chapterFor(page) {
    const toc = this.#toc;
    if (!toc.length) return null;
    let low = 0;
    let high = toc.length - 1;
    let found = null;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (toc[middle].pageId <= page.pageId) {
        found = toc[middle];
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return found?.title ?? null;
  }

  #percent() {
    if (this.#pageCount <= 1) return 1;
    return (this.#index + 1) / this.#pageCount;
  }

  #scheduleSave(page) {
    clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => this.#save(page), 400);
  }

  #save(page) {
    repository
      .saveProgress({
        editionId: this.#editionId,
        pageId: page.pageId,
        sequenceNum: page.sequenceNum,
        percent: this.#percent(),
        updatedAt: new Date().toISOString(),
      })
      .catch(() => toast(t('reader.progressSaveFailed')));
  }

  // ------------------------------------------------------------- réglages

  #setSize(value) {
    this.#applySize(value);
    setSetting('reader.fontSize', this.#prefs.size);
  }

  /**
   * Poser la taille sans l'écrire.
   *
   * Le pincement en produit une par image : l'écrire à chaque pas enverrait des
   * dizaines d'écritures dans `user.sqlite` pour un seul geste, et `user.sqlite`
   * s'écrit de côté puis se renomme — c'est le fichier qu'on ne peut pas
   * retélécharger. Elle s'écrit une fois, quand les doigts se lèvent.
   */
  #applySize(value) {
    const size = clampSize(value);
    this.#prefs.size = size;
    this.#nodes.root.style.setProperty('--reader-size', `${size}px`);
    this.#nodes.sizeValue.textContent = String(size);
    this.#nodes.sizeSlider.value = String(size);
  }

  #setFont(key) {
    this.#prefs.font = key;
    for (const font of FONTS) {
      this.#nodes.root.classList.toggle(`reader--font-${font.key}`, font.key === key);
    }
    this.#nodes.fontButtons.forEach((button, index) => {
      const isActive = FONTS[index].key === key;
      button.classList.toggle('is-active', isActive);
      const check = button.querySelector('svg');
      if (isActive && !check) button.append(icon('check', { size: 16 }));
      if (!isActive && check) check.remove();
    });
    setSetting('reader.font', key);
  }

  // ------------------------------------------------------------- panneaux

  /** Les panneaux sont exclusifs : ouvrir l'un referme les autres. */
  #panelNodes() {
    return {
      settings: this.#nodes.panel,
      toc: this.#nodes.tocPanel,
      search: this.#nodes.searchPanel,
      annotations: this.#nodes.annotationsPanel,
    };
  }

  #togglePanel(which) {
    const panels = this.#panelNodes();
    const target = panels[which];
    if (!target) return;
    for (const [key, node] of Object.entries(panels)) {
      if (key !== which) node.classList.remove('is-open');
    }
    const opened = target.classList.toggle('is-open');
    this.#nodes.root.classList.toggle('has-panel', opened);
    if (opened && which === 'search') this.#nodes.searchField?.focus();
    if (opened && which === 'annotations') this.#drawAnnotations();
  }

  #closePanels() {
    for (const node of Object.values(this.#panelNodes())) node.classList.remove('is-open');
    this.#nodes.root.classList.remove('has-panel');
  }

  #panelsOpen() {
    return Object.values(this.#panelNodes()).some((node) => node.classList.contains('is-open'));
  }

  /**
   * La fiche est posée sur `body` : un changement de route ne l'emporterait
   * pas, c'est au lecteur de la ranger quand il s'en va.
   *
   * Plus aucun outil ne l'ouvre — elle se consulte depuis `/settings`. Seule
   * la touche `؟` la déclenche encore, et qui a la touche a le clavier dont
   * elle parle.
   */
  #showShortcuts() {
    this.#closeShortcuts?.();
    this.#closeShortcuts = openShortcuts();
  }

  /**
   * Bascule le ruban de pagination, et l'écrit : c'est le même réglage que
   * celui de `/settings`, deux portes pour une seule valeur — comme la touche
   * `V` et le mode de lecture.
   */
  #togglePager() {
    this.#setPagerLayout(this.#prefs.pager === 'vertical' ? 'horizontal' : 'vertical');
  }

  #setPagerLayout(key) {
    if (resolvePagerLayout(key) !== key || key === this.#prefs.pager) return;
    this.#prefs.pager = key;
    for (const layout of PAGER_LAYOUTS) {
      this.#nodes.root.classList.toggle(`reader--pager-${layout.key}`, layout.key === key);
    }
    this.#syncPager();
    setSetting('reader.pager', key);
  }

  /**
   * Ce que la disposition change dans le dessin : les deux chevrons de
   * feuilletage et l'icône de l'outil.
   *
   * Couchés, les chevrons désignent le début et la fin de *ligne* et suivent
   * donc le sens d'écriture ; dressés, ils désignent le haut et le bas et sont
   * figés — une flèche de direction d'écriture y annoncerait un geste qu'on ne
   * fait pas. L'outil, lui, montre la disposition qu'on **obtiendra**, comme
   * celui du plein écran : celle qui est en place, on la voit déjà.
   */
  #syncPager() {
    const dresse = this.#prefs.pager === 'vertical';
    this.#nodes.previous.replaceChildren(
      dresse ? icon('chevronUp', { size: 20 }) : chevronBackward({ size: 20 }),
    );
    this.#nodes.next.replaceChildren(
      dresse ? icon('chevronDown', { size: 20 }) : chevronForward({ size: 20 }),
    );
    const button = this.#nodes.pagerButton;
    button.replaceChildren(icon(dresse ? 'pagerHorizontal' : 'pagerVertical', { size: 20 }));
    button.title = t(dresse ? 'reader.pagerToHorizontal' : 'reader.pagerToVertical');
  }

  #toggleFullscreen() {
    if (!this.#fullscreen) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  }

  #syncFullscreen() {
    const on = Boolean(document.fullscreenElement);
    const button = this.#nodes.fullscreenButton;
    if (!button) return;
    button.replaceChildren(icon(on ? 'fullscreenExit' : 'fullscreen', { size: 20 }));
    button.title = t(on ? 'reader.fullscreenExit' : 'reader.fullscreen');
  }

  // ------------------------------------------------------------ sélection

  /** La page montée, si [node] est dans son corps ; `null` sinon. */
  #blockOf(node) {
    const block = this.#block;
    return block && block.body.contains(node) ? block : null;
  }

  #onSelection() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      this.#hideSelection();
      return;
    }

    // En fil continu la sélection n'est pas forcément sur la page courante :
    // c'est la page qui la porte qui ancre l'annotation.
    const block = this.#blockOf(selection.anchorNode);
    if (!block) return;

    // Mesurée maintenant : le premier clic dans le menu défait la sélection.
    this.#pendingSelection = describeSelection(block.body);
    if (!this.#pendingSelection) return;
    this.#pendingPage = block.page;

    const rect = selection.getRangeAt(0).getBoundingClientRect();
    if (!rect.width && !rect.height) return;

    const menu = this.#nodes.selection;
    menu.classList.add('is-open');
    // La feuille est ancrée dans le lecteur, lui-même en `fixed inset: 0` :
    // les coordonnées de la sélection s'y transposent telles quelles.
    const width = menu.offsetWidth || 256;
    const height = menu.offsetHeight || 260;
    const below = rect.bottom + 12 + height < window.innerHeight;
    menu.style.left = `${clamp(rect.left + rect.width / 2 - width / 2, 12, window.innerWidth - width - 12)}px`;
    menu.style.top = `${below ? rect.bottom + 12 : Math.max(12, rect.top - height - 12)}px`;
  }

  #hideSelection() {
    this.#nodes.selection?.classList.remove('is-open');
  }

  async #copySelection() {
    const text =
      window.getSelection()?.toString() || this.#pendingSelection?.selectedText || '';
    this.#hideSelection();
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
      toast(t('reader.copied'));
    } catch {
      toast(t('reader.copyFailed'));
    }
  }

  // -------------------------------------------------------- interactions

  #onKey(event) {
    if (event.key === 'Escape') {
      if (this.#nodes.selection.classList.contains('is-open')) this.#hideSelection();
      else if (this.#panelsOpen()) this.#closePanels();
      else if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else back();
      return;
    }
    // Là où le plein écran n'est pas offert, la touche n'est pas non plus
    // interceptée : mieux vaut la laisser au système que l'avaler pour rien.
    if (event.key === 'F11' && this.#fullscreen) {
      event.preventDefault();
      this.#toggleFullscreen();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      if (!this.#nodes.searchPanel.classList.contains('is-open')) this.#togglePanel('search');
      else this.#nodes.searchField?.focus();
      return;
    }
    // Les raccourcis de navigation ne doivent pas voler la frappe du champ.
    if (event.target instanceof HTMLInputElement) return;
    if (event.target instanceof HTMLTextAreaElement) return;
    if (event.ctrlKey && (event.key === '+' || event.key === '=')) {
      event.preventDefault();
      this.#setSize(this.#prefs.size + 2);
      return;
    }
    if (event.ctrlKey && event.key === '-') {
      event.preventDefault();
      this.#setSize(this.#prefs.size - 2);
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    // Lettres nues : les gestes qu'on répète le plus, dits par la fiche « ؟ ».
    switch (event.key.toLowerCase()) {
      case 'b':
        event.preventDefault();
        this.#toggleBookmark();
        return;
      case 'n':
        event.preventDefault();
        this.#togglePanel('annotations');
        return;
      case 'c':
        event.preventDefault();
        this.#togglePanel('toc');
        return;
      case '?':
      case '؟':
        event.preventDefault();
        this.#showShortcuts();
        return;
      default:
        break;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      this.#show(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      this.#show(this.#pageCount - 1);
      return;
    }
    // Le feuilletage suit la direction de l'interface, comme les deux chevrons
    // de la barre basse : en arabe la page suivante est à gauche, en anglais à
    // droite. Une flèche figée ferait reculer le bouton qui avance.
    const forward = isRtl() ? 'ArrowLeft' : 'ArrowRight';
    const backward = isRtl() ? 'ArrowRight' : 'ArrowLeft';
    if (event.key === forward || event.key === 'PageDown') this.#move(1);
    if (event.key === backward || event.key === 'PageUp') this.#move(-1);
  }

  #onWheel(event) {
    if (!event.ctrlKey) return;
    event.preventDefault();
    this.#setSize(this.#prefs.size + (event.deltaY < 0 ? 1 : -1));
  }

  /**
   * Un clic sur le texte. Trois zones, et rien d'autre : le tiers où la ligne
   * **commence** ramène en arrière, celui où elle **finit** avance, le tiers du
   * milieu escamote les barres ou referme un panneau.
   *
   * Les gardes viennent d'abord, et leur ordre est celui des défauts vécus.
   */
  #onContentClick(event) {
    // Ce qui a déjà son geste : un bouton, un lien, un passage surligné (qui
    // ouvre sa note), la feuille des couleurs.
    if (event.target.closest('button, a, input, mark, .reader__selection')) return;

    // Un glissement laisse souvent un `click` derrière lui : la page a déjà
    // tourné, elle ne doit pas tourner deux fois pour un seul geste.
    if (this.#swiped) {
      this.#swiped = false;
      return;
    }

    // Une tape qui **défait** une sélection ne fait que cela. Elle ne tourne
    // pas la page et ne rappelle pas les barres : c'est le geste qu'on fait
    // pour revenir au texte.
    //
    // L'état vient du `pointerdown`, pas d'ici : le navigateur défait la
    // sélection entre `mousedown` et `mouseup`, et la lire maintenant montre
    // toujours du vide. C'est pour cela que les barres ressortaient à la
    // moindre touche sur le texte, et qu'on ne pouvait plus rien sélectionner.
    const pressee = this.#selectionAtPress;
    this.#selectionAtPress = false;
    if (pressee) {
      this.#hideSelection();
      return;
    }

    // Un cliquer-glisser qui s'achève sur le texte laisse sa sélection vivante :
    // celle-là se lit encore ici, et l'interface ne doit pas bouger.
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    this.#hideSelection();
    this.#hideHint();

    // Un panneau ouvert se referme au premier contact avec le texte, où qu'on
    // touche : sa croix est à l'autre bout de l'écran, et revenir au livre est
    // de toute façon le geste qu'on fait ensuite. Tourner la page sous un
    // panneau ouvert ferait deux choses pour un seul geste.
    if (this.#panelsOpen()) {
      this.#closePanels();
      return;
    }

    const zone = this.#zoneOf(event.clientX);
    if (zone) {
      this.#move(zone);
      return;
    }

    this.#nodes.header.classList.toggle('is-hidden');
    this.#nodes.footer.classList.toggle('is-hidden');
  }

  /**
   * Le tiers de la colonne où tombe [clientX] : `-1` en arrière, `1` en avant,
   * `0` au milieu. La mesure est physique — le navigateur ne connaît que des
   * pixels depuis le bord gauche — et c'est `turnZone` qui la rend logique.
   */
  #zoneOf(clientX) {
    // Les côtés peuvent avoir été éteints depuis `/settings`. Le refus est posé
    // ici et non dans le clic : les trois tiers redeviennent alors un seul, et
    // toucher le bord escamote les barres au lieu de ne rien faire du tout —
    // une zone morte demanderait deux fois avant qu'on la croie voulue.
    if (this.#prefs.tapZones === 'off') return 0;
    const rect = this.#nodes.scroll.getBoundingClientRect();
    if (!rect.width) return 0;
    return turnZone((clientX - rect.left) / rect.width, isRtl());
  }

  /**
   * Départ d'un glissement.
   *
   * Le doigt et le stylet seulement : à la souris, un déplacement horizontal
   * sur du texte est une sélection, et tourner la page dessus rendrait le
   * texte insélectionnable. La souris a les trois zones, les deux chevrons et
   * les flèches du clavier — elle ne manque de rien.
   *
   * Un geste qui commence sur une sélection vivante est abandonné d'avance :
   * les poignées natives de sélection avalent les évènements tactiles
   * (`docs/spikes/react-native-contre-webview.md`), et ce qu'on croirait lire
   * serait un geste tronqué.
   */
  #onPointerDown(event) {
    // Le doigt est retenu avant toute garde : un second doigt n'est pas un
    // second glissement, mais c'est lui qui fait le pincement, et les gardes du
    // glissement l'auraient renvoyé sans le compter.
    if (event.pointerType !== 'mouse') {
      // Un doigt levé **hors** de la colonne n'y laisse pas de `pointerup` : il
      // resterait sur la carte, et le geste suivant croirait voir deux doigts.
      // Le premier doigt d'un geste est le seul instant sûr pour oublier ceux
      // qui traînent — et pour écrire la taille que le précédent avait posée.
      if (event.isPrimary) {
        this.#endPinch();
        this.#pointers.clear();
      }
      this.#pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.#pointers.size === 2) this.#startPinch();
    }
    this.#swipeFrom = null;
    // La trace du glissement précédent s'efface ici, et non au clic : un
    // glissement n'en laisse pas toujours un, et le drapeau resté levé aurait
    // avalé le prochain clic — celui d'un geste qui n'a rien à voir.
    this.#swiped = false;
    if (!event.isPrimary || event.pointerType === 'mouse') return;
    if (this.#selectionAtPress) return;
    this.#swipeFrom = { x: event.clientX, y: event.clientY, id: event.pointerId };
  }

  /**
   * Fin d'un glissement. `swipeTurn` dit s'il tourne quelque chose, et de quel
   * côté : trop court, trop vertical — c'est un défilement dans la page — ou
   * bien la page suit le sens où le texte s'écoule.
   */
  #onPointerUp(event) {
    const from = this.#swipeFrom;
    this.#swipeFrom = null;
    if (!from || event.pointerId !== from.id) return;
    // Une sélection posée par le geste n'est pas un glissement de page.
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;

    const sens = swipeTurn(event.clientX - from.x, event.clientY - from.y, isRtl());
    if (!sens) return;
    this.#swiped = true;
    this.#move(sens);
  }

  /**
   * Un doigt se lève, ou le navigateur reprend son pointeur.
   *
   * C'est ici que le pincement s'écrit, et une seule fois : dès qu'il ne reste
   * plus deux doigts, il n'y a plus de rapport à mesurer.
   */
  #endPointer(event) {
    this.#pointers.delete(event.pointerId);
    if (this.#pointers.size < 2) this.#endPinch();
  }

  /** Le pincement s'achève, et c'est le seul endroit où sa taille s'écrit. */
  #endPinch() {
    if (!this.#pinch) return;
    this.#pinch = null;
    setSetting('reader.fontSize', this.#prefs.size);
  }

  /**
   * Deux doigts posés : on retient l'écartement de départ **et** la taille de
   * départ. Le geste se mesure en rapport à ces deux-là, jamais au pas
   * précédent — cumuler les pas ferait dériver la taille sans que les doigts
   * bougent, chaque arrondi s'ajoutant au suivant.
   */
  #startPinch() {
    const spread = this.#spread();
    if (spread < PINCH_MIN_SPREAD) return;
    this.#pinch = { spread, size: this.#prefs.size };
    // Un pincement n'est pas un glissement : le geste ne peut pas tourner la
    // page en même temps qu'il change la lettre.
    this.#swipeFrom = null;
    this.#hideSelection();
  }

  /**
   * Le pincement en cours. La taille suit les doigts sans rien écrire —
   * `#endPointer` s'en charge quand ils se lèvent.
   */
  #onPointerMove(event) {
    const point = this.#pointers.get(event.pointerId);
    if (!point) return;
    point.x = event.clientX;
    point.y = event.clientY;
    if (!this.#pinch) return;
    const spread = this.#spread();
    if (!spread) return;
    // Le `click` que laisse le geste ne doit pas tourner la page, comme celui
    // que laisse un glissement.
    this.#swiped = true;
    this.#applySize(pinchSize(this.#pinch.size, spread / this.#pinch.spread));
  }

  /** L'écartement des deux premiers doigts posés, en pixels. */
  #spread() {
    const [a, b] = [...this.#pointers.values()];
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  /**
   * Le défilement **dans** une page : une feuille imprimée dépasse souvent la
   * hauteur de l'écran. Il n'y a rien d'autre à y faire que d'escamoter les
   * barres en descendant et de les rappeler en remontant.
   */
  #onScroll(scroll) {
    const top = scroll.scrollTop;
    this.#hideSelection();
    if (top > 100 && top > this.#nodes.lastScroll) {
      this.#nodes.header.classList.add('is-hidden');
      this.#nodes.footer.classList.add('is-hidden');
    } else if (top < this.#nodes.lastScroll) {
      this.#showChrome();
    }
    this.#nodes.lastScroll = top;
  }

  #showChrome() {
    this.#nodes.header?.classList.remove('is-hidden');
    this.#nodes.footer?.classList.remove('is-hidden');
  }

  #hideHint() {
    clearTimeout(this.#hintTimer);
    this.#nodes.hint?.classList.add('is-gone');
  }
}

function clamp(value, min, max) {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}
