/**
 * Un DOM minimal, mais juste sur les points qui font tomber le rendu.
 *
 * Le rendu n'a pas de navigateur sous `node --test`. Ce module en pose un assez
 * complet pour monter une vue entière, et surtout assez **fidèle** sur les deux
 * règles qui ont produit de vrais défauts :
 *
 * - retirer un nœud du document **rend le focus au corps**, comme le fait un
 *   navigateur — sans quoi le test du clavier d'Android passerait sur le code
 *   fautif ;
 * - un évènement **bulle** jusqu'à la racine en portant `target`, ce dont
 *   dépendent le voile qui se referme d'une tape et la convention de `Ctrl+F`.
 *
 * Il vit ici, seul, plutôt qu'en copie par fichier de test : c'est de deux
 * copies d'une même table qu'étaient nés le thème `sepia` mort et la police
 * orpheline, et un bouchon dérive comme le reste.
 */

const makeStyle = () => ({
  setProperty() {},
  removeProperty() {},
  getPropertyValue: () => '',
});

/** Sélecteurs compris : `tag`, `.classe`, `[attr="valeur"]`, et leur concaténation. */
function matchesSelector(element, selector) {
  const parts = selector.trim().match(/(^[a-zA-Z][\w-]*)|(\.[\w-]+)|(\[[^\]]+\])/g) ?? [];
  for (const part of parts) {
    if (part.startsWith('.')) {
      if (!element.classList.contains(part.slice(1))) return false;
    } else if (part.startsWith('[')) {
      const [, name, value] = part.slice(1, -1).match(/^([\w-]+)(?:=["']?([^"']*)["']?)?$/) ?? [];
      if (!element.attributes.has(name)) return false;
      if (value != null && element.attributes.get(name) !== value) return false;
    } else if (element.localName !== part.toLowerCase()) return false;
  }
  return parts.length > 0;
}

function* descendants(root) {
  for (const child of root.childNodes) {
    if (child.nodeType === 1) {
      yield child;
      yield* descendants(child);
    }
  }
}

function contains(root, node) {
  let current = node;
  while (current) {
    if (current === root) return true;
    current = current.parentNode;
  }
  return false;
}

/**
 * Monte le faux DOM et le pose dans les globales que le rendu lit.
 *
 * Rend `{ document, El, Nd }` : `El` sert à fabriquer l'hôte d'une vue.
 */
