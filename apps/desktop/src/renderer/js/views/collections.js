import { paletteFor } from '../../../shared/book-cover.js';
import { localeDir } from '../../../shared/locale.js';
import { h } from '../dom.js';
import { currentLocale, t } from '../i18n.js';
import { chevronBackward, chevronForward, icon } from '../icons.js';
import { repository } from '../repository.js';
import { navigate } from '../router.js';
import { renderShell, toast } from '../shell.js';
import { actionBar } from '../components/action-bar.js';
import { bookCard } from '../components/book-card.js';
import { coverGrain } from '../components/cover.js';
import { confirmDialog } from '../components/modal.js';
import { pagination, PAGE_SIZES } from '../components/pagination.js';
import { asyncView, emptyView, errorView, loadingView } from '../components/states.js';

/**
 * Une page du mode d'édition. La source est **tout le catalogue** — 8 589
 * livres —, on n'en monte jamais plus d'une page et la page se tourne.
 */
const PICK_PAGE = 20;

/** Le champ de recherche attend que la frappe se calme avant d'interroger. */
const PICK_DEBOUNCE = 250;

/**
 * De combien la rangée se déplace d'un chevron : quatre cinquièmes de ce qu'on
 * voit, jamais l'écran entier — une carte reste visible d'un coup à l'autre,
 * c'est elle qui dit qu'on n'a pas sauté.
 */
const CAROUSEL_STEP = 0.8;

/** En dessous, on pousse au moins d'une carte : la rangée est plus étroite qu'elle. */
const CAROUSEL_MIN_STEP = 220;

/**
 * Bandeau des collections, posé en tête de la bibliothèque. Une collection est
 * une liste de références : elle peut contenir des livres non installés, ce qui
 * en fait autant une liste d'envies qu'un rangement.
 *
 * La rangée est un **carrousel** : les collections sont peu nombreuses mais rien
 * ne les borne, et repliées elles poussaient l'étagère sous la ligne de
 * flottaison. Au large, elle se lit comme une rangée ordinaire — les chevrons
 * s'effacent dès que tout tient, un bouton qui ne fait rien étant pire qu'un
 * bouton absent.
 */
