import { renderBookHtml } from '../content-html.js';
import { h } from '../dom.js';
import { arabicNumber } from '../format.js';
import { icon } from '../icons.js';
import { repository, setSetting, settings } from '../repository.js';
import { back, navigate } from '../router.js';
import { toast } from '../shell.js';
import { errorView, loadingView } from '../components/states.js';

const PAGE_WINDOW = 20;
const MIN_FONT = 16;
const MAX_FONT = 34;
const HINT_DELAY = 4000;

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

const HIGHLIGHTS = ['#f2c744', '#e2604c', '#5fa877', '#5b8bd0'];

/**
 * Lecteur : une page imprimée par écran, sélection de texte native, taille de
 * police réglable, ambiances, progression écrite dans `user.sqlite`.
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
  #prefs = { size: 22, theme: 'paper', font: 'serif' };
  #saveTimer = null;
  #hintTimer = null;
  #nodes = {};
  #keyHandler = (event) => this.#onKey(event);
  #fullscreenHandler = () => this.#syncFullscreen();

  constructor(host, editionId, requestedPageId) {
    this.#host = host;
    this.#editionId = editionId;
    this.#requestedPageId = requestedPageId ? Number(requestedPageId) : null;
  }

  async start() {
    try {
      const [detail, count, toc, saved, prefs] = await Promise.all([
        repository.getBookDetail(this.#editionId),
        repository.getPageCount(this.#editionId),
        repository.getToc(this.#editionId).catch(() => []),
        repository.getProgress(this.#editionId),
        settings(),
      ]);

      this.#title = detail.summary.title;
      this.#pageCount = count;
      this.#toc = toc;
      this.#prefs = {
        size: clamp(Number(prefs['reader.fontSize'] ?? 22), MIN_FONT, MAX_FONT),
        theme: prefs['reader.theme'] ?? 'paper',
        font: prefs['reader.font'] ?? 'serif',
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
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }

  // ------------------------------------------------------------- structure

  #build() {
    // --- la page elle-même : entête discret, chapitre, texte, pied de page ---
    const page = h('article', { class: 'reader__page' });
    const footnotes = h('aside', { class: 'reader__footnotes' });
    const chapter = h('h2', { class: 'reader__chapter' });
    const pageHead = h(
      'div',
      { class: 'reader__page-head' },
      h('p', { class: 'headline-md' }, this.#title),
      h('span', { class: 'reader__hairline' }),
    );
    const pageFoot = h('div', { class: 'reader__page-foot label-sm' });

    const scroll = h(
      'div',
      { class: 'reader__scroll no-scrollbar' },
      pageHead,
      chapter,
      page,
      footnotes,
      pageFoot,
    );

    // --- barre haute : outils à droite (départ RTL), titre et fermeture à gauche ---
    const tool = (name, title, onclick) =>
      h('button', { class: 'reader__tool', title, onclick }, icon(name, { size: 20 }));

    const fullscreenButton = tool('fullscreen', 'ملء الشاشة', () => this.#toggleFullscreen());

    const header = h(
      'header',
      { class: 'reader__header' },
      h(
        'div',
        { class: 'reader__bar' },
        h(
          'div',
          { class: 'reader__tools' },
          tool('moreVertical', 'خيارات أخرى', () => toast('خيارات إضافية قيد الإنجاز')),
          tool('help', 'اختصارات القراءة', () => this.#showShortcuts()),
          tool('bookmark', 'إشارة مرجعية', () => toast('الإشارات المرجعية قيد الإنجاز')),
          tool('bookOpen', 'فهرس المحتويات', () => this.#togglePanel('toc')),
          tool('formatSize', 'إعدادات القراءة', () => this.#togglePanel('settings')),
          tool('search', 'بحث في الكتاب', () => toast('البحث قيد الإنجاز')),
          fullscreenButton,
        ),
        h(
          'div',
          { class: 'reader__titles' },
          h('h1', { class: 'truncate' }, this.#title),
          tool('close', 'العودة للمكتبة', () => back()),
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

    const previous = tool('chevronRight', 'الصفحة السابقة', () => this.#move(-1));
    const next = tool('chevronLeft', 'الصفحة التالية', () => this.#move(1));
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
    const selection = this.#selectionMenu();

    const root = h(
      'div',
      {
        class: `reader reader--${this.#prefs.theme} reader--font-${this.#prefs.font}`,
        style: { '--reader-size': `${this.#prefs.size}px` },
      },
      header,
      scroll,
      footer,
      hint,
      panel,
      tocPanel,
      selection,
    );

    scroll.addEventListener('scroll', () => this.#onScroll(scroll));
    scroll.addEventListener('click', (event) => this.#onContentClick(event));
    scroll.addEventListener('wheel', (event) => this.#onWheel(event), { passive: false });
    scroll.addEventListener('mouseup', () => setTimeout(() => this.#onSelection(), 0));

    this.#nodes = {
      root,
      page,
      footnotes,
      chapter,
      pageFoot,
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
      selection,
      fullscreenButton,
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

    Object.assign(refs, { sizeValue, sizeSlider, themeButtons, fontButtons });

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

  /** Sommaire glissant : la même donnée que la fiche livre, à portée de page. */
  #tocPanel() {
    const body = this.#toc.length
      ? this.#toc.map((entry) =>
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
        )
      : h('p', { class: 'label-md muted' }, 'لا يوجد فهرس لهذا الكتاب.');

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
      h('div', { class: 'reader__panel-body reader__toc-list' }, body),
    );
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
      item('noteAdd', 'إضافة ملاحظة', () => {
        toast('الملاحظات قيد الإنجاز');
        this.#hideSelection();
      }),
      item('copy', 'نسخ', () => this.#copySelection()),
      item('translate', 'ترجمة', () => {
        toast('الترجمة قيد الإنجاز');
        this.#hideSelection();
      }),
      item('search', 'بحث في الكتاب', () => {
        toast('البحث قيد الإنجاز');
        this.#hideSelection();
      }),
      h(
        'div',
        { class: 'reader__highlights' },
        HIGHLIGHTS.map((color) =>
          h('button', {
            title: 'تظليل',
            style: { background: color },
            onclick: () => {
              toast('التظليل قيد الإنجاز');
              this.#hideSelection();
            },
          }),
        ),
      ),
    );
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

  async #show(index, { save = true } = {}) {
    const bounded = clamp(index, 0, Math.max(0, this.#pageCount - 1));
    this.#index = bounded;
    const page = await this.#pageAt(bounded);
    if (!page) return;

    const { page: pageNode, footnotes, chapter, pageFoot, slider } = this.#nodes;
    pageNode.replaceChildren(renderBookHtml(page.bodyHtml));

    if (page.footnotes) {
      footnotes.replaceChildren(document.createTextNode(page.footnotes));
      footnotes.style.display = '';
    } else {
      footnotes.replaceChildren();
      footnotes.style.display = 'none';
    }

    const title = this.#chapterFor(page);
    chapter.textContent = title ?? '';
    chapter.style.display = title ? '' : 'none';
    slider.value = String(bounded + 1);

    // `printed` est le numéro imprimé dans l'édition papier, `bounded` la
    // position dans le fichier : les deux diffèrent presque toujours, on ne
    // les mélange donc jamais dans un même « N sur M ».
    const printed = page.printedPageNum ?? page.sequenceNum;
    pageFoot.textContent =
      `صفحة ${arabicNumber(bounded + 1)} من ${arabicNumber(this.#pageCount)}` +
      ` · المطبوعة ${arabicNumber(printed)}`;
    this.#nodes.pagerLabel.textContent =
      `${arabicNumber(bounded + 1)} / ${arabicNumber(this.#pageCount)}`;
    const done = Math.round(this.#percent() * 100);
    this.#nodes.percent.textContent = `${arabicNumber(done)}٪`;
    // Le rail n'a pas de remplissage natif une fois `appearance: none` posé :
    // c'est un dégradé, mis à jour ici, qui joue ce rôle.
    this.#nodes.root.style.setProperty('--reader-fill', `${done}%`);
    this.#nodes.previous.disabled = bounded === 0;
    this.#nodes.next.disabled = bounded >= this.#pageCount - 1;

    this.#nodes.scroll.scrollTop = 0;
    this.#hideSelection();
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

  // ------------------------------------------------------------- panneaux

  #togglePanel(which) {
    const target = which === 'toc' ? this.#nodes.tocPanel : this.#nodes.panel;
    const other = which === 'toc' ? this.#nodes.panel : this.#nodes.tocPanel;
    other.classList.remove('is-open');
    target.classList.toggle('is-open');
  }

  #closePanels() {
    this.#nodes.panel.classList.remove('is-open');
    this.#nodes.tocPanel.classList.remove('is-open');
  }

  #panelsOpen() {
    return (
      this.#nodes.panel.classList.contains('is-open') ||
      this.#nodes.tocPanel.classList.contains('is-open')
    );
  }

  #showShortcuts() {
    toast('◀ ▶ للتنقّل • Ctrl + / − لحجم الخط • Esc للخروج');
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

  #onSelection() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      this.#hideSelection();
      return;
    }
    if (!this.#nodes.scroll.contains(selection.anchorNode)) return;

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
    const text = window.getSelection()?.toString() ?? '';
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
