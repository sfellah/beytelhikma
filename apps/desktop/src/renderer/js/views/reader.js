import { DEFAULT_READER_FONT, fontsForScript, resolveFont } from '../../../shared/fonts.js';
import { describeSelection, paintHighlights } from '../annotations.js';
import { pushBackHandler } from '../back-intent.js';
import { renderBookHtml } from '../content-html.js';
import { h } from '../dom.js';
import { n } from '../format.js';
import { t } from '../i18n.js';
import { chevronBackward, chevronForward, icon, isRtl } from '../icons.js';
import { isLargeBook } from '../../../shared/large-book.js';
import { canGoFullscreen, isTouchPrimary } from '../platform.js';
import { repository, setSetting, settings } from '../repository.js';
import { back, navigate } from '../router.js';
import { toast } from '../shell.js';
import { confirmDialog } from '../components/modal.js';
import { openShortcuts } from '../components/shortcuts.js';
import { errorView, loadingView } from '../components/states.js';
import { settingChoice } from '../components/setting-choice.js';
import { themeChoices } from '../components/theme-choices.js';
import { arabicSearchPattern, normalizeArabic } from '../../../shared/arabic.js';
import { footnotesByNumber, markerPattern, toLatinDigits } from '../../../shared/footnotes.js';
import { composeNote } from '../../../shared/note-draft.js';
import {
  DEFAULT_TAP_ZONES,
  TAP_ZONE_MODES,
  resolveTapZones,
  swipeTurn,
  turnZone,
} from '../../../shared/page-turn.js';
import {
  DEFAULT_READING_MODE,
  READING_MODES,
  outOfWindow,
  resolveReadingMode,
  windowAround,
} from '../../../shared/reading-modes.js';
import {
  ANCHORS_SETTING,
  anchorFor,
  readAnchors,
  rememberAnchor,
  serializeAnchors,
} from '../../../shared/reader-anchors.js';
import {
  clampSize,
  DEFAULT_FONT_SIZE,
  MAX_FONT,
  MIN_FONT,
  PINCH_MIN_SPREAD,
  pinchSize,
} from '../../../shared/reader-size.js';

/**
 * Direction du **contenu**, qui n'est pas celle de l'interface : le corpus est
 * arabe, une page de livre reste RTL sous une interface anglaise. Elle se pose
 * explicitement — une direction implicite coïnciderait en `ar` et masquerait le
 * défaut jusqu'à la première bascule.
 */
const CONTENT_DIR = 'rtl';

/** Texte écrit par le lecteur : sa direction est celle de ce qu'il a tapé. */
const USER_DIR = 'auto';

const PAGE_WINDOW = 20;
const HINT_DELAY = 4000;

/**
 * Répit laissé au défilement avant d'écrire où l'on en est dans la page. Le
 * geste en produit une mesure par image, et `user.sqlite` s'écrit de côté puis
 * se renomme — c'est le seul fichier qu'on ne puisse pas retélécharger.
 */
const ANCHOR_DELAY = 500;

/**
 * Délai laissé à une sélection pour se poser avant qu'on la mesure. Une
 * sélection qui s'étire émet `selectionchange` à chaque caractère ; sans ce
 * répit, la feuille des couleurs sauterait sous le doigt qui la fabrique.
 */
const SELECTION_SETTLE = 250;

// Les deux règles qui décident du sens — les tiers au clic, le glissement au
// doigt — vivent dans `shared/page-turn.js`, pures et seules : c'est la seule
// façon de les vérifier dans les *deux* directions d'écriture sans un DOM.

/**
 * Entrées de sommaire montées d'un coup ; au-delà, on déplie à la demande.
 *
 * Trente, et non quatre-vingts : sur un téléphone, quatre-vingts boutons font
 * une dizaine d'écrans de défilement avant d'atteindre le pied du panneau, et
 * certains livres du corpus portent des dizaines de milliers d'entrées — la
 * tranche est ce qu'on parcourt d'un pouce, pas ce que la mémoire supporte.
 * Le lecteur garde de toute façon le sommaire **entier** en mémoire : il lui
 * sert à nommer le chapitre de chaque page.
 */
const TOC_WINDOW = 30;

/**
 * La marge, en pixels, sous laquelle arriver au bord de la tranche montée en
 * déplie une de plus.
 *
 * Le dépliage suit le défilement, et c'est le geste que le sommaire attend :
 * viser un bouton tous les trente titres, ce n'est pas parcourir une liste,
 * c'est la faire avancer à la main. Le bouton reste — il dit ce qui reste et
 * répond au clavier — mais on ne doit plus en dépendre pour continuer à lire.
 */
const TOC_EDGE = 160;

// Les familles de lecture viennent de `shared/fonts.js`, seul propriétaire de
// la liste : c'est d'une copie locale ici et d'une autre dans les réglages
// qu'était née la police orpheline. Le livre est arabe, donc seules les faces
// arabes sont proposées.
const FONTS = fontsForScript('arab');

/**
 * Palette « Serene Heritage » : les quatre teintes sortent des jetons du
 * projet (or antique, émeraude, argile, graphite) plutôt que d'un nuancier de
 * surligneur. Posées à faible opacité, elles teintent le fond sans jamais
 * toucher l'encre — le texte garde son contraste dans les trois ambiances.
 */
const HIGHLIGHTS = [
  { color: '#d9b26a', label: 'reader.highlight.gold' },
  { color: '#6a9e88', label: 'reader.highlight.emerald' },
  { color: '#c58a6b', label: 'reader.highlight.clay' },
  { color: '#8f9aa6', label: 'reader.highlight.stone' },
];

/** Onglets du panneau « ملاحظاتي » : le même vocabulaire que l'écran global. */
const ANNOTATION_KINDS = [
  { value: 'all', label: 'reader.tab.all', icon: 'notes' },
  { value: 'highlight', label: 'reader.tab.highlight', icon: 'highlight' },
  { value: 'note', label: 'reader.tab.note', icon: 'noteAdd' },
  { value: 'bookmark', label: 'reader.tab.bookmark', icon: 'bookmark' },
];

/**
 * Lecteur : page imprimée par écran ou fil continu, sélection de texte native,
 * taille de police réglable, ambiances, progression écrite dans `user.sqlite`.
 * Disposition et jeu d'icônes calqués sur `docs/maquettes/reader-v2.html`.
 */
export function readerView(host, params) {
  host.replaceChildren(loadingView(t('reader.opening')));
  const controller = new Reader(host, params.id, params.query?.page);
  controller.start();
  return { dispose: () => controller.dispose() };
}

