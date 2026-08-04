import { pushBackHandler } from '../back-intent.js';
import { h } from '../dom.js';
import { n, t } from '../i18n.js';
import { icon } from '../icons.js';
import { repository } from '../repository.js';

/** Facettes à liste de cases, dans l'ordre d'affichage. */
const LISTS = [
  ['categories', 'facet.category'],
  ['types', 'facet.type'],
  ['centuries', 'facet.century'],
  ['status', 'facet.status'],
];

/** Facettes à autocomplétion : trop de valeurs pour une liste. */
const SUGGESTED = [
  ['authors', 'facet.author', 'facet.authorSearch'],
  ['publishers', 'facet.publisher', 'facet.publisherSearch'],
];

/** Clés de [query] qui restreignent réellement la liste. */
const FILTRANTES = [
  'popular',
  'categories',
  'types',
  'centuries',
  'status',
  'authors',
  'publishers',
];

/**
 * Combien de filtres sont posés — c'est ce que le déclencheur doit annoncer.
 *
 * Exportée parce que c'est le seul chiffre de l'écran qui ne vienne pas de SQL :
 * il se compte ici, et un test le tient.
 */
export function countActive(query) {
  let total = 0;
  for (const key of FILTRANTES) {
    const value = query?.[key];
    if (Array.isArray(value)) total += value.length;
    // Un booléen se compte sur sa **valeur**, pas sur sa présence. La règle
    // précédente — « ni nul ni vide » — comptait `popular: false` comme un
    // filtre posé : le déclencheur annonçait un filtre de plus dès l'ouverture
    // de l'écran, sur une case décochée.
    else if (typeof value === 'boolean') total += value ? 1 : 0;
    else if (value != null && value !== '') total += 1;
  }
  if (query?.years) total += 1;
  return total;
}

/**
 * Un champ de saisie ne se réécrit pas sous les doigts qui le tiennent : la
 * valeur de l'état est celle d'une frappe déjà dépassée, et l'y reposer
 * déplacerait le curseur en fin de ligne au milieu d'un mot.
 */
function syncField(input, value) {
  if (globalThis.document?.activeElement === input) return;
  const text = value == null ? '' : String(value);
  if (input.value !== text) input.value = text;
}

/**
 * Panneau de filtres. [onChange] reçoit un fragment de requête à fusionner ;
 * [onClose] est appelé quand la feuille se referme, pour que l'appelant amène
 * les résultats sous les yeux.
 *
 * Le panneau **vit** : il rend `{ node, trigger, update }` et non plus un nœud
 * jetable. Il se redessinait en rendant un arbre neuf que l'appelant
 * substituait à l'ancien — et ce geste arrachait du document les quatre
 * `<input>` qu'il porte. Un champ arraché perd le focus, et sur Android la
 * WebView referme le clavier avec lui : on tapait un caractère, le clavier se
 * fermait. Les nœuds de saisie sont donc créés une fois et ne bougent plus ;
 * seul ce qui change de contenu est repeint.
 *
 * **Le déclencheur ne vit pas dans le panneau : il en sort.** C'était un
 * `<details>`, dont le `<summary>` gardait sa place au-dessus des résultats et
 * les repoussait d'autant en s'ouvrant — ouvert, six disciplines, deux types et
 * quinze siècles passaient avant le premier livre, et l'on croyait que la
 * recherche n'avait rien rendu. Le déclencheur est donc un bouton rendu à part
 * (`trigger`), que l'écran pose **dans sa barre d'outils**, à côté du champ et
 * du tri ; le panneau, lui, s'ouvre en feuille par-dessus la page et ne prend
 * plus une ligne du flux.
 *
 * Sur grand écran rien de tout cela ne joue : le CSS masque le déclencheur, la
 * feuille redevient la colonne latérale, et l'état d'ouverture n'a pas de
 * lecteur. C'est une **media query** qui tranche, jamais une détection d'OS —
 * une fenêtre de bureau réduite doit se comporter comme un téléphone.
 */