export function collectionsStrip(onChanged) {
  const host = h('section', { class: 'collections' });

  async function create() {
    const name = await askName(t('collections.newTitle'));
    if (!name) return;
    try {
      // `createCollection` rend l'identifiant qu'il vient de tirer : c'est ce
      // qui permet d'entrer dans la collection au lieu de la chercher des yeux
      // dans le bandeau. Créer une collection, c'est vouloir la remplir — le
      // mode d'édition s'ouvre avec elle.
      const id = await repository.createCollection(name);
      onChanged?.();
      navigate(`/collection/${id}?add=1`);
    } catch (error) {
      toast(t('collections.actionFailed'));
      await refresh();
    }
  }

  async function refresh() {
    const collections = await repository.getCollections();

    // `role="list"` et non une simple boîte : au lecteur d'écran, un carrousel
    // reste une liste, et c'est le seul moyen d'en annoncer la longueur.
    const row = h(
      'div',
      { class: 'collections__row no-scrollbar', role: 'list', tabindex: 0 },
      collections.map((entry) => h('div', { role: 'listitem' }, collectionCard(entry))),
    );

    const previous = h(
      'button',
      {
        class: 'button--icon collections__chevron',
        type: 'button',
        title: t('collections.previous'),
        'aria-label': t('collections.previous'),
      },
      chevronBackward({ size: 20 }),
    );
    const next = h(
      'button',
      {
        class: 'button--icon collections__chevron',
        type: 'button',
        title: t('collections.next'),
        'aria-label': t('collections.next'),
      },
      chevronForward({ size: 20 }),
    );
    const nav = h('div', { class: 'collections__nav' }, previous, next);

    const step = () => Math.max(CAROUSEL_MIN_STEP, row.clientWidth * CAROUSEL_STEP);
    // Le *sens de lecture* décide du signe, jamais une constante : en RTL,
    // avancer fait décroître `scrollLeft`, en LTR il croît. Écrit en dur pour
    // l'arabe, « suivant » ne bougerait pas d'un pixel sous interface anglaise —
    // le défaut coïnciderait avec la vérité dans la langue où l'on développe.
    const avance = () => (localeDir(currentLocale()) === 'rtl' ? -1 : 1);
    previous.onclick = () => row.scrollBy({ left: -avance() * step(), behavior: 'smooth' });
    next.onclick = () => row.scrollBy({ left: avance() * step(), behavior: 'smooth' });

    // `scrollLeft` est négatif en RTL sous Chromium : on raisonne en distance
    // absolue au bord, jamais en signe. C'est la règle de l'accueil.
    const syncEdges = () => {
      const max = row.scrollWidth - row.clientWidth;
      const offset = Math.abs(row.scrollLeft);
      // Tout tient : la rangée est une rangée, et les deux chevrons n'ont rien à
      // proposer. On les retire au lieu de les griser — on essaie deux fois un
      // bouton grisé avant de conclure qu'il est mort.
      nav.hidden = max <= 1;
      previous.disabled = offset <= 1;
      next.disabled = offset >= max - 1;
      row.classList.toggle('collections__row--at-start', previous.disabled);
      row.classList.toggle('collections__row--at-end', next.disabled);
    };
    row.addEventListener('scroll', syncEdges, { passive: true });
    requestAnimationFrame(syncEdges);
    // `ResizeObserver` plutôt qu'un écouteur sur `window` : la rangée est
    // remplacée à chaque rafraîchissement, l'observateur s'en va avec elle.
    new ResizeObserver(syncEdges).observe(row);

    host.replaceChildren(
      h(
        'div',
        { class: 'section-header' },
        h(
          'div',
          {},
          h('h2', { class: 'headline-lg' }, t('collections.title')),
          h('p', { class: 'body-md muted' }, t('collections.subtitle')),
        ),
        // « Nouvelle collection » est une **action**, pas une collection : elle
        // reste dans l'entête, hors du carrousel. Posée en carte, elle serait
        // partie hors de l'écran dès la sixième collection — un geste de
        // création qu'il faut faire défiler pour atteindre est un geste perdu —
        // et elle aurait allongé une liste dont elle n'est pas membre.
        h(
          'div',
          { class: 'collections__tools' },
          nav,
          h(
            'button',
            { class: 'button button--tonal', type: 'button', onclick: create },
            icon('plusSquare', { size: 18 }),
            h('span', {}, t('collections.newTitle')),
          ),
        ),
      ),
      row,
    );
  }

  refresh();
  return host;
}

/**
 * La carte d'une collection. Elle n'a pas de discipline à quoi accrocher une
 * teinte — son propriétaire y met ce qu'il veut — mais elle a un identifiant qui
 * ne change jamais : `paletteFor` en tire une des neuf familles de
 * `shared/book-cover.js`, la même palette que les couvertures, et jamais une
 * seconde à tenir à jour.
 *
 * La teinte se tire de l'identifiant et **non du rang** : ajouter une collection
 * en tête repeindrait toutes les autres, et l'on ne reconnaîtrait plus la sienne
 * d'un coup d'œil.
 *
 * Le bandeau porte la couleur et le décor, le corps porte le texte : les mots
 * restent sur la surface du thème, donc lisibles en parchemin comme en nuit. Une
 * carte entièrement teintée aurait mis du texte sur neuf fonds différents, à
 * vérifier un par un dans les trois ambiances.
 */
function collectionCard(entry) {
  const palette = paletteFor(entry.id ?? entry.name);
  // Le décompte vient de SQL — `bookCount` et `installedCount` du dépôt — et la
  // part n'est qu'une division de ces deux-là : rien n'est compté côté vue.
  const share = entry.bookCount > 0 ? entry.installedCount / entry.bookCount : 0;
  return h(
    'button',
    {
      class: `collection-card collection-card--${palette.family}`,
      // Les deux seules valeurs que la vue pose : les teintes de la famille,
      // telles que les rend le module partagé. La dorure du moiré et l'encre du
      // sceau sont des constantes de la feuille de style — une couleur écrite en
      // clair ici serait une seconde palette, celle qui finit par diverger.
      style: { '--cover-from': palette.from, '--cover-to': palette.to },
      onclick: () => navigate(`/collection/${entry.id}`),
    },
    h(
      'span',
      { class: 'collection-card__band', 'aria-hidden': 'true' },
      coverGrain(palette.pattern),
      h('span', { class: 'collection-card__seal' }, icon('rows', { size: 20 })),
    ),
    h(
      'span',
      { class: 'collection-card__body' },
      h('span', { class: 'collection-card__name truncate' }, entry.name),
      h(
        'span',
        { class: 'collection-card__counts label-sm' },
        h('span', {}, t('collections.cardBooks', { count: entry.bookCount })),
        h('span', { class: 'muted' }, t('collections.cardInstalled', { count: entry.installedCount })),
      ),
      h(
        'span',
        { class: 'progress collection-card__gauge' },
        h('span', { style: { width: `${Math.round(share * 100)}%` } }),
      ),
    ),
  );
}

