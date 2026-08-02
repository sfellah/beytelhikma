/**
 * Ce que la fenêtre a le droit d'atteindre.
 *
 * Module pur — ni Electron, ni disque — pour que les deux règles se testent
 * sans lancer d'application. Elles sont posées dans `main.js` sur
 * `will-navigate` et sur le gestionnaire d'ouverture de fenêtre.
 */

/**
 * Une navigation n'est permise que vers la page de l'application elle-même.
 *
 * `file:` seul ne suffirait pas : n'importe quel HTML du disque hériterait
 * alors du preload, donc du pont vers les trois bases. On compare donc le
 * document — le fragment et la requête sont ignorés, c'est par eux que le
 * routeur travaille.
 *
 * En pratique `will-navigate` ne se déclenche pas sur un changement de
 * fragment ; cette tolérance n'est là que pour ne pas dépendre de ce détail.
 */
export function navigationPermise(url, pageAutorisée) {
  const cible = analyse(url);
  const permise = analyse(pageAutorisée);
  if (!cible || !permise) return false;
  return document(cible) === document(permise);
}

/**
 * Un lien qu'on confie au navigateur du système.
 *
 * Le protocole est **comparé**, jamais pris comme préfixe :
 * `url.startsWith('http')` acceptait aussi `httpfoo://…`, que `openExternal`
 * aurait passé au gestionnaire de protocole du système — c'est-à-dire à un
 * programme arbitraire de la machine.
 */
export function estLienExterne(url) {
  const cible = analyse(url);
  return cible?.protocol === 'https:' || cible?.protocol === 'http:';
}

function analyse(url) {
  try {
    return new URL(String(url));
  } catch {
    return null;
  }
}

/** L'URL sans son fragment ni sa requête. */
function document(url) {
  return `${url.protocol}//${url.host}${url.pathname}`;
}
