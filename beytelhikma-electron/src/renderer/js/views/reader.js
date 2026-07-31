import { describeSelection, paintHighlights } from '../annotations.js';
import { renderBookHtml } from '../content-html.js';
import { h } from '../dom.js';
import { arabicNumber } from '../format.js';
import { icon } from '../icons.js';
import { repository, setSetting, settings } from '../repository.js';
import { back, navigate } from '../router.js';
import { toast } from '../shell.js';
import { confirmDialog, noteDialog, shortcutsDialog } from '../components/modal.js';
import { errorView, loadingView } from '../components/states.js';
import { arabicSearchPattern, normalizeArabic } from '../../../shared/arabic.js';

const PAGE_WINDOW = 20;
const MIN_FONT = 16;
const MAX_FONT = 34;
const HINT_DELAY = 4000;

/** Défilement continu : pages gardées de part et d'autre, et seuils de recharge. */
const FLOW_KEEP = 40;
const FLOW_STEP = 3;
const NEAR_START = 600;
const NEAR_END = 900;

/** Entrées de sommaire montées d'un coup ; au-delà, on déplie à la demande. */
const TOC_WINDOW = 80;

const THEMES = [
  { key: 'paper', label: 'رق إفتراضي', swatch: '#fbf9f4', dot: '#001614' },
  { key: 'white', label: 'أبيض ناصع', swatch: '#ffffff', dot: '#000000' },
  { key: 'night', label: 'الوضع الليلي', swatch: '#14150f', dot: '#d5d3ca' },
];

// Trois familles embarquées (voir `styles/fonts.css`). Amiri est le naskh de
// bibliothèque : c'est le défaut. Noto Naskh ouvre les contreformes pour qui
// trouve Amiri trop fin, IBM Plex reste la voix « écran ».
const FONTS = [
  { key: 'serif', label: 'أميري (خط المكتبة)', family: "'Amiri', serif" },
  { key: 'naskh', label: 'نسخ (أوضح)', family: "'Noto Naskh Arabic', serif" },
  { key: 'sans', label: 'حديث (شاشة)', family: "'IBM Plex Sans Arabic', sans-serif" },
];

/**
 * Deux façons de parcourir un livre : la page imprimée, une par écran — c'est
 * le défaut, et c'est ce que le corpus décrit — ou le fil continu, où les pages
 * s'enchaînent et où le pied de page ne fait plus que séparer.
 */
const MODES = [
  { key: 'page', label: 'صفحة صفحة', hint: 'كما في المطبوع', icon: 'book' },
  { key: 'scroll', label: 'تمرير متصل', hint: 'الصفحات تتوالى', icon: 'rows' },
];

/**
 * Palette « Serene Heritage » : les quatre teintes sortent des jetons du
 * projet (or antique, émeraude, argile, graphite) plutôt que d'un nuancier de
 * surligneur. Posées à faible opacité, elles teintent le fond sans jamais
 * toucher l'encre — le texte garde son contraste dans les trois ambiances.
 */
const HIGHLIGHTS = [
  { color: '#d9b26a', label: 'ذهبي' },
  { color: '#6a9e88', label: 'زمردي' },
  { color: '#c58a6b', label: 'طيني' },
  { color: '#8f9aa6', label: 'حجري' },
];

/** Onglets du panneau « ملاحظاتي » : le même vocabulaire que l'écran global. */
const ANNOTATION_KINDS = [
  { value: 'all', label: 'الكل', icon: 'notes' },
  { value: 'highlight', label: 'تظليل', icon: 'highlight' },
  { value: 'note', label: 'ملاحظات', icon: 'noteAdd' },
  { value: 'bookmark', label: 'علامات', icon: 'bookmark' },
];

const SHORTCUTS = [
  { keys: ['←'], label: 'الصفحة التالية' },
  { keys: ['→'], label: 'الصفحة السابقة' },
  { keys: ['Page ↓', 'Page ↑'], sep: '/', label: 'تنقّل بالصفحات' },
  { keys: ['Home', 'End'], sep: '/', label: 'أول الكتاب / آخره' },
  { keys: ['Ctrl', '+'], label: 'تكبير الخط' },
  { keys: ['Ctrl', '−'], label: 'تصغير الخط' },
  { keys: ['Ctrl', 'عجلة الفأرة'], label: 'حجم الخط' },
  { keys: ['Ctrl', 'F'], label: 'بحث في الكتاب' },
  { keys: ['B'], label: 'إشارة مرجعية على هذه الصفحة' },
  { keys: ['N'], label: 'لوحة ملاحظاتي' },
  { keys: ['C'], label: 'فهرس المحتويات' },
  { keys: ['V'], label: 'تبديل نمط القراءة (صفحة / تمرير)' },
  { keys: ['F11'], label: 'ملء الشاشة' },
  { keys: ['؟'], label: 'هذه اللائحة' },
  { keys: ['Esc'], label: 'إغلاق أو الخروج' },
];

