/**
 * La mise à jour du catalogue, proposée au démarrage.
 *
 * « La mise à jour se propose, ne s'impose pas. » Cinq branches de décision
 * sur six sont silencieuses — hors ligne, pointeur illisible, schéma trop
 * récent, déjà à jour, version refusée : une application hors ligne a déjà
 * tout ce qu'il lui faut pour explorer, lui afficher une alerte serait du
 * bruit. Seule `action === 'offer'` se voit, sous la forme d'une bande
 * discrète qu'on peut écarter — jamais une boîte modale qui barre la route.
 *
 * Écarter la bande, c'est refuser **cette version-là**
 * (`distribution.declined_catalog_version`) : refuser la 2 ne fait pas taire
 * la 3, et le bouton de `/settings` repose la question sans tenir compte du
 * refus (`ignoreDeclined` lui appartient, pas à nous).
 *
 * Ce module vit dans le rendu **partagé** : le mobile le régénère tel quel, et
 * les trois méthodes qu'il appelle sont portées des deux côtés du pont.
 */
import { h } from './dom.js';
import { t } from './i18n.js';
import { repository } from './repository.js';
import { remount } from './router.js';
import { toast } from './shell.js';

/**
 * Le premier rendu passe devant : la proposition est un confort, l'écran
 * qu'on est venu ouvrir est la raison du démarrage. Quelques secondes de
 * retard ne changent rien à la proposition — le pointeur, lui, porte déjà son
 * propre délai de garde côté repository.
 */
const STARTUP_DELAY_MS = 2500;

/** Programme la vérification. Ne bloque rien : `app.js` l'appelle sans await. */
export function proposeCatalogUpdate({ delayMs = STARTUP_DELAY_MS } = {}) {
  setTimeout(run, delayMs);
}

async function run() {
  let verdict;
  try {
    // Sans `ignoreDeclined` : une vérification automatique respecte un refus
    // passé. C'est le bouton de `/settings` qui repose la question.
    verdict = await repository.checkCatalogUpdate();
  } catch {
    return; // l'échec d'une vérification automatique n'a rien à dire
  }
  if (verdict?.action !== 'offer') return; // les cinq branches silencieuses
  showBanner(verdict.pointer);
}

function showBanner(pointer) {
  document.querySelector('.update-banner')?.remove();

  const label = h(
    'span',
    { class: 'update-banner__text body-md' },
    t('update.catalogAvailable', { version: pointer.catalog_version }),
  );

  const install = h(
    'button',
    {
      class: 'button button--filled',
      onclick: async () => {
        install.disabled = true;
        skip.disabled = true;
        label.textContent = t('settings.catalogDownloading');
        try {
          // La décision est reprise côté repository : un pointeur qui a bougé
          // entre la bannière et le clic ne fait pas installer autre chose.
          const { catalogVersion } = await repository.installCatalogUpdate();
          banner.remove();
          // Version nulle : le pointeur a bougé, rien n'a été installé —
          // l'annoncer serait pire que se taire.
          if (catalogVersion == null) return;
          toast(t('settings.catalogUpdated', { version: catalogVersion }));
          // Les écrans lisent le catalogue au montage : seule une remontée
          // leur fait voir celui qui vient d'être installé.
          remount();
        } catch (error) {
          // La bande reste : l'échec est dit, la proposition tient toujours.
          install.disabled = false;
          skip.disabled = false;
          label.textContent = t('update.catalogAvailable', {
            version: pointer.catalog_version,
          });
          toast(error?.message ?? t('settings.catalogFailed'));
        }
      },
    },
    t('update.install'),
  );

  const skip = h(
    'button',
    {
      class: 'button',
      onclick: () => {
        banner.remove();
        // Refuser cette version-là : la bande ne reviendra pas pour elle,
        // elle reviendra pour la suivante.
        repository.declineCatalogUpdate(pointer.catalog_version).catch(() => {});
      },
    },
    t('update.skip'),
  );

  const banner = h(
    'div',
    { class: 'update-banner', role: 'status' },
    label,
    h('div', { class: 'update-banner__actions' }, skip, install),
  );

  // Sur `document.body`, comme le toast : la bande survit aux navigations —
  // le routeur ne remplace que le contenu de `#app` — et s'écarte d'un geste.
  document.body.append(banner);
}
