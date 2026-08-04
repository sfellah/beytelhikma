/**
 * La politique de confidentialité — exigée par le Play Console avant toute
 * publication, et par le RGPD dès qu'un serveur voit passer une adresse IP.
 *
 * Elle est écrite depuis **ce que le code fait**, pas depuis un gabarit
 * juridique recopié : chaque affirmation ci-dessous a son lieu dans le dépôt.
 * Le catalogue et les livres se lisent en `GET` anonyme (`download-manager.js`,
 * `catalog-updater.js`) ; `user.sqlite` ne traverse jamais le pont vers le
 * réseau ; le seul hôte tiers qu'on puisse joindre est celui des polices, et
 * seulement quand le lecteur en ajoute une (`font-installer.js`, et sa
 * transcription mobile `repo/polices.js`). Une politique qui promettrait moins
 * que cela mentirait par excès de prudence, et une qui promettrait plus
 * mentirait tout court.
 *
 * La forme suit le reste du site : un chapeau, des sections séparées par des
 * filets, aucune carte. Les sections sont **nommées une par une** — pas
 * bâties par boucle sur une table de clés. `test/locales.test.js` échoue sur
 * toute clé qu'aucune source ne cite en clair, et une famille bâtie à
 * l'exécution devrait s'exempter, donc se surveiller autrement. Trente clés
 * écrites franchement coûtent moins qu'une exemption à tenir.
 */
import { escapeHtml, icon } from '../lib/html.mjs';

/** Une section : un titre, un chapeau, et une liste facultative. */
function section(title, body, items = []) {
  const list = items.length
    ? `\n    <ul class="policy__list">
      ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('\n      ')}
    </ul>`
    : '';

  return `<section class="policy__section">
    <h2 class="policy__title">${escapeHtml(title)}</h2>
    <p class="policy__body">${escapeHtml(body)}</p>${list}
  </section>`;
}

export function privacy({ t, fmtDate, updated, email, repoUrl }) {
  return `<section class="lead">
  <h1 class="lead__title">${escapeHtml(t('privacy.heading'))}</h1>
  <p class="lead__text">${escapeHtml(t('privacy.lede'))}</p>
  <p class="lead__aside policy__updated">${icon('lock')}${escapeHtml(t('privacy.updated', { date: fmtDate(updated) }))}</p>
</section>

<div class="policy">
  <section class="policy__summary">
    <h2 class="policy__title">${escapeHtml(t('privacy.summary.title'))}</h2>
    <ul class="policy__list">
      <li>${escapeHtml(t('privacy.summary.account'))}</li>
      <li>${escapeHtml(t('privacy.summary.telemetry'))}</li>
      <li>${escapeHtml(t('privacy.summary.ads'))}</li>
      <li>${escapeHtml(t('privacy.summary.sale'))}</li>
    </ul>
  </section>

  ${section(t('privacy.device.title'), t('privacy.device.body'), [
    t('privacy.device.library'),
    t('privacy.device.progress'),
    t('privacy.device.annotations'),
    t('privacy.device.settings'),
  ])}

  ${section(t('privacy.network.title'), t('privacy.network.body'), [
    t('privacy.network.pointer'),
    t('privacy.network.catalog'),
    t('privacy.network.books'),
    t('privacy.network.anonymous'),
  ])}

  ${section(t('privacy.logs.title'), t('privacy.logs.body'), [
    t('privacy.logs.fields'),
    t('privacy.logs.retention'),
    t('privacy.logs.purpose'),
    t('privacy.logs.never'),
  ])}

  ${section(t('privacy.fonts.title'), t('privacy.fonts.body'))}

  ${section(t('privacy.permissions.title'), t('privacy.permissions.body'))}

  ${section(t('privacy.store.title'), t('privacy.store.body'))}

  ${section(t('privacy.children.title'), t('privacy.children.body'))}

  ${section(t('privacy.rights.title'), t('privacy.rights.body'))}

  ${section(t('privacy.changes.title'), t('privacy.changes.body'))}

  <section class="policy__section">
    <h2 class="policy__title">${escapeHtml(t('privacy.contact.title'))}</h2>
    <p class="policy__body">${escapeHtml(t('privacy.contact.body'))}</p>
    <p class="policy__contact">
      <a class="link" href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>
      ${/* Le dépôt reste offert comme second canal : une question de fond sur ce
           que l'application envoie se répond mieux en public, sous la ligne de
           code qui la tranche. Ce n'est pas le canal d'une demande personnelle,
           d'où l'adresse en premier. */ ''}
      <a class="link" href="${escapeHtml(`${repoUrl}/issues`)}" rel="noopener">${icon('external')}${escapeHtml(t('privacy.contact.issues'))}</a>
    </p>
  </section>
</div>
`;
}
