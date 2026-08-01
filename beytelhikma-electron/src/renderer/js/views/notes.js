import { h } from '../dom.js';
import { n } from '../format.js';
import { icon } from '../icons.js';
import { repository } from '../repository.js';
import { navigate } from '../router.js';
import { renderShell, toast } from '../shell.js';
import { confirmDialog, noteDialog } from '../components/modal.js';
import { pagination, PAGE_SIZES } from '../components/pagination.js';
import { emptyView, errorView, loadingView } from '../components/states.js';

const KINDS = [
  { value: 'all', label: 'الكل', icon: 'notes' },
  { value: 'note', label: 'الملاحظات', icon: 'noteAdd' },
  { value: 'highlight', label: 'التظليلات', icon: 'highlight' },
  { value: 'bookmark', label: 'العلامات', icon: 'bookmark' },
];

/**
 * Écran transversal des annotations : ce qu'on a écrit, tous livres confondus.
 * Chaque entrée ramène à sa page dans le lecteur — c'est sa raison d'être.
 */
export function notesView(host, params) {
  const content = renderShell(host, { active: 'notes' });
  const screen = new NotesScreen(content, params?.query ?? {});
  screen.start();
  return null;
}

class NotesScreen {
  #host;
  #query;
  #nodes = {};
  #timer = null;
  #token = 0;

