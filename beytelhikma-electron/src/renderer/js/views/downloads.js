import { h } from '../dom.js';
import { icon } from '../icons.js';
import { onDownloadsChanged, repository } from '../repository.js';
import { renderShell } from '../shell.js';
import { formatBytes } from '../components/download-action.js';
import { asyncView, emptyView } from '../components/states.js';

const SECTIONS = [
  {
    key: 'active',
    title: 'قيد التنزيل',
    keep: (job) => job.status === 'downloading' || job.status === 'verifying',
  },
  { key: 'queued', title: 'في الانتظار', keep: (job) => job.status === 'queued' },
  { key: 'failed', title: 'فشل', keep: (job) => job.status === 'failed' },
];

/** Écran de suivi de la file : en cours, en attente, échecs. */
export function downloadsView(host) {
  const content = renderShell(host, { active: 'downloads' });
  const load = async () => ({
    jobs: await repository.getDownloads(),
    usage: await repository.getStorageUsage(),
  });

  const refresh = () => asyncView(content, load, render, { empty: 'لا توجد تنزيلات' });
  refresh();

  const unsubscribe = onDownloadsChanged(() => {
    if (content.isConnected) refresh();
    else unsubscribe();
  });
  return null;
}

function render({ jobs, usage }) {
  const sections = SECTIONS.map((section) => [section, jobs.filter(section.keep)]).filter(
    ([, items]) => items.length > 0,
  );

  const header = h(
    'div',
    { class: 'downloads__header' },
    h('h1', { class: 'display-lg' }, 'التنزيلات'),
    h(
      'p',
      { class: 'body-md muted' },
      `${usage.bookCount} كتابًا • ${formatBytes(usage.bytes) || '0 ك.ب'}`,
    ),
  );

  if (!sections.length) {
    return h('section', { class: 'downloads' }, header, emptyView('لا توجد تنزيلات جارية'));
  }

  return h(
    'section',
    { class: 'downloads' },
    header,
    sections.map(([section, items]) =>
      h(
        'div',
        { class: 'downloads__section' },
        h(
          'div',
          { class: 'downloads__section-head' },
          h('h2', { class: 'headline-lg' }, section.title),
          section.key === 'failed' &&
            h(
              'button',
              { class: 'button button--tonal', onclick: () => repository.clearFailedDownloads() },
              'مسح الإخفاقات',
            ),
        ),
        items.map((job) => jobRow(job)),
      ),
    ),
  );
}

function jobRow(job) {
  const percent = Math.round((job.percent ?? 0) * 100);
  const failed = job.status === 'failed';
  return h(
    'article',
    { class: 'download-row' },
    h(
      'div',
      { class: 'download-row__main' },
      h('p', { class: 'title-md' }, job.editionId),
      failed
        ? h('p', { class: 'label-sm download-action__error' }, job.error ?? 'فشل التنزيل')
        : h('div', { class: 'progress' }, h('span', { style: { width: `${percent}%` } })),
      !failed &&
        h(
          'p',
          { class: 'label-sm muted' },
          `${percent}٪ • ${formatBytes(job.receivedBytes)} / ${formatBytes(job.totalBytes)}`,
        ),
    ),
    failed
      ? h(
          'button',
          {
            class: 'button--icon',
            title: 'إعادة المحاولة',
            onclick: () => repository.retryDownload(job.editionId),
          },
          icon('download', { size: 20 }),
        )
      : h(
          'button',
          {
            class: 'button--icon',
            title: 'إلغاء',
            onclick: () => repository.cancelDownload(job.editionId),
          },
          icon('close', { size: 20 }),
        ),
  );
}