class Reader {
  #host;
  #editionId;
  #requestedPageId;
  #pages = new Map();
  #pageCount = 0;
  #index = 0;
  #toc = [];
  #title = '';
  /** Le thème n'est plus une préférence de lecture : il est global (`theme.js`). */
  #prefs = {
    size: DEFAULT_FONT_SIZE,
    font: DEFAULT_READER_FONT,
    tapZones: DEFAULT_TAP_ZONES,
  };
  #saveTimer = null;
  #hintTimer = null;
  /**
   * Où l'on en était **dans** la page, par livre.
   *
   * La progression retient la page ; sur un téléphone, une page du corpus fait
   * trois à six écrans, et rouvrir un livre renvoyait donc en haut de la page
   * plutôt qu'à la ligne qu'on lisait. La carte vit dans un réglage, les règles
   * dans `shared/reader-anchors.js`.
   */
  #anchors = {};
  #anchorTimer = null;
  /** Numéro de la montée de page en cours — voir `#show`. */
  #showToken = 0;
  /** D'où l'on est parti au dernier saut, et de quoi y revenir. */
  #origin = null;
  /** Les occurrences du terme cherché sur la page montée, et celle qu'on vise. */
  #matches = [];
  #matchAt = 0;
  #nodes = {};
  /** Motif du terme cherché, réappliqué à chaque page affichée. */
  #highlight = null;
  /** Annotations du livre entier, chargées une fois puis tenues à jour. */
  #annotations = { highlights: [], notes: [], bookmarks: [] };
  /** Onglet courant du panneau des annotations. */
  #annotationKind = 'all';
  /**
   * Index dérivés, invalidés à chaque écriture d'annotation. Ils évitent de
   * rebalayer tout le livre pour chaque page montée ou chaque ligne du panneau.
   */
  #highlightsByPage = null;
  #tocByPage = null;
  #pagesById = null;
  /**
   * Les pages montées, par rang.
   *
   * Une seule en mode page — la feuille imprimée, c'est tout le principe. Une
   * fenêtre glissante dans le fil : les plus gros livres du corpus passent le
   * millier de pages, et les deux clients chargent une base entièrement en
   * mémoire. Monter le livre entier est la version qui avait été mesurée puis
   * abandonnée.
   */
  #blocks = new Map();
  /** La façon de lire : `page` ou `scroll`. */
  #mode = DEFAULT_READING_MODE;
  /** Page affichée, pour ancrer une annotation sans la rechercher. */
  #page = null;
  /**
   * Sélection décrite au moment où elle est faite : cliquer dans le menu la
   * défait, il est trop tard pour la mesurer. La page est retenue avec elle —
   * un panneau ouvert entre-temps peut avoir changé la page courante.
   */
  #pendingSelection = null;
  #pendingPage = null;
  /**
   * Départ du glissement en cours, et trace du dernier qui a tourné la page.
   *
   * Un glissement au doigt émet souvent un `click` en fin de course : sans
   * cette trace, la page tournerait deux fois — une fois par le geste, une fois
   * par le clic qu'il laisse derrière lui.
   */
  #swipeFrom = null;
  #swiped = false;
  /**
   * Les doigts posés sur la colonne, et le pincement qu'ils font peut-être.
   *
   * Le lecteur a besoin des **deux** pointeurs à la fois : un pincement n'est
   * pas un évènement, c'est la distance entre deux d'entre eux qui change. Le
   * navigateur, lui, n'en livre qu'un par message — la carte est la seule façon
   * de tenir l'autre.
   *
   * `touch-action: pan-y` interdit au navigateur d'agrandir la page lui-même :
   * le geste reste donc au lecteur, qui **recompose** le texte au lieu de le
   * grossir — les lignes se replient, la colonne ne déborde pas de l'écran.
   */
  #pointers = new Map();
  #pinch = null;
  /** Ferme la fiche des raccourcis, tant qu'elle est ouverte. */
  #closeShortcuts = null;
  /**
   * L'issue de l'éditeur de note ouvert, et de quoi rendre l'écran à ce qu'il
   * était.
   *
   * `#notePrompt` résout la promesse de `#openNoteSheet` : une seule issue, quel
   * que soit le chemin — la croix, « annuler », `Escape`, le geste retour, ou le
   * démontage de la vue. Sans elle, la promesse resterait pendante et le geste
   * d'écriture n'aboutirait jamais.
   *
   * `#dropKeyboardWatch` défait la surveillance du clavier virtuel : c'est lui
   * qui garde l'ancre de lecture en place pendant qu'on tape.
   */
  #notePrompt = null;
  #dropKeyboardWatch = null;
  /** Retire la cascade de retour de la pile de `back-intent.js`. */
  #dropBackHandler = null;
  #keyHandler = (event) => this.#onKey(event);
  #fullscreenHandler = () => this.#syncFullscreen();
  /**
   * Le plein écran est-il offert ? Constaté une fois à l'ouverture, pas relu à
   * chaque geste : ce n'est pas un réglage, et la réponse ne change pas sous
   * les doigts de celui qui lit.
   */
  #fullscreen = canGoFullscreen();
  /**
   * Une sélection était-elle vivante quand le doigt s'est posé ?
   *
   * Le navigateur défait la sélection **entre `mousedown` et `mouseup`** :
   * mesuré sur l'appareil, `mousedown` la voit encore, `mouseup` et `click`
   * lisent du vide. Une garde posée au `click` ne peut donc jamais protéger la
   * tape qui vient de défaire une sélection — elle voit toujours du vide et
   * escamote les barres. L'état se relève donc au `pointerdown`, seul moment
   * où il est encore vrai.
   */
  #selectionAtPress = false;
  #selectionTimer = null;
  /** Vrai dès que le routeur a démonté la vue : `start()` s'arrête là où elle en est. */
  #disposed = false;
  /** Vrai tant que le sommaire est en route : le panneau le dit au lieu de mentir. */
  #tocLoading = false;
  /**
   * `selectionchange` est le **seul** évènement qui arrive pendant qu'une
   * sélection existe. `mouseup` est un évènement de l'ère souris : il convient
   * au cliquer-glisser, où la sélection survit au relâchement, et pas au doigt,
   * où l'appui long est piloté par la couche native. C'est ce que le spike
   * mobile avait mesuré, et la correction n'avait jamais été reportée ici :
   * sans elle, le menu de surlignage ne s'ouvre pas au doigt.
   *
   * Antirebond : une sélection qui s'étire en émet des dizaines, et la feuille
   * sauterait à chaque caractère.
   */
  #selectionHandler = () => {
    clearTimeout(this.#selectionTimer);
    this.#selectionTimer = setTimeout(() => this.#onSelection(), SELECTION_SETTLE);
  };

  constructor(host, editionId, requestedPageId) {
    this.#host = host;
    this.#editionId = editionId;
    this.#requestedPageId = requestedPageId ? Number(requestedPageId) : null;
  }

  async start() {
    try {
      // Le contenu n'est lisible qu'une fois le fichier installé : sans lui, la
      // fiche est le seul endroit où l'on peut faire quelque chose.
      const detail = await repository.getBookDetail(this.#editionId);
      if (this.#disposed) return;
      if (detail.download?.status !== 'installed') {
        navigate(`/book/${this.#editionId}`);
        return;
      }

      // Un gros livre fait attendre — cent secondes mesurées sur un index de
      // 124 569 pages, le temps que son sommaire traverse le pont. Un écran qui
      // tourne sans un mot se lit comme une panne : on le dit, discrètement, et
      // la ligne s'en va avec l'attente.
      if (
        isLargeBook({
          pageCount: detail.pageCount,
          bytes: detail.download?.uncompressedSize,
        })
      ) {
        const attente = loadingView(t('reader.opening'));
        attente.append(h('p', { class: 'state__note label-sm' }, t('reader.largeBook')));
        this.#host.replaceChildren(attente);
      }

      // Le sommaire n'est **pas** de la partie : c'est lui qui prend la minute,
      // et rien de ce qu'on affiche d'abord n'en a besoin. Il arrive ensuite,
      // par `#loadToc`, sur un lecteur déjà ouvert et déjà quittable.
      const [count, saved, prefs, annotations] = await Promise.all([
        repository.getPageCount(this.#editionId),
        repository.getProgress(this.#editionId),
        settings(),
        repository
          .getBookAnnotations(this.#editionId)
          .catch(() => ({ highlights: [], notes: [], bookmarks: [] })),
      ]);
      if (this.#disposed) return;
      this.#annotations = annotations;

      this.#title = detail.summary.title;
      this.#pageCount = count;
      this.#prefs = {
        size: clampSize(prefs['reader.fontSize']),
        font: resolveFont(prefs['reader.font'], 'arab', DEFAULT_READER_FONT),
        tapZones: resolveTapZones(prefs['reader.tapZones']),
      };
      this.#mode = resolveReadingMode(prefs['reader.mode']);
      this.#anchors = readAnchors(prefs[ANCHORS_SETTING]);

      let index = (saved?.sequenceNum ?? 1) - 1;
      if (this.#requestedPageId) {
        const page = await repository.getPageById(this.#editionId, this.#requestedPageId);
        if (this.#disposed) return;
        if (page) index = page.sequenceNum - 1;
      }
      this.#index = clamp(index, 0, Math.max(0, count - 1));

      this.#build();
      // Une reprise, et non un saut : c'est le seul montage qui rende sa
      // position **dans** la page. Un `?page=` est une demande explicite, elle
      // s'ouvre en haut de la page demandée.
      await this.#show(this.#index, { save: false, restore: !this.#requestedPageId });
      if (this.#disposed) return;
      document.addEventListener('keydown', this.#keyHandler);
      // `selectionchange` ne se pose que sur `document` : c'est là qu'il naît.
      document.addEventListener('selectionchange', this.#selectionHandler);
      // Le geste retour d'Android ferme une couche à la fois, comme `Escape`.
      // Rien à consommer : on laisse la plateforme quitter le livre — c'est
      // `back()` qui reste le seul propriétaire de la sortie.
      this.#dropBackHandler = pushBackHandler(() => this.#closeTopLayer());
      if (this.#fullscreen) document.addEventListener('fullscreenchange', this.#fullscreenHandler);
      this.#hintTimer = setTimeout(() => this.#hideHint(), HINT_DELAY);
      // Lancé, jamais attendu : le livre est déjà lisible et déjà quittable.
      this.#loadToc();
    } catch (error) {
      // Livre supprimé pendant la lecture : la fiche, pas un écran d'erreur.
      if (String(error?.message ?? '').includes('livre non installé')) {
        navigate(`/book/${this.#editionId}`);
        return;
      }
      if (this.#disposed) return;
      this.#host.replaceChildren(
        errorView(error, () => navigate(`/book/${this.#editionId}`)),
      );
    }
  }

  /**
   * Le sommaire, chargé **après** la première page et jamais attendu.
   *
   * Mesuré sur l'appareil, sur un index de 124 569 pages : ses ~96 000 entrées
   * mettent cent secondes à traverser le pont natif. Tant qu'elles étaient dans
   * le `Promise.all` d'ouverture, ces cent secondes se passaient devant un
   * rouet, avant la première ligne — et le lecteur qui renonçait et faisait le
   * geste retour n'avait encore rien à quitter : aucune couche n'était posée,
   * l'écran restait celui du chargement, et l'application paraissait bloquée.
   *
   * Rien de ce qui s'affiche d'abord n'a besoin du sommaire : le titre du
   * chapitre, ce qu'il reste avant sa fin et la liste elle-même se taisent tant
   * qu'il manque, puis se peignent quand il arrive. Et s'il arrive après le
   * départ du lecteur, il ne touche rien : `#disposed` est relu **après**
   * l'attente, comme partout ailleurs ici.
   */
  async #loadToc() {
    this.#tocLoading = true;
    const toc = await repository.getToc(this.#editionId).catch(() => []);
    this.#tocLoading = false;
    if (this.#disposed) return;
    this.#toc = toc;
    // L'index par page est mémorisé à la première demande : il a pu être bâti
    // sur le sommaire vide.
    this.#tocByPage = null;
    this.#refreshChapters();
    this.#nodes.tocReady?.();
  }

  /**
   * Repeint ce que le sommaire nomme sur les pages déjà montées : son titre en
   * tête de page, et ce qu'il reste avant la fin du chapitre en pied.
   */
  #refreshChapters() {
    for (const block of this.#blocks.values()) this.#paintChapter(block);
  }

  dispose() {
    // `start()` court encore : elle est faite d'attentes, et le routeur peut
    // démonter la vue entre deux. Sans ce drapeau, elle reprenait après coup et
    // posait ses écouteurs sur `document` — un lecteur quitté continuait alors
    // d'avaler les flèches et le `Ctrl+F` de l'écran suivant.
    this.#disposed = true;
    document.removeEventListener('keydown', this.#keyHandler);
    document.removeEventListener('selectionchange', this.#selectionHandler);
    document.removeEventListener('fullscreenchange', this.#fullscreenHandler);
    clearTimeout(this.#saveTimer);
    clearTimeout(this.#hintTimer);
    clearTimeout(this.#selectionTimer);
    // L'ancre s'écrit **avant** de partir, sans attendre son répit : quitter le
    // lecteur est précisément le moment où l'on veut que l'endroit soit retenu.
    clearTimeout(this.#anchorTimer);
    this.#saveAnchor();
    this.#closeShortcuts?.();
    this.#closeShortcuts = null;
    // Une feuille de note ouverte au moment du départ : elle se règle en refus.
    // Sa promesse resterait pendante, et rien de ce qu'elle attendait — ni
    // surlignage, ni note — ne doit être écrit après coup.
    this.#settleNote(null);
    this.#dropBackHandler?.();
    this.#dropBackHandler = null;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }

  // ------------------------------------------------------------- structure

  #build() {
    // --- la page elle-même : entête discret, puis le fil des pages montées ---
    // Le corpus est arabe : titre, chapitres et pages restent RTL sous une
    // interface anglaise, et le disent. Une direction héritée du `<html>`
    // marcherait par coïncidence en `ar` et casserait en `en`.
    const pageHead = h(
      'div',
      { class: 'reader__page-head' },
      h('p', { class: 'headline-md', dir: CONTENT_DIR }, this.#title),
      h('span', { class: 'reader__hairline' }),
    );
    const flow = h('div', { class: 'reader__flow' });

    const scroll = h('div', { class: 'reader__scroll no-scrollbar' }, pageHead, flow);

    // --- barre haute : sortie au départ (droite RTL), titre au centre, outils à
    // l'autre bout. Quitter n'est pas un outil parmi les outils : c'est le geste
    // qu'on cherche en premier quand on ne veut plus lire, et une croix seule ne
    // dit pas où elle ramène.
    // `data-tool` est le point d'accroche stable des captures et des tests :
    // les infobulles portent maintenant leur raccourci, elles bougent.
    // `name` est un nom d'icône, ou une fabrique quand le tracé dépend de la
    // direction de l'interface (`chevronForward` et sa jumelle).
    const tool = (key, name, title, onclick) =>
      h(
        'button',
        { class: 'reader__tool', 'data-tool': key, title, onclick },
        typeof name === 'function' ? name({ size: 20 }) : icon(name, { size: 20 }),
      );

    // Sur un téléphone la fenêtre occupe déjà tout l'écran : le bouton
    // répondrait sans que rien ne bouge. Il n'est donc pas désactivé, il est
    // absent — un outil grisé demande encore pourquoi.
    const fullscreenButton = this.#fullscreen
      ? tool('fullscreen', 'fullscreen', t('reader.fullscreen'), () => this.#toggleFullscreen())
      : null;
    const bookmarkButton = tool('bookmark', 'bookmark', t('reader.bookmarkTool'), () =>
      this.#toggleBookmark(),
    );

    // La sortie garde `data-tool="close"` : c'est le contrat que suivent les
    // captures et les tests, seul son habillage change. Le chevron pointe vers
    // le début de ligne — la droite en RTL, la gauche en LTR — comme tout
    // retour arrière : il suit la direction de l'interface, il n'est pas figé.
    const backButton = h(
      'button',
      {
        class: 'reader__back',
        'data-tool': 'close',
        title: t('reader.backTitle'),
        onclick: () => back(),
      },
      chevronBackward({ size: 20 }),
      h('span', { class: 'reader__back-label label-md' }, t('reader.back')),
    );

    const header = h(
      'header',
      { class: 'reader__header' },
      h(
        'div',
        { class: 'reader__bar' },
        h('div', { class: 'reader__lead' }, backButton),
        h(
          'div',
          { class: 'reader__titles' },
          h('h1', { class: 'truncate', dir: CONTENT_DIR }, this.#title),
        ),
        // Trois groupes, dans l'ordre où l'on s'en sert : **se repérer** dans
        // le livre (sommaire, recherche), **y laisser une trace** (signet,
        // notes), **régler l'affichage** (ruban, typographie). Les outils
        // étaient rangés dans l'ordre où ils avaient été écrits — signet entre
        // les notes et le sommaire, réglages entre le sommaire et la recherche.
        h(
          'div',
          { class: 'reader__tools' },
          tool('toc', 'toc', t('reader.tocTool'), () => this.#togglePanel('toc')),
          tool('search', 'search', t('reader.searchTool'), () => this.#togglePanel('search')),
          bookmarkButton,
          tool('annotations', 'annotate', t('reader.notesTool'), () =>
            this.#togglePanel('annotations'),
          ),
          // Les curseurs et non « Aa » : le panneau ne parle plus que de
          // typographie — il porte la façon de lire, l'ambiance et les côtés
          // qui tournent la page. Une icône qui annonce moins que ce qu'elle
          // ouvre se touche deux fois avant qu'on trouve ce qu'on cherchait.
          tool('settings', 'sliders', t('reader.settingsTool'), () => this.#togglePanel('settings')),
          fullscreenButton,
        ),
      ),
    );

    // --- barre basse : pagination puis jauge, comme la maquette ---
    // La jauge ne tourne les pages **qu'au relâchement**. À chaque cran, elle
    // ne faisait pas que peindre : elle montait la page. Sur un livre de mille
    // pages, une glissade au pouce, ce sont des dizaines de `getPages` — chacun
    // un aller-retour du pont natif sur Android — et autant de rendus, dont un
    // seul sera regardé. `input` annonce donc la destination, `change` s'y rend.
    const slider = h('input', {
      class: 'reader__rail',
      type: 'range',
      min: 1,
      max: Math.max(1, this.#pageCount),
      value: this.#index + 1,
      title: t('reader.position'),
      oninput: (event) => this.#previewJump(Number(event.target.value) - 1),
      onchange: (event) => this.#commitJump(Number(event.target.value) - 1),
    });

    const previous = tool('previous', chevronBackward, t('reader.shortcut.previousPage'), () =>
      this.#move(-1),
    );
    const next = tool('next', chevronForward, t('reader.shortcut.nextPage'), () => this.#move(1));

    // Trois nœuds plutôt qu'une chaîne : dressé, le ruban empile la page
    // courante, un filet et le total. Une fraction écrite verticalement tient
    // dans la largeur d'un pouce, « ٢٣٠ / ١ » non.
    const pagerCurrent = h('span', { class: 'reader__pager-current' });
    const pagerTotal = h('span', { class: 'reader__pager-total' });
    const pagerLabel = h(
      'span',
      { class: 'reader__pager-label label-md' },
      pagerCurrent,
      h('span', { class: 'reader__pager-sep' }, '/'),
      pagerTotal,
    );
    const percent = h('span', { class: 'reader__percent label-sm' });

    const footer = h(
      'footer',
      { class: 'reader__footer' },
      h(
        'div',
        { class: 'reader__toolbar' },
        h('div', { class: 'reader__pager' }, previous, pagerLabel, next),
        h('div', { class: 'reader__progress' }, slider),
        percent,
      ),
    );

    const hint = h(
      'div',
      { class: 'reader__hint label-sm' },
      t('reader.hideTools'),
    );

    // Ce que la jauge annonce pendant qu'on la glisse : le rang, et le chapitre
    // où l'on tomberait. Sans lui, glisser sans tourner les pages ne dirait
    // plus rien du tout — on viserait à l'aveugle sur un livre de mille pages.
    const scrubPage = h('span', { class: 'reader__scrub-page title-md' });
    const scrubChapter = h('span', {
      class: 'reader__scrub-chapter label-sm truncate',
      dir: CONTENT_DIR,
    });
    const scrub = h('div', { class: 'reader__scrub' }, scrubPage, scrubChapter);

    // Deux pastilles, une seule place : elles répondent toutes deux à « et
    // maintenant ? » juste après un saut, et n'apparaissent jamais sans qu'on
    // ait sauté. Empilées, jamais côte à côte — sur 411 px, deux pastilles sur
    // une ligne se coupent l'une l'autre.
    const returnLabel = h('span', { class: 'label-md' });
    const returnPill = h(
      'div',
      { class: 'reader__pill reader__return' },
      h(
        'button',
        { class: 'reader__pill-main', onclick: () => this.#goToOrigin() },
        chevronBackward({ size: 16 }),
        returnLabel,
      ),
      h(
        'button',
        {
          class: 'reader__pill-close',
          title: t('action.close'),
          'aria-label': t('action.close'),
          onclick: () => this.#hideReturn(),
        },
        icon('close', { size: 16 }),
      ),
    );

    const matchLabel = h('span', { class: 'label-md' });
    const matchPill = h(
      'div',
      { class: 'reader__pill reader__matches' },
      h(
        'button',
        {
          class: 'reader__pill-step',
          title: t('reader.previousMatch'),
          'aria-label': t('reader.previousMatch'),
          onclick: () => this.#stepMatch(-1),
        },
        chevronBackward({ size: 16 }),
      ),
      matchLabel,
      h(
        'button',
        {
          class: 'reader__pill-step',
          title: t('reader.nextMatch'),
          'aria-label': t('reader.nextMatch'),
          onclick: () => this.#stepMatch(1),
        },
        chevronForward({ size: 16 }),
      ),
    );

    const pills = h('div', { class: 'reader__pills' }, returnPill, matchPill);

    // La note, ouverte là où on lit. En pied d'écran et non au milieu : c'est
    // la moitié de l'écran qu'on ne regarde pas quand on lit une ligne, et
    // c'est celle que le pouce atteint.
    const footnoteNumber = h('span', { class: 'label-md' });
    const footnoteText = h('p', { class: 'body-md', dir: CONTENT_DIR });
    const footnoteSheet = h(
      'aside',
      { class: 'reader__footnote-sheet' },
      h(
        'div',
        { class: 'reader__footnote-head' },
        footnoteNumber,
        h(
          'button',
          {
            class: 'reader__tool',
            title: t('action.close'),
            'aria-label': t('action.close'),
            onclick: () => this.#closeFootnote(),
          },
          icon('close', { size: 20 }),
        ),
      ),
      footnoteText,
    );

    // L'éditeur de note, et **pas** une boîte modale.
    //
    // Une modale centrée sur un téléphone occupe l'écran, et le clavier virtuel
    // qui monte derrière elle redimensionne la fenêtre : la colonne se
    // recompose, l'endroit qu'on lisait saute, et l'on tape sa note sans plus
    // voir le passage qu'elle commente. La feuille se pose **par-dessus**, en
    // pied d'écran, là où le pouce est déjà — elle ne redimensionne pas
    // `.reader__scroll`, ne pose aucun voile sur le texte, et ce qui reste
    // visible reste lisible et défilable.
    const noteTitle = h('span', { class: 'label-md' });
    const noteQuote = h('blockquote', { class: 'reader__note-quote body-md', dir: CONTENT_DIR });
    const noteSave = h(
      'button',
      { class: 'button button--filled', onclick: () => this.#settleNote(noteField.value.trim()) },
      t('action.save'),
    );
    const noteField = h('textarea', {
      class: 'reader__note-field',
      rows: 3,
      dir: USER_DIR,
      placeholder: t('note.placeholder'),
      oninput: () => {
        noteSave.disabled = !noteField.value.trim();
      },
      onkeydown: (event) => {
        // La frappe reste au champ : les raccourcis nus du lecteur ne doivent
        // pas tourner la page pendant qu'on écrit.
        event.stopPropagation();
        if (event.key === 'Escape') this.#settleNote(null);
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && noteField.value.trim()) {
          event.preventDefault();
          this.#settleNote(noteField.value.trim());
        }
      },
    });
    // Vider une note existante la supprime : c'est le geste que porte ce bouton,
    // et le vide est ce que `#editNote` en lit.
    const noteDelete = h(
      'button',
      { class: 'button button--danger', onclick: () => this.#settleNote('') },
      t('action.delete'),
    );
    const noteSheet = h(
      'aside',
      { class: 'reader__note-sheet' },
      h(
        'div',
        { class: 'reader__note-head' },
        noteTitle,
        h(
          'button',
          {
            class: 'reader__tool',
            title: t('action.close'),
            'aria-label': t('action.close'),
            onclick: () => this.#settleNote(null),
          },
          icon('close', { size: 20 }),
        ),
      ),
      noteQuote,
      noteField,
      h(
        'div',
        { class: 'reader__note-actions' },
        h(
          'button',
          { class: 'button button--tonal', onclick: () => this.#settleNote(null) },
          t('action.cancel'),
        ),
        noteDelete,
        noteSave,
      ),
    );

    // Les références des panneaux sont collectées avant d'écraser `#nodes`.
    const refs = {};
    const panel = this.#settingsPanel(refs);
    const tocPanel = this.#tocPanel(refs);
    const searchPanel = this.#searchPanel(refs);
    const annotationsPanel = this.#annotationsPanel(refs);
    const selection = this.#selectionMenu();

    const root = h(
      'div',
      {
        // Il n'y a plus de classe de façon de lire : il n'en reste qu'une, et
        // une classe qui ne distingue plus le lecteur de lui-même se garde par
        // habitude. Les animations de feuilletage se portent donc sur le bloc.
        class: `reader reader--font-${this.#prefs.font} reader--${this.#mode}`,
        style: { '--reader-size': `${this.#prefs.size}px` },
      },
      header,
      scroll,
      footer,
      hint,
      scrub,
      pills,
      footnoteSheet,
      noteSheet,
      panel,
      tocPanel,
      searchPanel,
      annotationsPanel,
      selection,
    );

    scroll.addEventListener('scroll', () => this.#onScroll(scroll));
    scroll.addEventListener('click', (event) => this.#onContentClick(event));
    scroll.addEventListener('wheel', (event) => this.#onWheel(event), { passive: false });
    // Le dernier moment où la sélection est encore lisible : `mouseup` et
    // `click` arrivent après que le navigateur l'a défaite. C'est aussi le
    // départ d'un glissement — les deux se relèvent au même instant.
    scroll.addEventListener('pointerdown', (event) => {
      const selection = window.getSelection();
      this.#selectionAtPress = Boolean(selection) && !selection.isCollapsed;
      this.#onPointerDown(event);
    });
    scroll.addEventListener('pointermove', (event) => this.#onPointerMove(event));
    scroll.addEventListener('pointerup', (event) => {
      this.#endPointer(event);
      this.#onPointerUp(event);
    });
    scroll.addEventListener('pointercancel', (event) => {
      this.#endPointer(event);
      this.#swipeFrom = null;
    });
    // Trois portes vers la même mesure, toutes antirebondies : `selectionchange`
    // porte le doigt, les deux autres achèvent un cliquer-glisser sans attendre
    // le répit.
    scroll.addEventListener('mouseup', this.#selectionHandler);
    scroll.addEventListener('touchend', this.#selectionHandler);

    this.#nodes = {
      root,
      flow,
      pageHead,
      pagerCurrent,
      pagerTotal,
      percent,
      slider,
      previous,
      next,
      header,
      footer,
      hint,
      scrub,
      scrubPage,
      scrubChapter,
      returnPill,
      returnLabel,
      matchPill,
      matchLabel,
      footnoteSheet,
      footnoteNumber,
      footnoteText,
      noteSheet,
      noteTitle,
      noteQuote,
      noteField,
      noteDelete,
      noteSave,
      scroll,
      panel,
      tocPanel,
      searchPanel,
      annotationsPanel,
      selection,
      fullscreenButton,
      bookmarkButton,
      lastScroll: 0,
      ...refs,
    };
    this.#host.replaceChildren(root);
  }

  #settingsPanel(refs) {
    const sizeValue = h('span', { class: 'label-md' }, `${this.#prefs.size}`);
    const sizeSlider = h('input', {
      type: 'range',
      min: MIN_FONT,
      max: MAX_FONT,
      value: this.#prefs.size,
      oninput: (event) => this.#setSize(Number(event.target.value)),
    });

    // Le thème est global : les pastilles repeignent tout l'écran, pas la
    // seule page. C'est ici qu'on en a le plus besoin — en lecture, le soir.
    const themes = themeChoices();

    const fontButtons = FONTS.map((font) =>
      h(
        'button',
        {
          class: font.key === this.#prefs.font ? 'is-active' : '',
          onclick: () => this.#setFont(font.key),
        },
        h('span', { style: { fontFamily: font.stack, fontSize: '18px' } }, t(font.label)),
        font.key === this.#prefs.font ? icon('check', { size: 16 }) : null,
      ),
    );

    Object.assign(refs, { sizeValue, sizeSlider, fontButtons });

    return h(
      'aside',
      { class: 'reader__settings reader__panel' },
      h(
        'div',
        { class: 'reader__panel-head' },
        h('h2', { class: 'title-md' }, t('reader.settingsTitle')),
        h(
          'button',
          {
            class: 'reader__tool',
            title: t('action.close'),
            onclick: () => this.#closePanels(),
          },
          icon('close', { size: 20 }),
        ),
      ),
      // Un seul panneau pour tout ce qui change l'aspect du livre : la façon de
      // lire, la taille, l'ambiance, la face, et les côtés qui tournent la
      // page. Ils vivent aussi dans `/settings` — mêmes composants, mêmes
      // listes partagées — mais c'est ici qu'on en a besoin, parce qu'ici on
      // voit ce qu'ils changent.
      h(
        'div',
        { class: 'reader__panel-body' },
        h(
          'div',
          {},
          h('label', { class: 'label-md' }, t('reader.modeLabel')),
          settingChoice({
            liste: READING_MODES,
            valeur: this.#mode,
            label: 'reader.modeLabel',
            setting: 'reader.mode',
            marque: 'readingMode',
            // Le réglage s'écrit tout seul ; le lecteur, lui, remonte le livre.
            onPick: (key) => this.#applyReadingMode(key),
          }),
        ),
        h(
          'div',
          {},
          h('label', { class: 'label-md' }, t('reader.sizeLabel')),
          // Le pincement ne s'annonce que là où il existe : sur un écran tactile.
          // Une ligne qui promet un geste impossible se lit deux fois avant
          // qu'on la croie fausse — comme le bouton de plein écran grisé.
          isTouchPrimary() ? h('p', { class: 'label-sm muted' }, t('reader.pinchHint')) : null,
          h(
            'div',
            { class: 'font-size-control' },
            h(
              'button',
              { title: t('reader.shortcut.smaller'), onclick: () => this.#setSize(this.#prefs.size - 2) },
              icon('minus', { size: 16 }),
            ),
            sizeSlider,
            h(
              'button',
              { title: t('reader.shortcut.bigger'), onclick: () => this.#setSize(this.#prefs.size + 2) },
              icon('plus', { size: 20 }),
            ),
            sizeValue,
          ),
        ),
        h(
          'div',
          {},
          h('label', { class: 'label-md' }, t('reader.themeLabel')),
          themes.node,
        ),
        h(
          'div',
          {},
          h('label', { class: 'label-md' }, t('reader.fontLabel')),
          h('div', { class: 'font-choices' }, fontButtons),
        ),
        // Montré dans les deux modes, même s'il ne fait rien sur le fil : un
        // réglage qui disparaît selon l'écran se cherche, et l'on finit par
        // croire qu'il n'a jamais existé.
        h(
          'div',
          {},
          h('label', { class: 'label-md' }, t('settings.tapZonesLabel')),
          settingChoice({
            liste: TAP_ZONE_MODES,
            valeur: this.#prefs.tapZones,
            label: 'settings.tapZonesLabel',
            setting: 'reader.tapZones',
            marque: 'tapZones',
            onPick: (key) => {
              this.#prefs.tapZones = resolveTapZones(key);
            },
          }),
        ),
      ),
    );
  }

  /**
   * Sommaire glissant : la même donnée que la fiche livre, à portée de page.
   *
   * Un sommaire du corpus Shamela porte couramment des milliers d'entrées : on
   * n'en monte qu'une tranche, et un champ y cherche par titre. Le filtre passe
   * par `title_normalized`, déjà produit par le pipeline — chercher sur le
   * titre brut manquerait toute variante de hamza.
   */
  #tocPanel(refs) {
    const list = h('div', { class: 'reader__panel-body reader__toc-list' });
    const more = h('div', { class: 'reader__toc-more' });
    const earlier = h('div', { class: 'reader__toc-more' });
    let matches = this.#toc;
    // La tranche montée, en index dans `matches` : `[from, to)`. Elle ne part
    // plus forcément du début — ouvrir le sommaire au chapitre 400 sur 3 000
    // devait pouvoir montrer ce chapitre-là sans monter les 399 d'avant.
    let from = 0;
    let to = 0;

    const item = (entry) =>
      h(
        'button',
        {
          class: `reader__toc-item${entry.parentTocId != null ? ' is-child' : ''}${
            entry === this.#chapterEntry(this.#page?.pageId) ? ' is-current' : ''
          }`,
          onclick: () => this.#goToPage(entry.pageId),
        },
        h('span', { class: 'truncate', dir: CONTENT_DIR }, entry.title),
        h(
          'span',
          { class: 'label-sm muted' },
          // jamais `pageId` : c'est l'identifiant source, global au corpus
          t('reader.page', { page: entry.printedPageNum ?? entry.pageSequenceNum ?? '' }),
        ),
      );

    /**
     * Les deux boutons de dépliage, en tête et en pied de la tranche montée.
     *
     * Chacun est précédé du **reste**, dit en toutes lettres. Le bouton ne
     * déplie qu'un cran (`TOC_WINDOW`) : lui faire annoncer les milliers
     * d'entrées qui restent promettait ce qu'un clic ne donne pas, et ne disait
     * rien à qui voulait seulement savoir où il en est dans la liste.
     */
    const unfold = (remaining, grow, key) =>
      h(
        'div',
        { class: 'reader__toc-more-inner' },
        h('span', { class: 'label-sm muted' }, t(key, { count: remaining })),
        h(
          'button',
          { class: 'button button--tonal', onclick: grow },
          h('span', {}, t('reader.showMore', { count: Math.min(TOC_WINDOW, remaining) })),
        ),
      );

    // Un bord sans reste ne laisse **rien** derrière lui, pas même un nœud
    // vide : le bloc porte une réserve, et un span vide la ferait tenir sous
    // la dernière entrée du sommaire — une bande morte au pied du panneau.
    const syncMore = () => {
      earlier.replaceChildren(
        ...(from > 0 ? [unfold(from, growStart, 'reader.tocRemainingBefore')] : []),
      );
      more.replaceChildren(
        ...(to < matches.length
          ? [unfold(matches.length - to, growEnd, 'reader.tocRemainingAfter')]
          : []),
      );
    };

    const growEnd = () => {
      const next = matches.slice(to, to + TOC_WINDOW);
      list.append(...next.map(item));
      to += next.length;
      syncMore();
    };

    const growStart = () => {
      const start = Math.max(0, from - TOC_WINDOW);
      const before = matches.slice(start, from);
      // La hauteur gagnée est rendue au défilement : sans cela, déplier vers le
      // haut ferait sauter la liste sous le doigt qui l'a demandé.
      const avant = list.scrollHeight;
      list.prepend(...before.map(item));
      list.scrollTop += list.scrollHeight - avant;
      from = start;
      syncMore();
    };

    /**
     * Le dépliage suit le défilement : toucher un bord de la tranche montée
     * monte la suivante, dans le sens où l'on va.
     *
     * `growStart` rend au défilement la hauteur qu'il ajoute — il repose donc
     * `scrollTop`, ce qui rappelle ce gestionnaire. Le drapeau coupe la boucle
     * là : sans lui, un seul geste vers le haut déplierait le sommaire entier.
     */
    let growing = false;
    const onScroll = () => {
      if (growing) return;
      growing = true;
      try {
        const reste = list.scrollHeight - list.scrollTop - list.clientHeight;
        if (list.scrollTop <= TOC_EDGE && from > 0) growStart();
        else if (reste <= TOC_EDGE && to < matches.length) growEnd();
      } finally {
        growing = false;
      }
    };
    list.addEventListener('scroll', onScroll);

    /**
     * Une tranche qui ne remplit pas le panneau ne défile pas — donc rien ne
     * rappellerait `onScroll`, et la liste s'arrêterait à trente titres sur un
     * grand écran. On complète jusqu'à ce qu'il y ait de quoi défiler, sans
     * jamais dépasser dix crans : le sommaire entier n'est pas le but.
     */
    const fill = () => {
      for (let i = 0; i < 10 && to < matches.length; i += 1) {
        if (list.scrollHeight > list.clientHeight) return;
        growEnd();
      }
    };

    /**
     * Remonte la liste. [center] est l'index sur lequel la tranche s'ouvre —
     * le chapitre courant à l'ouverture, le début quand on filtre : un filtre
     * répond par ses meilleures réponses, pas par le milieu de la liste.
     */
    const apply = (term, center = 0) => {
      const needle = normalizeArabic(term ?? '');
      matches = needle
        ? this.#toc.filter((entry) => normalizeArabic(entry.title ?? '').includes(needle))
        : this.#toc;
      list.replaceChildren();
      if (!matches.length) {
        from = 0;
        to = 0;
        list.append(
          h(
            'p',
            { class: 'label-md muted' },
            // Trois réponses, pas deux : « rien qui corresponde », « pas de
            // sommaire », et « il arrive ». Sans la troisième, un livre dont le
            // sommaire est en route s'annonce comme un livre qui n'en a pas.
            t(
              this.#toc.length
                ? 'reader.tocNoMatch'
                : this.#tocLoading
                  ? 'reader.tocLoading'
                  : 'reader.tocMissing',
            ),
          ),
        );
        earlier.replaceChildren();
        more.replaceChildren();
        return;
      }
      from = Math.max(0, Math.min(center - Math.floor(TOC_WINDOW / 2), matches.length - TOC_WINDOW));
      to = from;
      growEnd();
      fill();
    };

    let timer = null;
    const field = h('input', {
      type: 'search',
      class: 'reader__search-field',
      placeholder: t('reader.tocSearch'),
      oninput: (event) => {
        clearTimeout(timer);
        const value = event.target.value;
        timer = setTimeout(() => apply(value), 200);
      },
    });

    /**
     * Ce que fait l'ouverture du panneau : remonter la liste **autour du
     * chapitre qu'on lit**, et l'amener à l'écran.
     *
     * Sans cela, ouvrir le sommaire en cours de lecture ne disait rien de
     * l'endroit où l'on se trouve — il montrait le début du livre, comme si
     * l'on n'avait pas commencé. Tous les lecteurs de référence ouvrent le
     * sommaire *sur* le chapitre courant.
     */
    refs.focusToc = () => {
      if (field.value) return;
      const current = this.#chapterEntry(this.#page?.pageId);
      apply('', current ? Math.max(0, this.#toc.indexOf(current)) : 0);
      list.querySelector('.reader__toc-item.is-current')?.scrollIntoView({ block: 'center' });
    };

    // Le panneau est monté avant que le sommaire n'existe : il se remplit quand
    // celui-ci arrive. Le champ de filtre en fait partie — sa présence dépend
    // du nombre d'entrées, qui vaut zéro à la construction.
    const searchBox = h('div', {});
    refs.tocReady = () => {
      searchBox.replaceChildren(
        ...(this.#toc.length > TOC_WINDOW ? [h('div', { class: 'reader__search-box' }, field)] : []),
      );
      // Une question déjà posée se rejoue sur la nouvelle liste ; sinon on
      // ouvre là où l'on en est.
      if (field.value) apply(field.value);
      else refs.focusToc();
    };

    apply('');

    return h(
      'aside',
      { class: 'reader__toc reader__panel' },
      h(
        'div',
        { class: 'reader__panel-head' },
        h('h2', { class: 'title-md' }, t('reader.tocTitle')),
        h(
          'button',
          { class: 'reader__tool', title: t('action.close'), onclick: () => this.#closePanels() },
          icon('close', { size: 20 }),
        ),
      ),
      searchBox,
      earlier,
      list,
      more,
    );
  }

  /**
   * Panneau des annotations du livre : surlignages, notes et marques-pages,
   * dans l'ordre des pages. Il se redessine à chaque écriture plutôt que d'être
   * reconstruit — le panneau peut rester ouvert pendant qu'on annote.
   */
  #annotationsPanel(refs) {
    const tabs = h('div', { class: 'reader__annotation-tabs' });
    const list = h('div', { class: 'reader__panel-body reader__annotations' });
    refs.annotationsList = list;
    refs.annotationsTabs = tabs;

    return h(
      'aside',
      { class: 'reader__annotations-panel reader__panel' },
      h(
        'div',
        { class: 'reader__panel-head' },
        h('h2', { class: 'title-md' }, t('reader.notesTitle')),
        h(
          'button',
          { class: 'reader__tool', title: t('action.close'), onclick: () => this.#closePanels() },
          icon('close', { size: 20 }),
        ),
      ),
      tabs,
      list,
    );
  }

  /** Toutes les annotations du livre, page par page, dans un seul flux. */
  #drawAnnotations() {
    const list = this.#nodes.annotationsList;
    if (!list) return;

    const notesByHighlight = new Map(
      this.#annotations.notes
        .filter((note) => note.highlightId)
        .map((note) => [note.highlightId, note]),
    );

    const entries = [
      ...this.#annotations.highlights.map((highlight) => ({
        kind: 'highlight',
        pageId: highlight.pageId,
        highlight,
        note: notesByHighlight.get(highlight.highlightId) ?? null,
      })),
      ...this.#annotations.notes
        .filter((note) => !note.highlightId)
        .map((note) => ({ kind: 'note', pageId: note.pageId, note })),
      ...this.#annotations.bookmarks.map((bookmark) => ({
        kind: 'bookmark',
        pageId: bookmark.pageId,
        bookmark,
      })),
    ].sort((a, b) => (a.pageId ?? 0) - (b.pageId ?? 0));

    this.#drawAnnotationTabs(entries);

    // Un surlignage commenté compte pour les deux onglets : c'est la même
    // chose vue de deux côtés, la cacher sous « ملاحظات » serait un piège.
    const shown = entries.filter((entry) => {
      if (this.#annotationKind === 'all') return true;
      if (this.#annotationKind === 'note') return Boolean(entry.note ?? entry.kind === 'note');
      return entry.kind === this.#annotationKind;
    });

    if (!shown.length) {
      list.replaceChildren(
        h(
          'p',
          { class: 'label-md muted' },
          entries.length
            ? t('reader.annotationsNoneOfKind')
            : t('reader.annotationsEmpty'),
        ),
      );
      return;
    }

    list.replaceChildren(...shown.map((entry) => this.#annotationCard(entry)));
  }

  #drawAnnotationTabs(entries) {
    const tabs = this.#nodes.annotationsTabs;
    if (!tabs) return;

    const counts = {
      all: entries.length,
      highlight: entries.filter((entry) => entry.kind === 'highlight').length,
      note: entries.filter((entry) => Boolean(entry.note) || entry.kind === 'note').length,
      bookmark: entries.filter((entry) => entry.kind === 'bookmark').length,
    };

    tabs.replaceChildren(
      ...ANNOTATION_KINDS.map((kind) =>
        h(
          'button',
          {
            class: `reader__annotation-tab${kind.value === this.#annotationKind ? ' is-active' : ''}`,
            title: t(kind.label),
            onclick: () => {
              this.#annotationKind = kind.value;
              this.#drawAnnotations();
            },
          },
          icon(kind.icon, { size: 16 }),
          h('span', { class: 'label-sm' }, n(counts[kind.value] ?? 0)),
        ),
      ),
    );
  }

  /** Une entrée du panneau : ce qu'on a marqué, où, et de quoi l'amender. */
  #annotationCard(entry) {
    const open = () => entry.pageId != null && this.#goToPage(entry.pageId);
    const actions = h('div', { class: 'reader__annotation-actions' });
    const color = entry.highlight?.color ?? null;

    if (entry.kind === 'bookmark') {
      actions.append(
        this.#annotationAction('trash', t('action.delete'), async () => {
          try {
            await repository.deleteBookmark(entry.bookmark.bookmarkId);
          } catch (error) {
            toast(error?.message ?? t('reader.bookmarkDeleteFailed'));
            return;
          }
          this.#annotations.bookmarks = this.#annotations.bookmarks.filter(
            (item) => item.bookmarkId !== entry.bookmark.bookmarkId,
          );
          this.#afterAnnotationChange(entry.pageId);
        }),
      );
    } else if (entry.kind === 'highlight') {
      actions.append(
        this.#annotationAction('noteAdd', t(entry.note ? 'reader.editNote' : 'reader.addNote'), () =>
          this.#editNote(entry.highlight, entry.note),
        ),
        this.#annotationAction('trash', t('reader.deleteHighlight'), () =>
          this.#removeHighlight(entry.highlight),
        ),
      );
    } else {
      actions.append(
        this.#annotationAction('noteAdd', t('notes.edit'), () => this.#editNote(null, entry.note)),
        this.#annotationAction('trash', t('action.delete'), () => this.#removeNote(entry.note)),
      );
    }

    // Entête : de quoi il s'agit, puis la page — la même grammaire pour les
    // trois types, pour qu'une liste mêlée se lise d'un coup d'œil.
    const head = h(
      'div',
      { class: 'reader__annotation-head' },
      color
        ? h('span', { class: 'reader__annotation-dot', style: { background: color } })
        : icon(entry.kind === 'bookmark' ? 'bookmark' : 'noteAdd', { size: 14 }),
      h(
        'span',
        { class: 'label-sm' },
        t(
          entry.kind === 'bookmark'
            ? 'reader.kindBookmark'
            : entry.note
              ? 'reader.kindNote'
              : 'reader.kindHighlight',
        ),
      ),
      h('span', { class: 'reader__annotation-page label-sm' }, this.#pageLabelFor(entry.pageId)),
    );

    const body =
      entry.kind === 'bookmark'
        ? h(
            'p',
            { class: 'body-md', dir: USER_DIR },
            entry.bookmark.label ?? t('reader.savedPosition'),
          )
        : h(
            'div',
            { class: 'reader__annotation-text' },
            entry.highlight &&
              h(
                'p',
                {
                  class: 'reader__annotation-quote',
                  dir: CONTENT_DIR,
                  style: { '--highlight-color': entry.highlight.color },
                },
                entry.highlight.selectedText,
              ),
            entry.note && h('p', { class: 'body-md', dir: USER_DIR }, entry.note.content),
          );

    return h(
      'article',
      { class: `reader__annotation is-${entry.kind}` },
      h('button', { class: 'reader__annotation-open', onclick: open }, head, body),
      actions,
    );
  }

  #annotationAction(name, title, onclick) {
    return h(
      'button',
      { class: 'button--icon', title, 'aria-label': title, onclick },
      icon(name, { size: 18 }),
    );
  }

  /**
   * Numéro affichable d'une page à partir de son identifiant. Le sommaire porte
   * déjà la correspondance ; `pageId` lui-même ne se montre jamais.
   */
  #pageLabelFor(pageId) {
    if (pageId == null) return '';
    // Deux index, construits à la demande puis gardés : le panneau appelle
    // ceci une fois par annotation, et un livre peut porter des milliers
    // d'entrées de sommaire comme de pages en cache.
    this.#tocByPage ??= new Map(this.#toc.map((entry) => [entry.pageId, entry]));
    const entry = this.#tocByPage.get(pageId);
    const printed = entry?.printedPageNum ?? entry?.pageSequenceNum;
    if (printed != null) return t('reader.page', { page: printed });

    if (this.#pagesById?.size !== this.#pages.size) {
      this.#pagesById = new Map([...this.#pages.values()].map((item) => [item.pageId, item]));
    }
    const cached = this.#pagesById.get(pageId);
    const number = cached?.printedPageNum ?? cached?.sequenceNum;
    return number == null ? '' : t('reader.page', { page: number });
  }

  // ----------------------------------------------------------- annotations

  /**
   * Surlignages d'une page, marqués s'ils portent une note.
   *
   * L'index par page est construit une fois par écriture, pas une fois par
   * page affichée : en fil continu, quarante pages montées voulaient dire
   * quarante balayages de toutes les annotations du livre.
   */
  #highlightsFor(pageId) {
    if (!this.#highlightsByPage) {
      const noted = new Set(
        this.#annotations.notes.map((note) => note.highlightId).filter(Boolean),
      );
      this.#highlightsByPage = new Map();
      for (const highlight of this.#annotations.highlights) {
        const bucket = this.#highlightsByPage.get(highlight.pageId);
        const marked = { ...highlight, hasNote: noted.has(highlight.highlightId) };
        if (bucket) bucket.push(marked);
        else this.#highlightsByPage.set(highlight.pageId, [marked]);
      }
    }
    return this.#highlightsByPage.get(pageId) ?? [];
  }

  /**
   * Redessine le panneau, le signet, et **la seule page touchée**.
   *
   * Repeindre toutes les pages montées était tenable tant que le fil n'en
   * gardait qu'une tranche ; il porte maintenant le livre entier, et poser une
   * teinte sur trois mots relançait `renderBookHtml` sur des milliers de pages.
   * [pageId] est toujours connu de l'appelant — une annotation appartient à une
   * page. Nul par prudence : tout est repeint, ce qui est lent mais jamais faux.
   */
  #afterAnnotationChange(pageId = null) {
    this.#highlightsByPage = null;
    this.#drawAnnotations();
    this.#syncBookmark(pageId);
    for (const block of this.#blocks.values()) {
      if (pageId == null || block.page.pageId === pageId) this.#paintBlock(block);
    }
    this.#collectMatches();
  }

  /** Le bloc de la page qu'on lit, s'il est monté. */
  #currentBlock() {
    return this.#blocks.get(this.#index) ?? null;
  }

  /** Repeint le contenu d'une page montée : recherche puis annotations. */
  #paintBlock(block) {
    block.body.replaceChildren(renderBookHtml(block.page.bodyHtml));
    this.#applyHighlight(block.body);
    paintHighlights(block.body, this.#highlightsFor(block.page.pageId), {
      onClick: (highlight) => this.#openHighlight(highlight),
    });
    this.#linkFootnotes(block);
  }

  /**
   * Rend les appels de note cliquables.
   *
   * Deux formes, et il faut les deux : le jeu d'exemple porte `<sup class="fn">`,
   * le corpus Shamela ne porte rien — `tools/shamela/text.py` retire toute
   * balise autre que `br`, `hr`, les images et les titres, et l'appel y est donc
   * du texte nu, « (١) » au fil du paragraphe. Ne connaître que la première
   * forme aurait donné une fonctionnalité qui marche sur cinq livres d'exemple
   * et sur rien d'autre.
   *
   * Le texte n'est jamais réinterprété : on découpe les nœuds existants, comme
   * le surlignage de recherche. Les décalages des annotations sont comptés en
   * caractères du texte rendu, que ce découpage ne change pas.
   */
  #linkFootnotes(block) {
    const notes = footnotesByNumber(block.page.footnotes);
    block.notes = notes;
    if (!notes.size) return;

    // Forme balisée : le marqueur existe déjà, il ne lui manque que sa prise.
    for (const sup of block.body.querySelectorAll('sup.fn')) {
      const number = Number(toLatinDigits(sup.textContent));
      if (notes.has(number)) this.#armFootnote(block, sup, number);
    }

    // Forme nue. On ne marque un nombre que si la page porte une note qui lui
    // répond : « (3) » au fil d'un texte est aussi bien un numéro de verset ou
    // une énumération, et marquer au hasard abîmerait la page.
    const pattern = markerPattern(notes);
    const walker = document.createTreeWalker(block.body, NodeFilter.SHOW_TEXT);
    const targets = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeValue.trim()) targets.push(node);
    }

    for (const node of targets) {
      const text = node.nodeValue;
      pattern.lastIndex = 0;
      const fragment = document.createDocumentFragment();
      let cursor = 0;
      let match;
      while ((match = pattern.exec(text))) {
        const number = Number(toLatinDigits(match[1]));
        if (!notes.has(number)) continue;
        if (match.index > cursor) {
          fragment.append(document.createTextNode(text.slice(cursor, match.index)));
        }
        const mark = h('sup', {}, match[0]);
        this.#armFootnote(block, mark, number);
        fragment.append(mark);
        cursor = match.index + match[0].length;
      }
      if (!cursor) continue;
      if (cursor < text.length) fragment.append(document.createTextNode(text.slice(cursor)));
      node.replaceWith(fragment);
    }
  }

  /** Donne sa prise à un appel de note : au doigt, au clavier, et au lecteur d'écran. */
  #armFootnote(block, element, number) {
    element.classList.add('reader__fn');
    element.setAttribute('role', 'button');
    element.setAttribute('tabindex', '0');
    element.setAttribute('aria-label', t('reader.footnoteOf', { number }));
    element.dataset.footnote = String(number);
    element.addEventListener('click', (event) => {
      // Le clic ne doit pas remonter : le tiers de page où il tombe tournerait
      // la page sous la note qu'on vient d'ouvrir.
      event.stopPropagation();
      this.#openFootnote(block, number);
    });
    element.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      event.stopPropagation();
      this.#openFootnote(block, number);
    });
  }

  /** La note, là où on lit — pas au pied d'une page qu'il faut aller chercher. */
  #openFootnote(block, number) {
    const text = block?.notes?.get(number);
    if (!text) return;
    this.#hideSelection();
    this.#nodes.footnoteNumber.textContent = t('reader.footnoteOf', { number });
    this.#nodes.footnoteText.textContent = text;
    this.#nodes.footnoteSheet.classList.add('is-open');
  }

  #closeFootnote() {
    this.#nodes.footnoteSheet?.classList.remove('is-open');
  }

  #footnoteOpen() {
    return Boolean(this.#nodes.footnoteSheet?.classList.contains('is-open'));
  }

  /**
   * Les occurrences du terme cherché, sur tout ce qui est monté.
   *
   * Elles sont peintes depuis toujours ; ce qui manquait, c'est de pouvoir les
   * atteindre. Une page du corpus fait trois à six écrans sur un téléphone :
   * une occurrence peinte hors de vue est une occurrence qu'on ne trouve pas,
   * et la page paraît ne rien contenir.
   *
   * Sur le fil, la question se pose pour la fenêtre entière et non pour une
   * seule page : c'est la colonne qu'on parcourt, pas la feuille.
   */
  #collectMatches() {
    const flow = this.#nodes.flow;
    this.#matches = this.#highlight && flow ? [...flow.querySelectorAll('.reader__match')] : [];
    this.#matchAt = 0;
    this.#syncMatches();
  }

  #syncMatches() {
    const pill = this.#nodes.matchPill;
    if (!pill) return;
    const total = this.#matches.length;
    pill.classList.toggle('is-open', total > 1);
    if (total > 1) {
      this.#nodes.matchLabel.textContent = t('reader.matchOf', {
        index: this.#matchAt + 1,
        total,
      });
      this.#hideHint();
    }
  }

  /**
   * Va à l'occurrence suivante ([sens] positif), précédente, ou à celle qui est
   * visée ([sens] nul — c'est l'arrivée sur la page). Le tour est bouclé : sur
   * une page, la dernière ramène à la première, comme toute barre de recherche.
   */
  #stepMatch(sens) {
    const total = this.#matches.length;
    if (!total) return;
    this.#matchAt = (this.#matchAt + sens + total) % total;
    for (const mark of this.#matches) mark.classList.remove('is-current');
    const mark = this.#matches[this.#matchAt];
    mark.classList.add('is-current');
    mark.scrollIntoView({ block: 'center', behavior: 'auto' });
    this.#nodes.lastScroll = this.#nodes.scroll.scrollTop;
    this.#syncMatches();
  }

  /** Clic sur un passage surligné : sa note, sinon l'occasion d'en écrire une. */
  #openHighlight(highlight) {
    const note = this.#annotations.notes.find(
      (item) => item.highlightId === highlight.highlightId,
    );
    this.#editNote(highlight, note ?? null);
  }

  async #addHighlight(color) {
    const selected = this.#pendingSelection;
    const page = this.#pendingPage;
    this.#hideSelection();
    return this.#persistHighlight(selected, page, color);
  }

  /**
   * Pose un surlignage sur une sélection déjà mesurée.
   *
   * Séparé de `#addHighlight` parce que la note diffère l'écriture : elle
   * retient la sélection, ouvre son éditeur, et n'appelle ceci qu'une fois le
   * texte validé — voir `shared/note-draft.js`.
   */
  async #persistHighlight(selected, page, color) {
    if (!selected || !page) return null;

    try {
      const saved = await repository.saveHighlight({
        editionId: this.#editionId,
        pageId: page.pageId,
        ...selected,
        color,
      });
      this.#annotations.highlights = [
        ...this.#annotations.highlights.filter((item) => item.highlightId !== saved.highlightId),
        saved,
      ];
      this.#afterAnnotationChange(page.pageId);
      return saved;
    } catch (error) {
      toast(error?.message ?? t('reader.highlightSaveFailed'));
      return null;
    }
  }

  /**
   * Une note sur la sélection courante — **rien n'est écrit avant d'être
   * validé**.
   *
   * Le surlignage était posé d'abord, l'éditeur ouvert ensuite : « annuler » ne
   * rendait alors que la note, et le passage restait teinté sans que rien ne
   * dise comment le retirer. L'ordre est inversé, et c'est toute la correction —
   * il n'y a pas de rattrapage à écrire, donc pas de risque de défaire un
   * surlignage préexistant. La règle vit dans `shared/note-draft.js`, pure, pour
   * être éprouvée dans les deux sens sans un DOM ni une base.
   */
  async #noteOnSelection() {
    const selected = this.#pendingSelection;
    const page = this.#pendingPage;
    this.#hideSelection();
    if (!selected || !page) return;

    await composeNote({
      ask: () =>
        this.#openNoteSheet({
          title: t('reader.addNote'),
          quote: selected.selectedText ?? null,
        }),
      createHighlight: () => this.#persistHighlight(selected, page, HIGHLIGHTS[0].color),
      saveNote: (highlight, content) => this.#saveNote(highlight, null, content),
    });
  }

  /**
   * Écrit ou modifie une note. Une note attachée à un surlignage disparaît avec
   * lui ; une note de page vit seule.
   *
   * Ce chemin-ci n'a **rien créé** : le surlignage qu'on annote existait avant
   * le geste. Renoncer ne doit donc rien défaire — ni la note, ni la couleur.
   */
  async #editNote(highlight, existing) {
    const content = await this.#openNoteSheet({
      title: t(existing ? 'reader.editNote' : 'reader.addNote'),
      quote: highlight?.selectedText ?? null,
      value: existing?.content ?? '',
      canDelete: Boolean(existing),
    });
    if (content === null) return;
    if (content === '') {
      if (existing) await this.#removeNote(existing);
      return;
    }
    await this.#saveNote(highlight, existing, content);
  }

  /** L'écriture elle-même, partagée par les deux chemins. */
  async #saveNote(highlight, existing, content) {
    try {
      const saved = await repository.saveNote({
        noteId: existing?.noteId ?? null,
        editionId: this.#editionId,
        pageId: highlight?.pageId ?? existing?.pageId ?? this.#page?.pageId ?? null,
        highlightId: highlight?.highlightId ?? existing?.highlightId ?? null,
        content,
      });
      this.#annotations.notes = [
        ...this.#annotations.notes.filter((note) => note.noteId !== saved.noteId),
        saved,
      ];
      this.#afterAnnotationChange(saved.pageId);
      toast(t('reader.noteSaved'));
      return saved;
    } catch (error) {
      toast(error?.message ?? t('reader.noteSaveFailed'));
      return null;
    }
  }

  /**
   * Ouvre la feuille de saisie et rend ce qu'on en a fait : le texte, `''` pour
   * une suppression, `null` pour un refus.
   *
   * Une seule feuille, montée une fois avec l'écran : une boîte fabriquée à
   * chaque geste réinstallerait ses écouteurs et, sur un téléphone, ferait
   * remonter le clavier virtuel à chaque ouverture.
   */
  #openNoteSheet({ title, quote = null, value = '', canDelete = false }) {
    // Une feuille déjà ouverte se règle avant : deux promesses pendantes sur un
    // seul champ, et la première n'aurait plus aucune issue.
    this.#settleNote(null);

    const nodes = this.#nodes;
    nodes.noteTitle.textContent = title;
    nodes.noteQuote.textContent = quote ?? '';
    nodes.noteQuote.hidden = !quote;
    nodes.noteField.value = value;
    nodes.noteSave.disabled = !value.trim();
    nodes.noteDelete.hidden = !canDelete;
    nodes.noteSheet.classList.add('is-open');
    this.#dropKeyboardWatch = this.#watchKeyboard();
    nodes.noteField.focus();

    return new Promise((resolve) => {
      this.#notePrompt = resolve;
    });
  }

  /** L'unique issue de la feuille, quel que soit le chemin qui l'atteint. */
  #settleNote(result) {
    const resolve = this.#notePrompt;
    this.#notePrompt = null;
    this.#nodes.noteSheet?.classList.remove('is-open');
    this.#dropKeyboardWatch?.();
    this.#dropKeyboardWatch = null;
    resolve?.(result === null || result === undefined ? null : result);
  }

  #noteSheetOpen() {
    return Boolean(this.#notePrompt);
  }

  /**
   * Tient l'ancre de lecture pendant que le clavier virtuel est là.
   *
   * Deux comportements existent sur Android, et il faut les deux : la fenêtre
   * est redimensionnée (la feuille, ancrée au bas de la fenêtre, monte alors
   * toute seule) ou elle ne l'est pas, et c'est `visualViewport` qui dit ce que
   * le clavier recouvre — la feuille s'en écarte d'autant. Dans les deux cas la
   * colonne est **remise où elle était** : sans quoi la page qu'on lit change
   * sous le texte qu'on écrit, parce que `#followScroll` déduit la page courante
   * de ce qui est à l'écran.
   */
  #watchKeyboard() {
    const view = window.visualViewport;
    const scroll = this.#nodes.scroll;
    const top = scroll?.scrollTop ?? 0;
    const restore = () => {
      if (scroll) scroll.scrollTop = top;
    };
    if (!view) return restore;

    const apply = () => {
      const covered = Math.max(0, window.innerHeight - view.height - view.offsetTop);
      this.#nodes.root.style.setProperty('--reader-keyboard', `${covered}px`);
      restore();
    };
    view.addEventListener('resize', apply);
    view.addEventListener('scroll', apply);
    apply();

    return () => {
      view.removeEventListener('resize', apply);
      view.removeEventListener('scroll', apply);
      this.#nodes.root.style.removeProperty('--reader-keyboard');
      restore();
    };
  }

  async #removeNote(note) {
    try {
      await repository.deleteNote(note.noteId);
    } catch (error) {
      toast(error?.message ?? t('reader.noteDeleteFailed'));
      return;
    }
    this.#annotations.notes = this.#annotations.notes.filter(
      (item) => item.noteId !== note.noteId,
    );
    this.#afterAnnotationChange(note.pageId);
  }

  async #removeHighlight(highlight) {
    const hasNote = this.#annotations.notes.some(
      (note) => note.highlightId === highlight.highlightId,
    );
    if (hasNote) {
      const choice = await confirmDialog({
        title: t('reader.deleteHighlightTitle'),
        message: t('reader.deleteHighlightMessage'),
        actions: [{ value: 'go', label: t('action.delete'), variant: 'danger' }],
      });
      if (choice !== 'go') return;
    }
    try {
      await repository.deleteHighlight(highlight.highlightId);
    } catch (error) {
      toast(error?.message ?? t('reader.highlightDeleteFailed'));
      return;
    }
    this.#annotations.highlights = this.#annotations.highlights.filter(
      (item) => item.highlightId !== highlight.highlightId,
    );
    this.#annotations.notes = this.#annotations.notes.filter(
      (note) => note.highlightId !== highlight.highlightId,
    );
    this.#afterAnnotationChange(highlight.pageId);
  }

  async #toggleBookmark() {
    if (!this.#page) return;
    const page = this.#page;
    try {
      const result = await repository.toggleBookmark({
        editionId: this.#editionId,
        pageId: page.pageId,
        label:
          this.#chapterFor(page) ??
          t('reader.page', { page: page.printedPageNum ?? page.sequenceNum }),
      });
      this.#annotations.bookmarks = result.added
        ? [...this.#annotations.bookmarks, result.bookmark]
        : this.#annotations.bookmarks.filter((item) => item.pageId !== page.pageId);
      this.#afterAnnotationChange(page.pageId);
      toast(t(result.added ? 'reader.bookmarkAdded' : 'reader.bookmarkRemoved'));
    } catch (error) {
      toast(error?.message ?? t('reader.bookmarkSaveFailed'));
    }
  }

  #isBookmarked(pageId) {
    return this.#annotations.bookmarks.some((item) => item.pageId === pageId);
  }

  /**
   * L'icône dit si la page courante porte une marque, et la page montée arbore
   * son signet : sans repère dans le texte, le bouton avait l'air de ne rien
   * faire.
   */
  #syncBookmark(pageId = null) {
    for (const block of this.#blocks.values()) {
      if (pageId != null && block.page.pageId !== pageId) continue;
      block.root.classList.toggle('is-bookmarked', this.#isBookmarked(block.page.pageId));
    }
    this.#syncBookmarkButton();
  }

  /** L'icône de la barre haute seule : ce que la page courante change. */
  #syncBookmarkButton() {
    const button = this.#nodes.bookmarkButton;
    if (!button || !this.#page) return;
    const marked = this.#isBookmarked(this.#page.pageId);
    button.classList.toggle('is-active', marked);
    button.replaceChildren(icon('bookmark', { size: 20, fill: marked }));
    button.title = t(marked ? 'reader.bookmarkRemove' : 'reader.bookmarkTool');
  }

  /**
   * Recherche dans le livre. `pages_fts` n'est pas interrogeable — le build
   * sql.js embarqué ne contient pas FTS5 — le dépôt cherche donc sur les
   * colonnes normalisées `body_search` et `title_normalized`.
   */
  #searchPanel(refs) {
    const results = h('div', { class: 'reader__panel-body reader__search-results' });
    const summary = h('p', { class: 'label-sm muted' }, t('reader.searchTooShort'));
    let timer = null;

    const field = h('input', {
      type: 'search',
      class: 'reader__search-field',
      placeholder: t('reader.searchField'),
      oninput: () => {
        clearTimeout(timer);
        timer = setTimeout(() => this.#runSearch(field.value, { results, summary }), 250);
      },
    });

    refs.searchField = field;

    return h(
      'aside',
      { class: 'reader__search reader__panel' },
      h(
        'div',
        { class: 'reader__panel-head' },
        h('h2', { class: 'title-md' }, t('reader.searchTitle')),
        h(
          'button',
          { class: 'reader__tool', title: t('action.close'), onclick: () => this.#closePanels() },
          icon('close', { size: 20 }),
        ),
      ),
      h('div', { class: 'reader__search-box' }, field, summary),
      results,
    );
  }

  async #runSearch(term, { results, summary }) {
    const trimmed = term.trim();
    if (trimmed.length < 2) {
      this.#highlight = null;
      summary.textContent = t('reader.searchTooShort');
      results.replaceChildren();
      return;
    }

    summary.textContent = t('reader.searching');
    let found;
    try {
      found = await repository.searchInBook(this.#editionId, trimmed, { limit: 60 });
    } catch {
      summary.textContent = t('reader.searchFailed');
      return;
    }

    this.#highlight = arabicSearchPattern(trimmed);
    // La page qu'on a sous les yeux porte peut-être déjà le terme : la
    // repeindre la fait entrer dans le compte des occurrences, au lieu
    // d'attendre qu'on tourne pour voir la recherche prendre effet.
    for (const block of this.#blocks.values()) this.#paintBlock(block);
    this.#collectMatches();
    const total = found.chapters.length + found.pages.length;
    summary.textContent = total
      ? t('pagination.results', { total })
      : t('reader.searchNone');

    // Les chapitres d'abord : trouver un titre vaut mieux qu'une occurrence
    // perdue au milieu d'une page.
    results.replaceChildren(
      ...found.chapters.map((entry) =>
        h(
          'button',
          {
            class: 'reader__result is-chapter',
            onclick: () => this.#goToPage(entry.pageId, { focusMatch: true }),
          },
          h('span', { class: 'reader__result-title truncate', dir: CONTENT_DIR }, entry.title),
          h(
            'span',
            { class: 'label-sm muted' },
            t('reader.page', { page: entry.printedPageNum ?? entry.sequenceNum }),
          ),
        ),
      ),
      ...found.pages.map((entry) =>
        h(
          'button',
          {
            class: 'reader__result',
            onclick: () => this.#goToPage(entry.pageId, { focusMatch: true }),
          },
          h(
            'p',
            { class: 'reader__result-snippet', dir: CONTENT_DIR },
            entry.snippet.before,
            h('mark', {}, entry.snippet.match),
            entry.snippet.after,
          ),
          h(
            'span',
            { class: 'label-sm muted' },
            t('reader.page', { page: entry.printedPageNum ?? entry.sequenceNum }),
          ),
        ),
      ),
    );
  }

  /**
   * Enveloppe les occurrences du terme cherché dans la page affichée. On
   * parcourt les nœuds de texte plutôt que de manipuler du HTML : le contenu du
   * livre n'est jamais réinterprété.
   */
  #applyHighlight(root) {
    if (!this.#highlight) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const targets = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeValue.trim()) targets.push(node);
    }

    for (const node of targets) {
      const text = node.nodeValue;
      this.#highlight.lastIndex = 0;
      const fragment = document.createDocumentFragment();
      let cursor = 0;
      let match;
      while ((match = this.#highlight.exec(text))) {
        if (match.index > cursor) {
          fragment.append(document.createTextNode(text.slice(cursor, match.index)));
        }
        // Classé : sans cela le fond de recherche l'emporterait, par
        // spécificité, sur la couleur choisie pour un surlignage.
        fragment.append(h('mark', { class: 'reader__match' }, match[0]));
        cursor = match.index + match[0].length;
        // Un motif capable de correspondre au vide bouclerait sans fin.
        if (match[0].length === 0) this.#highlight.lastIndex += 1;
      }
      if (!cursor) continue;
      if (cursor < text.length) fragment.append(document.createTextNode(text.slice(cursor)));
      node.replaceWith(fragment);
    }
  }

  /** Menu contextuel de sélection, calqué sur la maquette (V2). */
  #selectionMenu() {
    const item = (name, label, onclick) =>
      h(
        'button',
        { class: 'reader__selection-item', onclick },
        icon(name, { size: 20 }),
        h('span', { class: 'label-md' }, label),
      );

    return h(
      'aside',
      { class: 'reader__selection' },
      // Une note sans surlignage flotterait sans ancre : le passage est donc
      // posé avec elle — mais **après** qu'elle est écrite, jamais avant.
      // Renoncer ne doit rien laisser derrière soi.
      item('noteAdd', t('reader.addNote'), () => this.#noteOnSelection()),
      item('copy', t('reader.copy'), () => this.#copySelection()),
      // Pas d'entrée « traduire » : elle n'ouvrait qu'un message d'attente. Un
      // outil qui annonce son propre chantier prend la place d'un doigt et
      // n'apprend rien qu'on ne sache après le premier essai.
      item('search', t('reader.searchTitle'), () => this.#searchSelection()),
      h(
        'div',
        { class: 'reader__highlights' },
        HIGHLIGHTS.map((entry) =>
          h('button', {
            title: t('reader.highlightWith', { color: t(entry.label) }),
            'aria-label': t('reader.highlightWith', { color: t(entry.label) }),
            style: { background: entry.color },
            onclick: () => this.#addHighlight(entry.color),
          }),
        ),
      ),
    );
  }

  /** Le texte sélectionné devient le terme cherché, panneau ouvert. */
  #searchSelection() {
    const term = this.#pendingSelection?.selectedText?.trim() ?? '';
    this.#hideSelection();
    if (!term) return;
    if (!this.#nodes.searchPanel.classList.contains('is-open')) this.#togglePanel('search');
    const field = this.#nodes.searchField;
    if (!field) return;
    field.value = term;
    field.dispatchEvent(new Event('input'));
  }

  // ---------------------------------------------------------------- pages

  async #pageAt(index) {
    if (this.#pages.has(index)) return this.#pages.get(index);
    const offset = Math.floor(index / PAGE_WINDOW) * PAGE_WINDOW;
    const pages = await repository.getPages(this.#editionId, {
      offset,
      limit: PAGE_WINDOW,
    });
    pages.forEach((page, position) => this.#pages.set(offset + position, page));
    return this.#pages.get(index) ?? null;
  }

  /**
   * Monte une page : son titre de chapitre, son corps, ses notes de bas de
   * page, puis le pied imprimé.
   *
   * Chaque page rouvre son chapitre. C'est le seul repère de la feuille : on
   * n'y voit rien de ce qui précède, et taire le titre parce que la page
   * d'avant le portait laisserait le lecteur sans réponse à « où suis-je ».
   */
  #makeBlock(index, page) {
    const body = h('article', { class: 'reader__page', dir: CONTENT_DIR });
    const footnotes = h('aside', { class: 'reader__footnotes', dir: CONTENT_DIR });
    const chapter = h('h2', { class: 'reader__chapter', dir: CONTENT_DIR });
    const foot = h('div', { class: 'reader__page-foot label-sm' });
    const ribbon = h(
      'span',
      { class: 'reader__block-mark', title: t('reader.markedPage'), 'aria-hidden': 'true' },
      icon('bookmark', { size: 16, fill: true }),
    );

    const root = h(
      'section',
      { class: 'reader__block', 'data-index': String(index) },
      ribbon,
      chapter,
      body,
      footnotes,
      foot,
    );

    const block = { index, page, root, body, chapter, footnotes, foot, title: null };

    if (page.footnotes) {
      footnotes.replaceChildren(document.createTextNode(page.footnotes));
    } else {
      footnotes.style.display = 'none';
    }

    this.#paintChapter(block);
    root.classList.toggle('is-bookmarked', this.#isBookmarked(page.pageId));
    this.#paintBlock(block);
    return block;
  }

  /**
   * Ce que le sommaire nomme sur une page : son chapitre en tête, et en pied
   * ce qu'il reste avant la fin de ce chapitre.
   *
   * À part, parce que le sommaire arrive **après** la page (`#loadToc`) : sans
   * un endroit unique où le repeindre, la première page ouverte d'un gros livre
   * garderait son entête vide jusqu'à ce qu'on la quitte.
   */
  #paintChapter(block) {
    const { page, index, chapter, foot } = block;
    const title = this.#chapterFor(page);
    block.title = title;
    chapter.textContent = title ?? '';
    chapter.style.display = title ? '' : 'none';

    // `printed` est le numéro imprimé dans l'édition papier, `index` la
    // position dans le fichier : les deux diffèrent presque toujours, on ne
    // les mélange donc jamais dans un même « N sur M ».
    const printed = page.printedPageNum ?? page.sequenceNum;
    foot.replaceChildren(
      h(
        'span',
        {},
        t('reader.pageOf', { index: index + 1, total: this.#pageCount }) +
          t('reader.printedPage', { printed }),
      ),
    );

    // « il reste tant avant la fin du chapitre » : le sommaire est en mémoire,
    // c'est une soustraction. Le pourcentage du livre entier ne dit rien de
    // l'effort qui reste avant de pouvoir s'arrêter — c'est pourtant la seule
    // question qu'on se pose en fin de soirée.
    const left = this.#pagesLeftInChapter(page);
    if (left > 0) {
      foot.append(h('span', {}, t('reader.leftInChapter', { count: left })));
    }
  }

  // ------------------------------------------------------------- affichage

  /**
   * Une page monte, l'ancienne s'en va. C'est la seule façon de lire.
   *
   * [restore] rend sa position **dans** la page — une reprise, pas un saut. Un
   * saut depuis le sommaire ou la recherche ouvre en haut : on y va pour voir
   * un endroit précis, pas pour retrouver le sien. [ratio] est ce même endroit,
   * mais donné en clair : c'est ce que rend la pastille « revenir à ».
   *
   * [focusMatch] amène la première occurrence du terme cherché à l'écran. Sans
   * lui, un résultat ouvrait sa page en haut, et l'occurrence pouvait être
   * trois écrans plus bas : la page paraissait ne rien contenir.
   */
  async #show(index, { save = true, restore = false, ratio = null, focusMatch = false } = {}) {
    index = clamp(index, 0, Math.max(0, this.#pageCount - 1));
    // Le numéro de la montée en cours. `#pageAt` peut attendre une fenêtre de
    // vingt pages — un aller-retour du pont natif sur Android — et deux appels
    // qui se chevauchent se posaient dans le désordre : la page affichée
    // n'était alors plus celle qu'on venait de demander. C'est la panne que
    // `router.js` a déjà réglée, au même motif.
    const mine = ++this.#showToken;
    const page = await this.#pageAt(index);
    if (!page || mine !== this.#showToken || this.#disposed) return;

    // Sens du feuilletage. En RTL on avance vers la gauche : la page qui arrive
    // vient donc du bord gauche quand on avance, du bord droit quand on revient.
    // Une page rouverte au même rang — changement d'ambiance, de taille, de
    // police — ne bouge pas : rien n'a tourné.
    const turn = index === this.#index ? 0 : Math.sign(index - this.#index);

    if (this.#mode === 'scroll') {
      // Le fil ne remplace pas la page : il l'amène. La fenêtre est montée
      // d'abord, sinon le bloc visé n'existe pas encore quand on veut y aller.
      await this.#mountWindow(index, mine);
      if (mine !== this.#showToken || this.#disposed) return;
      const block = this.#blocks.get(index);
      if (!block) return;
      const top = Math.max(0, block.root.offsetTop - this.#nodes.flow.offsetTop);
      this.#nodes.lastScroll = top;
      this.#nodes.scroll.scrollTop = top;
      this.#setCurrent(index, page, { save });
    } else {
      const block = this.#makeBlock(index, page);
      this.#blocks.clear();
      this.#blocks.set(index, block);
      this.#nodes.flow.replaceChildren(block.root);
      if (turn) {
        block.root.classList.add(turn > 0 ? 'is-turned-next' : 'is-turned-previous');
      }
      // Une page imprimée dépasse souvent la hauteur de l'écran : la colonne
      // garde son défilement, et une page qui arrive s'ouvre à son début.
      this.#nodes.scroll.scrollTop = 0;
      this.#nodes.lastScroll = 0;
      this.#setCurrent(index, page, { save });
    }

    this.#collectMatches();
    if (focusMatch) this.#stepMatch(0);
    else if (ratio != null) this.#applyRatio(page, ratio);
    else if (restore) this.#restoreAnchor(page);
  }

  // ------------------------------------------------------------------ le fil

  /**
   * Monte la fenêtre de pages autour de [center], et démonte ce qui s'en est
   * trop éloigné.
   *
   * Une **fenêtre**, jamais le livre entier : les plus gros livres du corpus
   * passent le millier de pages, et les deux clients chargent une base de livre
   * entièrement en mémoire. C'est la version « tout d'un coup » qui avait été
   * mesurée puis abandonnée.
   *
   * L'ordre du DOM suit l'ordre des rangs : on insère **avant** le premier bloc
   * de rang supérieur, jamais à la fin. Ajouté en queue, le bloc précédent
   * apparaîtrait sous le suivant, et le fil se lirait à l'envers.
   */
  async #mountWindow(center, token) {
    const wanted = windowAround(center, this.#pageCount);
    for (const index of wanted) {
      if (this.#blocks.has(index)) continue;
      const page = await this.#pageAt(index);
      if (token !== this.#showToken || this.#disposed) return;
      // Une seconde montée a pu poser ce bloc pendant l'attente.
      if (!page || this.#blocks.has(index)) continue;
      const block = this.#makeBlock(index, page);
      this.#blocks.set(index, block);
      const after = [...this.#blocks.keys()].filter((key) => key > index).sort((a, b) => a - b)[0];
      const anchor = after === undefined ? null : this.#blocks.get(after).root;
      // Insérer au-dessus de ce qui suit **fige la position lue** : sans cela,
      // monter une page en amont pousserait le texte sous les yeux du lecteur.
      const before = this.#nodes.scroll.scrollHeight;
      this.#nodes.flow.insertBefore(block.root, anchor);
      if (anchor && block.root.offsetTop < this.#nodes.scroll.scrollTop) {
        const grown = this.#nodes.scroll.scrollHeight - before;
        this.#nodes.scroll.scrollTop += grown;
        this.#nodes.lastScroll = this.#nodes.scroll.scrollTop;
      }
    }

    for (const [index, block] of [...this.#blocks]) {
      if (!outOfWindow(index, center)) continue;
      block.root.remove();
      this.#blocks.delete(index);
    }
  }

  /** Le rang du bloc qui occupe le haut de la colonne, dans le fil. */
  #visibleIndex() {
    const scroll = this.#nodes.scroll;
    // Le tiers haut de la fenêtre : c'est la ligne qu'on lit, pas le bord de
    // l'écran, qui appartient encore à la page d'avant pendant tout un écran.
    const mark = scroll.scrollTop + scroll.clientHeight / 3;
    let found = null;
    for (const [index, block] of this.#blocks) {
      const top = block.root.offsetTop - this.#nodes.flow.offsetTop;
      if (top <= mark && (found === null || index > found)) found = index;
    }
    return found;
  }

  /**
   * Le fil a défilé : la page courante est celle qu'on a sous les yeux, et la
   * fenêtre suit.
   *
   * Aucun remontage ici — `#setCurrent` ne touche pas au DOM du fil. Le
   * confondre avec `#show` ferait sauter la colonne à chaque pixel défilé.
   */
  #followScroll() {
    const index = this.#visibleIndex();
    if (index === null || index === this.#index) return;
    const block = this.#blocks.get(index);
    if (block) this.#setCurrent(index, block.page, { save: true });
    // La fenêtre se recentre sans attendre d'en toucher le bord : la charger
    // au dernier moment, c'est la charger pendant que le doigt défile.
    this.#mountWindow(index, this.#showToken);
  }

  /**
   * Rend à la page la position qu'on y avait.
   *
   * Après le montage et **après une image** : la hauteur du bloc n'existe pas
   * encore au moment où on l'insère, et un `scrollTop` posé trop tôt retombe à
   * zéro sans rien dire.
   *
   * `lastScroll` est avancé **avant** le saut, et pas après : sinon `#onScroll`
   * voit une descente et escamote les barres — une reprise ferait alors
   * disparaître les repères au moment précis où l'on cherche à savoir où l'on
   * est.
   */
  #restoreAnchor(page) {
    const anchor = anchorFor(this.#anchors, this.#editionId);
    if (!anchor || anchor.pageId !== page.pageId) return;
    this.#applyRatio(page, anchor.ratio);
  }

  /** Pose la colonne à [ratio] de sa hauteur, une fois la page mesurable. */
  #applyRatio(page, ratio) {
    if (!ratio) return;
    requestAnimationFrame(() => {
      if (this.#disposed || this.#page?.pageId !== page.pageId) return;
      const scroll = this.#nodes.scroll;
      const block = this.#currentBlock();
      let top;
      if (this.#mode === 'scroll' && block) {
        const start = block.root.offsetTop - this.#nodes.flow.offsetTop;
        top = Math.round(start + block.root.offsetHeight * ratio);
      } else {
        const range = scroll.scrollHeight - scroll.clientHeight;
        if (range <= 0) return;
        top = Math.round(range * ratio);
      }
      this.#nodes.lastScroll = top;
      scroll.scrollTop = top;
    });
  }

  #scheduleAnchor() {
    clearTimeout(this.#anchorTimer);
    this.#anchorTimer = setTimeout(() => this.#saveAnchor(), ANCHOR_DELAY);
  }

  /**
   * Écrit où l'on en est dans la page courante. Un rapport, jamais un pixel :
   * la taille de la lettre se règle, et la hauteur de la page avec elle.
   */
  #saveAnchor() {
    const page = this.#page;
    const scroll = this.#nodes.scroll;
    if (!page || !scroll) return;
    const range = scroll.scrollHeight - scroll.clientHeight;
    const ratio = range > 0 ? scroll.scrollTop / range : 0;
    const next = rememberAnchor(this.#anchors, this.#editionId, { pageId: page.pageId, ratio });
    // Rien de neuf, rien à écrire : le lecteur qui tourne les pages sans
    // défiler en poserait une par page, toutes identiques.
    const before = anchorFor(this.#anchors, this.#editionId);
    const after = anchorFor(next, this.#editionId);
    this.#anchors = next;
    if (before && after && before.pageId === after.pageId && before.ratio === after.ratio) return;
    setSetting(ANCHORS_SETTING, serializeAnchors(next));
  }

  /** Synchronise la barre basse, le signet et la progression sur [index]. */
  #setCurrent(index, page, { save = true } = {}) {
    const changed = this.#index !== index || this.#page?.pageId !== page.pageId;
    this.#index = index;
    this.#page = page;

    this.#nodes.slider.value = String(index + 1);
    this.#nodes.pagerCurrent.textContent = n(index + 1);
    this.#nodes.pagerTotal.textContent = n(this.#pageCount);
    const done = Math.round(this.#percent() * 100);
    this.#nodes.percent.textContent = t('format.percent', { value: done });
    // Le rail n'a pas de remplissage natif une fois `appearance: none` posé :
    // c'est un dégradé, mis à jour ici, qui joue ce rôle.
    this.#nodes.root.style.setProperty('--reader-fill', `${done}%`);
    this.#nodes.previous.disabled = index === 0;
    this.#nodes.next.disabled = index >= this.#pageCount - 1;

    this.#syncBookmarkButton();
    if (changed) {
      this.#pendingSelection = null;
      this.#pendingPage = null;
      this.#hideSelection();
      // Une note appartient à sa page : la laisser ouverte sur la suivante
      // ferait lire un commentaire qui ne parle plus de ce qu'on a sous les yeux.
      this.#closeFootnote();
    }
    // La page qui arrive ramène les barres : c'est le moment où l'on regarde
    // où l'on en est.
    this.#showChrome();
    if (save) this.#scheduleSave(page);
    else this.#save(page);
    // La page a changé : l'ancre de l'ancienne ne vaut plus, et celle-ci
    // commence en haut. Sans cette pose, une ancre périmée survivrait à la
    // page qu'elle décrivait — elle serait ignorée à la reprise, mais on
    // rouvrirait alors en haut d'une page où l'on avait pourtant lu.
    if (changed) this.#scheduleAnchor();
  }

  /**
   * Page suivante ou précédente.
   *
   * Sur le fil, ce n'est pas un remontage : la page voisine est déjà là, on y
   * va. La remonter ferait clignoter la colonne et perdrait ce qui est au-dessus
   * — c'est précisément ce que le fil promet de garder.
   */
  #move(direction) {
    const target = clamp(this.#index + direction, 0, Math.max(0, this.#pageCount - 1));
    if (this.#mode === 'scroll') {
      const block = this.#blocks.get(target);
      if (block) {
        const top = Math.max(0, block.root.offsetTop - this.#nodes.flow.offsetTop);
        this.#nodes.lastScroll = top;
        this.#nodes.scroll.scrollTo({ top, behavior: 'smooth' });
        this.#setCurrent(target, block.page, { save: true });
        return;
      }
    }
    this.#show(target);
  }

  /**
   * Ce que la jauge annonce sous le doigt : le rang visé et le chapitre qui le
   * porte, sans monter une seule page. Le ruban suit la poignée — sinon la
   * fraction et le pourcentage mentiraient tant qu'on n'a pas lâché.
   */
  #previewJump(index) {
    const target = clamp(index, 0, Math.max(0, this.#pageCount - 1));
    const done = Math.round(((target + 1) / Math.max(1, this.#pageCount)) * 100);
    this.#nodes.pagerCurrent.textContent = n(target + 1);
    this.#nodes.percent.textContent = t('format.percent', { value: done });
    this.#nodes.root.style.setProperty('--reader-fill', `${done}%`);

    this.#nodes.scrubPage.textContent = t('reader.pageOf', {
      index: target + 1,
      total: this.#pageCount,
    });
    // Le rang, pas l'identifiant : la destination n'est pas chargée, on ne
    // connaît d'elle que sa place dans le livre.
    const chapter = this.#chapterEntry(target + 1, 'pageSequenceNum')?.title ?? '';
    this.#nodes.scrubChapter.textContent = chapter;
    this.#nodes.scrubChapter.style.display = chapter ? '' : 'none';
    this.#nodes.scrub.classList.add('is-open');
    this.#showChrome();
  }

  /** Le doigt se lève : c'est le seul moment où la page monte. */
  #commitJump(index) {
    this.#nodes.scrub.classList.remove('is-open');
    this.#show(index);
  }

  /**
   * Saut vers une page nommée : sommaire, résultat de recherche, annotation.
   *
   * Le point de départ est retenu avant de partir. Sans lui, ouvrir un chapitre
   * pour vérifier une référence perdait la lecture en cours, et le seul recours
   * était la jauge — c'est-à-dire retrouver à la main une page dont on ne se
   * souvient plus du numéro.
   */
  async #goToPage(pageId, { focusMatch = false } = {}) {
    this.#closePanels();
    this.#rememberOrigin();
    const page = await repository.getPageById(this.#editionId, pageId).catch(() => null);
    if (page) this.#show(page.sequenceNum - 1, { focusMatch });
    else toast(t('reader.openPageFailed'));
  }

  /** Le rapport de défilement de la colonne, ici et maintenant. */
  #scrollRatio() {
    const scroll = this.#nodes.scroll;
    if (!scroll) return 0;
    // Sur le fil, le rapport se compte **dans la page** et non dans la colonne :
    // la colonne porte une fenêtre glissante, sa hauteur change à chaque
    // montage, et une ancre posée dessus désignerait un autre endroit au tour
    // suivant.
    const block = this.#currentBlock();
    if (this.#mode === 'scroll' && block) {
      const height = block.root.offsetHeight;
      if (height <= 0) return 0;
      const top = block.root.offsetTop - this.#nodes.flow.offsetTop;
      return Math.min(1, Math.max(0, (scroll.scrollTop - top) / height));
    }
    const range = scroll.scrollHeight - scroll.clientHeight;
    return range > 0 ? scroll.scrollTop / range : 0;
  }

  /**
   * Retient d'où l'on part, et le montre.
   *
   * Une seule mémoire, pas une pile : après deux sauts d'affilée, ce qu'on veut
   * retrouver est le dernier endroit **lu**, pas le premier chapitre par lequel
   * on est passé. Une pile promettrait un chemin qu'on n'a pas parcouru.
   */
  #rememberOrigin() {
    const page = this.#page;
    if (!page) return;
    this.#origin = {
      index: this.#index,
      ratio: this.#scrollRatio(),
      printed: page.printedPageNum ?? page.sequenceNum,
    };
    this.#nodes.returnLabel.textContent = t('reader.backTo', { page: this.#origin.printed });
    this.#nodes.returnPill.classList.add('is-open');
    // La bulle d'aide et la pastille se disputeraient le même bas d'écran.
    this.#hideHint();
  }

  #hideReturn() {
    this.#origin = null;
    this.#nodes.returnPill?.classList.remove('is-open');
  }

  /** Retour au point de lecture, à l'endroit exact où on l'avait laissé. */
  #goToOrigin() {
    const origin = this.#origin;
    this.#hideReturn();
    if (!origin) return;
    this.#show(origin.index, { ratio: origin.ratio });
  }

  /**
   * L'entrée de sommaire qui couvre [value] : la dernière dont la clé [key] ne
   * dépasse pas la valeur donnée.
   *
   * Par dichotomie, et non par balayage. La question se pose une fois par page
   * montée et une fois par cran de la jauge : au balayage, le corpus donne
   * 54 millions de tours au 99ᵉ centile de `pages × sommaire`, et 17 milliards
   * sur le plus gros livre. Le sommaire est trié — l'ancien balayage s'arrêtait
   * au premier dépassement, il le supposait déjà.
   *
   * Deux clés, une seule dichotomie : `pageId` pour la page qu'on a en main,
   * `pageSequenceNum` pour un rang dont on ne connaît que le numéro — c'est le
   * cas de la jauge, qui doit nommer une destination sans l'avoir chargée. La
   * seconde copie de cette boucle aurait divergé de la première au premier
   * changement de tri.
   */
  #chapterEntry(value, key = 'pageId') {
    const toc = this.#toc;
    if (!toc.length || value == null) return null;
    let low = 0;
    let high = toc.length - 1;
    let found = null;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (toc[middle][key] <= value) {
        found = toc[middle];
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return found;
  }

  /** Le titre du chapitre qui couvre [page]. */
  #chapterFor(page) {
    return this.#chapterEntry(page.pageId)?.title ?? null;
  }

  /**
   * Combien de pages avant la fin du chapitre courant.
   *
   * Le chapitre finit là où le suivant commence ; le dernier finit avec le
   * livre. Zéro quand on est sur sa dernière page, et le pied n'annonce alors
   * rien — « il reste 0 » est une phrase qu'on lit deux fois.
   *
   * Des sous-titres qui ouvrent la même page rendent la même chose : la
   * soustraction tombe à zéro ou en dessous, et la ligne se tait.
   */
  #pagesLeftInChapter(page) {
    const entry = this.#chapterEntry(page.pageId);
    if (!entry) return 0;
    const next = this.#toc[this.#toc.indexOf(entry) + 1];
    const end = next?.pageSequenceNum ?? this.#pageCount + 1;
    return Math.max(0, end - 1 - page.sequenceNum);
  }

  #percent() {
    if (this.#pageCount <= 1) return 1;
    return (this.#index + 1) / this.#pageCount;
  }

  #scheduleSave(page) {
    clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => this.#save(page), 400);
  }

  #save(page) {
    repository
      .saveProgress({
        editionId: this.#editionId,
        pageId: page.pageId,
        sequenceNum: page.sequenceNum,
        percent: this.#percent(),
        updatedAt: new Date().toISOString(),
      })
      .catch(() => toast(t('reader.progressSaveFailed')));
  }

  // ------------------------------------------------------------- réglages

  #setSize(value) {
    this.#applySize(value);
    setSetting('reader.fontSize', this.#prefs.size);
  }

  /**
   * Poser la taille sans l'écrire.
   *
   * Le pincement en produit une par image : l'écrire à chaque pas enverrait des
   * dizaines d'écritures dans `user.sqlite` pour un seul geste, et `user.sqlite`
   * s'écrit de côté puis se renomme — c'est le fichier qu'on ne peut pas
   * retélécharger. Elle s'écrit une fois, quand les doigts se lèvent.
   */
  #applySize(value) {
    const size = clampSize(value);
    this.#prefs.size = size;
    this.#nodes.root.style.setProperty('--reader-size', `${size}px`);
    this.#nodes.sizeValue.textContent = String(size);
    this.#nodes.sizeSlider.value = String(size);
  }

  #setFont(key) {
    this.#prefs.font = key;
    for (const font of FONTS) {
      this.#nodes.root.classList.toggle(`reader--font-${font.key}`, font.key === key);
    }
    this.#nodes.fontButtons.forEach((button, index) => {
      const isActive = FONTS[index].key === key;
      button.classList.toggle('is-active', isActive);
      const check = button.querySelector('svg');
      if (isActive && !check) button.append(icon('check', { size: 16 }));
      if (!isActive && check) check.remove();
    });
    setSetting('reader.font', key);
  }

  // ------------------------------------------------------------- panneaux

  /** Les panneaux sont exclusifs : ouvrir l'un referme les autres. */
  #panelNodes() {
    return {
      settings: this.#nodes.panel,
      toc: this.#nodes.tocPanel,
      search: this.#nodes.searchPanel,
      annotations: this.#nodes.annotationsPanel,
    };
  }

  #togglePanel(which) {
    const panels = this.#panelNodes();
    const target = panels[which];
    if (!target) return;
    for (const [key, node] of Object.entries(panels)) {
      if (key !== which) node.classList.remove('is-open');
    }
    const opened = target.classList.toggle('is-open');
    this.#nodes.root.classList.toggle('has-panel', opened);
    if (opened && which === 'search') this.#nodes.searchField?.focus();
    if (opened && which === 'annotations') this.#drawAnnotations();
    // Le sommaire s'ouvre **sur** le chapitre qu'on lit, pas sur le début du
    // livre : c'est la première question qu'on lui pose.
    if (opened && which === 'toc') this.#nodes.focusToc?.();
  }

  #closePanels() {
    for (const node of Object.values(this.#panelNodes())) node.classList.remove('is-open');
    this.#nodes.root.classList.remove('has-panel');
  }

  #panelsOpen() {
    return Object.values(this.#panelNodes()).some((node) => node.classList.contains('is-open'));
  }

  /**
   * La fiche est posée sur `body` : un changement de route ne l'emporterait
   * pas, c'est au lecteur de la ranger quand il s'en va.
   *
   * Plus aucun outil ne l'ouvre — elle se consulte depuis `/settings`. Seule
   * la touche `؟` la déclenche encore, et qui a la touche a le clavier dont
   * elle parle.
   */
  #showShortcuts() {
    this.#closeShortcuts?.();
    this.#closeShortcuts = openShortcuts();
  }

  /**
   * Bascule la façon de lire, et la remonte.
   *
   * Les pages montées ne se recyclent pas d'un mode à l'autre : la feuille en
   * porte une, le fil en porte une fenêtre, et l'animation de feuilletage n'a
   * de sens que dans la première. On repart du rang courant, qui est la seule
   * chose qui compte de part et d'autre.
   */
  #setReadingMode(key) {
    const mode = resolveReadingMode(key);
    if (mode === this.#mode) return;
    setSetting('reader.mode', mode);
    this.#applyReadingMode(mode);
  }

  /**
   * Pose la façon de lire **sans l'écrire** : c'est le contrôle du panneau qui
   * écrit, comme partout ailleurs, et la touche `V` passe par `#setReadingMode`
   * qui écrit puis appelle ceci. Deux portes, une seule bascule.
   */
  #applyReadingMode(key) {
    const mode = resolveReadingMode(key);
    if (mode === this.#mode) return;
    this.#mode = mode;
    this.#nodes.root.classList.toggle('reader--page', mode === 'page');
    this.#nodes.root.classList.toggle('reader--scroll', mode === 'scroll');
    this.#blocks.clear();
    this.#nodes.flow.replaceChildren();
    this.#show(this.#index, { save: false });
  }

  #toggleFullscreen() {
    if (!this.#fullscreen) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  }

  #syncFullscreen() {
    const on = Boolean(document.fullscreenElement);
    const button = this.#nodes.fullscreenButton;
    if (!button) return;
    button.replaceChildren(icon(on ? 'fullscreenExit' : 'fullscreen', { size: 20 }));
    button.title = t(on ? 'reader.fullscreenExit' : 'reader.fullscreen');
  }

  // ------------------------------------------------------------ sélection

  /**
   * La page montée qui porte [node], ou `null`.
   *
   * Sur le fil, plusieurs pages sont montées à la fois : une sélection n'est
   * pas forcément sur celle qu'on compte comme courante, et c'est **la page qui
   * la porte** qui ancre l'annotation.
   */
  #blockOf(node) {
    for (const block of this.#blocks.values()) {
      if (block.body.contains(node)) return block;
    }
    return null;
  }

  #onSelection() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      this.#hideSelection();
      return;
    }

    // En fil continu la sélection n'est pas forcément sur la page courante :
    // c'est la page qui la porte qui ancre l'annotation.
    const block = this.#blockOf(selection.anchorNode);
    if (!block) return;

    // Mesurée maintenant : le premier clic dans le menu défait la sélection.
    this.#pendingSelection = describeSelection(block.body);
    if (!this.#pendingSelection) return;
    this.#pendingPage = block.page;

    const rect = selection.getRangeAt(0).getBoundingClientRect();
    if (!rect.width && !rect.height) return;

    const menu = this.#nodes.selection;
    menu.classList.add('is-open');
    // La feuille est ancrée dans le lecteur, lui-même en `fixed inset: 0` :
    // les coordonnées de la sélection s'y transposent telles quelles.
    const width = menu.offsetWidth || 256;
    const height = menu.offsetHeight || 260;
    const below = rect.bottom + 12 + height < window.innerHeight;
    menu.style.left = `${clamp(rect.left + rect.width / 2 - width / 2, 12, window.innerWidth - width - 12)}px`;
    menu.style.top = `${below ? rect.bottom + 12 : Math.max(12, rect.top - height - 12)}px`;
  }

  #hideSelection() {
    this.#nodes.selection?.classList.remove('is-open');
  }

  async #copySelection() {
    const text =
      window.getSelection()?.toString() || this.#pendingSelection?.selectedText || '';
    this.#hideSelection();
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
      toast(t('reader.copied'));
    } catch {
      toast(t('reader.copyFailed'));
    }
  }

  // -------------------------------------------------------- interactions

  /**
   * Ferme la couche la plus haute, et **une seule**. Rend `true` si quelque
   * chose s'est refermé.
   *
   * Une règle, deux portes : `Escape` au clavier et le geste retour d'Android.
   * Écrire la cascade deux fois, c'est la configuration qui a produit la police
   * orpheline et l'ambiance morte — sauf qu'ici la seconde copie divergerait
   * sur un appareil, là où personne ne la relit.
   *
   * Ce qu'elle ne fait **pas** : quitter le livre. `back()` reste le seul
   * propriétaire de la sortie, et le geste système la trouve tout seul quand
   * plus rien n'est à fermer.
   */
  #closeTopLayer() {
    // L'éditeur de note passe avant tout : il est ouvert par-dessus le reste,
    // et le refermer **est** le refus — rien n'aura été écrit.
    if (this.#noteSheetOpen()) {
      this.#settleNote(null);
      return true;
    }
    // La note est la couche la plus haute : c'est la dernière qu'on ait
    // ouverte, et la seule posée par-dessus le texte qu'on lisait.
    if (this.#footnoteOpen()) {
      this.#closeFootnote();
      return true;
    }
    if (this.#nodes.selection?.classList.contains('is-open')) {
      this.#hideSelection();
      return true;
    }
    if (this.#panelsOpen()) {
      this.#closePanels();
      return true;
    }
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
      return true;
    }
    return false;
  }

  #onKey(event) {
    if (event.key === 'Escape') {
      if (!this.#closeTopLayer()) back();
      return;
    }
    // Là où le plein écran n'est pas offert, la touche n'est pas non plus
    // interceptée : mieux vaut la laisser au système que l'avaler pour rien.
    if (event.key === 'F11' && this.#fullscreen) {
      event.preventDefault();
      this.#toggleFullscreen();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      if (!this.#nodes.searchPanel.classList.contains('is-open')) this.#togglePanel('search');
      else this.#nodes.searchField?.focus();
      return;
    }
    // Les raccourcis de navigation ne doivent pas voler la frappe du champ.
    if (event.target instanceof HTMLInputElement) return;
    if (event.target instanceof HTMLTextAreaElement) return;
    if (event.ctrlKey && (event.key === '+' || event.key === '=')) {
      event.preventDefault();
      this.#setSize(this.#prefs.size + 2);
      return;
    }
    if (event.ctrlKey && event.key === '-') {
      event.preventDefault();
      this.#setSize(this.#prefs.size - 2);
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    // Lettres nues : les gestes qu'on répète le plus, dits par la fiche « ؟ ».
    switch (event.key.toLowerCase()) {
      case 'b':
        event.preventDefault();
        this.#toggleBookmark();
        return;
      case 'n':
        event.preventDefault();
        this.#togglePanel('annotations');
        return;
      case 'c':
        event.preventDefault();
        this.#togglePanel('toc');
        return;
      case 'v':
        event.preventDefault();
        this.#setReadingMode(this.#mode === 'page' ? 'scroll' : 'page');
        return;
      case '?':
      case '؟':
        event.preventDefault();
        this.#showShortcuts();
        return;
      default:
        break;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      this.#show(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      this.#show(this.#pageCount - 1);
      return;
    }
    // Le feuilletage suit la direction de l'interface, comme les deux chevrons
    // de la barre basse : en arabe la page suivante est à gauche, en anglais à
    // droite. Une flèche figée ferait reculer le bouton qui avance.
    const forward = isRtl() ? 'ArrowLeft' : 'ArrowRight';
    const backward = isRtl() ? 'ArrowRight' : 'ArrowLeft';
    if (event.key === forward || event.key === 'PageDown') this.#move(1);
    if (event.key === backward || event.key === 'PageUp') this.#move(-1);
  }

  #onWheel(event) {
    if (!event.ctrlKey) return;
    event.preventDefault();
    this.#setSize(this.#prefs.size + (event.deltaY < 0 ? 1 : -1));
  }

  /**
   * Un clic sur le texte. Trois zones, et rien d'autre : le tiers où la ligne
   * **commence** ramène en arrière, celui où elle **finit** avance, le tiers du
   * milieu escamote les barres ou referme un panneau.
   *
   * Les gardes viennent d'abord, et leur ordre est celui des défauts vécus.
   */
  #onContentClick(event) {
    // Ce qui a déjà son geste : un bouton, un lien, un passage surligné (qui
    // ouvre sa note), la feuille des couleurs.
    if (event.target.closest('button, a, input, mark, .reader__selection')) return;

    // Une note en cours d'écriture ne se perd pas sur une tape. La feuille se
    // referme par « annuler », la croix, `Escape` ou le geste retour — tous
    // explicites, parce que refermer, ici, jette ce qu'on vient de taper. Et le
    // texte derrière ne tourne pas non plus : le geste ne fait rien.
    if (this.#noteSheetOpen()) return;

    // Un glissement laisse souvent un `click` derrière lui : la page a déjà
    // tourné, elle ne doit pas tourner deux fois pour un seul geste.
    if (this.#swiped) {
      this.#swiped = false;
      return;
    }

    // Une tape qui **défait** une sélection ne fait que cela. Elle ne tourne
    // pas la page et ne rappelle pas les barres : c'est le geste qu'on fait
    // pour revenir au texte.
    //
    // L'état vient du `pointerdown`, pas d'ici : le navigateur défait la
    // sélection entre `mousedown` et `mouseup`, et la lire maintenant montre
    // toujours du vide. C'est pour cela que les barres ressortaient à la
    // moindre touche sur le texte, et qu'on ne pouvait plus rien sélectionner.
    const pressee = this.#selectionAtPress;
    this.#selectionAtPress = false;
    if (pressee) {
      this.#hideSelection();
      return;
    }

    // Un cliquer-glisser qui s'achève sur le texte laisse sa sélection vivante :
    // celle-là se lit encore ici, et l'interface ne doit pas bouger.
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    this.#hideSelection();
    this.#hideHint();

    // Une note ouverte se referme comme un panneau : au premier contact avec le
    // texte, et sans rien faire d'autre.
    if (this.#footnoteOpen()) {
      this.#closeFootnote();
      return;
    }

    // Un panneau ouvert se referme au premier contact avec le texte, où qu'on
    // touche : sa croix est à l'autre bout de l'écran, et revenir au livre est
    // de toute façon le geste qu'on fait ensuite. Tourner la page sous un
    // panneau ouvert ferait deux choses pour un seul geste.
    if (this.#panelsOpen()) {
      this.#closePanels();
      return;
    }

    const zone = this.#zoneOf(event.clientX);
    if (zone) {
      this.#move(zone);
      return;
    }

    this.#nodes.header.classList.toggle('is-hidden');
    this.#nodes.footer.classList.toggle('is-hidden');
  }

  /**
   * Le tiers de la colonne où tombe [clientX] : `-1` en arrière, `1` en avant,
   * `0` au milieu. La mesure est physique — le navigateur ne connaît que des
   * pixels depuis le bord gauche — et c'est `turnZone` qui la rend logique.
   */
  #zoneOf(clientX) {
    // Sur le fil, on ne tourne pas : on défile. Les trois tiers redeviennent un
    // seul, et toucher le bord escamote les barres — le geste qui fait passer
    // d'une page à l'autre est le défilement, et lui seul.
    if (this.#mode === 'scroll') return 0;
    // Les côtés peuvent avoir été éteints depuis `/settings`. Le refus est posé
    // ici et non dans le clic : les trois tiers redeviennent alors un seul, et
    // toucher le bord escamote les barres au lieu de ne rien faire du tout —
    // une zone morte demanderait deux fois avant qu'on la croie voulue.
    if (this.#prefs.tapZones === 'off') return 0;
    const rect = this.#nodes.scroll.getBoundingClientRect();
    if (!rect.width) return 0;
    return turnZone((clientX - rect.left) / rect.width, isRtl());
  }

  /**
   * Départ d'un glissement.
   *
   * Le doigt et le stylet seulement : à la souris, un déplacement horizontal
   * sur du texte est une sélection, et tourner la page dessus rendrait le
   * texte insélectionnable. La souris a les trois zones, les deux chevrons et
   * les flèches du clavier — elle ne manque de rien.
   *
   * Un geste qui commence sur une sélection vivante est abandonné d'avance :
   * les poignées natives de sélection avalent les évènements tactiles
   * (`docs/spikes/react-native-contre-webview.md`), et ce qu'on croirait lire
   * serait un geste tronqué.
   */
  #onPointerDown(event) {
    // Le doigt est retenu avant toute garde : un second doigt n'est pas un
    // second glissement, mais c'est lui qui fait le pincement, et les gardes du
    // glissement l'auraient renvoyé sans le compter.
    if (event.pointerType !== 'mouse') {
      // Un doigt levé **hors** de la colonne n'y laisse pas de `pointerup` : il
      // resterait sur la carte, et le geste suivant croirait voir deux doigts.
      // Le premier doigt d'un geste est le seul instant sûr pour oublier ceux
      // qui traînent — et pour écrire la taille que le précédent avait posée.
      if (event.isPrimary) {
        this.#endPinch();
        this.#pointers.clear();
      }
      this.#pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.#pointers.size === 2) this.#startPinch();
    }
    this.#swipeFrom = null;
    // La trace du glissement précédent s'efface ici, et non au clic : un
    // glissement n'en laisse pas toujours un, et le drapeau resté levé aurait
    // avalé le prochain clic — celui d'un geste qui n'a rien à voir.
    this.#swiped = false;
    if (!event.isPrimary || event.pointerType === 'mouse') return;
    if (this.#selectionAtPress) return;
    this.#swipeFrom = { x: event.clientX, y: event.clientY, id: event.pointerId };
  }

  /**
   * Fin d'un glissement. `swipeTurn` dit s'il tourne quelque chose, et de quel
   * côté : trop court, trop vertical — c'est un défilement dans la page — ou
   * bien la page suit le sens où le texte s'écoule.
   */
  #onPointerUp(event) {
    const from = this.#swipeFrom;
    this.#swipeFrom = null;
    if (!from || event.pointerId !== from.id) return;
    // Une sélection posée par le geste n'est pas un glissement de page.
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;

    // Même règle que les trois tiers : sur le fil, le doigt défile, il ne
    // chasse pas la page. Un glissement horizontal y serait un geste de plus
    // pour faire ce que le défilement fait déjà.
    if (this.#mode === 'scroll') return;
    const sens = swipeTurn(event.clientX - from.x, event.clientY - from.y, isRtl());
    if (!sens) return;
    this.#swiped = true;
    this.#move(sens);
  }

  /**
   * Un doigt se lève, ou le navigateur reprend son pointeur.
   *
   * C'est ici que le pincement s'écrit, et une seule fois : dès qu'il ne reste
   * plus deux doigts, il n'y a plus de rapport à mesurer.
   */
  #endPointer(event) {
    this.#pointers.delete(event.pointerId);
    if (this.#pointers.size < 2) this.#endPinch();
  }

  /** Le pincement s'achève, et c'est le seul endroit où sa taille s'écrit. */
  #endPinch() {
    if (!this.#pinch) return;
    this.#pinch = null;
    setSetting('reader.fontSize', this.#prefs.size);
  }

  /**
   * Deux doigts posés : on retient l'écartement de départ **et** la taille de
   * départ. Le geste se mesure en rapport à ces deux-là, jamais au pas
   * précédent — cumuler les pas ferait dériver la taille sans que les doigts
   * bougent, chaque arrondi s'ajoutant au suivant.
   */
  #startPinch() {
    const spread = this.#spread();
    if (spread < PINCH_MIN_SPREAD) return;
    this.#pinch = { spread, size: this.#prefs.size };
    // Un pincement n'est pas un glissement : le geste ne peut pas tourner la
    // page en même temps qu'il change la lettre.
    this.#swipeFrom = null;
    this.#hideSelection();
  }

  /**
   * Le pincement en cours. La taille suit les doigts sans rien écrire —
   * `#endPointer` s'en charge quand ils se lèvent.
   */
  #onPointerMove(event) {
    const point = this.#pointers.get(event.pointerId);
    if (!point) return;
    point.x = event.clientX;
    point.y = event.clientY;
    if (!this.#pinch) return;
    const spread = this.#spread();
    if (!spread) return;
    // Le `click` que laisse le geste ne doit pas tourner la page, comme celui
    // que laisse un glissement.
    this.#swiped = true;
    this.#applySize(pinchSize(this.#pinch.size, spread / this.#pinch.spread));
  }

  /** L'écartement des deux premiers doigts posés, en pixels. */
  #spread() {
    const [a, b] = [...this.#pointers.values()];
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  /**
   * Le défilement **dans** une page : une feuille imprimée dépasse souvent la
   * hauteur de l'écran. Il n'y a rien d'autre à y faire que d'escamoter les
   * barres en descendant et de les rappeler en remontant.
   */
  #onScroll(scroll) {
    const top = scroll.scrollTop;
    this.#hideSelection();
    this.#scheduleAnchor();
    // Sur le fil, défiler *est* tourner la page : la page courante se déduit de
    // ce qu'on a sous les yeux, et la fenêtre se recentre derrière.
    if (this.#mode === 'scroll') this.#followScroll();
    if (top > 100 && top > this.#nodes.lastScroll) {
      this.#nodes.header.classList.add('is-hidden');
      this.#nodes.footer.classList.add('is-hidden');
    } else if (top < this.#nodes.lastScroll) {
      this.#showChrome();
    }
    this.#nodes.lastScroll = top;
  }

  #showChrome() {
    this.#nodes.header?.classList.remove('is-hidden');
    this.#nodes.footer?.classList.remove('is-hidden');
  }

  #hideHint() {
    clearTimeout(this.#hintTimer);
    this.#nodes.hint?.classList.add('is-gone');
  }
}

function clamp(value, min, max) {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}
