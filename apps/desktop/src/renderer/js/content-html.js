/**
 * Le contenu des livres est un HTML minimal produit par le pipeline de données.
 * On le reconstruit nœud par nœud selon une liste blanche : pas d'`innerHTML`,
 * donc pas de script ni d'attribut inattendu dans la page du lecteur.
 */
const ALLOWED_TAGS = new Set([
  'p',
  'div',
  'span',
  'b',
  'strong',
  'i',
  'em',
  'u',
  'sup',
  'sub',
  'br',
  'hr',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'ul',
  'ol',
  'li',
]);

const ALLOWED_CLASSES = new Set(['verse', 'fn', 'title', 'center', 'footnote']);

function convert(node) {
  if (node.nodeType === Node.TEXT_NODE) return [document.createTextNode(node.data)];
  if (node.nodeType !== Node.ELEMENT_NODE) return [];

  const tag = node.tagName.toLowerCase();
  const children = [...node.childNodes].flatMap(convert);

  // Balise inconnue : on garde son texte, jamais la balise elle-même.
  if (!ALLOWED_TAGS.has(tag)) return children;

  const element = document.createElement(tag);
  const classes = [...node.classList].filter((name) => ALLOWED_CLASSES.has(name));
  if (classes.length) element.className = classes.join(' ');
  element.append(...children);
  return [element];
}

export function renderBookHtml(html) {
  const parsed = new DOMParser().parseFromString(html ?? '', 'text/html');
  const fragment = document.createDocumentFragment();
  fragment.append(...[...parsed.body.childNodes].flatMap(convert));
  return fragment;
}
