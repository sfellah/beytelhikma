import { h } from '../dom.js';
import { n } from '../format.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { onDownloadsChanged, repository } from '../repository.js';
import { navigate } from '../router.js';
import { renderShell, toast } from '../shell.js';
import {
  BUSY,
  FINISHED_LIMIT,
  departures,
  rememberFinished,
} from '../../../shared/downloads-queue.js';
import { formatBytes } from '../components/download-action.js';
import { confirmDialog } from '../components/modal.js';
import { pagination, PAGE_SIZES } from '../components/pagination.js';
import { emptyView, errorView, loadingView } from '../components/states.js';

const SECTIONS = [
  {
    key: 'active',
    title: 'downloads.group.downloading',
    keep: (job) => job.status === 'downloading' || job.status === 'verifying',
  },
  { key: 'queued', title: 'downloads.group.queued', keep: (job) => job.status === 'queued' },
  { key: 'failed', title: 'downloads.group.failed', keep: (job) => job.status === 'failed' },
];

const STATUS_FILTERS = [
  { value: '', label: 'downloads.scope.all' },
  { value: 'installed', label: 'downloads.scope.installed' },
  { value: 'missing', label: 'downloads.scope.missing' },
];

const SORTS = [
  { value: 'title', label: 'downloads.sort.title' },
  { value: 'size', label: 'downloads.sort.size' },
  { value: 'pages', label: 'downloads.sort.pages' },
  { value: 'recent', label: 'downloads.sort.recent' },
];

/** Libellé et teinte de chaque statut, pour la colonne « الحالة ». */
const STATUS_LABELS = {
  installed: ['downloads.status.installed', 'is-installed'],
  queued: ['downloads.status.queued', 'is-pending'],
  downloading: ['downloads.status.downloading', 'is-pending'],
  verifying: ['downloads.status.verifying', 'is-pending'],
  failed: ['downloads.status.failed', 'is-failed'],
  // `removed` décrit une ligne d'historique, pas un état visible : pour qui
  // regarde la table, un livre effacé est un livre non téléchargé.
};

/**
 * Écran des téléchargements : la file en cours au-dessus, puis le catalogue
 * entier sous forme de table paginée — taille, nombre de pages, statut — d'où
 * l'on télécharge, annule, ouvre ou supprime, livre par livre ou par lot.
 */
export function downloadsView(host) {
  const content = renderShell(host, { active: 'downloads' });
  const screen = new DownloadsScreen(content);
  screen.start();
  return { dispose: () => screen.dispose() };
}

class DownloadsScreen {
  #host;
  #query = { text: '', status: '', sort: 'title', offset: 0, limit: PAGE_SIZES[0] };
  #selection = new Set();
  /** Les travaux vus dans la file au passage précédent, pour savoir qui la quitte. */
  #watched = new Set();
  /** Les livres tout juste installés, confirmés par le dépôt : `id → ligne`. */
  #finished = new Map();
  #nodes = {};
  #searchTimer = null;
  #refreshTimer = null;
  #unsubscribe = null;
  /** Jeton de la dernière requête : une réponse tardive ne doit pas s'afficher. */
  #token = 0;

  constructor(host) {
    this.#host = host;
  }

