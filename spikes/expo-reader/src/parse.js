/**
 * Analyseur HTML minimal pour le rendu natif.
 *
 * React Native n'a pas de DOM : `DOMParser`, `createTreeWalker` et `Range`
 * n'existent pas. Ce module rend l'arbre que `content-html.js` construirait,
 * et surtout **le même repère de décalages** — sans quoi une annotation posée
 * sur un client ne se retrouverait pas sur l'autre.
 *
 * La règle d'or vient de `annotations.js` : les décalages comptent les
 * caractères des **nœuds de texte**, dans l'ordre du document. Conséquences,
 * toutes deux implémentées ici :
 *
 * - `<br>` et `<hr>` ne portent aucun texte : ils comptent pour **zéro**
 *   caractère, alors même qu'ils produisent une rupture visible ;
 * - les frontières de blocs ne comptent pour rien non plus — `range.toString()`
 *   sur `<p>a</p><p>b</p>` rend `"ab"`, sans séparateur.
 */

/** Reprend `ALLOWED_TAGS` de `src/renderer/js/content-html.js`. */
const ALLOWED_TAGS = new Set([
  'p', 'div', 'span', 'b', 'strong', 'i', 'em', 'u', 'sup', 'sub',
  'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'li',
]);

/** Reprend `ALLOWED_CLASSES`. */
const ALLOWED_CLASSES = new Set(['verse', 'fn', 'title', 'center', 'footnote']);

/** Éléments sans contenu : ils ferment seuls. */
const VOID_TAGS = new Set(['br', 'hr']);

/** Blocs : ils se dessinent l'un sous l'autre, sans rien ajouter au texte. */
export const BLOCK_TAGS = new Set([
  'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'li', 'hr',
]);

const ENTITIES = {
  nbsp: ' ', // un caractère, pas une espace ordinaire : le DOM en fait autant
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  laquo: '«',
  raquo: '»',
  hellip: '…',
};