export function installFakeDom() {
  class Nd {
    constructor() {
      this.parentNode = null;
      this.childNodes = [];
      // Les écouteurs vivent sur **tout** nœud, le document compris : la
      // cascade d'`Escape` et les boîtes qui se referment à la touche
      // s'inscrivent sur `document`, et un document sans `addEventListener` les
      // faisait tomber au montage — pas au geste qu'elles écoutent.
      this.listeners = new Map();
    }

    get isConnected() {
      let node = this;
      while (node.parentNode) node = node.parentNode;
      return node === document;
    }

    addEventListener(type, handler) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(handler);
    }

    removeEventListener(type, handler) {
      const list = this.listeners.get(type) ?? [];
      const index = list.indexOf(handler);
      if (index !== -1) list.splice(index, 1);
    }

    /**
     * L'évènement **bulle** jusqu'à la racine en portant sa cible : c'est de
     * cela que dépendent le voile qui se referme d'une tape et la convention de
     * `Ctrl+F`. Sur `Nd` et non sur `El` : `Escape` et le geste retour
     * s'écoutent sur le document, qui n'est pas un élément.
     */
    dispatchEvent(event) {
      event.target ??= this;
      let node = this;
      while (node) {
        event.currentTarget = node;
        for (const handler of [...(node.listeners?.get(event.type) ?? [])]) handler(event);
        node = node.parentNode;
      }
      return !event.defaultPrevented;
    }
  }

  class Txt extends Nd {
    constructor(data) {
      super();
      this.data = String(data);
    }

    get nodeType() {
      return 3;
    }

    get textContent() {
      return this.data;
    }
  }

  class El extends Nd {
    constructor(tag) {
      super();
      this.localName = String(tag).toLowerCase();
      this.tagName = this.localName.toUpperCase();
      this.attributes = new Map();
      this.style = makeStyle();
      this.dataset = {};
      this.value = '';
      this.checked = false;
    }

    get nodeType() {
      return 1;
    }

    // ------------------------------------------------------------- attributs

    setAttribute(name, value) {
      this.attributes.set(name, String(value));
      // Le navigateur reflète l'attribut `value` dans la propriété tant que le
      // champ n'a pas été touché : `h()` s'en sert pour semer un champ pré-rempli.
      if (name === 'value') this.value = String(value);
      if (name === 'checked') this.checked = true;
    }

    getAttribute(name) {
      return this.attributes.get(name) ?? null;
    }

    hasAttribute(name) {
      return this.attributes.has(name);
    }

    removeAttribute(name) {
      this.attributes.delete(name);
    }

    get className() {
      return this.attributes.get('class') ?? '';
    }

    set className(value) {
      this.attributes.set('class', String(value));
    }

    get classList() {
      const owner = this;
      return {
        contains: (name) => owner.className.split(/\s+/).includes(name),
        add(name) {
          if (!this.contains(name)) owner.className = `${owner.className} ${name}`.trim();
        },
        remove(name) {
          owner.className = owner.className
            .split(/\s+/)
            .filter((item) => item && item !== name)
            .join(' ');
        },
        toggle(name, force) {
          const wanted = force === undefined ? !this.contains(name) : Boolean(force);
          if (wanted) this.add(name);
          else this.remove(name);
          return wanted;
        },
      };
    }

    get hidden() {
      return this.attributes.has('hidden');
    }

    set hidden(value) {
      if (value) this.attributes.set('hidden', '');
      else this.attributes.delete('hidden');
    }

    // ---------------------------------------------------------------- arbre

    get children() {
      return this.childNodes.filter((node) => node.nodeType === 1);
    }

    get firstChild() {
      return this.childNodes[0] ?? null;
    }

    get lastChild() {
      return this.childNodes.at(-1) ?? null;
    }

    get textContent() {
      return this.childNodes.map((node) => node.textContent).join('');
    }

    set textContent(value) {
      this.#detachAll();
      if (value !== '' && value != null) this.append(new Txt(value));
    }

    #adopt(node) {
      node.parentNode?.removeChild(node);
      node.parentNode = this;
      return node;
    }

    /** Détacher rend le focus au corps : c'est là toute la question du clavier. */
    #detach(node) {
      node.parentNode = null;
      if (contains(node, document.activeElement)) document.activeElement = document.body;
    }

    #detachAll() {
      for (const node of this.childNodes) this.#detach(node);
      this.childNodes = [];
    }

    removeChild(node) {
      const index = this.childNodes.indexOf(node);
      if (index === -1) return node;
      this.childNodes.splice(index, 1);
      this.#detach(node);
      return node;
    }

    append(...nodes) {
      for (const node of nodes.flat(Infinity)) {
        if (node == null) continue;
        this.childNodes.push(this.#adopt(node));
      }
    }

    replaceChildren(...nodes) {
      this.#detachAll();
      this.append(...nodes);
    }

    replaceWith(node) {
      const parent = this.parentNode;
      if (!parent) return;
      node.parentNode?.removeChild(node);
      const index = parent.childNodes.indexOf(this);
      parent.childNodes[index] = node;
      node.parentNode = parent;
      this.parentNode = null;
      if (contains(this, document.activeElement)) document.activeElement = document.body;
    }

    remove() {
      this.parentNode?.removeChild(this);
    }

    querySelectorAll(selector) {
      const out = [];
      for (const node of descendants(this)) {
        if (matchesSelector(node, selector)) out.push(node);
      }
      return out;
    }

    querySelector(selector) {
      return this.querySelectorAll(selector)[0] ?? null;
    }

    closest(selector) {
      let node = this;
      while (node && node.nodeType === 1) {
        if (matchesSelector(node, selector)) return node;
        node = node.parentNode;
      }
      return null;
    }

    focus() {
      document.activeElement = this;
    }

    blur() {
      if (document.activeElement === this) document.activeElement = document.body;
    }

    select() {}

    scrollIntoView() {
      document.scrolledInto = this;
    }
  }

  class Doc extends Nd {
    createElement(tag) {
      return new El(tag);
    }

    createElementNS(_ns, tag) {
      return new El(tag);
    }

    createTextNode(data) {
      return new Txt(data);
    }

    createDocumentFragment() {
      return new El('#fragment');
    }

    querySelectorAll(selector) {
      return this.documentElement.querySelectorAll(selector);
    }

    querySelector(selector) {
      return this.querySelectorAll(selector)[0] ?? null;
    }

    /** Les couvertures déposent leurs motifs une fois : elles le demandent par là. */
    getElementById(id) {
      return this.querySelector(`[id="${id}"]`);
    }
  }

  const document = new Doc();
  document.documentElement = new El('html');
  document.documentElement.parentNode = document;
  document.childNodes = [document.documentElement];
  document.body = new El('body');
  document.documentElement.append(document.body);
  document.activeElement = document.body;

  const store = new Map();

  globalThis.document = document;
  // `dom.js` distingue un nœud d'une chaîne par `instanceof Node`.
  globalThis.Node = Nd;
  globalThis.localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
  globalThis.matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  });
  globalThis.history = { length: 1, replaceState() {}, pushState() {}, back() {} };
  globalThis.location = { hash: '#/explore' };
  globalThis.addEventListener = () => {};
  globalThis.removeEventListener = () => {};
  globalThis.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    matchMedia: globalThis.matchMedia,
  };

  return { document, El, Nd };
}
