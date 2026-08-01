/**
 * La page de téléchargement.
 *
 * Toutes les plateformes sont rendues **au build**, visibles et cliquables sans
 * JavaScript. Le script de détection ne fait que remonter et marquer celle qui
 * correspond au visiteur : un bouton principal qui n'existerait qu'après
 * exécution d'un script serait une page de téléchargement qui ne télécharge
 * rien quand le script échoue.
 *
 * Les liens viennent des artefacts réellement publiés, jamais d'une URL
 * devinée à partir du numéro de version.
 */
import { PLATFORMS, url } from '../config.mjs';
import { formatSize } from '../lib/releases.mjs';
import { attrs, escapeHtml, icon, safeUrl } from '../lib/html.mjs';
import { pagePath } from './layout.mjs';

const PLATFORM_ICON = { windows: 'laptop', linux: 'terminal', macos: 'laptop' };

function assetRow(asset, { t, locale }) {
  const size = formatSize(asset.size);
  const sizeText = size === null ? null : t('format.size', { value: size });

  return `<li class="asset">
        <a class="asset__link" href="${safeUrl(asset.url)}" download>
          ${icon('download')}
          <span class="asset__name">${escapeHtml(t(`asset.${asset.kind}`))}</span>
          ${sizeText ? `<span class="asset__size">${escapeHtml(sizeText)}</span>` : ''}
        </a>
        <p class="asset__hint">${escapeHtml(t(`asset.${asset.kind}.hint`))}</p>
        ${
          asset.sha512
            ? `<details class="asset__digest">
          <summary>${escapeHtml(t('download.checksum'))}</summary>
          <code class="asset__sha" dir="ltr">${escapeHtml(asset.sha512)}</code>
        </details>`
            : ''
        }
      </li>`;
}

function platformCard(platform, assets, context) {
  const { t } = context;
  return `<section class="platform"${attrs({ 'data-platform': platform })}>
      <h2 class="platform__title">${icon(PLATFORM_ICON[platform] ?? 'laptop')}${escapeHtml(t(`platform.${platform}`))}</h2>
      <ul class="platform__assets">
        ${assets.map((asset) => assetRow(asset, context)).join('\n        ')}
      </ul>
    </section>`;
}

function specs(t) {
  const rows = [
    ['specs.os', 'specs.os.value'],
    ['specs.ram', 'specs.ram.value'],
    ['specs.disk', 'specs.disk.value'],
    ['specs.net', 'specs.net.value'],
  ]
    .map(
      ([label, value]) =>
        `<div class="specs__row"><dt>${escapeHtml(t(label))}</dt><dd>${escapeHtml(t(value))}</dd></div>`,
    )
    .join('\n      ');

  return `<aside class="specs">
    <h2 class="specs__title">${escapeHtml(t('specs.heading'))}</h2>
    <dl class="specs__list">
      ${rows}
    </dl>
    <div class="notice">
      <h3 class="notice__title">${icon('alert')}${escapeHtml(t('smartscreen.heading'))}</h3>
      <p class="notice__body">${escapeHtml(t('smartscreen.body'))}</p>
    </div>
  </aside>`;
}

export function download({ locale, t, fmtDate, latest, repoUrl }) {
  if (!latest) {
    return `<section class="lead">
  <h1 class="lead__title">${escapeHtml(t('download.heading'))}</h1>
  <p class="lead__text">${escapeHtml(t('download.lede.none'))}</p>
  <p class="lead__text">${escapeHtml(t('download.empty'))}</p>
  <p><a class="button button--primary" href="${safeUrl(repoUrl)}" rel="noopener">${icon('code')}${escapeHtml(t('nav.source'))}</a></p>
</section>`;
  }

  const byPlatform = new Map();
  for (const asset of latest.assets) {
    if (!byPlatform.has(asset.os)) byPlatform.set(asset.os, []);
    byPlatform.get(asset.os).push(asset);
  }

  const ordered = [
    ...PLATFORMS.map((platform) => platform.key).filter((key) => byPlatform.has(key)),
    ...[...byPlatform.keys()].filter(
      (key) => !PLATFORMS.some((platform) => platform.key === key),
    ),
  ];

  const cards = ordered
    .map((platform) => platformCard(platform, byPlatform.get(platform), { t, locale }))
    .join('\n    ');

  return `<section class="lead">
  <h1 class="lead__title">${escapeHtml(t('download.heading'))}</h1>
  <p class="lead__text">${escapeHtml(t('download.lede', { version: latest.version, date: fmtDate(latest.published_at) }))}</p>
  <p class="lead__aside"><a class="link" href="${url(pagePath(locale, 'releases'))}">${escapeHtml(t('releases.heading'))}</a></p>
</section>

<div class="download">
  <div class="download__platforms" data-platforms data-recommended="${escapeHtml(t('download.recommended'))}">
    ${cards}
  </div>
  ${specs(t)}
</div>
`;
}
