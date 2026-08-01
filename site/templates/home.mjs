/**
 * L'accueil : ce que fait l'application, montré avant d'être dit.
 *
 * Trois choses de la maquette ne sont pas reprises, parce qu'elles seraient
 * fausses : la synchronisation cloud, la « version navigateur » et les
 * applications mobiles à venir. L'application est locale, de bureau, sans
 * compte — une page d'accueil qui promet le contraire se paie au premier
 * téléchargement.
 */
import { url } from '../config.mjs';
import { attrs, escapeHtml, icon } from '../lib/html.mjs';
import { pagePath } from './layout.mjs';

function badge(latest, t) {
  const text = latest ? t('home.badge', { version: latest.version }) : t('home.badge.none');
  return `<p class="badge">${icon('layers')}<span>${escapeHtml(text)}</span></p>`;
}

function calls(locale, latest, t, defaultPlatform) {
  const download = url(pagePath(locale, 'download'));
  const label = latest
    ? t('home.cta.primary', { platform: t(`platform.${defaultPlatform}`) })
    : t('home.cta.pending');

  return `<p class="hero__calls">
      <a class="button button--primary"${attrs({ href: download, 'data-cta': 'primary' })}>${icon('download')}<span data-cta-label>${escapeHtml(label)}</span></a>
      <a class="button button--ghost" href="${url(pagePath(locale, 'releases'))}">${escapeHtml(t('home.cta.secondary'))}</a>
    </p>`;
}

function shot(name, alt, { className }) {
  return `<figure class="${escapeHtml(className)}">
        <div class="frame">
          <div class="frame__bar"><span></span><span></span><span></span></div>
          <img class="frame__shot" src="${url(`assets/shots/${name}`)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async" width="1280" height="800" />
        </div>
      </figure>`;
}

function feature({ id, iconName, title, body, wide = false, media = null }) {
  return `<article class="feature${wide ? ' feature--wide' : ''}" id="${escapeHtml(id)}">
      <span class="feature__icon">${icon(iconName)}</span>
      <h3 class="feature__title">${escapeHtml(title)}</h3>
      <p class="feature__body">${escapeHtml(body)}</p>
      ${media ?? ''}
    </article>`;
}

export function home({ locale, t, latest, books, defaultPlatform }) {
  const trust = [
    ['lock', t('trust.free'), t('trust.free.detail')],
    ['security', t('trust.private'), t('trust.private.detail')],
    ['offline', t('trust.offline'), t('trust.offline.detail')],
  ]
    .map(
      ([name, title, detail]) =>
        `<li class="trust__item">${icon(name)}<strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span></li>`,
    )
    .join('\n      ');

  return `<section class="hero">
  <div class="hero__inner">
    <div class="hero__text">
      ${badge(latest, t)}
      <h1 class="hero__heading">${escapeHtml(t('home.heading'))}<br /><span class="hero__accent">${escapeHtml(t('home.heading.accent'))}</span></h1>
      <p class="hero__lede">${escapeHtml(t('home.lede', { books }))}</p>
      ${calls(locale, latest, t, defaultPlatform)}
      <ul class="trust">
      ${trust}
      </ul>
    </div>
    <div class="hero__media">
      ${shot('home.png', t('home.shot.alt'), { className: 'hero__shot' })}
      ${shot('reader.png', t('home.shot.reader.alt'), { className: 'hero__shot hero__shot--behind' })}
    </div>
  </div>
</section>

<section class="features" id="features">
  <div class="features__inner">
    <header class="section-head">
      <h2 class="section-head__title">${escapeHtml(t('features.heading'))}</h2>
      <p class="section-head__lede">${escapeHtml(t('features.lede'))}</p>
    </header>
    <div class="features__grid">
      ${feature({
        id: 'offline',
        iconName: 'offline',
        title: t('features.offline.title'),
        body: t('features.offline.body'),
        wide: true,
        media: shot('explore.png', t('home.shot.alt'), { className: 'feature__media' }),
      })}
      ${feature({
        id: 'corpus',
        iconName: 'book',
        title: t('features.corpus.title', { books }),
        body: t('features.corpus.body'),
      })}
      ${feature({
        id: 'reading',
        iconName: 'layers',
        title: t('features.reading.title'),
        body: t('features.reading.body'),
        wide: true,
        media: shot('reader-night.png', t('home.shot.reader.alt'), { className: 'feature__media' }),
      })}
      ${feature({
        id: 'arabic',
        iconName: 'globe',
        title: t('features.arabic.title'),
        body: t('features.arabic.body'),
      })}
    </div>
  </div>
</section>
`;
}
