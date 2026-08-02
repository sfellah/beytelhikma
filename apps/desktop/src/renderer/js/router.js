/**
 * Routeur par fragment d'URL. Une route déclare un motif (`/book/:id`) et une
 * fonction qui rend la vue dans l'élément hôte.
 */
const routes = [];
let notFound = null;
let host = null;
let current = null;
/**
 * Numéro de la résolution en cours.
 *
 * `resolve` est `async` : une vue peut être attendue pendant qu'un second
 * `hashchange` en lance une autre. Le second passait alors son `dispose` sur un
 * `current` encore nul — la première vue n'était **jamais** démontée, et ses
 * écouteurs de `document` survivaient à l'écran qui les avait posés. Le
 * lecteur, qui écoute les flèches et `Ctrl+F`, continuait de les avaler
 * ailleurs.
 */
let generation = 0;

export function defineRoutes(definitions, { fallback } = {}) {
  routes.length = 0;
  for (const [pattern, view] of Object.entries(definitions)) {
    routes.push({ segments: pattern.split('/').filter(Boolean), view, pattern });
  }
  notFound = fallback ?? null;
}

export function start(hostElement, { initial = '/home' } = {}) {
  host = hostElement;
  window.addEventListener('hashchange', resolve);
  if (!location.hash) location.hash = `#${initial}`;
  else resolve();
}

export function navigate(path) {
  if (location.hash === `#${path}`) resolve();
  else location.hash = `#${path}`;
}

export function back() {
  if (history.length > 1) history.back();
  else navigate('/home');
}

/**
 * Remonte la vue courante sans toucher à l'historique. Sert au changement de
 * langue : les vues rendent leurs chaînes au montage, donc seule une remontée
 * les fait parler la nouvelle langue. Passer par `navigate` ferait le même
 * travail, mais en dépendant du fait que le fragment est déjà le bon.
 */
export function remount() {
  if (host) resolve();
}

function match(segments) {
  for (const route of routes) {
    if (route.segments.length !== segments.length) continue;
    const params = {};
    let ok = true;
    for (const [index, part] of route.segments.entries()) {
      if (part.startsWith(':')) params[part.slice(1)] = decodeURIComponent(segments[index]);
      else if (part !== segments[index]) {
        ok = false;
        break;
      }
    }
    if (ok) return { route, params };
  }
  return null;
}

async function resolve() {
  const path = location.hash.replace(/^#/, '') || '/home';
  const [rawPath, rawQuery] = path.split('?');
  const segments = rawPath.split('/').filter(Boolean);
  const found = match(segments);
  const query = Object.fromEntries(new URLSearchParams(rawQuery ?? ''));

  const mine = ++generation;
  current?.dispose?.();
  current = null;

  const vue = found
    ? await found.route.view(host, { ...found.params, query, path: rawPath })
    : await notFound?.(host, { path: rawPath });

  // Une navigation plus récente a pris la main pendant l'attente : cette vue-ci
  // n'est plus à l'écran. On la démonte au lieu de l'inscrire — sans quoi elle
  // devient la vue « courante » et démontera celle qui l'a remplacée.
  if (mine !== generation) {
    vue?.dispose?.();
    return;
  }
  current = vue ?? null;
}