/** Décode les entités comme le ferait le DOM. */
function decode(text) {
  return text.replace(/&(#x?[0-9a-f]+|\w+);/gi, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

const TAG_RE = /<\/?([a-z][a-z0-9]*)((?:\s+[^>]*)?)\/?>/gi;

/** Classe retenue d'un attribut `class`, ou `null`. */
function classOf(attrs) {
  const found = /class\s*=\s*"([^"]*)"/i.exec(attrs) ?? /class\s*=\s*'([^']*)'/i.exec(attrs);
  if (!found) return null;
  const kept = found[1].split(/\s+/).filter((name) => ALLOWED_CLASSES.has(name));
  return kept.length ? kept.join(' ') : null;
}

/**
 * Rend l'arbre de [html]. Nœuds : `{ type: 'text', text }` et
 * `{ type: 'el', tag, cls, children }`.
 *
 * Une balise hors liste blanche est supprimée mais **son texte est conservé**,
 * comme `convert()` de `content-html.js`.
 */
export function parseHtml(html) {
  const root = { type: 'el', tag: 'root', cls: null, children: [] };
  const stack = [root];
  const top = () => stack[stack.length - 1];

  let pos = 0;
  TAG_RE.lastIndex = 0;
  for (let m = TAG_RE.exec(html); m; m = TAG_RE.exec(html)) {
    if (m.index > pos) {
      const text = decode(html.slice(pos, m.index));
      if (text) top().children.push({ type: 'text', text });
    }
    pos = TAG_RE.lastIndex;

    const closing = m[0][1] === '/';
    const tag = m[1].toLowerCase();

    if (!ALLOWED_TAGS.has(tag)) continue; // texte gardé, balise jetée

    if (VOID_TAGS.has(tag)) {
      if (!closing) top().children.push({ type: 'el', tag, cls: classOf(m[2]), children: [] });
      continue;
    }

    if (closing) {
      // Ne dépile que si la balise est bien ouverte : un `</b>` orphelin ne
      // doit pas fermer le paragraphe qui l'entoure.
      const at = stack.findLastIndex((node) => node.tag === tag);
      if (at > 0) stack.length = at;
      continue;
    }

    const element = { type: 'el', tag, cls: classOf(m[2]), children: [] };
    top().children.push(element);
    stack.push(element);
  }

  if (pos < html.length) {
    const text = decode(html.slice(pos));
    if (text) root.children.push({ type: 'text', text });
  }
  return root;
}

/**
 * Texte rendu de [tree], dans le repère des annotations : concaténation des
 * nœuds de texte, sans rien pour les balises. Équivaut à `renderedText(root)`
 * de `annotations.js`, qui passe par `range.toString()`.
 */
export function renderedText(tree) {
  let out = '';
  const walk = (node) => {
    if (node.type === 'text') out += node.text;
    else node.children.forEach(walk);
  };
  walk(tree);
  return out;
}

/**
 * Découpe [tree] en blocs dessinables, chaque nœud de texte portant sa position
 * dans le repère global.
 *
 * Rend `[{ tag, cls, runs: [{ text, start, end, marks }] }]` où `marks` est la
 * pile des balises en ligne traversées (`sup`, `span.title`, `b`…).
 */
export function toBlocks(tree) {
  const blocks = [];
  let cursor = 0;
  let current = null;

  const open = (tag, cls) => {
    current = { tag, cls, runs: [] };
    blocks.push(current);
  };

  const walk = (node, marks) => {
    if (node.type === 'text') {
      if (!current) open('p', null); // texte hors de tout bloc
      current.runs.push({
        text: node.text,
        start: cursor,
        end: cursor + node.text.length,
        marks,
      });
      cursor += node.text.length;
      return;
    }

    if (node.tag === 'br') {
      // Zéro caractère dans le repère, mais une rupture à dessiner : le run
      // porte un texte vide et une marque, jamais un « \n » qui décalerait
      // toutes les annotations suivantes.
      if (!current) open('p', null);
      current.runs.push({ text: '', start: cursor, end: cursor, marks: [...marks, 'br'] });
      return;
    }

    if (node.tag === 'hr') {
      blocks.push({ tag: 'hr', cls: null, runs: [] });
      current = null;
      return;
    }

    if (BLOCK_TAGS.has(node.tag)) {
      open(node.tag, node.cls);
      node.children.forEach((child) => walk(child, []));
      current = null;
      return;
    }

    const mark = node.cls ? `${node.tag}.${node.cls}` : node.tag;
    node.children.forEach((child) => walk(child, [...marks, mark]));
  };

  tree.children.forEach((child) => walk(child, []));
  return blocks.filter((block) => block.tag === 'hr' || block.runs.length);
}

/**
 * Place [highlights] dans [full], par la même logique que `locate()` :
 * décalages enregistrés d'abord, puis occurrence la plus proche du texte.
 */
export function locateAll(full, highlights) {
  const placed = [];
  for (const highlight of highlights) {
    const needle = highlight.selectedText ?? '';
    if (!needle) continue;

    const { startOffset = null, endOffset = null } = highlight;
    if (startOffset !== null && full.slice(startOffset, endOffset) === needle) {
      placed.push({ ...highlight, start: startOffset, end: endOffset });
      continue;
    }

    const positions = [];
    for (let at = full.indexOf(needle); at !== -1; at = full.indexOf(needle, at + 1)) {
      positions.push(at);
    }
    if (!positions.length) continue;

    const anchor = startOffset ?? 0;
    const best = positions.reduce((closest, at) =>
      Math.abs(at - anchor) < Math.abs(closest - anchor) ? at : closest,
    );
    placed.push({ ...highlight, start: best, end: best + needle.length });
  }
  return placed;
}

/** Découpe [run] aux frontières de [placed] : chaque morceau sait son surlignage. */
export function splitRun(run, placed) {
  const cuts = new Set([run.start, run.end]);
  for (const highlight of placed) {
    if (highlight.start > run.start && highlight.start < run.end) cuts.add(highlight.start);
    if (highlight.end > run.start && highlight.end < run.end) cuts.add(highlight.end);
  }
  const bounds = [...cuts].sort((a, b) => a - b);

  const pieces = [];
  for (let i = 0; i < bounds.length - 1; i += 1) {
    const from = bounds[i];
    const to = bounds[i + 1];
    pieces.push({
      text: run.text.slice(from - run.start, to - run.start),
      start: from,
      end: to,
      marks: run.marks,
      highlight: placed.find((h) => h.start <= from && h.end >= to) ?? null,
    });
  }
  return pieces;
}
