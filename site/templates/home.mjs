/**
 * L'accueil, composé comme une page de titre : une annonce, deux planches
 * légendées, un sommaire.
 *
 * Trois choses de la maquette ne sont pas reprises, parce qu'elles seraient
 * fausses : la synchronisation cloud, la « version navigateur » et les
 * applications mobiles à venir. L'application est locale, de bureau, sans
 * compte — une page d'accueil qui promet le contraire se paie au premier
 * téléchargement.
 *
 * Trois autres sont parties parce qu'elles étaient du décor : le cadre de
 * fenêtre avec ses pastilles rouge-jaune-vert, l'icône en carré arrondi au-
 * dessus de chaque titre, et la grille de quatre cartes identiques. Une
 * capture devient une planche, une fonction devient une entrée de sommaire.
 */
import { PLATFORMS, url } from '../config.mjs';
import { attrs, escapeHtml, icon } from '../lib/html.mjs';
import { pagePath } from './layout.mjs';

function badge(latest, t) {
  const text = latest ? t('home.badge', { version: latest.version }) : t('home.badge.none');
  return `<p class="badge">${escapeHtml(text)}</p>`;
}

function calls(locale, latest, t, defaultPlatform) {
  const download = url(pagePath(locale, 'download'));
  const label = latest
    ? t('home.cta.primary', { platform: t(`platform.${defaultPlatform}`) })
    : t('home.cta.pending');

  return `<p class="hero__calls">
      <a class="button button--primary"${attrs({ href: download, 'data-cta': 'primary' })}>${icon('download')}<span data-cta-label>${escapeHtml(label)}</span></a>
      <a class="link" href="${url(pagePath(locale, 'releases'))}">${escapeHtml(t('home.cta.secondary'))}</a>
    </p>`;
}

/**
 * Les plateformes, nommées et tracées, sous les appels.
 *
 * Elle ne paraît **que si une version est publiée**. Sans Release, le rappel et
 * l'appel disent déjà « première version en préparation » ; répéter le même
 * fait trois fois, une par plateforme, ne l'apprendrait à personne.
 *
 * Chacune est marquée d'après les artefacts que la Release porte réellement,
 * jamais d'après une liste écrite ici : c'est la même règle que les liens de la
 * page de téléchargement, appliquée à un mot au lieu d'une URL. Android est
 * donc au même rang que Windows et Linux, et se dit « bientôt » tant que rien
 * n'en est publié.
 */
function platforms(latest, t) {
  if (!latest) return '';

  const items = PLATFORMS.map((platform) => {
    const published = latest.assets.some((asset) => asset.os === platform.key);
    const soon = published
      ? ''
      : `<em class="hero__soon">${escapeHtml(t('platform.soon'))}</em>`;
    return `<li class="hero__platform${published ? '' : ' hero__platform--pending'}">${icon(platform.icon)}<span>${escapeHtml(t(`platform.${platform.key}`))}</span>${soon}</li>`;
  }).join('\n        ');

  return `<div class="hero__available">
      <h2 class="hero__available-title">${escapeHtml(t('home.platforms'))}</h2>
      <ul class="hero__platforms">
        ${items}
      </ul>
    </div>`;
}

/**
 * Une planche : le cadre, la vue, la légende sous un filet.
 *
 * L'image porte un `alt` vide **exprès** : la légende est visible et la
 * décrit. Répéter le même texte dans l'`alt` le ferait annoncer deux fois de
 * suite par un lecteur d'écran.
 */
function plate(name, caption, { className = '', eager = false } = {}) {
  // Les deux planches de tête ne sont pas différées : elles sont ce que
  // l'écran montre en premier, et `lazy` sur une image au-dessus de la ligne
  // de flottaison retarde exactement le pixel qui compte.
  const loading = eager
    ? 'loading="eager" fetchpriority="high"'
    : 'loading="lazy" fetchpriority="low"';

  return `<figure class="plate${className ? ` ${className}` : ''}">
        <div class="plate__frame">
          <img class="plate__shot" src="${url(`assets/shots/${name}`)}" alt="" ${loading} decoding="async" width="1280" height="800" />
        </div>
        <figcaption class="plate__caption">${escapeHtml(caption)}</figcaption>
      </figure>`;
}

function feature({ id, title, body, media = null }) {
  return `<article class="feature" id="${escapeHtml(id)}">
      <h3 class="feature__title">${escapeHtml(title)}</h3>
      <p class="feature__body">${escapeHtml(body)}</p>
      ${media ?? ''}
    </article>`;
}

export function home({ locale, t, latest, books, defaultPlatform }) {
  const trust = [
    [t('trust.free'), t('trust.free.detail')],
    [t('trust.private'), t('trust.private.detail')],
    [t('trust.offline'), t('trust.offline.detail')],
  ]
    .map(
      ([title, detail]) =>
        `<li class="trust__item"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span></li>`,
    )
    .join('\n      ');

  return `<section class="hero">
  <div class="hero__inner">
    <div class="hero__text">
      ${badge(latest, t)}
      <h1 class="hero__heading">${escapeHtml(t('home.heading'))}<br /><span class="hero__accent">${escapeHtml(t('home.heading.accent'))}</span></h1>
      <p class="hero__lede">${escapeHtml(t('home.lede', { books }))}</p>
      ${calls(locale, latest, t, defaultPlatform)}
      ${platforms(latest, t)}
    </div>
    <ul class="trust">
      ${trust}
    </ul>
  </div>
</section>

<section class="plates">
  ${plate('home.png', t('plate.home'), { eager: true })}
  ${plate('reader.png', t('plate.reader'), { eager: true })}
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
        title: t('features.offline.title'),
        body: t('features.offline.body'),
        media: plate('explore.png', t('plate.explore'), { className: 'feature__media' }),
      })}
      ${feature({
        id: 'corpus',
        title: t('features.corpus.title', { books }),
        body: t('features.corpus.body'),
      })}
      ${feature({
        id: 'reading',
        title: t('features.reading.title'),
        body: t('features.reading.body'),
        media: plate('reader-night.png', t('plate.night'), { className: 'feature__media' }),
      })}
      ${feature({
        id: 'arabic',
        title: t('features.arabic.title'),
        body: t('features.arabic.body'),
      })}
    </div>
  </div>
</section>
`;
}
