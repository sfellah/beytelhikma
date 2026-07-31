/**
 * La liste des thèmes, et rien d'autre.
 *
 * Elle vit ici — sans DOM, sans `window` — pour deux raisons. D'abord parce
 * qu'elle a déjà divergé une fois : `views/reader.js` et `views/settings.js`
 * en portaient chacun une copie, et celle des réglages proposait un `sepia`
 * qu'aucune règle CSS ne lisait plus. Ensuite parce qu'un module importable
 * depuis `node --test` est un module qu'on peut tester : `test/theme.test.js`
 * compare cette table aux blocs de `styles/tokens.css`.
 *
 * Les `swatch` sont les valeurs réelles des jetons, pas des approximations.
 * Les anciennes mentaient : `paper` annonçait `#fbf9f4` pour un `--surface` à
 * `#fbf8fc`, `night` annonçait `#14150f` pour un fond peint `#1a1c1a`.
 */
export const THEMES = [
  { key: 'paper', label: 'رق إفتراضي', swatch: '#fbf8fc', dot: '#1b1b1e' },
  { key: 'white', label: 'أبيض ناصع', swatch: '#ffffff', dot: '#131315' },
  { key: 'night', label: 'الوضع الليلي', swatch: '#1a1c1a', dot: '#e6e3de' },
];

/**
 * Le parchemin est le défaut : c'est l'identité du projet, pas un cas
 * particulier. Il n'a donc pas de bloc dans `tokens.css` — il *est* `:root`.
 */
export const DEFAULT_THEME = 'paper';

/**
 * Replie sur le défaut tout ce qui n'est pas une clé connue : réglage absent,
 * miroir vide, ou valeur héritée d'une version antérieure (`sepia`).
 */
export function resolveTheme(stored) {
  return THEMES.some((theme) => theme.key === stored) ? stored : DEFAULT_THEME;
}