/**
 * Saisie d'un nom. Rendue à la main plutôt que par `confirmDialog` : celui-ci
 * ne rend qu'un choix parmi des actions, pas une valeur libre.
 */
function askName(title, initial = '') {
  return new Promise((resolve) => {
    let settle = (value) => {
      settle = () => {};
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
      resolve(value);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') settle(null);
    };

    const field = h('input', {
      type: 'text',
      class: 'picker__field',
      value: initial,
      onkeydown: (event) => {
        if (event.key === 'Enter') settle(field.value.trim() || null);
      },
    });

    const backdrop = h(
      'div',
      {
        class: 'modal',
        onclick: (event) => {
          if (event.target === backdrop) settle(null);
        },
      },
      h(
        'div',
        { class: 'modal__panel', role: 'dialog', 'aria-modal': 'true' },
        h('h3', { class: 'title-md' }, title),
        field,
        h(
          'div',
          { class: 'modal__actions' },
          h(
            'button',
            {
              class: 'button button--filled',
              onclick: () => settle(field.value.trim() || null),
            },
            t('action.save'),
          ),
          h('button', { class: 'button button--tonal', onclick: () => settle(null) }, t('action.cancel')),
        ),
      ),
    );

    document.addEventListener('keydown', onKey);
    document.body.append(backdrop);
    field.focus();
    field.select();
  });
}

/**
 * Contenu d'une collection : renommer, supprimer, télécharger ce qui manque,
 * et **composer** — ajouter ou retirer des livres un par un.
 * Nom distinct de `collectionView` de `library.js`, qui est une fabrique de
 * vues de listes (catégorie, auteur, siècle) et n'a rien à voir.
 *
 * Le mode d'édition puise dans **tout le catalogue**, pas dans les livres
 * installés : une collection est autant une liste d'envies qu'un rangement, et
 * la borner au disque interdirait d'y mettre ce qu'on n'a pas encore. Il n'est
 * pas réservé à la création — on y revient quand on veut, par le bouton de
 * l'entête ; c'est le fragment `?add=1` qui l'ouvre d'emblée au sortir d'une
 * création.
 */
