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

/**
 * Panneau de filtres. [onChange] reçoit un fragment de requête à fusionner ;
 * le panneau ne détient aucun état, il se redessine à partir de [query].
 */
export function facetPanel({ facets, query, onChange }) {
  return h(
    'aside',
    { class: 'facets' },
    LISTS.map(([key, label]) => listFacet(key, label, facets[key] ?? [], query, onChange)),
    SUGGESTED.map(([key, label, placeholder]) =>
      suggestFacet(key, label, placeholder, facets, query, onChange),
    ),
    yearFacet(query, onChange),
  );
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

function listFacet(key, label, entries, query, onChange) {
  if (!entries.length) return null;
  const selected = key === 'status' ? [query.status].filter(Boolean) : (query[key] ?? []);
  return h(
    'section',
    { class: 'facet' },
    h('h3', { class: 'facet__title label-md' }, t(label)),
    h(
      'div',
      { class: 'facet__list' },
      entries.map((entry) =>
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
    ),
  );
}

function suggestFacet(key, label, placeholder, facets, query, onChange) {
  const chosen = query[key] ?? [];
  const results = h('div', { class: 'facet__suggestions' });
  let timer = null;

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

  return h(
    'section',
    { class: 'facet' },
    h('h3', { class: 'facet__title label-md' }, t(label)),
    chosen.length > 0 &&
      h(
        'div',
        { class: 'facet__chosen' },
        chosen.map((value) =>
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
      ),
    field,
    results,
  );
}

function yearFacet(query, onChange) {
  const { from = '', to = '' } = query.years ?? {};

  const emit = (patch) => {
    const years = { ...(query.years ?? {}), ...patch };
    for (const key of ['from', 'to']) {
      if (years[key] == null || years[key] === '' || Number.isNaN(years[key])) delete years[key];
    }
    onChange({ years: Object.keys(years).length ? years : null });
  };

  const box = (value, key, placeholder) =>
    h('input', {
      type: 'number',
      class: 'facet__year',
      value: String(value ?? ''),
      placeholder,
      onchange: (event) =>
        emit({ [key]: event.target.value === '' ? null : Number(event.target.value) }),
    });

  return h(
    'section',
    { class: 'facet' },
    h('h3', { class: 'facet__title label-md' }, t('facet.year')),
    h(
      'div',
      { class: 'facet__range' },
      box(from, 'from', t('facet.from')),
      box(to, 'to', t('facet.to')),
    ),
  );
}