/**
 * Lecteur : page imprimée par écran ou fil continu, sélection de texte native,
 * taille de police réglable, ambiances, progression écrite dans `user.sqlite`.
 * Disposition et jeu d'icônes calqués sur `ui-examples/reader V2.html`.
 */
export function readerView(host, params) {
  host.replaceChildren(loadingView('جارٍ فتح الكتاب…'));
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
  #prefs = { size: 22, theme: 'paper', font: 'serif', mode: 'page' };
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
   * Pages montées à l'écran, par position dans le livre. En mode page il n'y en
   * a qu'une ; en mode timer continu, une tranche glissante autour de la lecture.
   */
  #blocks = new Map();
  #first = 0;
  #last = -1;
  /** Une seule extension du fil à la fois, sinon les bornes se marchent dessus. */
  #extending = false;
  /** Page affichée, pour ancrer une annotation sans la rechercher. */
  #page = null;
  /**
   * Sélection décrite au moment où elle est faite : cliquer dans le menu la
   * défait, il est trop tard pour la mesurer. La page est retenue avec, car en
   * fil continu la sélection n'est pas forcément sur la page courante.
   */
  #pendingSelection = null;
  #pendingPage = null;
  /** Ferme la fiche des raccourcis, tant qu'elle est ouverte. */
  #closeShortcuts = null;
  #keyHandler = (event) => this.#onKey(event);
  #fullscreenHandler = () => this.#syncFullscreen();

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
      this.#annotations = annotations;

      this.#title = detail.summary.title;
      this.#pageCount = count;
      this.#toc = toc;
      this.#prefs = {
        size: clamp(Number(prefs['reader.fontSize'] ?? 22), MIN_FONT, MAX_FONT),
        theme: prefs['reader.theme'] ?? 'paper',
        font: prefs['reader.font'] ?? 'serif',
        mode: MODES.some((mode) => mode.key === prefs['reader.mode'])
          ? prefs['reader.mode']
          : 'page',
      };

      let index = (saved?.sequenceNum ?? 1) - 1;
      if (this.#requestedPageId) {
        const page = await repository.getPageById(this.#editionId, this.#requestedPageId);
        if (page) index = page.sequenceNum - 1;
      }
      this.#index = clamp(index, 0, Math.max(0, count - 1));

      this.#build();
      await this.#show(this.#index, { save: false });
      document.addEventListener('keydown', this.#keyHandler);
      document.addEventListener('fullscreenchange', this.#fullscreenHandler);
      this.#hintTimer = setTimeout(() => this.#hideHint(), HINT_DELAY);
    } catch (error) {
      // Livre supprimé pendant la lecture : la fiche, pas un écran d'erreur.
      if (String(error?.message ?? '').includes('livre non installé')) {
        navigate(`/book/${this.#editionId}`);
        return;
      }
      this.#host.replaceChildren(
        errorView(error, () => navigate(`/book/${this.#editionId}`)),
      );
    }
  }

  dispose() {
    document.removeEventListener('keydown', this.#keyHandler);
    document.removeEventListener('fullscreenchange', this.#fullscreenHandler);
    clearTimeout(this.#saveTimer);
    clearTimeout(this.#hintTimer);
    this.#closeShortcuts?.();
    this.#closeShortcuts = null;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }

  // ------------------------------------------------------------- structure

  #build() {
    // --- la page elle-même : entête discret, puis le fil des pages montées ---
    const pageHead = h(
      'div',
      { class: 'reader__page-head' },
      h('p', { class: 'headline-md' }, this.#title),
      h('span', { class: 'reader__hairline' }),
    );
    const flow = h('div', { class: 'reader__flow' });

    const scroll = h('div', { class: 'reader__scroll no-scrollbar' }, pageHead, flow);

    // --- barre haute : outils à droite (départ RTL), titre et fermeture à gauche ---
    // `data-tool` est le point d'accroche stable des captures et des tests :
    // les infobulles portent maintenant leur raccourci, elles bougent.
    const tool = (key, name, title, onclick) =>
      h(
        'button',
        { class: 'reader__tool', 'data-tool': key, title, onclick },
        icon(name, { size: 20 }),
      );

    const fullscreenButton = tool('fullscreen', 'fullscreen', 'ملء الشاشة', () =>
      this.#toggleFullscreen(),
    );
    const bookmarkButton = tool('bookmark', 'bookmark', 'إشارة مرجعية (B)', () =>
      this.#toggleBookmark(),
    );

    const header = h(
      'header',
      { class: 'reader__header' },
      h(
        'div',
        { class: 'reader__bar' },
        h(
          'div',
          { class: 'reader__tools' },
          tool('help', 'help', 'اختصارات القراءة (؟)', () => this.#showShortcuts()),
          tool('annotations', 'notes', 'ملاحظاتي في هذا الكتاب (N)', () =>
            this.#togglePanel('annotations'),
          ),
          bookmarkButton,
          tool('toc', 'bookOpen', 'فهرس المحتويات (C)', () => this.#togglePanel('toc')),
          tool('settings', 'formatSize', 'إعدادات القراءة', () => this.#togglePanel('settings')),
          tool('search', 'search', 'بحث في الكتاب (Ctrl+F)', () => this.#togglePanel('search')),
          fullscreenButton,
        ),
        h(
          'div',
          { class: 'reader__titles' },
          h('h1', { class: 'truncate' }, this.#title),
          tool('close', 'close', 'العودة للمكتبة', () => back()),
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
      title: 'موضع القراءة',
      oninput: (event) => this.#show(Number(event.target.value) - 1),
    });

    const previous = tool('previous', 'chevronRight', 'الصفحة السابقة', () => this.#move(-1));
    const next = tool('next', 'chevronLeft', 'الصفحة التالية', () => this.#move(1));
    const pagerLabel = h('span', { class: 'reader__pager-label label-md' });
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
      'انقر في وسط الصفحة لإخفاء الأدوات',
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
        class:
          `reader reader--${this.#prefs.theme} reader--font-${this.#prefs.font}` +
          ` reader--${this.#prefs.mode}`,
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
    scroll.addEventListener('mouseup', () => setTimeout(() => this.#onSelection(), 0));

    this.#nodes = {
      root,
      flow,
      pageHead,
      pagerLabel,
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
      lastScroll: 0,
      ...refs,
    };
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

    const themeButtons = THEMES.map((theme) =>
      h(
        'button',
        {
          class: theme.key === this.#prefs.theme ? 'is-active' : '',
          title: theme.label,
          style: { background: theme.swatch },
          onclick: () => this.#setTheme(theme.key),
        },
        h('span', { style: { background: theme.dot } }),
      ),
    );

    const modeButtons = MODES.map((mode) =>
      h(
        'button',
        {
          class: mode.key === this.#prefs.mode ? 'is-active' : '',
          title: mode.hint,
          onclick: () => this.#setMode(mode.key),
        },
        icon(mode.icon, { size: 18 }),
        h(
          'span',
          {},
          h('span', { class: 'label-md' }, mode.label),
          h('span', { class: 'label-sm muted' }, mode.hint),
        ),
      ),
    );

    const fontButtons = FONTS.map((font) =>
      h(
        'button',
        {
          class: font.key === this.#prefs.font ? 'is-active' : '',
          onclick: () => this.#setFont(font.key),
        },
        h('span', { style: { fontFamily: font.family, fontSize: '18px' } }, font.label),
        font.key === this.#prefs.font ? icon('check', { size: 16 }) : null,
      ),
    );

    Object.assign(refs, { sizeValue, sizeSlider, themeButtons, fontButtons, modeButtons });

    return h(
      'aside',
      { class: 'reader__settings reader__panel' },
      h(
        'div',
        { class: 'reader__panel-head' },
        h('h2', { class: 'title-md' }, 'إعدادات القراءة'),
        h(
          'button',
          {
            class: 'reader__tool',
            title: 'إغلاق',
            onclick: () => this.#closePanels(),
          },
          icon('close', { size: 20 }),
        ),
      ),
      h(
        'div',
        { class: 'reader__panel-body' },
        h(
          'div',
          {},
          h('label', { class: 'label-md' }, 'نمط القراءة'),
          h('div', { class: 'mode-choices' }, modeButtons),
        ),
        h(
          'div',
          {},
          h('label', { class: 'label-md' }, 'حجم الخط'),
          h(
            'div',
            { class: 'font-size-control' },
            h(
              'button',
              { title: 'تصغير الخط', onclick: () => this.#setSize(this.#prefs.size - 2) },
              icon('minus', { size: 16 }),
            ),
            sizeSlider,
            h(
              'button',
              { title: 'تكبير الخط', onclick: () => this.#setSize(this.#prefs.size + 2) },
              icon('plus', { size: 20 }),
            ),
            sizeValue,
          ),
        ),
        h(
          'div',
          {},
          h('label', { class: 'label-md' }, 'المظهر'),
          h('div', { class: 'theme-choices' }, themeButtons),
        ),
        h(
          'div',
          {},
          h('label', { class: 'label-md' }, 'نوع الخط'),
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
            h('span', { class: 'truncate' }, entry.title),
            h(
              'span',
              { class: 'label-sm muted' },
              // jamais `pageId` : c'est l'identifiant source, global au corpus
              `ص ${arabicNumber(entry.printedPageNum ?? entry.pageSequenceNum ?? '')}`,
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
              h('span', {}, `عرض المزيد (${arabicNumber(matches.length - shown)})`),
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
            this.#toc.length ? 'لا عنوان بهذا الاسم.' : 'لا يوجد فهرس لهذا الكتاب.',
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
      placeholder: 'ابحث في الفهرس…',
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
        h('h2', { class: 'title-md' }, 'فهرس المحتويات'),
        h(
          'button',
          { class: 'reader__tool', title: 'إغلاق', onclick: () => this.#closePanels() },
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
        h('h2', { class: 'title-md' }, 'ملاحظاتي'),
        h(
          'button',
          { class: 'reader__tool', title: 'إغلاق', onclick: () => this.#closePanels() },
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
            ? 'لا شيء من هذا النوع في هذا الكتاب.'
            : 'لا ملاحظات بعد. حدِّد نصًّا في الصفحة لتظليله أو للتعليق عليه.',
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
            title: kind.label,
            onclick: () => {
              this.#annotationKind = kind.value;
              this.#drawAnnotations();
            },
          },
          icon(kind.icon, { size: 16 }),
          h('span', { class: 'label-sm' }, arabicNumber(counts[kind.value] ?? 0)),
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
        this.#annotationAction('trash', 'حذف', async () => {
          try {
            await repository.deleteBookmark(entry.bookmark.bookmarkId);
          } catch (error) {
            toast(error?.message ?? 'تعذّر حذف الإشارة');
            return;
          }
          this.#annotations.bookmarks = this.#annotations.bookmarks.filter(
            (item) => item.bookmarkId !== entry.bookmark.bookmarkId,
          );
          this.#afterAnnotationChange();
        }),
      );
    } else if (entry.kind === 'highlight') {
      actions.append(
        this.#annotationAction('noteAdd', entry.note ? 'تعديل الملاحظة' : 'إضافة ملاحظة', () =>
          this.#editNote(entry.highlight, entry.note),
        ),
        this.#annotationAction('trash', 'حذف التظليل', () =>
          this.#removeHighlight(entry.highlight),
        ),
      );
    } else {
      actions.append(
        this.#annotationAction('noteAdd', 'تعديل', () => this.#editNote(null, entry.note)),
        this.#annotationAction('trash', 'حذف', () => this.#removeNote(entry.note)),
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
        entry.kind === 'bookmark' ? 'علامة' : entry.note ? 'ملاحظة' : 'تظليل',
      ),
      h('span', { class: 'reader__annotation-page label-sm' }, this.#pageLabelFor(entry.pageId)),
    );

    const body =
      entry.kind === 'bookmark'
        ? h('p', { class: 'body-md' }, entry.bookmark.label ?? 'موضع محفوظ')
        : h(
            'div',
            { class: 'reader__annotation-text' },
            entry.highlight &&
              h(
                'p',
                {
                  class: 'reader__annotation-quote',
                  style: { '--highlight-color': entry.highlight.color },
                },
                entry.highlight.selectedText,
              ),
            entry.note && h('p', { class: 'body-md' }, entry.note.content),
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
    if (printed != null) return `ص ${arabicNumber(printed)}`;

    if (this.#pagesById?.size !== this.#pages.size) {
      this.#pagesById = new Map([...this.#pages.values()].map((item) => [item.pageId, item]));
    }
    const cached = this.#pagesById.get(pageId);
    const number = cached?.printedPageNum ?? cached?.sequenceNum;
    return number == null ? '' : `ص ${arabicNumber(number)}`;
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

  /** Redessine les pages montées et le panneau après toute écriture. */
  #afterAnnotationChange() {
    this.#highlightsByPage = null;
    this.#drawAnnotations();
    this.#syncBookmark();
    for (const block of this.#blocks.values()) this.#paintBlock(block);
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
      this.#afterAnnotationChange();
      return saved;
    } catch (error) {
      toast(error?.message ?? 'تعذّر حفظ التظليل');
      return null;
    }
  }

  /**
   * Écrit ou modifie une note. Une note attachée à un surlignage disparaît avec
   * lui ; une note de page vit seule.
   */
  async #editNote(highlight, existing) {
    const content = await noteDialog({
      title: existing ? 'تعديل الملاحظة' : 'إضافة ملاحظة',
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
      this.#afterAnnotationChange();
      toast('حُفظت الملاحظة');
    } catch (error) {
      toast(error?.message ?? 'تعذّر حفظ الملاحظة');
    }
  }

  async #removeNote(note) {
    try {
      await repository.deleteNote(note.noteId);
    } catch (error) {
      toast(error?.message ?? 'تعذّر حذف الملاحظة');
      return;
    }
    this.#annotations.notes = this.#annotations.notes.filter(
      (item) => item.noteId !== note.noteId,
    );
    this.#afterAnnotationChange();
  }

  async #removeHighlight(highlight) {
    const hasNote = this.#annotations.notes.some(
      (note) => note.highlightId === highlight.highlightId,
    );
    if (hasNote) {
      const choice = await confirmDialog({
        title: 'حذف التظليل؟',
        message: 'الملاحظة المرتبطة به ستُحذف أيضًا.',
        actions: [{ value: 'go', label: 'حذف', variant: 'danger' }],
      });
      if (choice !== 'go') return;
    }
    try {
      await repository.deleteHighlight(highlight.highlightId);
    } catch (error) {
      toast(error?.message ?? 'تعذّر حذف التظليل');
      return;
    }
    this.#annotations.highlights = this.#annotations.highlights.filter(
      (item) => item.highlightId !== highlight.highlightId,
    );
    this.#annotations.notes = this.#annotations.notes.filter(
      (note) => note.highlightId !== highlight.highlightId,
    );
    this.#afterAnnotationChange();
  }

  async #toggleBookmark() {
    if (!this.#page) return;
    const page = this.#page;
    try {
      const result = await repository.toggleBookmark({
        editionId: this.#editionId,
        pageId: page.pageId,
        label: this.#chapterFor(page) ?? `ص ${arabicNumber(page.printedPageNum ?? page.sequenceNum)}`,
      });
      this.#annotations.bookmarks = result.added
        ? [...this.#annotations.bookmarks, result.bookmark]
        : this.#annotations.bookmarks.filter((item) => item.pageId !== page.pageId);
      this.#afterAnnotationChange();
      toast(result.added ? 'أُضيفت إشارة مرجعية' : 'أُزيلت الإشارة المرجعية');
    } catch (error) {
      toast(error?.message ?? 'تعذّر حفظ الإشارة');
    }
  }

  #isBookmarked(pageId) {
    return this.#annotations.bookmarks.some((item) => item.pageId === pageId);
  }

  /**
   * L'icône dit si la page courante porte une marque, et chaque page montée
   * arbore son signet : sans repère dans le texte, le bouton avait l'air de
   * ne rien faire.
   */
  #syncBookmark() {
    for (const block of this.#blocks.values()) {
      block.root.classList.toggle('is-bookmarked', this.#isBookmarked(block.page.pageId));
    }

    const button = this.#nodes.bookmarkButton;
    if (!button || !this.#page) return;
    const marked = this.#isBookmarked(this.#page.pageId);
    button.classList.toggle('is-active', marked);
    button.replaceChildren(icon('bookmark', { size: 20, fill: marked }));
    button.title = marked ? 'إزالة الإشارة المرجعية (B)' : 'إشارة مرجعية (B)';
  }

  /**
   * Recherche dans le livre. `pages_fts` n'est pas interrogeable — le build
   * sql.js embarqué ne contient pas FTS5 — le dépôt cherche donc sur les
   * colonnes normalisées `body_search` et `title_normalized`.
   */
  #searchPanel(refs) {
    const results = h('div', { class: 'reader__panel-body reader__search-results' });
    const summary = h('p', { class: 'label-sm muted' }, 'اكتب كلمتين على الأقل.');
    let timer = null;

    const field = h('input', {
      type: 'search',
      class: 'reader__search-field',
      placeholder: 'ابحث في هذا الكتاب…',
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
        h('h2', { class: 'title-md' }, 'بحث في الكتاب'),
        h(
          'button',
          { class: 'reader__tool', title: 'إغلاق', onclick: () => this.#closePanels() },
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
      summary.textContent = 'اكتب كلمتين على الأقل.';
      results.replaceChildren();
      return;
    }

    summary.textContent = 'جارٍ البحث…';
    let found;
    try {
      found = await repository.searchInBook(this.#editionId, trimmed, { limit: 60 });
    } catch {
      summary.textContent = 'تعذّر البحث في هذا الكتاب.';
      return;
    }

    this.#highlight = arabicSearchPattern(trimmed);
    const total = found.chapters.length + found.pages.length;
    summary.textContent = total
      ? `${arabicNumber(total)} نتيجة`
      : 'لا نتائج في هذا الكتاب.';

    // Les chapitres d'abord : trouver un titre vaut mieux qu'une occurrence
    // perdue au milieu d'une page.
    results.replaceChildren(
      ...found.chapters.map((entry) =>
        h(
          'button',
          { class: 'reader__result is-chapter', onclick: () => this.#goToPage(entry.pageId) },
          h('span', { class: 'reader__result-title truncate' }, entry.title),
          h(
            'span',
            { class: 'label-sm muted' },
            `ص ${arabicNumber(entry.printedPageNum ?? entry.sequenceNum)}`,
          ),
        ),
      ),
      ...found.pages.map((entry) =>
        h(
          'button',
          { class: 'reader__result', onclick: () => this.#goToPage(entry.pageId) },
          h(
            'p',
            { class: 'reader__result-snippet' },
            entry.snippet.before,
            h('mark', {}, entry.snippet.match),
            entry.snippet.after,
          ),
          h(
            'span',
            { class: 'label-sm muted' },
            `ص ${arabicNumber(entry.printedPageNum ?? entry.sequenceNum)}`,
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
      item('noteAdd', 'إضافة ملاحظة', async () => {
        const highlight = await this.#addHighlight(HIGHLIGHTS[0].color);
        if (highlight) this.#editNote(highlight, null);
      }),
      item('copy', 'نسخ', () => this.#copySelection()),
      item('translate', 'ترجمة', () => {
        toast('الترجمة قيد الإنجاز');
        this.#hideSelection();
      }),
      item('search', 'بحث في الكتاب', () => this.#searchSelection()),
      h(
        'div',
        { class: 'reader__highlights' },
        HIGHLIGHTS.map((entry) =>
          h('button', {
            title: `تظليل ${entry.label}`,
            'aria-label': `تظليل ${entry.label}`,
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
   * Monte une page : titre de chapitre quand il change, corps, notes de bas de
   * page, puis le pied imprimé — qui sert aussi de séparateur en fil continu.
   */
  #makeBlock(index, page) {
    const body = h('article', { class: 'reader__page' });
    const footnotes = h('aside', { class: 'reader__footnotes' });
    const chapter = h('h2', { class: 'reader__chapter' });
    const foot = h('div', { class: 'reader__page-foot label-sm' });
    const ribbon = h(
      'span',
      { class: 'reader__block-mark', title: 'صفحة معلَّمة', 'aria-hidden': 'true' },
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

    const block = { index, page, root, body, chapter, footnotes, foot };

    // Le titre de chapitre ne se répète pas d'une page à l'autre dans le fil :
    // il n'annonce que ce qui commence.
    const title = this.#chapterFor(page);
    const previous = this.#pages.get(index - 1);
    const repeated =
      this.#prefs.mode === 'scroll' && previous && this.#chapterFor(previous) === title;
    chapter.textContent = title ?? '';
    chapter.style.display = title && !repeated ? '' : 'none';

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
      `صفحة ${arabicNumber(index + 1)} من ${arabicNumber(this.#pageCount)}` +
      ` · المطبوعة ${arabicNumber(printed)}`;

    root.classList.toggle('is-bookmarked', this.#isBookmarked(page.pageId));
    this.#paintBlock(block);
    return block;
  }

  // ------------------------------------------------------------- affichage

  #show(index, options = {}) {
    const bounded = clamp(index, 0, Math.max(0, this.#pageCount - 1));
    return this.#prefs.mode === 'scroll'
      ? this.#showInFlow(bounded, options)
      : this.#showAlone(bounded, options);
  }

  /** Mode page : une page monte, l'ancienne s'en va. */
  async #showAlone(index, { save = true } = {}) {
    const page = await this.#pageAt(index);
    if (!page) return;

    const block = this.#makeBlock(index, page);
    this.#blocks = new Map([[index, block]]);
    this.#first = index;
    this.#last = index;
    this.#nodes.flow.replaceChildren(block.root);
    this.#nodes.scroll.scrollTop = 0;
    this.#nodes.lastScroll = 0;
    this.#setCurrent(index, page, { save });
  }

  /**
   * Mode fil continu : si la page demandée est déjà montée on s'y rend, sinon
   * on repart d'elle. Le fil reste borné — `FLOW_KEEP` pages autour de la
   * lecture — parce que sql.js tient tout le livre en mémoire et qu'un fil sans
   * fin ferait enfler la page autant que le processus.
   */
  async #showInFlow(index, { save = true, jump = true } = {}) {
    const known = this.#blocks.get(index);
    if (!known) {
      const page = await this.#pageAt(index);
      if (!page) return;
      const block = this.#makeBlock(index, page);
      this.#blocks = new Map([[index, block]]);
      this.#first = index;
      this.#last = index;
      this.#nodes.flow.replaceChildren(block.root);
      this.#nodes.scroll.scrollTop = 0;
      this.#nodes.lastScroll = 0;
      this.#setCurrent(index, page, { save });
      await this.#fill();
      return;
    }

    if (jump) {
      const scroll = this.#nodes.scroll;
      scroll.scrollTop += known.root.getBoundingClientRect().top
        - scroll.getBoundingClientRect().top
        - 24;
      this.#nodes.lastScroll = scroll.scrollTop;
    }
    this.#setCurrent(index, known.page, { save });
  }

  /** Complète le fil jusqu'à ce qu'il déborde de l'écran, dans les deux sens. */
  async #fill() {
    const scroll = this.#nodes.scroll;
    for (let round = 0; round < 8; round += 1) {
      const room = scroll.scrollHeight - scroll.clientHeight;
      if (room > NEAR_END && scroll.scrollTop > NEAR_START) break;
      const grew = (await this.#extendEnd()) || (await this.#extendStart());
      if (!grew) break;
    }
  }

  async #extendEnd() {
    if (this.#extending) return false;
    this.#extending = true;
    try {
      let grew = false;
      for (let step = 0; step < FLOW_STEP; step += 1) {
        const next = this.#last + 1;
        if (next >= this.#pageCount) break;
        const page = await this.#pageAt(next);
        if (!page) break;
        const block = this.#makeBlock(next, page);
        this.#nodes.flow.append(block.root);
        this.#blocks.set(next, block);
        this.#last = next;
        grew = true;
      }
      if (grew) this.#trim('start');
      return grew;
    } finally {
      this.#extending = false;
    }
  }

  async #extendStart() {
    if (this.#extending) return false;
    this.#extending = true;
    try {
      const scroll = this.#nodes.scroll;
      let grew = false;
      for (let step = 0; step < FLOW_STEP; step += 1) {
        const previous = this.#first - 1;
        if (previous < 0) break;
        const page = await this.#pageAt(previous);
        if (!page) break;
        const block = this.#makeBlock(previous, page);
        const before = scroll.scrollHeight;
        this.#nodes.flow.prepend(block.root);
        // Le contenu ajouté au-dessus décalerait la lecture : on lui rend
        // exactement la hauteur qu'il vient de perdre.
        scroll.scrollTop += scroll.scrollHeight - before;
        this.#blocks.set(previous, block);
        this.#first = previous;
        grew = true;
      }
      if (grew) {
        this.#trim('end');
        this.#nodes.lastScroll = scroll.scrollTop;
      }
      return grew;
    } finally {
      this.#extending = false;
    }
  }

  /** Élague le fil par le bout opposé au sens de lecture. */
  #trim(side) {
    const scroll = this.#nodes.scroll;
    while (this.#blocks.size > FLOW_KEEP) {
      const index = side === 'start' ? this.#first : this.#last;
      if (index === this.#index) break;
      const block = this.#blocks.get(index);
      if (!block) break;
      if (side === 'start') {
        const before = scroll.scrollHeight;
        block.root.remove();
        scroll.scrollTop -= before - scroll.scrollHeight;
        this.#first += 1;
      } else {
        block.root.remove();
        this.#last -= 1;
      }
      this.#blocks.delete(index);
    }
  }

  /** Synchronise la barre basse, le signet et la progression sur [index]. */
  #setCurrent(index, page, { save = true } = {}) {
    const changed = this.#index !== index || this.#page?.pageId !== page.pageId;
    this.#index = index;
    this.#page = page;

    for (const block of this.#blocks.values()) {
      block.root.classList.toggle('is-current', block.index === index);
    }

    this.#nodes.slider.value = String(index + 1);
    this.#nodes.pagerLabel.textContent =
      `${arabicNumber(index + 1)} / ${arabicNumber(this.#pageCount)}`;
    const done = Math.round(this.#percent() * 100);
    this.#nodes.percent.textContent = `${arabicNumber(done)}٪`;
    // Le rail n'a pas de remplissage natif une fois `appearance: none` posé :
    // c'est un dégradé, mis à jour ici, qui joue ce rôle.
    this.#nodes.root.style.setProperty('--reader-fill', `${done}%`);
    this.#nodes.previous.disabled = index === 0;
    this.#nodes.next.disabled = index >= this.#pageCount - 1;

    this.#syncBookmark();
    if (changed) {
      this.#pendingSelection = null;
      this.#pendingPage = null;
      this.#hideSelection();
    }
    if (this.#prefs.mode === 'page') this.#showChrome();
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
    else toast('تعذّر فتح هذه الصفحة');
  }

  #chapterFor(page) {
    let current = null;
    for (const entry of this.#toc) {
      if (entry.pageId <= page.pageId) current = entry;
      else break;
    }
    return current?.title ?? null;
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
      .catch(() => toast('تعذّر حفظ موضع القراءة'));
  }

  // ------------------------------------------------------------- réglages

  #setSize(value) {
    const size = clamp(value, MIN_FONT, MAX_FONT);
    this.#prefs.size = size;
    this.#nodes.root.style.setProperty('--reader-size', `${size}px`);
    this.#nodes.sizeValue.textContent = String(size);
    this.#nodes.sizeSlider.value = String(size);
    setSetting('reader.fontSize', size);
  }

  #setTheme(key) {
    this.#prefs.theme = key;
    this.#nodes.root.classList.remove('reader--paper', 'reader--white', 'reader--night');
    this.#nodes.root.classList.add(`reader--${key}`);
    this.#nodes.themeButtons.forEach((button, index) =>
      button.classList.toggle('is-active', THEMES[index].key === key),
    );
    setSetting('reader.theme', key);
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

  /** Bascule page ↔ fil continu : le fil est remonté depuis la page courante. */
  #setMode(key) {
    if (!MODES.some((mode) => mode.key === key) || key === this.#prefs.mode) return;
    this.#prefs.mode = key;
    for (const mode of MODES) {
      this.#nodes.root.classList.toggle(`reader--${mode.key}`, mode.key === key);
    }
    this.#nodes.modeButtons?.forEach((button, index) =>
      button.classList.toggle('is-active', MODES[index].key === key),
    );
    setSetting('reader.mode', key);

    // Le fil est reconstruit autour de la page lue : ni la position ni la
    // progression ne bougent, seule la façon de tourner change.
    this.#blocks = new Map();
    this.#nodes.flow.replaceChildren();
    this.#first = this.#index;
    this.#last = this.#index - 1;
    this.#show(this.#index, { save: false });
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
   */
  #showShortcuts() {
    this.#closeShortcuts?.();
    this.#closeShortcuts = shortcutsDialog({
      title: 'اختصارات القراءة',
      shortcuts: SHORTCUTS,
    });
  }

  #toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  }

  #syncFullscreen() {
    const on = Boolean(document.fullscreenElement);
    const button = this.#nodes.fullscreenButton;
    if (!button) return;
    button.replaceChildren(icon(on ? 'fullscreenExit' : 'fullscreen', { size: 20 }));
    button.title = on ? 'إنهاء ملء الشاشة' : 'ملء الشاشة';
  }

  // ------------------------------------------------------------ sélection

  /** La page montée qui contient [node], ou `null`. */
  #blockOf(node) {
    for (const block of this.#blocks.values()) {
      if (block.body.contains(node)) return block;
    }
    return null;
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
      toast('تم نسخ النص');
    } catch {
      toast('تعذّر النسخ');
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
    if (event.key === 'F11') {
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
      case 'v':
        event.preventDefault();
        this.#setMode(this.#prefs.mode === 'page' ? 'scroll' : 'page');
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
    // Sens de lecture arabe : la page suivante est à gauche.
    if (event.key === 'ArrowLeft' || event.key === 'PageDown') this.#move(1);
    if (event.key === 'ArrowRight' || event.key === 'PageUp') this.#move(-1);
  }

  #onWheel(event) {
    if (!event.ctrlKey) return;
    event.preventDefault();
    this.#setSize(this.#prefs.size + (event.deltaY < 0 ? 1 : -1));
  }

  #onContentClick(event) {
    if (event.target.closest('button, a, input, .reader__selection')) return;
    // Ne pas masquer l'interface au milieu d'une sélection de texte.
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    this.#hideSelection();
    this.#hideHint();
    this.#nodes.header.classList.toggle('is-hidden');
    this.#nodes.footer.classList.toggle('is-hidden');
  }

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
    if (this.#prefs.mode !== 'scroll') return;

    const current = this.#visibleBlock();
    if (current && current.index !== this.#index) {
      this.#setCurrent(current.index, current.page);
    }
    if (scroll.scrollHeight - top - scroll.clientHeight < NEAR_END) this.#extendEnd();
    else if (top < NEAR_START) this.#extendStart();
  }

  /** La page montée que l'on est en train de lire : celle sous le haut d'écran. */
  #visibleBlock() {
    const line = this.#nodes.scroll.getBoundingClientRect().top + 140;
    let best = null;
    let bestGap = Infinity;
    for (const block of this.#blocks.values()) {
      const rect = block.root.getBoundingClientRect();
      if (rect.top <= line && rect.bottom > line) return block;
      const gap = Math.abs(rect.top - line);
      if (gap < bestGap) {
        best = block;
        bestGap = gap;
      }
    }
    return best;
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