  constructor(host, query) {
    this.#host = host;
    this.#query = {
      kind: KINDS.some((entry) => entry.value === query.kind) ? query.kind : 'all',
      text: query.text ?? '',
      offset: 0,
      limit: PAGE_SIZES[0],
    };
  }

  start() {
    this.#build();
    this.#refresh();
  }

  #build() {
    const list = h('div', { class: 'notes__list' }, loadingView());
    const pager = h('div', { class: 'notes__pager' });
    const tabs = h('div', { class: 'notes__tabs' });
    const count = h('p', { class: 'body-md muted' });

    const search = h('input', {
      type: 'search',
      class: 'notes__search',
      placeholder: 'ابحث في ملاحظاتي…',
      value: this.#query.text,
      oninput: (event) => {
        clearTimeout(this.#timer);
        const value = event.target.value;
        this.#timer = setTimeout(() => {
          this.#query = { ...this.#query, text: value.trim(), offset: 0 };
          this.#refresh();
        }, 250);
      },
    });

    this.#nodes = { list, pager, tabs, count, search };

    this.#host.replaceChildren(
      h(
        'section',
        { class: 'notes' },
        h(
          'div',
          { class: 'notes__header' },
          h('h1', { class: 'display-lg' }, 'ملاحظاتي'),
          count,
        ),
        h(
          'div',
          { class: 'notes__toolbar' },
          tabs,
          h('div', { class: 'notes__search-box' }, icon('search', { size: 18 }), search),
        ),
        list,
        pager,
      ),
    );
  }

  #drawTabs(counts) {
    const total = counts.note + counts.highlight + counts.bookmark;
    const sizeOf = (kind) => (kind === 'all' ? total : counts[kind] ?? 0);

    this.#nodes.tabs.replaceChildren(
      ...KINDS.map((entry) =>
        h(
          'button',
          {
            class: `button button--tonal${entry.value === this.#query.kind ? ' is-active' : ''}`,
            onclick: () => {
              this.#query = { ...this.#query, kind: entry.value, offset: 0 };
              this.#refresh();
            },
          },
          icon(entry.icon, { size: 18 }),
          h('span', {}, `${entry.label} (${n(sizeOf(entry.value))})`),
        ),
      ),
    );
  }

  async #refresh() {
    const token = ++this.#token;
    try {
      const data = await repository.getAnnotations({
        kind: this.#query.kind,
        text: this.#query.text || null,
        offset: this.#query.offset,
        limit: this.#query.limit,
      });
      if (token !== this.#token || !this.#host.isConnected) return;

      this.#drawTabs(data.counts);
      this.#nodes.count.textContent = this.#query.text
        ? `${n(data.total)} نتيجة لـ « ${this.#query.text} »`
        : `${n(data.total)} عنصرًا`;

      this.#nodes.list.replaceChildren(
        data.items.length
          ? h('div', { class: 'notes__items' }, data.items.map((item) => this.#card(item)))
          : emptyView(
              this.#query.text ? 'لا نتائج لهذا البحث' : 'لا ملاحظات بعد — ظلِّل نصًّا أثناء القراءة',
            ),
      );

      this.#nodes.pager.replaceChildren(
        data.total > this.#query.limit
          ? pagination({
              total: data.total,
              offset: this.#query.offset,
              limit: this.#query.limit,
              onChange: (offset) => {
                this.#query = { ...this.#query, offset };
                this.#refresh();
              },
              onPageSize: (limit) => {
                this.#query = { ...this.#query, limit, offset: 0 };
                this.#refresh();
              },
            })
          : h('div', {}),
      );
    } catch (error) {
      if (token !== this.#token) return;
      this.#nodes.list.replaceChildren(errorView(error, () => this.#refresh()));
    }
  }

  #card(item) {
    const open = () => {
      const page = item.pageId ?? item.highlight?.pageId ?? null;
      navigate(`/reader/${item.editionId}${page != null ? `?page=${page}` : ''}`);
    };

    const quote =
      item.kind === 'highlight'
        ? item.selectedText
        : item.kind === 'note'
          ? item.highlight?.selectedText ?? null
          : item.label;

    return h(
      'article',
      { class: `note-card is-${item.kind}` },
      h(
        'button',
        { class: 'note-card__open', onclick: open },
        h(
          'div',
          { class: 'note-card__head' },
          icon(KINDS.find((entry) => entry.value === item.kind)?.icon ?? 'notes', { size: 18 }),
          h('span', { class: 'label-md truncate' }, item.bookTitle),
        ),
        quote &&
          h(
            'p',
            {
              class: 'note-card__quote',
              style: {
                '--highlight-color': item.color ?? item.highlight?.color ?? 'transparent',
              },
            },
            quote,
          ),
        item.kind === 'note' && h('p', { class: 'body-md' }, item.content),
      ),
      h('div', { class: 'note-card__actions' }, ...this.#actions(item)),
    );
  }

  #actions(item) {
    const button = (name, title, onclick) =>
      h(
        'button',
        { class: 'button--icon', title, 'aria-label': title, onclick },
        icon(name, { size: 18 }),
      );

    if (item.kind === 'note') {
      return [
        button('noteAdd', 'تعديل', async () => {
          const content = await noteDialog({
            title: 'تعديل الملاحظة',
            quote: item.highlight?.selectedText ?? null,
            value: item.content,
            canDelete: true,
          });
          if (content === null) return;
          if (content === '') return this.#delete(item);
          await this.#run(() =>
            repository.saveNote({
              noteId: item.noteId,
              editionId: item.editionId,
              pageId: item.pageId,
              highlightId: item.highlightId,
              content,
            }),
          );
        }),
        button('trash', 'حذف', () => this.#delete(item)),
      ];
    }
    return [button('trash', 'حذف', () => this.#delete(item))];
  }

  async #delete(item) {
    const choice = await confirmDialog({
      title: 'حذف هذا العنصر؟',
      message:
        item.kind === 'highlight'
          ? 'التظليل والملاحظة المرتبطة به سيُحذفان.'
          : 'لا يمكن التراجع عن هذا الحذف.',
      actions: [{ value: 'go', label: 'حذف', variant: 'danger' }],
    });
    if (choice !== 'go') return;

    await this.#run(() => {
      if (item.kind === 'note') return repository.deleteNote(item.noteId);
      if (item.kind === 'highlight') return repository.deleteHighlight(item.highlightId);
      return repository.deleteBookmark(item.bookmarkId);
    });
  }

  async #run(action) {
    try {
      await action();
    } catch (error) {
      toast(error?.message ?? 'تعذّر تنفيذ العملية');
    }
    if (this.#host.isConnected) this.#refresh();
  }
}
