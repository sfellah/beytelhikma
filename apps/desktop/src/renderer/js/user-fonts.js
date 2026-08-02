import { fontStack, resolveFont } from '../../shared/fonts.js';
import { repository } from './repository.js';

/**
 * Les polices ajoutées depuis Google Fonts.
 *
 * Elles ne rejoignent pas `shared/fonts.js` : cette liste-là est close et
 * testée, celle-ci vient de `user.sqlite` et change en cours de session. Les
 * deux se rejoignent au moment de choisir, pas au moment de déclarer.
 *
 * Les règles `@font-face` sont écrites par le processus principal
 * (`font-installer.js`) et posées dans une balise `<style>` : la feuille de
 * Google n'est jamais servie, seules ses valeurs traversent.
 */

let loaded = [];

/**
 * Une feuille **construite**, pas une balise `<style>`.
 *
 * La CSP est `style-src 'self'` : une balise injectée est du style en ligne et
 * se fait refuser. Une `CSSStyleSheet` bâtie par le code ne passe pas par
 * l'analyseur de document et n'en relève donc pas — et l'alternative, ouvrir
 * `style-src`, autoriserait bien plus que ces quelques `@font-face`.
 */
let sheet = null;

function userSheet() {
  if (sheet) return sheet;
  try {
    sheet = new CSSStyleSheet();
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  } catch {
    sheet = null; // moteur sans feuilles construites : on se passe des ajouts
  }
  return sheet;
}

/** Relit la liste et repose les règles. Appelée au démarrage et après un ajout. */
export async function syncUserFonts() {
  try {
    loaded = await repository.listFonts();
  } catch {
    // Une police illisible ne doit pas empêcher l'application de s'ouvrir :
    // les six familles embarquées suffisent à tout peindre.
    loaded = [];
  }
  userSheet()?.replaceSync(loaded.map((font) => font.css).join('\n\n'));
  return loaded;
}

export function userFonts(script = null) {
  return script ? loaded.filter((font) => font.scripts.includes(script)) : loaded;
}

/** Une police ajoutée se présente comme une famille embarquée, en plus souple. */
function asFamily(font) {
  return {
    key: font.key,
    family: font.family,
    label: font.family,
    stack: `'${font.family.replace(/'/g, '')}', serif`,
    user: true,
  };
}

/** Les familles proposées pour une écriture : les embarquées, puis les ajoutées. */
export function familiesFor(script, builtins) {
  return [...builtins, ...userFonts(script).map(asFamily)];
}

/**
 * Résout une clé qui peut désigner une police ajoutée. `resolveFont` seul ne
 * les connaît pas — elle replierait un choix valide sur le défaut à chaque
 * rendu.
 */
export function resolveAnyFont(stored, script, fallback) {
  const user = loaded.find((font) => font.key === stored && font.scripts.includes(script));
  return user ? user.key : resolveFont(stored, script, fallback);
}

export function stackForAny(key, script, fallback) {
  const user = loaded.find((font) => font.key === key && font.scripts.includes(script));
  return user ? asFamily(user).stack : fontStack(key, script, fallback);
}