export function facetPanel({ facets, query, onChange, onClose }) {
  let state = { facets: facets ?? {}, query };
  let opened = false;

  const badge = h('span', { class: 'facets__badge' });
  const trigger = h(
    'button',
    {
      type: 'button',
      class: 'facets__trigger',
      'aria-expanded': 'false',
      onclick: () => setOpen(!opened),
    },
    icon('filter', { size: 18 }),
    h('span', { class: 'facets__trigger-label' }, t('explore.filters')),
    badge,
  );

  const sections = [
    popularFacet(onChange),
    ...LISTS.map(([key, label]) => listFacet(key, label, onChange)),
    ...SUGGESTED.map(([key, label, placeholder]) =>
      suggestFacet(key, label, placeholder, onChange),
    ),
    yearFacet(onChange),
  ];

  const sheet = h(
    'div',
    { class: 'facets__sheet' },
    h(
      'div',
      { class: 'facets__head' },
      h('h2', { class: 'facets__head-title label-md' }, t('explore.filters')),
      h(
        'button',
        {
          type: 'button',
          class: 'facets__close',
          'aria-label': t('action.close'),
          onclick: () => setOpen(false),
        },
        icon('close', { size: 18 }),
      ),
    ),
    h('div', { class: 'facets__sections' }, sections.map((section) => section.node)),
    h(
      'button',
      { type: 'button', class: 'button button--filled facets__apply', onclick: () => setOpen(false) },
      t('explore.showResults'),
    ),
  );

  // Le voile est le nœud lui-même : une tape qui l'atteint — donc qui ne touche
  // pas la feuille — referme, comme partout ailleurs dans l'application.
  const node = h(
    'div',
    {
      class: 'facets',
      onclick: (event) => {
        if (event.target === node) setOpen(false);
      },
    },
    sheet,
  );

  /**
   * L'ouverture se **reflète en attribut**, pas en classe : le CSS n'en lit
   * qu'une déclaration, sous la media query du téléphone, et sur grand écran
   * l'attribut ne veut rien dire.
   */
  function setOpen(next) {
    if (opened === next) return;
    opened = next;
    if (opened) node.setAttribute('data-open', '');
    else node.removeAttribute('data-open');
    trigger.setAttribute('aria-expanded', String(opened));
    if (!opened) onClose?.();
  }

  // Le geste retour d'Android ferme la feuille avant de quitter l'écran : c'est
  // la cascade d'`Escape`, une couche à la fois.
  const releaseBack = pushBackHandler(() => {
    if (!opened) return false;
    setOpen(false);
    return true;
  });

  function paint() {
    const actifs = countActive(state.query);
    badge.textContent = actifs > 0 ? n(actifs) : '';
    badge.hidden = actifs === 0;
    trigger.setAttribute('aria-label', t('explore.filtersCount', { count: actifs }));
    for (const section of sections) section.paint(state);
  }

  paint();

  return {
    node,
    trigger,
    /** Repeint depuis un nouvel état, sans remplacer un seul nœud de saisie. */
    update({ facets: nextFacets, query: nextQuery }) {
      state = { facets: nextFacets ?? {}, query: nextQuery };
      paint();
    },
    /** Ouvre ou ferme la feuille. Sans effet visible sur grand écran. */
    setOpen,
    isOpen: () => opened,
    dispose: releaseBack,
  };
}

/**
 * Une case, pas une facette.
 *
 * Une facette porte des valeurs et leurs comptes ; celle-ci est un booléen. La
 * bâtir comme les autres l'obligerait à un `GROUP BY` sur une colonne qui
 * n'existe pas — la liste vit dans `shared/popular.js`, pas dans le catalogue.
 *
 * Elle est **en tête** du panneau parce que c'est la restriction la plus large :
 * cocher vingt-trois livres sur 8 568 change ce que toutes les autres comptent.
 */
function popularFacet(onChange) {
  const box = h('input', {
    type: 'checkbox',
    onchange: (event) => onChange({ popular: event.target.checked }),
  });

  const node = h(
    'section',
    { class: 'facet facet--toggle' },
    // `facet__toggle` et non `facet__option` : ce n'est pas la valeur d'une
    // facette, et les écrans qui interrogent `.facet__option` cherchent une
    // discipline, un type ou un siècle — pas cette ligne-ci.
    h(
      'label',
      { class: 'facet__toggle' },
      box,
      h('span', { class: 'facet__label' }, t('popular.filter')),
    ),
  );

  return {
    node,
    paint({ query }) {
      // Un champ de saisie ne se réécrit pas sous les doigts qui le tiennent —
      // mais une case n'a pas de curseur à déplacer : la reposer est sans effet.
      box.checked = Boolean(query.popular);
    },
  };
}

/** Le statut n'accepte qu'une valeur ; les autres facettes en acceptent plusieurs. */
function toggle(key, value, query) {
  if (key === 'status') return { status: query.status === value ? null : value };
  const current = query[key] ?? [];
  const next = current.includes(value)
    ? current.filter((item) => item !== value)
    : [...current, value];
  return { [key]: next };
}

