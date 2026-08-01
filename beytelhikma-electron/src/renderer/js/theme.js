import { DEFAULT_THEME, resolveTheme, THEMES } from '../../shared/theme.js';
import { setSetting, settings } from './repository.js';

export { THEMES, resolveTheme };

/**
 * Le thème est global : il se pose sur `<html>`, et `styles/tokens.css` en tire
 * toute la palette. Le lecteur n'en est plus qu'un consommateur parmi les
 * autres — ses variables `--reader-*` dérivent déjà de `--page`, `--ink` et
 * `--primary`, elles suivent sans être touchées.
 */

/** Source de vérité : `user.sqlite`. Clé d'avant la bascule, lue une fois. */
const SETTING_KEY = 'app.theme';
const LEGACY_KEY = 'reader.theme';

/**
 * Miroir de peinture, jamais interrogé comme vérité. `user.sqlite` arrive par
 * IPC après le premier rendu : sans ce miroir, ouvrir l'application en mode
 * nuit donnerait un éclair blanc de plusieurs centaines de millisecondes. Au
 * soir, c'est précisément ce qu'on voulait éviter.
 */
const MIRROR_KEY = 'beytelhikma.theme';

function readMirror() {
  try {
    return localStorage.getItem(MIRROR_KEY);
  } catch {
    return null;
  }
}

/** Pose le thème et le miroite. Renvoie la clé retenue, jamais l'entrée brute. */
export function applyTheme(stored) {
  const key = resolveTheme(stored);
  document.documentElement.dataset.theme = key;
  try {
    localStorage.setItem(MIRROR_KEY, key);
  } catch {
    // Miroir facultatif : l'absence coûte un éclair au démarrage, rien de plus.
  }
  return key;
}

export function currentTheme() {
  return resolveTheme(document.documentElement.dataset.theme);
}

/** Choix de l'utilisateur : peint tout de suite, écrit dans `user.sqlite`. */
export function setTheme(stored) {
  const key = applyTheme(stored);
  setSetting(SETTING_KEY, key);
  return key;
}

/**
 * Réconcilie le miroir avec `user.sqlite` une fois les réglages arrivés. Le
 * repli sur `reader.theme` fait survivre un choix antérieur à la bascule ;
 * cette clé n'est plus jamais écrite.
 */
export async function syncTheme() {
  const prefs = await settings().catch(() => ({}));
  return applyTheme(prefs[SETTING_KEY] ?? prefs[LEGACY_KEY] ?? DEFAULT_THEME);
}

// Peinture immédiate, à l'import : ce module est chargé avant `app.js`, donc
// avant qu'une seule vue n'ait été montée.
applyTheme(readMirror());
