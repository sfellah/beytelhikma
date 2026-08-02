/**
 * L'historique des versions, en frise verticale — la forme de la maquette
 * `docs/maquettes/site-download.html`, dont la dernière version est pleine et les
 * précédentes en retrait.
 *
 * Les notes viennent des `CHANGELOG.<langue>.md`, pas de l'API : le corps d'une
 * Release GitHub est un seul champ de texte, il ne peut pas porter trois
 * langues séparément. C'est le sens de la règle « les notes sont la source, la
 * Release en est dérivée ».
 */
import { escapeHtml, icon, safeUrl } from '../lib/html.mjs';
import { KINDS } from '../lib/changelog.mjs';

function notesFor(entry, locale, t) {
  const sections = entry.notes?.[locale];
  if (!sections?.length) {
    return `<p class="release__empty">${escapeHtml(t('releases.notes.empty'))}</p>`;
  }

  const ordered = [...sections].sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind));

  return ordered
    .map(
      (section) => `<div class="release__group release__group--${escapeHtml(section.kind)}">
        <h3 class="release__kind">${icon(section.kind)}${escapeHtml(t(`changelog.${section.kind}`))}</h3>
        <ul class="release__items">
          ${section.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('\n          ')}
        </ul>
      </div>`,
    )
    .join('\n      ');
}

function card(entry, { locale, t, fmtDate, latestVersion }) {
  const current = entry.version === latestVersion;
  const installer =
    entry.assets.find((asset) => asset.os === 'windows' && asset.kind === 'installer') ??
    entry.assets[0];

  return `<article class="release${current ? ' release--current' : ''}" id="v${escapeHtml(entry.version)}">
      <header class="release__head">
        <h2 class="release__version">
          ${escapeHtml(entry.version)}
          ${current ? `<span class="chip chip--on">${escapeHtml(t('releases.latest'))}</span>` : ''}
          ${entry.prerelease ? `<span class="chip">${escapeHtml(t('releases.prerelease'))}</span>` : ''}
        </h2>
        <p class="release__date"><time datetime="${escapeHtml(entry.published_at ?? '')}">${escapeHtml(t('releases.published', { date: fmtDate(entry.published_at) }))}</time></p>
      </header>
      <div class="release__body">
      ${notesFor(entry, locale, t)}
      </div>
      ${
        installer
          ? `<p class="release__foot"><a class="link" href="${safeUrl(installer.url)}" download>${icon('download')}${escapeHtml(t('releases.download'))}</a></p>`
          : ''
      }
    </article>`;
}

export function releases({ locale, t, fmtDate, index }) {
  const history = index.history ?? [];

  const body = history.length
    ? `<div class="timeline">
      ${history.map((entry) => card(entry, { locale, t, fmtDate, latestVersion: index.latest?.version })).join('\n      ')}
    </div>`
    : `<p class="lead__text">${escapeHtml(t('releases.empty'))}</p>`;

  return `<section class="lead">
  <h1 class="lead__title">${escapeHtml(t('releases.heading'))}</h1>
  <p class="lead__text">${escapeHtml(t('releases.lede'))}</p>
</section>

<section class="releases">
    ${body}
</section>
`;
}