/**
 * Une facette sans valeur se **cache** au lieu de disparaître du document :
 * l'ordre des sections est alors fixe, et rien n'a besoin de réinsérer un
 * voisin — c'est cette réinsertion qui déracinait les champs.
 */
function listFacet(key, label, onChange) {
  const list = h('div', { class: 'facet__list' });
  const node = h(
    'section',
    { class: 'facet' },
    h('h3', { class: 'facet__title label-md' }, t(label)),
    list,
  );

  return {
    node,
    paint({ facets, query }) {
      const entries = facets[key] ?? [];
      node.hidden = entries.length === 0;
      const selected = key === 'status' ? [query.status].filter(Boolean) : (query[key] ?? []);
      list.replaceChildren(
        ...entries.map((entry) =>
          h(
            'label',
            { class: `facet__option${entry.count === 0 ? ' is-empty' : ''}` },
            h('input', {
              type: 'checkbox',
              checked: selected.includes(entry.value),
              // Une valeur à zéro reste visible mais inutilisable : voir qu'une
              // combinaison est vide vaut mieux qu'une liste qui rétrécit sans
              // explication.
              disabled: entry.count === 0 && !selected.includes(entry.value),
              onchange: () => onChange(toggle(key, entry.value, query)),
            }),
            h('span', { class: 'facet__label' }, entry.label),
            h('span', { class: 'facet__count label-sm muted' }, n(entry.count)),
          ),
        ),
      );
    },
  };
}

function suggestFacet(key, label, placeholder, onChange) {
  let facets = {};
  let chosen = [];
  let timer = null;

  const picked = h('div', { class: 'facet__chosen' });
  const results = h('div', { class: 'facet__suggestions' });

  // Les identifiants d'auteurs ne sont pas lisibles : on cherche leur libellé
  // dans les facettes déjà chargées, à défaut on montre la valeur brute.
  const labelOf = (value) =>
    facets[key]?.find((entry) => entry.value === value)?.label ?? String(value);

  const field = h('input', {
    type: 'search',
    class: 'facet__search',
    placeholder: t(placeholder),
    oninput: () => {
      clearTimeout(timer);
      // Antirebond : sans lui, chaque frappe déclenche un aller-retour IPC.
      timer = setTimeout(async () => {
        const term = field.value.trim();
        const suggestions = term.length >= 2 ? await repository.suggestValues(key, term) : [];
        // L'écran a pu partir pendant l'aller-retour.
        if (!field.isConnected) return;
        results.replaceChildren(
          ...suggestions
            .filter((entry) => !chosen.includes(entry.value))
            .map((entry) =>
              h(
                'button',
                {
                  class: 'facet__suggestion',
                  onclick: () => {
                    field.value = '';
                    results.replaceChildren();
                    onChange({ [key]: [...chosen, entry.value] });
                  },
                },
                h('span', { class: 'facet__label' }, entry.label),
                h('span', { class: 'label-sm muted' }, n(entry.count)),
              ),
            ),
        );
      }, 200);
    },
  });

  const node = h(
    'section',
    { class: 'facet' },
    h('h3', { class: 'facet__title label-md' }, t(label)),
    picked,
    field,
    results,
  );

  return {
    node,
    paint(state) {
      facets = state.facets;
      chosen = state.query[key] ?? [];
      picked.hidden = chosen.length === 0;
      picked.replaceChildren(
        ...chosen.map((value) =>
          h(
            'button',
            {
              class: 'chip chip--removable',
              onclick: () => onChange({ [key]: chosen.filter((item) => item !== value) }),
            },
            h('span', {}, labelOf(value)),
            icon('close', { size: 14 }),
          ),
        ),
      );
    },
  };
}

function yearFacet(onChange) {
  let years = {};

  const emit = (patch) => {
    const next = { ...years, ...patch };
    for (const key of ['from', 'to']) {
      if (next[key] == null || next[key] === '' || Number.isNaN(next[key])) delete next[key];
    }
    onChange({ years: Object.keys(next).length ? next : null });
  };

  const box = (key, placeholder) =>
    h('input', {
      type: 'number',
      class: 'facet__year',
      placeholder,
      onchange: (event) =>
        emit({ [key]: event.target.value === '' ? null : Number(event.target.value) }),
    });

  const from = box('from', t('facet.from'));
  const to = box('to', t('facet.to'));

  const node = h(
    'section',
    { class: 'facet' },
    h('h3', { class: 'facet__title label-md' }, t('facet.year')),
    h('div', { class: 'facet__range' }, from, to),
  );

  return {
    node,
    paint({ query }) {
      years = query.years ?? {};
      syncField(from, years.from);
      syncField(to, years.to);
    },
  };
}
