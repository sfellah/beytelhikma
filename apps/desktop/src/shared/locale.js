/**
 * La liste des locales de l'interface, et rien d'autre.
 *
 * Elle vit ici — sans DOM, sans `window` — pour la raison qui a valu son
 * module à `shared/theme.js` : une liste recopiée dans une vue finit par
 * diverger, et c'est déjà arrivé une fois sur ce projet.
 *
 * Deux locales seulement. `CLAUDE.md` en annonçait trois ; le français est
 * écarté, et rien ici ne le prépare — l'ajouter plus tard ne coûtera qu'un
 * fichier de chaînes de plus.
 *
 * La locale gouverne trois choses et rien d'autre : les mots, la direction de
 * *l'interface*, et la forme des chiffres. Pas la direction du **contenu** :
 * le corpus est arabe, une page de livre reste RTL sous une interface
 * anglaise.
 */
export const LOCALES = [
  { key: 'ar', label: 'العربية', dir: 'rtl', digits: 'arab' },
  { key: 'en', label: 'English', dir: 'ltr', digits: 'latn' },
];

/** L'application est une bibliothèque arabe : l'arabe est le défaut. */
export const DEFAULT_LOCALE = 'ar';

const byKey = new Map(LOCALES.map((locale) => [locale.key, locale]));

/**
 * Replie sur le défaut tout ce qui n'est pas une clé connue : réglage absent,
 * miroir vide, ou `fr` hérité d'une version qui l'aurait proposé.
 */
export function resolveLocale(stored) {
  return byKey.has(stored) ? stored : DEFAULT_LOCALE;
}

export function localeDir(stored) {
  return byKey.get(resolveLocale(stored)).dir;
}

export function localeDigits(stored) {
  return byKey.get(resolveLocale(stored)).digits;
}
