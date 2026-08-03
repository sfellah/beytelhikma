import { h } from '../dom.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { onDownloadsChanged, repository } from '../repository.js';
import { renderShell } from '../shell.js';
import { pushBackHandler } from '../back-intent.js';
import { actionBar } from '../components/action-bar.js';
import { bookCard } from '../components/book-card.js';
import { confirmDialog } from '../components/modal.js';
import { formatBytes } from '../components/download-action.js';
import { facetPanel } from '../components/facet-panel.js';
import { emptyView, errorView, loadingView } from '../components/states.js';

const PAGE = 40;

/**
 * Attente avant de peser la sélection. Chaque pesée est un aller-retour du pont
 * — natif sur Android : cocher dix cartes d'affilée en produirait dix.
 */
const WEIGH_DELAY = 200;

const SORTS = [
  ['title', 'explore.sort.title'],
  ['recent', 'explore.sort.recent'],
  ['pages', 'explore.sort.pages'],
  ['size', 'explore.sort.size'],
];

/** Facettes à valeurs multiples, dans l'ordre des puces de filtres actifs. */
const MULTI = ['categories', 'types', 'centuries', 'authors', 'publishers'];

const EMPTY_QUERY = {
  text: '',
  categories: [],
  types: [],
  centuries: [],
  authors: [],
  publishers: [],
  years: null,
  status: null,
};

/** Décode l'état depuis le fragment d'URL, pour qu'un lien soit partageable. */
function readQuery(params) {
  const raw = params?.query ?? {};
  const list = (key) => (raw[key] ? raw[key].split(',').filter(Boolean) : []);
  const numbers = (key) => list(key).map(Number);
  const years = {};
  if (raw.from) years.from = Number(raw.from);
  if (raw.to) years.to = Number(raw.to);
  return {
    text: raw.text ?? '',
    categories: numbers('categories'),
    types: list('types'),
    centuries: numbers('centuries'),
    authors: list('authors'),
    publishers: list('publishers'),
    years: Object.keys(years).length ? years : null,
    status: raw.status ?? null,
    sort: raw.sort ?? 'title',
  };
}

/** Réécrit le fragment sans provoquer de navigation ni de re-rendu. */
function writeQuery(query) {
  const params = new URLSearchParams();
  if (query.text) params.set('text', query.text);
  for (const key of MULTI) {
    if (query[key]?.length) params.set(key, query[key].join(','));
  }
  if (query.years?.from != null) params.set('from', String(query.years.from));
  if (query.years?.to != null) params.set('to', String(query.years.to));
  if (query.status) params.set('status', query.status);
  if (query.sort && query.sort !== 'title') params.set('sort', query.sort);
  const suffix = params.toString();
  history.replaceState(null, '', `#/explore${suffix ? `?${suffix}` : ''}`);
}

function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Écran d'exploration : recherche, facettes, sélection multiple, mise en file.
 * L'état vit ici ; un changement de filtre ne redessine que les résultats et
 * les compteurs, jamais la coque.
 *
 * **Aucun champ de saisie n'est jamais remplacé.** L'entête entier était
 * reconstruit à la fin de chaque chargement, et une frappe déclenche un
 * chargement : le `<input>` de recherche était donc arraché du document à
 * chaque caractère. Sous Electron cela ne coûtait qu'un curseur qui saute ; sur
 * Android la WebView referme le clavier avec le champ qui l'a ouvert, et l'on
 * ne pouvait pas taper deux lettres de suite. Le champ, le tri et le panneau de
 * facettes sont créés une fois pour toutes ; `draw()` ne repeint que ce qui
 * porte du texte — le total, les puces, les facettes, les résultats.
 */
