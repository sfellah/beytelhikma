import { DEFAULT_LOCALE, localeDir, LOCALES, resolveLocale } from '../../shared/locale.js';
import { formatNumber } from '../../shared/digits.js';
import { translate } from '../../shared/translate.js';
import { applyAppFont, interfaceScript } from './app-font.js';
import ar from './locales/ar.js';
import en from './locales/en.js';
import { setSetting, settings } from './repository.js';
import { remount } from './router.js';

export { LOCALES, resolveLocale };

/**
 * La langue de l'interface : les mots, la direction de *l'interface*, et la
 * forme des chiffres. Rien d'autre.
 *
 * La direction du **contenu** ne s'en déduit pas. Le corpus est arabe : une
 * page de livre, un titre d'œuvre, un sommaire restent RTL sous une interface
 * anglaise, et portent leur `dir` explicitement. Une direction implicite est
 * une direction qui casse à la première bascule — et en mode `ar` la
 * coïncidence masquerait le défaut.
 */

const CATALOGS = { ar, en };

/** Source de vérité : `user.sqlite`. */
const SETTING_KEY = 'app.locale';

/**
 * Miroir de peinture, jamais interrogé comme vérité. Les réglages arrivent par
 * IPC après le premier rendu : sans ce miroir, une interface anglaise
 * s'ouvrirait en RTL arabe puis basculerait, à chaque lancement.
 */
const MIRROR_KEY = 'beytelhikma.locale';

let current = DEFAULT_LOCALE;

function readMirror() {
  try {
    return localStorage.getItem(MIRROR_KEY);
  } catch {
    return null;
  }
}

/** Pose la locale et la miroite. Rend la clé retenue, jamais l'entrée brute. */
export function applyLocale(stored) {
  const key = resolveLocale(stored);
  current = key;
  const root = document.documentElement;
  root.lang = key;
  root.dir = localeDir(key);
  try {
    localStorage.setItem(MIRROR_KEY, key);
  } catch {
    // Miroir facultatif : l'absence coûte un saut au démarrage, rien de plus.
  }
  return key;
}

export function currentLocale() {
  return current;
}

/** Traduit et interpole. Les nombres passés en paramètre suivent la locale. */
export function t(key, params) {
  return translate(CATALOGS[current], key, params, current);
}

/** Formate un nombre isolé — un compteur, un total — hors de toute phrase. */
export function n(value) {
  return formatNumber(value, current);
}

/**
 * Choix de l'utilisateur : pose la langue, l'écrit dans `user.sqlite`, puis
 * remonte la vue courante. Les vues rendent leurs chaînes au montage ; sans
 * remontée, la nouvelle langue n'apparaîtrait qu'à la navigation suivante.
 */
export function setLocale(stored) {
  const key = applyLocale(stored);
  setSetting(SETTING_KEY, key);
  // La face d'interface est rangée par écriture : changer de langue change
  // d'écriture, donc de face. Sans ce rappel, l'anglais s'ouvrirait dans une
  // face arabe qui ne rend pas l'alphabet latin de la même main.
  syncAppFont(interfaceScript(key));
  remount();
  return key;
}

/** Repose la face d'interface depuis `user.sqlite` pour l'écriture donnée. */
async function syncAppFont(script) {
  const prefs = await settings().catch(() => ({}));
  applyAppFont(prefs[`app.font.${script}`], script);
}

/** Réconcilie le miroir avec `user.sqlite` une fois les réglages arrivés. */
export async function syncLocale() {
  const prefs = await settings().catch(() => ({}));
  return applyLocale(prefs[SETTING_KEY] ?? DEFAULT_LOCALE);
}

// Peinture immédiate, à l'import : ce module est chargé avant `app.js`, donc
// avant qu'une seule vue n'ait été montée.
applyLocale(readMirror());
