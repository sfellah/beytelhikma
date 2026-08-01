import { DEFAULT_INTERFACE_FONT, fontStack, resolveFont } from '../../shared/fonts.js';
import { localeDigits } from '../../shared/locale.js';
import { setSetting, settings } from './repository.js';

/**
 * La police de l'interface — coque, navigation, listes, réglages.
 *
 * Elle ne touche pas au livre : `reader.font` gouverne seul le texte des
 * pages, et le corpus est arabe quoi qu'il arrive.
 *
 * Le choix est **rangé par écriture**. Une face latine ne rendrait rien d'une
 * interface arabe et réciproquement ; garder une seule clé aurait fait perdre
 * le choix arabe à chaque aller-retour vers l'anglais.
 */

const KEYS = { arab: 'app.font.arab', latn: 'app.font.latn' };
const MIRROR = { arab: 'beytelhikma.font.arab', latn: 'beytelhikma.font.latn' };

/**
 * L'écriture de l'interface se déduit de la locale, jamais du contenu.
 *
 * La locale est lue sur `<html lang>`, que pose `i18n.js`, plutôt qu'importée :
 * `i18n.js` doit pouvoir appeler ce module au changement de langue, et deux
 * modules qui s'importent l'un l'autre ne se chargent pas.
 */
export function interfaceScript(locale = document.documentElement.lang) {
  return localeDigits(locale) === 'arab' ? 'arab' : 'latn';
}

function readMirror(script) {
  try {
    return localStorage.getItem(MIRROR[script]);
  } catch {
    return null;
  }
}

/**
 * Pose la face sur `<html>`. Les jetons `--font-display` et `--font-label` sont
 * surchargés en ligne plutôt que par un bloc CSS par police : la pile de repli
 * système reste dans la valeur, donc un fichier manquant ne laisse jamais
 * l'interface sans police.
 *
 * `--font-body` et `--font-naskh` ne bougent pas : elles servent le lecteur.
 */
export function applyAppFont(stored, script = interfaceScript()) {
  const key = resolveFont(stored, script, DEFAULT_INTERFACE_FONT[script]);
  const stack = fontStack(key, script, DEFAULT_INTERFACE_FONT[script]);
  const root = document.documentElement;
  root.style.setProperty('--font-display', stack);
  root.style.setProperty('--font-label', stack);
  root.dataset.appFont = key;
  try {
    localStorage.setItem(MIRROR[script], key);
  } catch {
    // Miroir facultatif : l'absence coûte un saut au démarrage, rien de plus.
  }
  return key;
}

export function currentAppFont(script = interfaceScript()) {
  return resolveFont(document.documentElement.dataset.appFont, script, DEFAULT_INTERFACE_FONT[script]);
}

export function setAppFont(stored, script = interfaceScript()) {
  const key = applyAppFont(stored, script);
  setSetting(KEYS[script], key);
  return key;
}

/** Réconcilie le miroir avec `user.sqlite`, et suit un changement de langue. */
export async function syncAppFont() {
  const script = interfaceScript();
  const prefs = await settings().catch(() => ({}));
  return applyAppFont(prefs[KEYS[script]], script);
}

// Peinture immédiate, à l'import : ce module est chargé avant `app.js`, donc
// avant qu'une seule vue n'ait été montée. Sans lui, l'interface s'ouvrirait
// dans la face par défaut puis sauterait à celle choisie.
applyAppFont(readMirror(interfaceScript()));
