/**
 * Ancrage des annotations dans le texte rendu d'une page.
 *
 * Les décalages sont comptés en **caractères du texte rendu**, c'est-à-dire la
 * concaténation des nœuds de texte de la page dans l'ordre du document. Le
 * balisage n'entre donc pas dans le compte : envelopper un passage dans un
 * `<mark>` ne déplace aucune annotation voisine.
 *
 * Les décalages seuls resteraient fragiles — une mise à jour du livre décale
 * tout — d'où le texte sélectionné et son contexte, gardés avec : quand les
 * décalages ne retombent pas sur le bon texte, on le recherche.
 */

/** Contexte conservé de part et d'autre d'un surlignage. */
const CONTEXT = 40;

/** Nœuds de texte de [root], avec leur position dans le texte rendu. */
function textNodes(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const entries = [];
  let cursor = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.nodeValue.length;
    entries.push({ node, start: cursor, end: cursor + length });
    cursor += length;
  }
  return entries;
}

/** Texte rendu de [root], dans le même repère que les décalages. */
export function renderedText(root) {
  const range = document.createRange();
  range.selectNodeContents(root);
  return range.toString();
}

/**
 * Décrit la sélection courante dans le repère de [root], ou `null` si elle est
 * vide ou hors de la page.
 */
export function describeSelection(root) {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;

  const text = range.toString();
  if (!text.trim()) return null;

  const before = document.createRange();
  before.selectNodeContents(root);
  before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length;

  const full = renderedText(root);
  return {
    startOffset: start,
    endOffset: start + text.length,
    selectedText: text,
    prefixText: full.slice(Math.max(0, start - CONTEXT), start),
    suffixText: full.slice(start + text.length, start + text.length + CONTEXT),
  };
}

/**
 * Retrouve l'emplacement d'un surlignage dans le texte courant.
 *
 * Trois tentatives, de la plus fiable à la plus tolérante : les décalages
 * enregistrés, puis l'occurrence du texte la plus proche de ces décalages, puis
 * rien — un surlignage qu'on ne sait plus placer n'est pas dessiné, mais il
 * reste dans la base et dans la liste des annotations.
 */
function locate(full, highlight) {
  const needle = highlight.selectedText ?? '';
  if (!needle) return null;

  const { startOffset = 0, endOffset = 0 } = highlight;
  if (full.slice(startOffset, endOffset) === needle) {
    return { start: startOffset, end: endOffset };
  }

  const positions = [];
  for (let at = full.indexOf(needle); at !== -1; at = full.indexOf(needle, at + 1)) {
    positions.push(at);
  }
  if (!positions.length) return null;

  const best = positions.reduce((closest, at) =>
    Math.abs(at - startOffset) < Math.abs(closest - startOffset) ? at : closest,
  );
  return { start: best, end: best + needle.length };
}

/** Enveloppe [start, end) dans un `<mark>` fabriqué par [makeWrapper]. */
function wrap(root, start, end, makeWrapper) {
  // Ordre inverse : découper un nœud n'invalide alors pas les positions des
  // nœuds encore à traiter.
  const targets = textNodes(root)
    .filter((entry) => entry.end > start && entry.start < end)
    .reverse();

  for (const entry of targets) {
    let node = entry.node;
    const from = Math.max(0, start - entry.start);
    const to = Math.min(node.nodeValue.length, end - entry.start);
    if (to <= from) continue;
    if (to < node.nodeValue.length) node.splitText(to);
    if (from > 0) node = node.splitText(from);

    const wrapper = makeWrapper();
    node.replaceWith(wrapper);
    wrapper.append(node);
  }
}

/**
 * Dessine [highlights] dans [root]. Le texte n'est jamais réinterprété : on
 * découpe les nœuds existants, comme le fait le surlignage de recherche.
 */
export function paintHighlights(root, highlights, { onClick = null } = {}) {
  if (!highlights?.length) return;

  for (const highlight of highlights) {
    // `full` est relu à chaque tour : le découpage précédent a changé les nœuds,
    // pas le texte, mais mieux vaut le prendre à l'état courant.
    const placed = locate(renderedText(root), highlight);
    if (!placed) continue;

    wrap(root, placed.start, placed.end, () => {
      const mark = document.createElement('mark');
      mark.className = 'reader__highlight';
      mark.dataset.highlightId = highlight.highlightId;
      mark.style.setProperty('--highlight-color', highlight.color);
      if (highlight.hasNote) mark.classList.add('has-note');
      if (onClick) {
        mark.addEventListener('click', (event) => {
          event.stopPropagation();
          onClick(highlight, mark);
        });
      }
      return mark;
    });
  }
}