export function collectionDetailView(host, params) {
  const content = renderShell(host, { active: 'library' });
  const { id } = params;

  // Une collection peut porter tout le catalogue : on en montre une page, et
  // `missing` est compté sur l'ensemble — sinon « tout télécharger »
  // proposerait moins de livres qu'il n'y en a à prendre.
  const query = { offset: 0, limit: PAGE_SIZES[0] };

  /**
   * L'état du mode d'édition, tenu hors du rendu : la liste des résultats se
   * redessine seule, sans que le champ de recherche perde le curseur.
   * `members` ne porte que l'appartenance des livres **affichés** — la demander
   * pour toute la collection ferait traverser le pont des milliers
   * d'identifiants à chaque page tournée.
   */
  const pick = {
    open: params?.query?.add === '1',
    text: '',
    offset: 0,
    books: [],
    total: 0,
    members: new Set(),
    loading: true,
    error: null,
    token: 0,
    timer: null,
    results: null,
  };

  // Le fragment a dit « ouvre le mode d'édition » : on l'efface une fois lu,
  // sinon un retour dans l'historique rouvrirait le mode qu'on vient de quitter.
  if (pick.open) history.replaceState(null, '', `#/collection/${encodeURIComponent(id)}`);

  const load = async () => ({
    collection: (await repository.getCollections()).find((entry) => entry.id === id) ?? null,
    page: await repository.getCollectionBooks(id, query),
  });

  const refresh = () => asyncView(content, load, render, { empty: t('collections.empty') });

  function render({ collection, page }) {
    if (!collection) return emptyView(t('collections.notFound'));
    return pick.open ? managePage(collection) : contentPage(collection, page);
  }

  // ------------------------------------------------------ la collection telle quelle

  function contentPage(collection, page) {
    const books = page.rows;
    const missing = page.missing;

    return h(
      'section',
      { class: 'collection-page' },
      h(
        'div',
        { class: 'section-header' },
        h(
          'div',
          {},
          h('h1', { class: 'display-lg' }, collection.name),
          h(
            'p',
            { class: 'body-md muted' },
            t('collections.counts', {
              books: collection.bookCount,
              installed: collection.installedCount,
            }),
          ),
        ),
        h(
          'div',
          { class: 'collection-page__actions' },
          h(
            'button',
            {
              class: 'button button--tonal',
              onclick: () => {
                pick.open = true;
                pick.offset = 0;
                refresh();
              },
            },
            icon('plusSquare', { size: 18 }),
            h('span', {}, t('collections.manage')),
          ),
          missing.length > 0 &&
            h(
              'button',
              {
                class: 'button button--filled',
                onclick: async () => {
                  await repository.downloadSelection(missing);
                  toast(t('collections.queued', { count: missing.length }));
                  refresh();
                },
              },
              icon('download', { size: 18 }),
              h('span', {}, t('collections.downloadRest', { count: missing.length })),
            ),
          h(
            'button',
            {
              class: 'button button--tonal',
              onclick: async () => {
                const name = await askName(t('collections.rename'), collection.name);
                if (!name) return;
                await repository.renameCollection(id, name);
                refresh();
              },
            },
            t('collections.rename'),
          ),
          h(
            'button',
            {
              class: 'button button--tonal',
              onclick: async () => {
                const choice = await confirmDialog({
                  title: t('collections.deleteTitle', { name: collection.name }),
                  message: t('collections.deleteMessage'),
                  actions: [{ value: 'go', label: t('collections.deleteAction'), variant: 'danger' }],
                });
                if (choice !== 'go') return;
                await repository.deleteCollection(id);
                navigate('/library');
              },
            },
            t('action.delete'),
          ),
        ),
      ),
      books.length
        ? h(
            'div',
            { class: 'explore__grid' },
            books.map((book) =>
              bookCard(book, {
                action: book.downloadStatus === 'installed' ? 'read' : 'download',
              }),
            ),
          )
        : emptyView(t('collections.empty')),
      page.total > query.limit &&
        pagination({
          total: page.total,
          offset: query.offset,
          limit: query.limit,
          onChange: (offset) => {
            query.offset = offset;
            refresh();
          },
          onPageSize: (limit) => {
            Object.assign(query, { limit, offset: 0 });
            refresh();
          },
        }),
    );
  }

  // ------------------------------------------------------------ le mode d'édition

  function managePage(collection) {
    // Le champ est créé une fois pour la durée du mode : seuls les résultats se
    // redessinent, sinon la frappe reprendrait le curseur à chaque lettre.
    const field = h('input', {
      type: 'search',
      class: 'explore__search',
      value: pick.text,
      placeholder: t('collections.searchCatalog'),
      oninput: (event) => {
        const text = event.target.value;
        clearTimeout(pick.timer);
        pick.timer = setTimeout(() => {
          pick.text = text;
          pick.offset = 0;
          loadPicks();
        }, PICK_DEBOUNCE);
      },
    });

    pick.results = h('div', { class: 'collection-manage__results' });

    /**
     * Valider **flotte**, comme la barre de l'exploration : c'est le seul geste
     * qui sorte du mode, et posé dans l'entête il partait hors champ dès qu'on
     * descendait dans les résultats — on ajoutait un livre au vingtième rang et
     * il fallait remonter tout l'écran pour dire qu'on avait fini.
     *
     * La barre est visible d'emblée et le reste : un mode dont la sortie
     * n'apparaît qu'à condition est un mode où l'on se sent enfermé. Elle ne
     * porte pas de décompte — ceux de l'entête viennent de SQL, et en tenir un
     * ici serait un second compte à faire diverger.
     */
    const bar = actionBar({ label: t('collections.manage') });
    bar.update({
      // Cette barre ne porte **que** la sortie du mode : rien n'y agit sur les
      // livres, tout se fait dans la liste. C'est donc la croix, pas une
      // action — elle ne se désactive pas et ne bouge pas de place, et son
      // libellé reste lisible au lecteur d'écran.
      dismiss: {
        label: t('collections.manageDone'),
        onPick: () => {
          clearTimeout(pick.timer);
          // Le jeton avance et l'hôte s'en va : une requête déjà partie ne
          // dessinera pas dans un nœud qui n'est plus à l'écran.
          pick.token += 1;
          pick.results = null;
          pick.open = false;
          // Les décomptes de l'entête viennent de SQL : on relit la
          // collection au lieu de tenir un compte de notre côté.
          refresh();
        },
      },
      actions: [],
    });
    bar.setVisible(true);

    const section = h(
      'section',
      { class: 'collection-page' },
      h(
        'div',
        { class: 'section-header' },
        h(
          'div',
          {},
          h('h1', { class: 'display-lg' }, collection.name),
          h('p', { class: 'body-md muted' }, t('collections.manageHint')),
        ),
      ),
      h('div', { class: 'collection-manage' }, field, pick.results),
      bar.node,
    );

    loadPicks();
    return section;
  }

  /**
   * Une requête lente ne doit jamais écraser le résultat d'une requête plus
   * récente : chaque chargement porte un jeton, seul le dernier écrit l'état.
   * C'est la règle de `views/explore.js` et du routeur.
   */
  async function loadPicks() {
    const mine = ++pick.token;
    pick.loading = true;
    pick.error = null;
    drawPicks();
    try {
      const page = await repository.exploreBooks({
        text: pick.text,
        offset: pick.offset,
        limit: PICK_PAGE,
        sort: 'title',
      });
      const inside = await repository.getCollectionMembership(
        id,
        page.books.map((book) => book.editionId),
      );
      if (mine !== pick.token) return;
      pick.books = page.books;
      pick.total = page.total;
      pick.members = new Set(inside);
    } catch (error) {
      if (mine !== pick.token) return;
      pick.error = error;
    } finally {
      if (mine === pick.token) {
        pick.loading = false;
        drawPicks();
      }
    }
  }

  function drawPicks() {
    if (pick.results) pick.results.replaceChildren(picksNode());
  }

  /** Les quatre états du mode d'édition, traités ici et nulle part ailleurs. */
  function picksNode() {
    if (pick.error) return errorView(pick.error, loadPicks);
    if (pick.loading) return loadingView();
    if (!pick.books.length) return emptyView(t('collections.noMatch'));

    return h(
      'div',
      { class: 'collection-manage__page' },
      h('ul', { class: 'collection-manage__list' }, pick.books.map(pickRow)),
      pick.total > PICK_PAGE &&
        pagination({
          total: pick.total,
          offset: pick.offset,
          limit: PICK_PAGE,
          onChange: (offset) => {
            pick.offset = offset;
            loadPicks();
          },
        }),
    );
  }

  /**
   * Une ligne du catalogue, avec le seul geste qui compte ici : `+` si le livre
   * manque à la collection, `−` s'il y est déjà. Le libellé dit lequel des deux
   * — une icône seule ne se lit pas au lecteur d'écran.
   */
  function pickRow(book) {
    const inside = pick.members.has(book.editionId);
    const label = inside ? t('collections.removeBook') : t('collections.addBook');
    return h(
      'li',
      { class: `collection-manage__row${inside ? ' is-in' : ''}` },
      h(
        'div',
        { class: 'collection-manage__text' },
        h('span', { class: 'collection-manage__title truncate' }, book.title),
        book.authorName && h('span', { class: 'label-sm muted truncate' }, book.authorName),
      ),
      h(
        'button',
        {
          class: 'button--icon collection-manage__toggle',
          title: label,
          'aria-label': label,
          'aria-pressed': inside ? 'true' : 'false',
          onclick: () => togglePick(book),
        },
        icon(inside ? 'minus' : 'plus', { size: 18 }),
      ),
    );
  }

  async function togglePick(book) {
    const inside = pick.members.has(book.editionId);
    try {
      if (inside) {
        await repository.removeFromCollection(id, book.editionId);
        pick.members.delete(book.editionId);
        toast(t('collections.bookRemoved'));
      } else {
        await repository.addToCollection(id, [book.editionId]);
        pick.members.add(book.editionId);
        toast(t('collections.bookAdded'));
      }
      drawPicks();
    } catch (error) {
      toast(t('collections.actionFailed'));
    }
  }

  refresh();
  // Le compte à rebours de la frappe survivrait à l'écran : il tirerait une
  // page du catalogue pour une vue qui n'est plus là.
  return { dispose: () => clearTimeout(pick.timer) };
}
