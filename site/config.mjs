/**
 * Le seul endroit du site qui connaisse un hôte, un dépôt ou un chemin.
 *
 * C'est la même règle que `src/shared/distribution.js` côté application : la
 * connaissance de « où vivent les choses » tient dans un module, et nulle part
 * ailleurs. Un déménagement de dépôt ou de domaine se fait donc ici, et le
 * reste du site n'en sait rien.
 */

/** Le dépôt d'où viennent les versions. */
export const REPO = { owner: 'sfellah', name: 'beytelhikma' };

/**
 * Le chemin sous lequel le site est servi.
 *
 * GitHub Pages sert un dépôt de projet sous `/<dépôt>/`, pas à la racine. Tout
 * lien interne passe donc par `url()` : un `/assets/…` écrit en dur marcherait
 * en développement et donnerait un 404 en production, ce qui est exactement le
 * genre de panne qui ne se voit qu'après publication. Avec un domaine propre,
 * cette constante devient `'/'` et rien d'autre ne bouge.
 */
export const BASE_PATH = '/beytelhikma/';

/** L'origine publique du site. Sert aux `hreflang`, à l'`og:url`, au sitemap. */
export const SITE_ORIGIN = 'https://sfellah.github.io';

/** Un chemin interne, préfixé une fois pour toutes. */
export function url(path = '') {
  return `${BASE_PATH}${String(path).replace(/^\//, '')}`;
}

/** La même chose en absolu, pour `hreflang`, `og:url` et le sitemap. */
export function absoluteUrl(path = '') {
  return `${SITE_ORIGIN}${url(path)}`;
}

/**
 * Les langues du **site**, qui ne sont pas celles de l'application.
 *
 * `src/shared/locale.js` n'en déclare que deux : le français y a été écarté
 * volontairement. Un site de présentation ne s'adresse pas au même public
 * qu'une interface de lecture — le projet se développe en français, sa page
 * d'accueil peut donc le parler sans que l'application le doive.
 *
 * Ne jamais importer `shared/locale.js` ici : `resolveLocale('fr')` y replie
 * sur l'arabe, ce qui est juste pour l'application et faux pour le site.
 */
export const SITE_LOCALES = [
  { key: 'ar', label: 'العربية', dir: 'rtl', hreflang: 'ar' },
  { key: 'fr', label: 'Français', dir: 'ltr', hreflang: 'fr' },
  { key: 'en', label: 'English', dir: 'ltr', hreflang: 'en' },
];

/** La langue servie à qui n'en demande aucune de connue. */
export const DEFAULT_LOCALE = 'ar';

/**
 * La forme des chiffres suit la langue, comme dans l'application.
 *
 * On délègue à `shared/translate.js`, mais son argument de locale ne connaît
 * que `ar` et `en` : le français veut les mêmes chiffres que l'anglais, donc
 * il s'y ramène. C'est exact, et ça évite de recopier la table des dix
 * caractères arabes-indiens dans un second module.
 */
export function digitsLocale(locale) {
  return locale === 'ar' ? 'ar' : 'en';
}

/**
 * Les plateformes annoncées, dans l'ordre d'affichage. **Seule liste** : le
 * tracé, l'exigence et l'avertissement d'installation d'une plateforme se
 * lisent ici, et le gabarit ne connaît aucune de ces trois choses par lui-même.
 * Une seconde table dans `templates/download.mjs` a déjà existé — c'est la
 * configuration qui a produit, ailleurs dans le projet, la police orpheline et
 * le thème `sepia` mort.
 *
 * `required` fait échouer le build si la dernière version ne porte aucun
 * artefact pour cette plateforme : un bouton qui pointe vers rien est pire
 * qu'un bouton absent, parce qu'il se découvre chez l'utilisateur.
 *
 * Android est annoncé et **non exigé**. L'application existe (`apps/mobile`,
 * Capacitor), mais aucun workflow ne construit encore l'APK : l'exiger ferait
 * échouer chaque build du site pour une plateforme dont on sait qu'elle n'a pas
 * d'artefact. Annoncée sans artefact, elle se dit « pas encore publiée » et ne
 * fabrique aucun lien — la page ne devine jamais une URL, pas même pour une
 * plateforme qu'elle nomme.
 *
 * `notice` désigne un couple de clés `<notice>.heading` / `<notice>.body` posé
 * **dans la carte de la plateforme**, là où l'on clique — jamais en note de bas
 * de page, qui est l'endroit où l'on ne lit pas.
 */
export const PLATFORMS = [
  { key: 'windows', required: true, icon: 'windows', notice: 'smartscreen' },
  { key: 'linux', required: true, icon: 'linux' },
  { key: 'android', required: false, icon: 'android', notice: 'apk.unsigned' },
];

/**
 * Le tracé d'une plateforme, y compris celles qu'on n'annonce pas.
 *
 * `macos` n'est pas dans la liste — aucun build n'en sort — mais une Release
 * pourrait en porter un artefact, et une carte sans icône se verrait. Le repli
 * est un portable : neutre, et jamais faux.
 */
export function platformIcon(key) {
  return PLATFORMS.find((platform) => platform.key === key)?.icon ?? 'laptop';
}

/** Les pages rendues, une fois par langue. */
export const PAGES = ['index', 'download', 'releases'];
