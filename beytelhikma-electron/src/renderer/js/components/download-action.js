import { h } from '../dom.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { onDownloadsChanged, repository } from '../repository.js';
import { toast } from '../shell.js';

/**
 * Octets -> « ١٢.٤ م.ب » ou « 12.4 MB ». L'unité et les chiffres suivent la
 * locale : la valeur part en nombre, c'est `translate` qui la met en forme.
 */
export function formatBytes(bytes) {
  if (!bytes) return '';
  const mega = bytes / (1024 * 1024);
  if (mega >= 1) return t('format.megabytes', { value: Number(mega.toFixed(1)) });
  return t('format.kilobytes', { value: Math.max(1, Math.round(bytes / 1024)) });
}

/** Statuts pendant lesquels la file travaille encore sur ce livre. */
const BUSY = new Set(['queued', 'downloading', 'verifying']);

/**
 * Bloc d'action unique de la fiche livre : télécharger, patienter, annuler,
 * lire, supprimer, réessayer. S'abonne au canal poussé et se redessine seul ;
 * l'abonnement se coupe dès que le nœud quitte le document.
 */
export function downloadAction({ book, download, progress, onOpen, onDelete }) {
  const host = h('div', { class: 'download-action' });
  let state = { ...download };

  const unsubscribe = onDownloadsChanged((jobs) => {
    if (!host.isConnected) {
      unsubscribe();
      return;
    }
    const job = jobs.find((item) => item.editionId === book.editionId);
    if (job) {
      state = { ...state, ...job };
      draw();
      return;
    }
    // Le job a quitté la file : soit installé, soit annulé. Seule la fiche
    // rechargée sait laquelle des deux.
    if (BUSY.has(state.status)) refreshFromRepository();
  });

  async function refreshFromRepository() {
    try {
      const fresh = await repository.getBookDetail(book.editionId);
      state = { ...state, ...fresh.download };
    } catch {
      state = { ...state, status: null, percent: 0, error: null };
    }
    draw();
  }

  async function run(action, fallbackMessage) {
    try {
      await action();
    } catch (error) {
      toast(error?.message ?? fallbackMessage);
    }
    draw();
  }

  function draw() {
    host.replaceChildren(...content());
  }

  function cancelButton() {
    return h(
      'button',
      {
        class: 'button button--tonal',
        onclick: () => run(() => repository.cancelDownload(book.editionId), t('download.cancelFailed')),
      },
      h('span', {}, t('download.cancel')),
    );
  }

  function content() {
    const percent = Math.round((state.percent ?? 0) * 100);
    switch (state.status) {
      case 'queued':
        return [h('p', { class: 'label-md muted' }, t('download.queued')), cancelButton()];
      case 'downloading':
        return [
          h('div', { class: 'progress' }, h('span', { style: { width: `${percent}%` } })),
          h('p', { class: 'label-sm muted' }, t('format.percent', { value: percent })),
          cancelButton(),
        ];
      case 'verifying':
        return [h('p', { class: 'label-md muted' }, t('download.verifying'))];
      case 'installed':
        return [
          h(
            'button',
            { class: 'button button--filled', onclick: onOpen },
            icon('bookOpen', { size: 20 }),
            h('span', {}, t(progress ? 'download.continue' : 'download.start')),
          ),
          h(
            'button',
            { class: 'button button--tonal', onclick: onDelete },
            icon('close', { size: 20 }),
            h('span', {}, t('action.delete')),
          ),
        ];
      case 'failed':
        return [
          h('p', { class: 'label-md download-action__error' }, state.error ?? t('download.failed')),
          h(
            'button',
            {
              class: 'button button--filled',
              onclick: () => run(() => repository.retryDownload(book.editionId), t('download.failed')),
            },
            h('span', {}, t('download.retry')),
          ),
        ];
      default:
        return [
          h(
            'button',
            {
              class: 'button button--filled',
              onclick: () => run(() => repository.downloadBook(book.editionId), t('download.failed')),
            },
            icon('download', { size: 20 }),
            h(
              'span',
              {},
              state.compressedSize
                ? t('download.actionSized', { size: formatBytes(state.compressedSize) })
                : t('download.action'),
            ),
          ),
          progress &&
            h(
              'p',
              { class: 'label-sm muted' },
              t('download.resumeFrom', { page: progress.sequenceNum }),
            ),
        ];
    }
  }

  draw();
  return host;
}
