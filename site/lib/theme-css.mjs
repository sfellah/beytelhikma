/**
 * La feuille qui fait suivre au site l'ambiance du système, **dérivée** de
 * `tokens.css` et jamais recopiée.
 *
 * L'application pose son thème sur `<html>` par `data-theme`, choisi par
 * l'utilisateur. Un site n'a pas ce réglage : il doit suivre
 * `prefers-color-scheme`. Recopier ici les valeurs du bloc `night` créerait une
 * seconde palette à tenir à jour — c'est exactement de deux copies d'une liste
 * de thèmes qu'est née la panne `sepia` déjà vécue sur ce projet.
 *
 * On extrait donc le bloc au build et on le ré-émet sous une requête média. La
 * sélection `:root:not([data-theme])` laisse un choix explicite l'emporter, si
 * un sélecteur d'ambiance est ajouté plus tard.
 */

/** Le corps d'un bloc `:root[data-theme='<nom>']` de `tokens.css`. */
export function extractThemeBlock(css, name) {
  const marker = `:root[data-theme='${name}']`;
  const start = css.indexOf(marker);
  if (start === -1) throw new Error(`tokens.css ne déclare pas ${marker}.`);

  const open = css.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    else if (css[index] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, index).trim();
    }
  }
  throw new Error(`Le bloc ${marker} de tokens.css n'est pas refermé.`);
}

export function nightMediaCss(tokensCss) {
  const body = extractThemeBlock(tokensCss, 'night');
  const indented = body
    .split('\n')
    .map((line) => (line.trim() ? `    ${line.trim()}` : ''))
    .join('\n');

  return `/* Généré par site/lib/theme-css.mjs depuis tokens.css. Ne pas éditer.
   Le bloc « night » de l'application, ré-émis sous la préférence système.
   Un choix explicite (data-theme) l'emporte toujours. */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) {
${indented}
  }
}
`;
}
