/**
 * La page du lecteur, telle qu'elle tourne aujourd'hui.
 *
 * `SANITIZER` et `ANNOTATIONS` sont **copiés mot pour mot** de
 * `beytelhikma-electron/src/renderer/js/content-html.js` et `annotations.js`,
 * les seuls retraits étant les mots-clés `export`, que ce document n'a pas
 * besoin de porter. C'est tout l'intérêt du spike B : si la page marche, ce
 * n'est pas qu'un équivalent qui marche, c'est le code du projet, inchangé.
 *
 * Le CSS suit `views.css` là où il compte — `.reader__page p` justifié,
 * `.verse` centré en italique, `sup.fn` en exposant émeraude.
 */

/** Copie verbatim de `src/renderer/js/content-html.js`. */
const SANITIZER = `
const ALLOWED_TAGS = new Set([
  'p','div','span','b','strong','i','em','u','sup','sub','br','hr',
  'h1','h2','h3','h4','h5','h6','blockquote','ul','ol','li',
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

function renderBookHtml(html) {
  const parsed = new DOMParser().parseFromString(html ?? '', 'text/html');
  const fragment = document.createDocumentFragment();
  fragment.append(...[...parsed.body.childNodes].flatMap(convert));
  return fragment;
}
`;

/** Copie verbatim de `src/renderer/js/annotations.js`. */
const ANNOTATIONS = `
const CONTEXT = 40;

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

function renderedText(root) {
  const range = document.createRange();
  range.selectNodeContents(root);
  return range.toString();
}

function describeSelection(root) {
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

function wrap(root, start, end, makeWrapper) {
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

function paintHighlights(root, highlights, { onClick = null } = {}) {
  if (!highlights?.length) return;

  for (const highlight of highlights) {
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
`;

const STYLE = `
:root {
  --ink: #1c1a17;
  --muted: #6b635a;
  --paper: #f6f1e7;
  --rule: #e0d7c8;
  --accent: #003527;
  --highlight-strength: 0.55;
}
* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
/* Le texte du livre doit être sélectionnable, explicitement : certaines
   WebView posent \`user-select: none\` par défaut sur le corps du document. */
.reader__page, .reader__page * {
  -webkit-user-select: text;
  user-select: text;
  -webkit-touch-callout: default;
}
body {
  margin: 0;
  padding: 18px 18px 28px;
  background: var(--paper);
  color: var(--ink);
  font-size: 19px;
  line-height: 2.2;
  /* La direction du **contenu** est portée explicitement : le corpus est
     arabe quelle que soit la langue de l'interface. */
  direction: rtl;
}
.reader__page p { margin: 0 0 1.5em; text-align: justify; }
.reader__page h1, .reader__page h2, .reader__page h3 {
  font-size: 1.14em; font-weight: 600; line-height: 1.6;
  text-align: center; margin: 0 0 1.6em; color: var(--accent);
}
.reader__page .verse { text-align: center; font-style: italic; }
.reader__page sup.fn { font-size: 0.62em; color: var(--accent); vertical-align: super; }
.reader__page hr { border: 0; border-top: 1px solid var(--rule); margin: 1.6em 0; }
.reader__page .title { font-weight: 700; color: var(--accent); }
.reader__footnotes {
  margin-top: 1.6em; padding-top: 12px;
  border-top: 1px solid var(--rule);
  color: var(--muted); font-size: 0.72em; line-height: 1.8; white-space: pre-line;
}
/* Le fond de surlignage porte sa couleur en variable, à opacité pilotée par
   l'ambiance — exactement le mécanisme de \`tokens.css\`. */
.reader__highlight {
  background: color-mix(in srgb, var(--highlight-color) calc(var(--highlight-strength) * 100%), transparent);
  color: inherit;
  border-radius: 2px;
  padding: 0 1px;
}
.reader__highlight.has-note { box-shadow: inset 0 -2px 0 var(--highlight-color); }
`;

/** Construit le document complet du lecteur. */
export function buildPage({ html, footnotes, highlights }) {
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<style>${STYLE}</style>
</head>
<body>
<div class="reader__page" id="page"></div>
<div class="reader__footnotes" id="footnotes"></div>
<script>
${SANITIZER}
${ANNOTATIONS}

const send = (payload) => window.ReactNativeWebView?.postMessage(JSON.stringify(payload));

const page = document.getElementById('page');
page.replaceChildren(renderBookHtml(${JSON.stringify(html)}));
document.getElementById('footnotes').textContent = ${JSON.stringify(footnotes)};

paintHighlights(page, ${JSON.stringify(highlights)}, {
  onClick: (highlight) => send({ kind: 'tap', highlight }),
});

// Sur mobile, la sélection ne se termine **pas** par un \`touchend\` qui
// remonte au document : dès que les poignées natives apparaissent, elles
// avalent les événements tactiles. C'est \`selectionchange\` qui fait foi, avec
// un délai pour ne pas rapporter à chaque déplacement de poignée. Les deux
// autres restent en second rideau, pour la souris et le navigateur de bureau.
let events = 0;
let timer = null;

/** Pourquoi \`describeSelection\` n'a rien rendu — sans quoi un échec est muet. */
const why = () => {
  const selection = window.getSelection();
  if (!selection) return 'window.getSelection() rend null';
  if (selection.rangeCount === 0) return 'aucune plage';
  if (selection.isCollapsed) return 'sélection vide (simple appui)';
  const range = selection.getRangeAt(0);
  if (!page.contains(range.startContainer) || !page.contains(range.endContainer)) {
    return 'sélection hors de la page du livre';
  }
  if (!range.toString().trim()) return 'sélection sans texte visible';
  return 'inconnu';
};

const report = () => {
  const described = describeSelection(page);
  send(
    described
      ? { kind: 'selection', events, ...described }
      : { kind: 'selection', events, empty: true, reason: why() },
  );
};

const schedule = () => {
  events += 1;
  clearTimeout(timer);
  timer = setTimeout(report, 250);
};

document.addEventListener('selectionchange', schedule);
document.addEventListener('touchend', schedule);
document.addEventListener('mouseup', schedule);

send({ kind: 'ready', length: page.textContent.length, marks: document.querySelectorAll('mark').length });
</script>
</body>
</html>`;
}
