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
 * devinée à partir du numéro de version. Une plateforme annoncée dont la
 * Release ne porte aucun artefact garde donc sa carte, et y dit qu'elle n'est
 * pas encore publiée : nommer une plateforme sans lien est une réponse, un lien
 * fabriqué serait un 404 différé.
 */
import { PLATFORMS, platformIcon, url } from '../config.mjs';
import { formatSize } from '../lib/releases.mjs';
import { attrs, escapeHtml, icon, safeUrl } from '../lib/html.mjs';
import { pagePath } from './layout.mjs';

/**
 * Un encadré d'avertissement, sobre : il dit une gêne réelle à l'installation,
 * il ne doit ni se cacher ni crier. `key` désigne le couple `.heading`/`.body`
 * déclaré par la plateforme dans `config.mjs`.
 */
function notice(t, key) {
  return `<div class="notice">
        <h3 class="notice__title">${icon('alert')}${escapeHtml(t(`${key}.heading`))}</h3>
        <p class="notice__body">${escapeHtml(t(`${key}.body`))}</p>
      </div>`;
}

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

/**
 * La carte d'une plateforme : son nom, son tracé, puis ses artefacts — ou, si
 * la Release n'en porte aucun, la mention qu'elle n'est pas encore publiée.
 *
 * L'avertissement vient **après** la liste, contre le lien qu'on vient de lire.
 * Il est rendu dans les deux cas : ce qu'il décrit est une propriété du build,
 * pas d'un fichier, et quelqu'un qui attend une plateforme a le droit de savoir
 * ce qu'il recevra avant de l'attendre.
 */
function platformCard(platform, assets, context) {
  const { t } = context;
  const body = assets.length
    ? `<ul class="platform__assets">
        ${assets.map((asset) => assetRow(asset, context)).join('\n        ')}
      </ul>`
    : `<p class="platform__pending">${escapeHtml(t('platform.pending'))}</p>`;

  return `<section class="platform"${attrs({ 'data-platform': platform.key })}>
      <h2 class="platform__title">${icon(platformIcon(platform.key))}${escapeHtml(t(`platform.${platform.key}`))}</h2>
      ${body}
      ${platform.notice ? notice(t, platform.notice) : ''}
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

  // L'avertissement SmartScreen a quitté ce cahier pour la carte Windows : un
  // avertissement d'installation appartient à la plateforme qu'il concerne, et
  // à l'endroit où l'on clique. Dans une colonne de côté intitulée
  // « configuration requise », il parlait de Windows à qui téléchargeait un
  // .deb. Une seule règle, portée par `PLATFORMS[].notice`.
  return `<aside class="specs">
    <h2 class="specs__title">${escapeHtml(t('specs.heading'))}</h2>
    <dl class="specs__list">
      ${rows}
    </dl>
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

  // Toutes les plateformes annoncées, **qu'elles portent un artefact ou non** :
  // c'est la seule façon de dire « Android existe, il n'est pas encore
  // publié ». Filtrer sur la présence d'un artefact la faisait disparaître,
  // et une plateforme absente ne se distingue pas d'une plateforme oubliée.
  // Ce qu'une Release porte en plus — un .dmg un jour — suit derrière.
  const ordered = [
    ...PLATFORMS,
    ...[...byPlatform.keys()]
      .filter((key) => !PLATFORMS.some((platform) => platform.key === key))
      .map((key) => ({ key })),
  ];

  const cards = ordered
    .map((platform) => platformCard(platform, byPlatform.get(platform.key) ?? [], { t, locale }))
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