  start() {
    this.#build();
    this.#refresh();
    this.#unsubscribe = onDownloadsChanged(() => {
      if (!this.#host.isConnected) {
        this.dispose();
        return;
      }
      // La file émet à chaque bloc reçu : on ne redessine pas la table à ce
      // rythme-là.
      clearTimeout(this.#refreshTimer);
      this.#refreshTimer = setTimeout(() => this.#refresh(), 400);
    });
  }

  dispose() {
    clearTimeout(this.#searchTimer);
    clearTimeout(this.#refreshTimer);
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }

  // ------------------------------------------------------------- structure

  #build() {
    const summary = h('p', { class: 'body-md muted' });
    const queue = h('div', { class: 'downloads__queue' });
    const table = h('div', { class: 'downloads__table-host' }, loadingView());
    const pager = h('div', { class: 'downloads__pager' });
    const bulk = h('div', { class: 'downloads__bulk' });

    const search = h('input', {
      type: 'search',
      class: 'downloads__search',
      placeholder: t('downloads.filter'),
      oninput: (event) => {
        clearTimeout(this.#searchTimer);
        const value = event.target.value;
        this.#searchTimer = setTimeout(() => {
          this.#query = { ...this.#query, text: value.trim(), offset: 0 };
          this.#refresh();
        }, 250);
      },
    });

    const select = (options, current, onchange) =>
      h(
        'select',
        { class: 'downloads__select', onchange: (event) => onchange(event.target.value) },
        options.map((option) =>
          h(
            'option',
            { value: option.value, selected: option.value === current },
            t(option.label),
          ),
        ),
      );

    const toolbar = h(
      'div',
      { class: 'downloads__toolbar' },
      h('div', { class: 'downloads__search-box' }, icon('search', { size: 18 }), search),
      h(
        'label',
        { class: 'downloads__filter label-sm' },
        h('span', {}, t('downloads.statusLabel')),
        select(STATUS_FILTERS, this.#query.status, (value) => {
          this.#query = { ...this.#query, status: value, offset: 0 };
          this.#refresh();
        }),
      ),
      h(
        'label',
        { class: 'downloads__filter label-sm' },
        h('span', {}, t('downloads.sortLabel')),
        select(SORTS, this.#query.sort, (value) => {
          this.#query = { ...this.#query, sort: value, offset: 0 };
          this.#refresh();
        }),
      ),
    );

    this.#nodes = { summary, queue, table, pager, bulk, search };

    this.#host.replaceChildren(
      h(
        'section',
        { class: 'downloads' },
        h(
          'div',
          { class: 'downloads__header' },
          h('h1', { class: 'display-lg' }, t('downloads.title')),
          summary,
        ),
        queue,
        h(
          'div',
          { class: 'downloads__manage' },
          h(
            'div',
            { class: 'downloads__manage-head' },
            h('h2', { class: 'headline-lg' }, t('downloads.scope.all')),
            toolbar,
          ),
          bulk,
          table,
          pager,
        ),
      ),
    );
  }

  // ---------------------------------------------------------------- données

  async #refresh() {
    const token = ++this.#token;
    try {
      const [jobs, usage, listing] = await Promise.all([
        repository.getDownloads(),
        repository.getStorageUsage(),
        repository.getManagedBooks(this.#queryPayload()),
      ]);
      if (token !== this.#token || !this.#host.isConnected) return;

      await this.#collectFinished(jobs, token);
      if (token !== this.#token || !this.#host.isConnected) return;

      this.#nodes.summary.textContent =
        t('downloads.usage', {
          count: usage.bookCount,
          size: formatBytes(usage.bytes) || t('format.zeroBytes'),
        }) + (jobs.length ? t('downloads.inQueue', { count: jobs.length }) : '');

      this.#drawQueue(jobs);
      this.#drawTable(listing);
      this.#drawBulk(listing);
      this.#nodes.pager.replaceChildren(
        pagination({
          total: listing.total,
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
        }),
      );
    } catch (error) {
      if (token !== this.#token) return;
      this.#nodes.table.replaceChildren(errorView(error, () => this.#refresh()));
    }
  }

  /**
   * Ce qui a quitté la file depuis le passage précédent, réduit à ce qui est
   * **effectivement installé**.
   *
   * La file efface un travail dès qu'il est installé : rien, dans ce qu'elle
   * rend, ne distingue un livre posé sur le disque d'un téléchargement annulé.
   * On ne devine donc pas — on redemande au dépôt les seuls identifiants
   * disparus, filtrés sur `installed`. Un seul aller-retour, et seulement quand
   * la file s'est vidée de quelque chose.
   */
  async #collectFinished(jobs, token) {
    const { present, left } = departures(this.#watched, jobs);
    this.#watched = present;
    if (!left.length) return;

    // On ne demande que ce qu'on pourrait montrer, et les derniers partis sont
    // les derniers arrivés : un nettoyage des échecs sur un lot de mille livres
    // ferait autrement un `IN (?,?,…)` de mille paramètres, que SQLite refuse.
    const asked = left.slice(-FINISHED_LIMIT);
    const { rows } = await repository.getManagedBooks({
      ids: asked,
      status: 'installed',
      limit: asked.length,
    });
    if (token !== this.#token || !this.#host.isConnected) return;
    this.#finished = rememberFinished(this.#finished, rows);
  }

  /** Le champ texte est vide par défaut : on n'envoie que ce qui filtre. */
  #queryPayload() {
    const { text, status, sort, offset, limit } = this.#query;
    return {
      text: text || null,
      status: status || null,
      sort,
      offset,
      limit,
    };
  }

  // ------------------------------------------------------------------ file

  #drawQueue(jobs) {
    const sections = SECTIONS.map((section) => [section, jobs.filter(section.keep)]).filter(
      ([, items]) => items.length > 0,
    );
    const finished = [...this.#finished.values()];

    if (!sections.length && !finished.length) {
      this.#nodes.queue.replaceChildren();
      return;
    }

    this.#nodes.queue.replaceChildren(
      // Ce qui vient d'arriver passe devant : c'est la seule ligne de l'écran
      // qui appelle un geste, les autres ne font que rendre compte.
      ...(finished.length ? [this.#doneSection(finished)] : []),
      ...sections.map(([section, items]) =>
        h(
          'div',
          { class: 'downloads__section' },
          h(
            'div',
            { class: 'downloads__section-head' },
            h('h2', { class: 'headline-lg' }, t(section.title)),
            section.key === 'failed' &&
              h(
                'button',
                {
                  class: 'button button--tonal',
                  onclick: () => this.#run(() => repository.clearFailedDownloads()),
                },
                t('downloads.clearFailed'),
              ),
          ),
          items.map((job) => this.#jobRow(job)),
        ),
      ),
    );
  }

  /**
   * Les livres tout juste installés, avec le geste qu'on attend d'eux : les
   * lire. Sans cette section, un téléchargement qui aboutit s'efface de la file
   * et il faut retrouver le livre dans la table pour l'ouvrir.
   *
   * `#finished` ne porte que des lignes confirmées installées par le dépôt : le
   * bouton ne peut donc pas mener à un livre absent du disque.
   */
  #doneSection(rows) {
    return h(
      'div',
      { class: 'downloads__section' },
      h(
        'div',
        { class: 'downloads__section-head' },
        h('h2', { class: 'headline-lg' }, t('downloads.group.done')),
      ),
      rows.map((row) =>
        h(
          'article',
          { class: 'download-row' },
          h(
            'div',
            { class: 'download-row__main' },
            h('p', { class: 'title-md' }, row.title ?? row.editionId),
            h('p', { class: 'label-sm muted' }, t('downloads.doneHint')),
          ),
          h(
            'button',
            {
              class: 'button button--filled',
              onclick: () => navigate(`/reader/${row.editionId}`),
            },
            icon('bookOpen', { size: 18 }),
            h('span', {}, t('downloads.read')),
          ),
          h(
            'button',
            {
              class: 'button--icon',
              title: t('downloads.dismiss'),
              'aria-label': t('downloads.dismiss'),
              onclick: () => {
                this.#finished.delete(row.editionId);
                this.#refresh();
              },
            },
            icon('close', { size: 20 }),
          ),
        ),
      ),
    );
  }

  #jobRow(job) {
    const percent = Math.round((job.percent ?? 0) * 100);
    const failed = job.status === 'failed';
    return h(
      'article',
      { class: 'download-row' },
      h(
        'div',
        { class: 'download-row__main' },
        h('p', { class: 'title-md' }, job.title ?? job.editionId),
        failed
          ? h('p', { class: 'label-sm download-action__error' }, job.error ?? t('download.failed'))
          : h('div', { class: 'progress' }, h('span', { style: { width: `${percent}%` } })),
        !failed &&
          h(
            'p',
            { class: 'label-sm muted' },
            t('downloads.progress', {
              percent,
              received: formatBytes(job.receivedBytes),
              total: formatBytes(job.totalBytes),
            }),
          ),
      ),
      failed
        ? h(
            'button',
            {
              class: 'button--icon',
              title: t('download.retry'),
              onclick: () => this.#run(() => repository.retryDownload(job.editionId)),
            },
            icon('download', { size: 20 }),
          )
        : h(
            'button',
            {
              class: 'button--icon',
              title: t('download.cancel'),
              onclick: () => this.#run(() => repository.cancelDownload(job.editionId)),
            },
            icon('close', { size: 20 }),
          ),
    );
  }

  // ----------------------------------------------------------------- table

  #drawTable({ rows }) {
    if (!rows.length) {
      this.#nodes.table.replaceChildren(emptyView(t('downloads.noMatch')));
      return;
    }

    // La case d'en-tête ne coche que la page affichée : cocher 8 000 livres
    // qu'on n'a pas sous les yeux ne veut rien dire.
    const pageIds = rows.map((row) => row.editionId);
    const allChecked = pageIds.every((id) => this.#selection.has(id));

    const head = h(
      'tr',
      {},
      h(
        'th',
        { class: 'books-table__pick' },
        // L'étiquette porte la cible qu'on touche ; la case n'en porte que le
        // dessin. Grossir la case elle-même prenait la place des deux boutons
        // de la ligne — lire, supprimer — et écrasait le titre sur téléphone.
        h(
          'label',
          { class: 'books-table__check' },
          h('input', {
            type: 'checkbox',
            checked: allChecked,
            title: t('downloads.selectPage'),
            'aria-label': t('downloads.selectPage'),
            onchange: (event) => {
              for (const id of pageIds) {
                if (event.target.checked) this.#selection.add(id);
                else this.#selection.delete(id);
              }
              this.#refresh();
            },
          }),
        ),
      ),
      h('th', {}, t('downloads.column.book')),
      h('th', {}, t('downloads.column.field')),
      h('th', { class: 'books-table__num' }, t('downloads.column.pages')),
      h('th', { class: 'books-table__num' }, t('downloads.column.size')),
      h('th', {}, t('downloads.statusLabel')),
      h('th', { class: 'books-table__actions' }, t('downloads.column.actions')),
    );

    this.#nodes.table.replaceChildren(
      h(
        'div',
        { class: 'books-table__scroll' },
        h(
          'table',
          { class: 'books-table' },
          h('thead', {}, head),
          h('tbody', {}, rows.map((row) => this.#bookRow(row))),
        ),
      ),
    );
  }

  #bookRow(row) {
    const status = row.downloadStatus ?? null;
    const [label, tone] = STATUS_LABELS[status] ?? ['downloads.status.missing', ''];
    const percent = Math.round((row.percent ?? 0) * 100);

    const statusCell = BUSY.has(status)
      ? h(
          'div',
          { class: 'books-table__status' },
          h('div', { class: 'progress' }, h('span', { style: { width: `${percent}%` } })),
          h('span', { class: 'label-sm muted' }, t('format.percent', { value: percent })),
        )
      : h(
          'span',
          { class: `books-table__badge ${tone}`.trim() },
          status === 'failed' ? (row.error ?? t(label)) : t(label),
        );

    // Installé : la taille qui compte est celle prise sur le disque, décompressée.
    const size = row.localBytes || row.compressedSize || 0;

    return h(
      'tr',
      { class: this.#selection.has(row.editionId) ? 'is-selected' : '' },
      h(
        'td',
        { class: 'books-table__pick' },
        h(
          'label',
          { class: 'books-table__check' },
          h('input', {
            type: 'checkbox',
            checked: this.#selection.has(row.editionId),
            'aria-label': row.title,
            onchange: (event) => {
              if (event.target.checked) this.#selection.add(row.editionId);
              else this.#selection.delete(row.editionId);
              this.#refresh();
            },
          }),
        ),
      ),
      h(
        'td',
        {},
        h(
          'button',
          {
            class: 'books-table__title',
            title: row.title,
            onclick: () => navigate(`/book/${row.editionId}`),
          },
          row.title,
        ),
        row.authorName && h('p', { class: 'label-sm muted truncate' }, row.authorName),
      ),
      h('td', { class: 'label-sm muted' }, row.categoryLabel ?? '—'),
      h(
        'td',
        { class: 'books-table__num label-sm' },
        row.pageCount ? n(row.pageCount) : '—',
      ),
      h('td', { class: 'books-table__num label-sm' }, size ? formatBytes(size) : '—'),
      h('td', {}, statusCell),
      // Les boutons sont posés en rangée : `.button--icon` est un bloc, et deux
      // blocs dans une cellule s'empilent — « lire » passait sous « supprimer »
      // et doublait la hauteur de la ligne.
      h(
        'td',
        { class: 'books-table__actions' },
        h('div', { class: 'books-table__row-actions' }, ...this.#rowActions(row, status)),
      ),
    );
  }

  #rowActions(row, status) {
    const button = (name, title, onclick, variant = '') =>
      h(
        'button',
        { class: `button--icon ${variant}`.trim(), title, 'aria-label': title, onclick },
        icon(name, { size: 18 }),
      );

    if (BUSY.has(status)) {
      return [
        button('close', t('download.cancel'), () =>
          this.#run(() => repository.cancelDownload(row.editionId)),
        ),
      ];
    }
    // « Lire » n'apparaît **que** sur un livre installé : le lecteur ouvre un
    // fichier, et il n'y en a pas tant que la file n'a pas fini.
    if (status === 'installed') {
      return [
        button('bookOpen', t('downloads.read'), () => navigate(`/reader/${row.editionId}`)),
        button('trash', t('action.delete'), () => this.#confirmDelete([row]), 'is-danger'),
      ];
    }
    return [
      button(
        'download',
        t(status === 'failed' ? 'download.retry' : 'explore.download'),
        () =>
          this.#run(() =>
            status === 'failed'
              ? repository.retryDownload(row.editionId)
              : repository.downloadBook(row.editionId),
          ),
      ),
    ];
  }

  // -------------------------------------------------------------- sélection

  #drawBulk({ rows }) {
    // La sélection survit à la pagination ; seule la part visible peut être
    // décrite précisément, le reste est compté.
    const selected = [...this.#selection];
    if (!selected.length) {
      this.#nodes.bulk.replaceChildren();
      return;
    }

    const byId = new Map(rows.map((row) => [row.editionId, row]));
    const visible = selected.map((id) => byId.get(id)).filter(Boolean);
    const installed = visible.filter((row) => row.downloadStatus === 'installed');
    const missing = visible.filter(
      (row) => row.downloadStatus !== 'installed' && !BUSY.has(row.downloadStatus),
    );

    this.#nodes.bulk.replaceChildren(
      h(
        'div',
        { class: 'downloads__bulk-bar' },
        h(
          'span',
          { class: 'label-md' },
          t('downloads.selectedCount', { count: selected.length }),
        ),
        missing.length > 0 &&
          h(
            'button',
            {
              class: 'button button--filled',
              onclick: () =>
                this.#run(async () => {
                  const queued = await repository.downloadSelection(
                    missing.map((row) => row.editionId),
                  );
                  toast(t('downloads.queued', { count: queued }));
                }),
            },
            icon('download', { size: 18 }),
            h('span', {}, t('downloads.downloadCount', { count: missing.length })),
          ),
        installed.length > 0 &&
          h(
            'button',
            {
              class: 'button button--danger',
              onclick: () => this.#confirmDelete(installed),
            },
            icon('trash', { size: 18 }),
            h('span', {}, t('downloads.deleteCount', { count: installed.length })),
          ),
        h(
          'button',
          {
            class: 'button button--tonal',
            onclick: () => {
              this.#selection.clear();
              this.#refresh();
            },
          },
          t('downloads.clearSelection'),
        ),
      ),
    );
  }

  async #confirmDelete(rows) {
    const bytes = rows.reduce((total, row) => total + (row.localBytes || 0), 0);
    const choice = await confirmDialog({
      title:
        rows.length === 1
          ? t('downloads.deleteOne')
          : t('downloads.deleteMany', { count: rows.length }),
      message:
        t('downloads.deleteMessage', { size: formatBytes(bytes) || t('format.zeroBytes') }),
      actions: [{ value: 'go', label: t('action.delete'), variant: 'danger' }],
    });
    if (choice !== 'go') return;

    await this.#run(async () => {
      const removed = await repository.deleteBooks(rows.map((row) => row.editionId));
      for (const row of rows) {
        this.#selection.delete(row.editionId);
        // Un livre effacé quitte aussi « ce qu'on vient de télécharger » :
        // sinon son bouton « lire » survivrait à son fichier.
        this.#finished.delete(row.editionId);
      }
      toast(t('downloads.deleted', { count: removed }));
    });
  }

  /** Exécute une action et redessine ; l'échec se dit, il ne casse pas l'écran. */
  async #run(action) {
    try {
      await action();
    } catch (error) {
      toast(error?.message ?? t('notes.actionFailed'));
    }
    if (this.#host.isConnected) this.#refresh();
  }
}
