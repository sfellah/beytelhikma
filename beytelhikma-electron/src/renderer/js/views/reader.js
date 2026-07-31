import { renderBookHtml } from '../content-html.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { repository, setSetting, settings } from '../repository.js';
import { back, navigate } from '../router.js';
import { toast } from '../shell.js';
import { errorView, loadingView } from '../components/states.js';

const PAGE_WINDOW = 20;
const MIN_FONT = 16;
const MAX_FONT = 34;

const THEMES = [
  { key: 'paper', label: 'رق إفتراضي', swatch: '#fbf9f4', dot: '#001614' },
  { key: 'white', label: 'أبيض ناصع', swatch: '#ffffff', dot: '#000000' },
  { key: 'night', label: 'الوضع الليلي', swatch: '#14150f', dot: '#d5d3ca' },
];

const FONTS = [
  { key: 'serif', label: 'أميري (تقليدي)' },
  { key: 'sans', label: 'كايرو (حديث)' },
];

/**
 * Lecteur : une page imprimée par écran, sélection de texte native, taille de
 * police réglable, ambiances, progression écrite dans `user.sqlite`.
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
  #nodes = {};
  #keyHandler = (event) => this.#onKey(event);

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
    } catch (error) {
      this.#host.replaceChildren(
        errorView(error, () => navigate(`/book/${this.#editionId}`)),
      );
    }
  }

  dispose() {
    document.removeEventListener('keydown', this.#keyHandler);
    clearTimeout(this.#saveTimer);
  }

  // ------------------------------------------------------------- structure

  #build() {
    const page = h('article', { class: 'reader__page' });
    const footnotes = h('aside', { class: 'reader__footnotes' });
    const chapter = h('p', { class: 'label-sm' });
    const info = h('div', { class: 'reader__progress-info label-sm' });
    const slider = h('input', {
      type: 'range',
      min: 1,
      max: Math.max(1, this.#pageCount),
      value: this.#index + 1,
      oninput: (event) => this.#show(Number(event.target.value) - 1),
    });

    const previous = h(
      'button',
      { class: 'button--icon', title: 'الصفحة السابقة', onclick: () => this.#move(-1) },
      icon('chevronRight', { size: 20 }),
    );
    const next = h(
      'button',
      { class: 'button--icon', title: 'الصفحة التالية', onclick: () => this.#move(1) },
      icon('chevronLeft', { size: 20 }),
    );
    const pager = h(
      'div',
      { class: 'reader__pager label-sm' },
      previous,
      h('span', { class: 'reader__pager-label' }),
      next,
    );

    const scroll = h('div', { class: 'reader__scroll' }, page, footnotes, pager);

    const header = h(
      'header',
      { class: 'reader__header' },
      h(
        'div',
        { class: 'reader__bar' },
        h(
          'button',
          { class: 'reader__back label-md', onclick: () => back() },
          icon('arrowRight', { size: 20 }),
          h('span', {}, 'العودة للمكتبة'),
        ),
        h(
          'div',
          { class: 'reader__titles' },
          h('h1', { class: 'truncate' }, this.#title),
          chapter,
        ),
        h(
          'div',
          { class: 'reader__tools' },
          h(
            'button',
            {
              class: 'reader__tool',
              title: 'إشارة مرجعية',
              onclick: () => toast('الإشارات المرجعية قيد الإنجاز'),
            },
            icon('bookmark', { size: 20 }),
          ),
          h(
            'button',
            {
              class: 'reader__tool',
              title: 'إعدادات القراءة',
              onclick: () => this.#nodes.panel.classList.toggle('is-open'),
            },
            icon('sliders', { size: 20 }),
          ),
        ),
      ),
    );

    const footer = h(
      'footer',
      { class: 'reader__footer' },
      h('div', { class: 'reader__progress' }, slider, info),
    );

    // Les références du panneau sont collectées avant d'écraser `#nodes`.
    const settingsRefs = {};
    const panel = this.#settingsPanel(settingsRefs);

    const root = h(
      'div',
      {
        class: `reader reader--${this.#prefs.theme}${this.#prefs.font === 'sans' ? ' reader--sans' : ''}`,
        style: { '--reader-size': `${this.#prefs.size}px` },
      },
      header,
      scroll,
      footer,
      panel,
    );

    scroll.addEventListener('scroll', () => this.#onScroll(scroll));
    scroll.addEventListener('click', (event) => this.#onContentClick(event));
    scroll.addEventListener('wheel', (event) => this.#onWheel(event), { passive: false });

    this.#nodes = {
      root,
      page,
      footnotes,
      chapter,
      info,
      slider,
      pager,
      previous,
      next,
      header,
      footer,
      scroll,
      panel,
      lastScroll: 0,
      ...settingsRefs,
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
        h(
          'span',
          {
            style: {
              fontFamily: font.key === 'sans' ? 'var(--font-label)' : 'var(--font-body)',
              fontSize: '18px',
            },
          },
          font.label,
        ),
        font.key === this.#prefs.font ? icon('check', { size: 16 }) : null,
      ),
    );

    Object.assign(refs, { sizeValue, sizeSlider, themeButtons, fontButtons });

    return h(
      'aside',
      { class: 'reader__settings' },
      h(
        'div',
        { class: 'reader__settings-head' },
        h('h2', { class: 'title-md' }, 'إعدادات القراءة'),
        h(
          'button',
          {
            class: 'reader__tool',
            title: 'إغلاق',
            onclick: () => this.#nodes.panel.classList.remove('is-open'),
          },
          icon('close', { size: 20 }),
        ),
      ),
      h(
        'div',
        { class: 'reader__settings-body' },
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

    const { page: pageNode, footnotes, chapter, info, slider, pager } = this.#nodes;
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
    slider.value = String(bounded + 1);

    const printed = page.printedPageNum ?? page.sequenceNum;
    // `printed` est le numéro imprimé dans l'édition papier, `bounded` la
    // position dans le fichier : les deux diffèrent presque toujours.
    pager.querySelector('.reader__pager-label').textContent =
      `الصفحة المطبوعة ${printed}`;
    this.#nodes.previous.disabled = bounded === 0;
    this.#nodes.next.disabled = bounded >= this.#pageCount - 1;

    info.replaceChildren(
      h('span', {}, `صفحة ${bounded + 1} من ${this.#pageCount}`),
      h('span', {}, title ?? ''),
      h('span', {}, `${Math.round(this.#percent() * 100)}٪`),
    );

    this.#nodes.scroll.scrollTop = 0;
    this.#showChrome();
    if (save) this.#scheduleSave(page);
    else this.#save(page);
  }

  #move(direction) {
    this.#show(this.#index + direction);
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
    this.#nodes.root.classList.toggle('reader--sans', key === 'sans');
    this.#nodes.fontButtons.forEach((button, index) => {
      const isActive = FONTS[index].key === key;
      button.classList.toggle('is-active', isActive);
      const check = button.querySelector('svg');
      if (isActive && !check) button.append(icon('check', { size: 16 }));
      if (!isActive && check) check.remove();
    });
    setSetting('reader.font', key);
  }

  // -------------------------------------------------------- interactions

  #onKey(event) {
    if (event.key === 'Escape') {
      if (this.#nodes.panel.classList.contains('is-open')) {
        this.#nodes.panel.classList.remove('is-open');
      } else back();
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
    if (event.target.closest('button, a, input')) return;
    // Ne pas masquer l'interface au milieu d'une sélection de texte.
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    this.#nodes.header.classList.toggle('is-hidden');
    this.#nodes.footer.classList.toggle('is-hidden');
  }

  #onScroll(scroll) {
    const top = scroll.scrollTop;
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
}

function clamp(value, min, max) {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}