export function exploreView(host, params) {
  const content = renderShell(host, { active: 'explore' });
  const state = {
    query: readQuery(params),
    books: [],
    total: 0,
    facets: {},
    selecting: false,
    selection: new Set(),
    loading: true,
    error: null,
  };

  /** Retire le gestionnaire du geste retour ; posé à l'entrée en mode, nul hors de lui. */
  let releaseBack = null;

  // Les cartes montées, par édition. Cocher n'a alors à toucher que la sienne :
  // repasser par `draw()` reconstruisait les puces, la barre **et les quarante
  // cartes** à chaque tape.
  const cards = new Map();

  // ------------------------------------------------------ nœuds permanents

  const total = h('p', { class: 'body-md muted' });

  const field = h('input', {
    type: 'search',
    class: 'explore__search',
    value: state.query.text,
    placeholder: t('explore.search'),
    oninput: debounce((event) => update({ text: event.target.value }), 250),
  });

  const sort = h(
    'select',
    {
      class: 'explore__sort',
      'aria-label': t('explore.sortLabel'),
      onchange: (event) => update({ sort: event.target.value }),
    },
    SORTS.map(([value, label]) =>
      h('option', { value, selected: state.query.sort === value }, t(label)),
    ),
  );

  // Le `<select>` nu ne dit pas qu'il s'ouvre : la flèche du système est celle
  // du thème de la plateforme, absente sous Android. Elle est dessinée ici, et
  // ne capte pas le doigt — c'est le contrôle en dessous qui le reçoit.
  const sortField = h(
    'div',
    { class: 'explore__sort-field' },
    sort,
    icon('chevronDown', { size: 18, className: 'explore__sort-caret' }),
  );

  const chips = h('div', { class: 'explore__chips' });

  // La rangée du bouton d'entrée en sélection. Elle ne porte plus les actions :
  // celles-ci sont ancrées en pied d'écran, hors du flux.
  const actions = h('div', { class: 'explore__actions' });

  // La bande contextuelle : elle remplace l'entête pendant la sélection. On ne
  // filtre pas pendant qu'on coche, et la place rendue est celle des résultats.
  const contextCount = h('span', { class: 'explore__context-count label-md' });
  const contextPage = h(
    'button',
    { type: 'button', class: 'button button--tonal explore__context-page', onclick: selectPage },
  );
  const context = h(
    'div',
    { class: 'explore__context', hidden: true },
    h(
      'button',
      {
        type: 'button',
        class: 'explore__context-close',
        'aria-label': t('action.close'),
        onclick: leaveSelection,
      },
      icon('close', { size: 20 }),
    ),
    contextCount,
    contextPage,
  );

  // Les actions vivent en pied d'écran, ancrées : dans le flux, il fallait
  // remonter tout l'écran pour agir sur ce qu'on venait de cocher.
  const bar = actionBar();

  // Le panneau se met à jour en place : c'est lui qui porte les quatre autres
  // champs de saisie de l'écran. Refermer sa feuille amène les résultats sous
  // les yeux : c'est le geste qui suit, et sur un téléphone ils sont en dessous.
  const panel = facetPanel({
    facets: state.facets,
    query: state.query,
    onChange: update,
    onClose: revealResults,
  });

  let results = resultsNode();

  const header = h(
        'div',
        { class: 'explore__header' },
        // Le titre et le total tiennent une seule ligne : empilés, ils
        // repoussaient à eux seuls les premiers livres hors de l'écran.
        h(
          'div',
          { class: 'explore__heading' },
          h('h1', { class: 'display-lg explore__title' }, t('explore.title')),
          total,
        ),
        // Chercher, puis trier et filtrer. Sur grand écran les trois tiennent
        // une rangée ; sur téléphone le champ prend la sienne et les deux
        // contrôles se partagent la suivante — serrés à trois, le tri tombait
        // sous la largeur où son intitulé se lit, et l'entête débordait de
        // l'écran par la droite.
        h(
          'div',
          { class: 'explore__toolbar' },
          field,
          h('div', { class: 'explore__controls' }, sortField, panel.trigger),
        ),
  );

  const section = h(
    'section',
    { class: 'explore' },
    context,
    header,
    chips,
    actions,
    h('div', { class: 'explore__body' }, panel.node, results),
    bar.node,
  );

  content.append(section);

  /**
   * Ramène les résultats à l'écran. Appelé quand la feuille de filtres se
   * referme — le geste qui suit est de les lire, et l'entête, si court soit-il,
   * reste au-dessus.
   */
  function revealResults() {
    results.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  }

  // Une requête lente ne doit jamais écraser le résultat d'une requête plus
  // récente : chaque chargement porte un jeton, seul le dernier écrit l'état.
  let token = 0;

  async function load({ append = false } = {}) {
    const mine = ++token;
    state.loading = true;
    drawResults();
    try {
      const offset = append ? state.books.length : 0;
      const [page, facets] = await Promise.all([
        repository.exploreBooks({ ...state.query, offset, limit: PAGE }),
        repository.getFacets(state.query),
      ]);
      if (mine !== token) return;
      state.books = append ? [...state.books, ...page.books] : page.books;
      state.total = page.total;
      state.facets = facets;
      state.error = null;
    } catch (error) {
      if (mine !== token) return;
      state.error = error;
    } finally {
      if (mine === token) {
        state.loading = false;
        draw();
      }
    }
  }

  function update(patch) {
    state.query = { ...state.query, ...patch };
    writeQuery(state.query);
    load();
  }

  /**
   * Le seul chemin qui vide le champ de recherche. Le vidage est **explicite**
   * ici plutôt que déduit de l'état dans `draw()` : `draw()` ne réécrit jamais
   * un champ tenu par le doigt, faute de quoi une réponse en retard reposerait
   * un terme dépassé par-dessus les caractères qui viennent d'être tapés.
   */
  function resetQuery() {
    field.value = '';
    update({ ...EMPTY_QUERY });
  }

  const unsubscribe = onDownloadsChanged(() => {
    if (!content.isConnected) {
      unsubscribe();
      return;
    }
    load();
  });

  function draw() {
    total.textContent = t('pagination.results', { total: state.total });
    // Ni le champ ni le tri ne sont remplacés : on ne repose leur valeur que
    // lorsqu'elle vient d'ailleurs, et jamais dans celui qu'on est en train de
    // remplir — l'y reposer déplacerait le curseur en fin de ligne.
    if (globalThis.document?.activeElement !== field && field.value !== state.query.text) {
      field.value = state.query.text;
    }
    if (sort.value !== state.query.sort) sort.value = state.query.sort;
    chips.replaceChildren(...chipNodes());
    actions.replaceChildren(selectButton());
    panel.update({ facets: state.facets, query: state.query });
    drawResults();
    paintSelection();
  }

  function drawResults() {
    const next = resultsNode();
    results.replaceWith(next);
    results = next;
  }

  // -------------------------------------------------------- filtres actifs

  function labelOf(key, value) {
    return state.facets[key]?.find((entry) => entry.value === value)?.label ?? String(value);
  }

  function activeFilters() {
    const out = [];
    for (const key of MULTI) {
      for (const value of state.query[key] ?? []) {
        out.push({ key, value, label: labelOf(key, value) });
      }
    }
    if (state.query.status) {
      out.push({ key: 'status', value: null, label: labelOf('status', state.query.status) });
    }
    if (state.query.years) out.push({ key: 'years', value: null, label: t('facet.year') });
    return out;
  }

  function chipNodes() {
    const active = activeFilters();
    const out = active.map((filter) =>
      h(
        'button',
        {
          class: 'chip chip--removable',
          onclick: () =>
            update(
              filter.value == null
                ? { [filter.key]: null }
                : { [filter.key]: state.query[filter.key].filter((v) => v !== filter.value) },
            ),
        },
        h('span', {}, filter.label),
        icon('close', { size: 14 }),
      ),
    );

    if (active.length || state.query.text) {
      out.push(
        h(
          'button',
          { class: 'button button--tonal', onclick: resetQuery },
          t('explore.clearAll'),
        ),
      );
    }

    return out;
  }

  // ------------------------------------------------------------- sélection

  function selectButton() {
    return h(
      'button',
      {
        class: 'button button--tonal explore__select',
        onclick: () => enterSelection(),
      },
      icon('check', { size: 18 }),
      h('span', {}, t('explore.select')),
    );
  }

  /**
   * Entre en mode sélection, et coche [editionId] s'il est donné — c'est le cas
   * de l'appui long : ouvrir un mode sans rien y mettre obligerait à refaire le
   * geste sur la carte qu'on visait.
   *
   * Le geste retour et `Escape` n'y sont inscrits **qu'ici** : hors du mode,
   * l'écran ne doit consommer ni l'un ni l'autre.
   */
  function enterSelection(editionId = null) {
    if (editionId) state.selection.add(editionId);
    if (state.selecting) {
      paintSelection();
      return;
    }
    state.selecting = true;
    releaseBack = pushBackHandler(() => {
      if (!state.selecting) return false;
      leaveSelection();
      return true;
    });
    globalThis.document?.addEventListener?.('keydown', onKey);
    drawResults();
    paintSelection();
  }

  /** La seule sortie : croix, `Escape`, geste retour, fin de téléchargement, `dispose`. */
  function leaveSelection() {
    if (!state.selecting) return;
    state.selecting = false;
    state.selection.clear();
    releaseBack?.();
    releaseBack = null;
    globalThis.document?.removeEventListener?.('keydown', onKey);
    drawResults();
    paintSelection();
  }

  /** Vide la sélection **sans** quitter le mode : effacer n'est pas renoncer. */
  function clearSelection() {
    if (!state.selection.size) return;
    for (const editionId of state.selection) paintCard(editionId, false);
    state.selection.clear();
    paintSelection();
  }

  function selectPage() {
    // Toute la page, l'installé compris : la case sert aussi à ranger.
    for (const book of state.books) {
      state.selection.add(book.editionId);
      paintCard(book.editionId, true);
    }
    paintSelection();
  }

  function onKey(event) {
    if (event.key !== 'Escape' || !state.selecting) return;
    event.preventDefault?.();
    leaveSelection();
  }

  /**
   * Coche ou décoche **une** carte, sans reconstruire la grille. Une carte hors
   * de l'écran — page précédente, filtre changé — n'a rien à peindre : la
   * sélection, elle, la garde.
   */
  function paintCard(editionId, selected) {
    const card = cards.get(editionId);
    if (!card) return;
    card.classList.toggle('is-selected', selected);
    const box = card.querySelector('.book-card__check');
    if (box) box.checked = selected;
  }

  function toggle(editionId, selected) {
    if (selected) state.selection.add(editionId);
    else state.selection.delete(editionId);
    paintCard(editionId, selected);
    paintSelection();
  }

  // La pesée est un aller-retour du pont natif : une glissade de cases en
  // produirait une par tape. Antirebond, et jeton de génération — deux pesées
  // qui se croisent se posaient dans le désordre.
  let weighToken = 0;
  let weighTimer = null;

  /** Repeint la bande et la barre depuis la sélection. Ne touche aucune carte. */
  function paintSelection() {
    context.hidden = !state.selecting;
    actions.hidden = state.selecting;
    header.hidden = state.selecting;
    chips.hidden = state.selecting;
    // La pastille ne flotte que s'il y a **quelque chose à en faire**. Une barre
    // qui s'affiche sur une sélection vide occupe le bas de l'écran pour dire
    // qu'on ne peut rien faire, et cache une rangée de livres pour le dire.
    bar.setVisible(state.selecting && state.selection.size > 0);
    if (state.selecting) section.setAttribute('data-selecting', '');
    else section.removeAttribute('data-selecting');
    if (!state.selecting) return;

    const chosen = state.selection.size;
    // Ce qui est coché mais pas à l'écran : sans ce nombre, une sélection
    // héritée d'une recherche précédente est invisible et paraît fantôme.
    const offscreen = [...state.selection].filter((id) => !cards.has(id)).length;
    contextCount.textContent = offscreen
      ? `${t('explore.selected', { count: chosen })} • ${t('explore.offscreen', { count: offscreen })}`
      : t('explore.selected', { count: chosen });
    contextPage.textContent = t('explore.selectPageCount', { count: state.books.length });

    paintActions({ count: 0, bytes: 0, pending: true });
    clearTimeout(weighTimer);
    const mine = ++weighToken;
    weighTimer = setTimeout(async () => {
      const weight = await repository.getSelectionWeight([...state.selection]).catch(() => null);
      if (mine !== weighToken || !weight) return;
      paintActions(weight);
    }, WEIGH_DELAY);
  }

  /**
   * La pastille dit **une** chose : ce qu'il y a à télécharger, et si l'on peut.
   *
   * Ranger dans une collection en est parti. Ce n'est pas le geste qu'on fait
   * après avoir coché vingt livres dans le catalogue — on les prend d'abord, on
   * les range ensuite, depuis `/collections` qui a son mode d'édition et la
   * fiche du livre qui a son bouton. Trois actions sur une pastille flottante,
   * c'est une barre d'outils : on la lit au lieu de l'utiliser.
   */
  function paintActions({ count, bytes, pending = false }) {
    bar.update({
      label: t('explore.selected', { count: state.selection.size }),
      actions: [
        {
          key: 'download',
          variant: 'filled',
          icon: 'download',
          label: t('explore.downloadCount', {
            count,
            size: formatBytes(bytes) || t('format.zeroBytes'),
          }),
          // Un refus se lit **avant** la tape : jusque-là, toucher une sélection
          // entièrement installée ouvrait un message pour dire qu'il n'y avait
          // rien à faire.
          disabled: !state.selection.size || (!pending && count === 0),
          reason: state.selection.size ? t('explore.allInstalled') : t('explore.selectSome'),
          onPick: () => downloadSelection(),
        },
        {
          key: 'clear',
          icon: 'close',
          label: t('explore.clearSelection'),
          disabled: !state.selection.size,
          onPick: clearSelection,
        },
      ],
    });
  }

  async function downloadSelection() {
    const ids = [...state.selection];
    const { count, bytes } = await repository.getSelectionWeight(ids);
    if (count === 0) return;
    const choice = await confirmDialog({
      title: t('explore.downloadTitle', { count }),
      message: t('explore.downloadSize', { size: formatBytes(bytes) || t('format.zeroBytes') }),
      actions: [{ value: 'go', label: t('explore.download'), variant: 'filled' }],
    });
    if (choice !== 'go') return;
    await repository.downloadSelection(ids);
    leaveSelection();
    load();
  }

  // --------------------------------------------------------------- résultats

  function resultsNode() {
    if (state.error) return h('div', { class: 'explore__results' }, errorView(state.error, load));
    if (state.loading && !state.books.length) {
      return h('div', { class: 'explore__results' }, loadingView());
    }
    if (!state.books.length) {
      return h(
        'div',
        { class: 'explore__results' },
        emptyView(t('explore.noResults')),
        h(
          'button',
          { class: 'button button--tonal', onclick: resetQuery },
          t('explore.clearFilters'),
        ),
      );
    }

    // Les cartes montées sont retenues : c'est ce qui permet à une case cochée
    // de ne toucher que la sienne.
    cards.clear();
    const grid = h(
      'div',
      { class: 'explore__grid' },
      state.books.map((book) => {
        const card = bookCard(book, {
          action: book.downloadStatus === 'installed' ? 'read' : 'download',
          selectable: state.selecting,
          selected: state.selection.has(book.editionId),
          onToggle: toggle,
          onLongSelect: (editionId) => enterSelection(editionId),
        });
        cards.set(book.editionId, card);
        return card;
      }),
    );

    const more =
      state.books.length < state.total &&
      h(
        'button',
        {
          class: 'button button--tonal explore__more',
          disabled: state.loading,
          onclick: () => load({ append: true }),
        },
        t(state.loading ? 'state.loading' : 'explore.more'),
      );

    return h('div', { class: 'explore__results' }, grid, more);
  }

  draw();
  load();
  return {
    dispose() {
      unsubscribe();
      // Sortir du mode retire du même coup le gestionnaire du geste retour et
      // l'écoute d'`Escape` : une seule porte de sortie, ici comme ailleurs.
      leaveSelection();
      clearTimeout(weighTimer);
      // Le gestionnaire du geste retour est posé par le panneau : le laisser
      // inscrit ferait fermer une feuille qui n'est plus au document.
      panel.dispose();
    },
  };
}
