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
