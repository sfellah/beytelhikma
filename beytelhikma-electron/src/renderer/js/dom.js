/** Fabrique d'éléments. Aucune chaîne HTML n'est jamais interprétée ici. */
export function h(tag, props = null, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key === 'class') element.className = value;
    else if (key === 'style') setStyle(element, value);
    else if (key === 'dataset') Object.assign(element.dataset, value);
    else if (key.startsWith('on'))
      element.addEventListener(key.slice(2).toLowerCase(), value);
    else element.setAttribute(key, value === true ? '' : String(value));
  }
  append(element, children);
  return element;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Même fabrique, espace de noms SVG. `document.createElement` produirait un
 * `HTMLUnknownElement` : un `<rect>` posé ainsi n'est jamais peint. D'où une
 * fonction séparée plutôt qu'une table de balises dans `h()` — la distinction
 * est celle de l'espace de noms, pas celle du nom.
 */
export function svg(tag, props = null, ...children) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key === 'style') setStyle(element, value);
    else element.setAttribute(key, value === true ? '' : String(value));
  }
  append(element, children);
  return element;
}

/** `Object.assign` ignore les propriétés personnalisées : il faut setProperty. */
export function setStyle(element, styles) {
  for (const [property, value] of Object.entries(styles)) {
    if (value == null) continue;
    if (property.startsWith('--')) element.style.setProperty(property, value);
    else element.style[property] = value;
  }
  return element;
}

export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

export function clear(node) {
  node.replaceChildren();
  return node;
}

export function fragment(...children) {
  return append(document.createDocumentFragment(), children);
}
