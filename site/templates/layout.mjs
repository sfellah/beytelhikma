/**
 * L'enveloppe commune aux neuf pages : `<html dir lang>`, en-tête, pied,
 * métadonnées sociales et alternats de langue.
 *
 * Les gabarits sont des modules JavaScript, pas un langage de gabarit maison :
 * le projet n'a pas de moteur de rendu et n'a aucune raison d'en acquérir un
 * pour trois pages. Une fonction qui rend une chaîne se lit, se teste et
 * s'appelle sans parseur.
 */
import { SITE_LOCALES, absoluteUrl, url } from '../config.mjs';
import { attrs, escapeHtml, icon, safeUrl } from '../lib/html.mjs';

/** `('ar', 'index')` → `ar/`, `('ar', 'download')` → `ar/download/`. */
export function pagePath(locale, page) {
  return page === 'index' ? `${locale}/` : `${locale}/${page}/`;
}

function languageNav(locale, page, t) {
  const links = SITE_LOCALES.map((entry) => {
    const current = entry.key === locale;
    return `<a${attrs({
      class: `lang__link${current ? ' lang__link--on' : ''}`,
      href: url(pagePath(entry.key, page)),
      lang: entry.key,
      dir: entry.dir,
      'aria-current': current ? 'true' : null,
    })}>${escapeHtml(entry.label)}</a>`;
  }).join('');

  return `<nav class="lang" aria-label="${escapeHtml(t('nav.language'))}">${links}</nav>`;
}

function header(locale, page, t) {
  const link = (target, key) =>
    `<a${attrs({
      class: `topbar__link${target === page ? ' topbar__link--on' : ''}`,
      href: url(pagePath(locale, target)),
      'aria-current': target === page ? 'page' : null,
    })}>${escapeHtml(t(key))}</a>`;

  return `<header class="topbar">
  <div class="topbar__inner">
    <a class="brand" href="${url(pagePath(locale, 'index'))}">
      <img class="brand__mark" src="${url('assets/brand/mark.png')}" alt="" width="32" height="32" />
      <span class="brand__name">${escapeHtml(t('site.name'))}</span>
    </a>
    <nav class="topbar__nav" aria-label="${escapeHtml(t('site.name'))}">
      ${link('index', 'nav.home')}
      ${link('releases', 'nav.releases')}
      ${languageNav(locale, page, t)}
      ${/* Sur `/download/`, ce bouton proposait la page où l'on se trouve déjà :
           le seul appel de la barre haute, et il ne menait nulle part. Il devient
           un repère — `aria-current` pour qui écoute, et l'encre du texte au lieu
           de celle de l'appel pour qui voit, exactement comme `.topbar__link--on`
           deux lignes plus haut. */ ''}
      <a${attrs({
        class: `button button--small${page === 'download' ? ' button--on' : ''}`,
        href: url(pagePath(locale, 'download')),
        'aria-current': page === 'download' ? 'page' : null,
      })}>${icon('download')}${escapeHtml(t('nav.download'))}</a>
    </nav>
  </div>
</header>`;
}

/**
 * Le pied est un colophon : qui édite, sous quelle licence, d'où vient le
 * texte, en quels caractères il est composé. C'est la fin de livre, et c'est
 * aussi le seul endroit honnête où dire que les polices sont embarquées.
 */
function footer(locale, t, { repoUrl, builtVersion }) {
  return `<footer class="footer">
  <div class="footer__inner">
    <h2 class="footer__heading">${escapeHtml(t('colophon.heading'))}</h2>
    <div>
      <p class="footer__line">
        <a class="footer__link" href="${safeUrl(repoUrl)}" rel="noopener">${icon('code')}${escapeHtml(t('nav.source'))}</a>
        <a class="footer__link" href="${safeUrl(`${repoUrl}/issues`)}" rel="noopener">${icon('external')}${escapeHtml(t('footer.issues'))}</a>
        ${/* La confidentialité vit au pied et non dans la barre haute : le Play
             Console veut une URL stable et publique, pas un appel à l'action.
             La barre haute porte ce qu'on vient faire — lire, télécharger ; le
             colophon porte ce qui répond de la page. */ ''}
        <a class="footer__link" href="${url(pagePath(locale, 'privacy'))}">${icon('lock')}${escapeHtml(t('footer.privacy'))}</a>
      </p>
      <p class="footer__note">${escapeHtml(t('footer.license'))}</p>
      <p class="footer__note">${escapeHtml(t('footer.corpus'))}</p>
      <p class="footer__note">${escapeHtml(t('colophon.typefaces'))}</p>
      <p class="footer__note footer__note--faint">${escapeHtml(t('footer.built', { version: builtVersion }))}</p>
    </div>
  </div>
</footer>`;
}

export function layout({
  locale,
  dir,
  page,
  title,
  description,
  body,
  sprite,
  t,
  repoUrl,
  builtVersion,
}) {
  const alternates = SITE_LOCALES.map(
    (entry) =>
      `<link rel="alternate" hreflang="${escapeHtml(entry.hreflang)}" href="${escapeHtml(absoluteUrl(pagePath(entry.key, page)))}" />`,
  ).join('\n  ');

  return `<!doctype html>
<html lang="${escapeHtml(locale)}" dir="${escapeHtml(dir)}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <link rel="canonical" href="${escapeHtml(absoluteUrl(pagePath(locale, page)))}" />
  ${alternates}
  <link rel="alternate" hreflang="x-default" href="${escapeHtml(absoluteUrl(''))}" />
  <link rel="icon" href="${url('assets/brand/mark.png')}" type="image/png" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:url" content="${escapeHtml(absoluteUrl(pagePath(locale, page)))}" />
  <meta property="og:image" content="${escapeHtml(absoluteUrl('assets/brand/lockup.png'))}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="theme-color" content="#fbf4ed" />
  <link rel="stylesheet" href="${url('styles/tokens.css')}" />
  <link rel="stylesheet" href="${url('styles/fonts.css')}" />
  <link rel="stylesheet" href="${url('styles/site.css')}" />
</head>
<body class="page page--${escapeHtml(page)}">
${sprite}
<a class="skip" href="#main">${escapeHtml(t('nav.skip'))}</a>
${header(locale, page, t)}
<main id="main" class="main">
${body}
</main>
${footer(locale, t, { repoUrl, builtVersion })}
<script src="${url('assets/site.js')}" defer></script>
</body>
</html>
`;
}
