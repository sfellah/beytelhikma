/**
 * Le seul fichier du rendu qui change pour Capacitor.
 *
 * `src/renderer/js/repository.js` est la seule porte du rendu vers le pont
 * Electron : toutes les vues importent depuis lui, et lui seul touche
 * `window.beytelhikma`. Le remplacer par ce fichier, c'est porter l'application
 * sans toucher une vue — `prepare-www.mjs` le dépose à la place de
 * `www/js/repository.js`.
 *
 * La surface est la même : `repository`, `onDownloadsChanged`, `settings`,
 * `setSetting`. Le contenu, lui, est une tranche : accueil → fiche → lecteur.
 * Tout le reste lève `not-ported`, et se voit donc à l'écran — les vues gèrent
 * déjà l'état `error` — au lieu de produire un écran blanc.
 *
 * Le SQL est **repris de `src/main/book-repository.js` sans être réécrit** :
 * c'est du SQL, il ne change pas de moteur en changeant de client.
 */

/**
 * `shared/arabic.js` se charge à la demande, par URL calculée depuis
 * `import.meta.url`.
 *
 * Le recopier serait la faute que le projet a déjà payée : `arabic.js` est le
 * reflet exact de `normalize_ar` de `tools/_common.py`, et c'est ce contrat qui
 * a produit les colonnes `body_search` et `title_normalized`. Une seconde
 * implémentation divergerait en silence et dégraderait la recherche sans qu'un
 * test échoue.
 *
 * Mais ce fichier vit dans **deux arbres** : `src/repository.capacitor.js`, où
 * `scripts/verify.mjs` le charge pour compter sa surface, et `www/js/`, où il
 * s'exécute réellement à côté de `www/shared/`. Un `import` statique devrait
 * être résoluble dans les deux, ce qu'aucun chemin relatif ne peut être. Un
 * chargement différé ne l'est qu'au moment où l'on cherche — c'est-à-dire dans
 * `www/`, où `../shared/arabic.js` est la vérité littérale.
 */
let arabePromise = null;

import { creerMethodesCatalogue } from './repo/catalogue-plus.js';
import { creerMethodesPolices } from './repo/polices.js';
import { creerMethodesTelechargements } from './repo/telechargements.js';
import { creerMethodesUtilisateur } from './repo/utilisateur.js';
import { creerPlanteurGraine } from './repo/graine.js';
import { brancherRetour } from './repo/retour.js';

function arabe() {
  arabePromise ??= import(new URL('../shared/arabic.js', import.meta.url).href).catch((erreur) => {
    // Un échec ne se met pas en cache : la recherche suivante doit retenter.
    arabePromise = null;
    throw erreur;
  });
  return arabePromise;
}

// ---------------------------------------------------------------- la surface

/**
 * Les 69 noms de `src/preload/preload.cjs`, recopiés dans l'ordre.
 *
 * Le compte se lit dans le fichier, il ne se décide pas d'avance : c'est
 * `scripts/verify.mjs` qui relit cette liste-là dans le preload et compare. Une
 * méthode ajoutée d'un seul côté ne casse rien au démarrage, elle échoue au
 * premier clic — c'est le test de parité que le projet a déjà
 * (`test/repository.test.js`), transposé au spike.
 */
const METHODS = [
  'installFont',
  'listFonts',
  'removeFont',
  'getCategories',
  'getTopCategories',
  'getRecentBooks',
  'getPopularBooks',
  'getBooks',
  'getBooksByCategory',
  'getBookDetail',
  'getRelatedBooks',
  'getFeaturedAuthor',
  'getAuthors',
  'getAuthorStats',
  'getBooksIn',
  'getEras',
  'getUndatedCount',
  'getBooksByCentury',
  'getBooksByAuthor',
  'getToc',
  'getPageCount',
  'getPages',
  'getPageById',
  'getLibrary',
  'getContinueReading',
  'getProgress',
  'saveProgress',
  'getSettings',
  'saveSetting',
  'downloadBook',
  'cancelDownload',
  'retryDownload',
  'deleteBook',
  'getDownloads',
  'clearFailedDownloads',
  'getStorageUsage',
  'exploreBooks',
  'getFacets',
  'suggestValues',
  'getSelectionWeight',
  'downloadSelection',
  'searchInBook',
  'getCollections',
  'createCollection',
  'renameCollection',
  'deleteCollection',
  'addToCollection',
  'removeFromCollection',
  'getCollectionBooks',
  'getCollectionMembership',
  'getCurricula',
  'getCurriculum',
  'deleteAllBooks',
  'setDownloadBaseUrl',
  'checkCatalogUpdate',
  'installCatalogUpdate',
  'declineCatalogUpdate',
  'getAbout',
  'getBookAnnotations',
  'getAnnotations',
  'saveHighlight',
  'deleteHighlight',
  'saveNote',
  'deleteNote',
  'toggleBookmark',
  'deleteBookmark',
  'searchLibrary',
  'getManagedBooks',
  'deleteBooks',
];

/**
 * Erreur remontée à l'interface, comme `book-repository.js` : message lisible —
 * `errorView` affiche `error.message` tel quel — plus un code que le panneau de
 * mesures et les tests peuvent trier. Trois codes, pas un de plus :
 * `not-ported`, `db-missing`, `query-failed`.
 */
export class RepositoryError extends Error {
  constructor(what, code, cause) {
    super(`Échec : ${what}`);
    this.name = 'RepositoryError';
    this.what = what;
    this.code = code;
    this.cause = cause;
  }
}

/**
 * Enveloppe une lecture. Une `RepositoryError` déjà typée traverse intacte :
 * la ré-emballer remplacerait `db-missing` — qui dit exactement quoi faire —
 * par un `query-failed` générique.
 */
async function garde(what, run) {
  try {
    return await run();
  } catch (error) {
    if (error instanceof RepositoryError) throw error;
    throw new RepositoryError(what, 'query-failed', error);
  }
}

// ------------------------------------------------------------- les mesures

/**
 * Un chronomètre par mesure. La sonde est facultative — `probe.js` peut ne pas
 * être chargé, et le shim doit marcher sans lui —, d'où l'appel défensif.
 */
function chrono() {
  const depart = performance.now();
  return (label, detail) => {
    globalThis.__probe?.record(label, performance.now() - depart, detail ?? '');
  };
}

// -------------------------------------------------------- le pont Capacitor

/**
 * Les greffons se prennent sur `globalThis.Capacitor.Plugins`, jamais par
 * `import`. C'est un blocage, pas une préférence.
 *
 * Le rendu n'a **pas de bundler** : `index.html` charge des
 * `<script type="module">` servis à plat, et `cap sync` ne copie que `www/`.
 * Importer le paquet du greffon par son nom donnerait un spécificateur nu,
 * qu'aucun navigateur ne résout — écran blanc au chargement. Une
 * `<script type="importmap">` en ligne n'est pas une sortie non plus : le CSP
 * est `script-src 'self'`, l'admettre demanderait `'unsafe-inline'`.
 * (`prepare-www.mjs` refuse d'ailleurs tout spécificateur nu dans ce fichier —
 * le nommer ici en toutes lettres ferait sonner sa garde pour rien.)
 *
 * Le pont natif, lui, injecte `window.Capacitor` dans chaque page qu'il sert et
 * y publie chaque greffon sous le nom de son annotation
 * (`@CapacitorPlugin(name = "CapacitorSQLite")`). On travaille donc avec la
 * couche **brute** — l'interface `CapacitorSQLitePlugin` de
 * `dist/esm/definitions.d.ts`, celle qui prend et rend des objets simples — et
 * non avec la classe d'enrobage `SQLiteConnection`, qui demanderait un bundler.
 */
function pont() {
  return globalThis.Capacitor?.Plugins ?? null;
}

/**
 * Le pont peut n'être pas encore posé au premier tour de boucle. On lui laisse
 * quelques trames plutôt que de conclure trop vite : un écran blanc sans
 * explication est le pire résultat possible, et l'absence du pont doit se dire
 * en toutes lettres, pas se deviner.
 */
let pontPromise = null;

function attendrePont() {
  pontPromise ??= (async () => {
    for (let essai = 0; essai < 40; essai += 1) {
      const plugins = pont();
      if (plugins?.CapacitorSQLite && plugins?.Filesystem) return plugins;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new RepositoryError(
      "l'application ne tourne pas dans Capacitor : ni CapacitorSQLite ni " +
        'Filesystem ne sont publiés sur window.Capacitor.Plugins',
      'db-missing',
    );
  })();
  return pontPromise;
}

function sqlite() {
  const plugin = pont()?.CapacitorSQLite;
  if (!plugin) {
    throw new RepositoryError(
      "greffon CapacitorSQLite absent : l'application ne tourne pas dans Capacitor",
      'db-missing',
    );
  }
  return plugin;
}

function filesystem() {
  const plugin = pont()?.Filesystem;
  if (!plugin) {
    throw new RepositoryError(
      "greffon Filesystem absent : l'application ne tourne pas dans Capacitor",
      'db-missing',
    );
  }
  return plugin;
}

/** Valeur de `Directory.External` — l'énumération ne s'importe pas sans bundler. */
const REPERTOIRE_EXTERNE = 'EXTERNAL';
/** Valeur de `Encoding.UTF8`. */
const UTF8 = 'utf8';

/** Le dossier poussé sur l'appareil par `scripts/fetch-real-data.mjs`. */
const RACINE = 'beytelhikma';

/**
 * `getUri` rend une URI (`file:///storage/emulated/0/…`), les méthodes NC
 * veulent un chemin de fichier nu : `createNCConnection` fait
 * `new File(dbPath)`, un préfixe `file://` en ferait un chemin relatif
 * introuvable. Le chemin peut de surcroît être percent-encodé.
 */
function cheminDepuisUri(uri) {
  const brut = String(uri ?? '').replace(/^file:\/\//, '');
  try {
    return decodeURIComponent(brut);
  } catch {
    return brut;
  }
}

/**
 * Racine des données sur l'appareil, résolue une fois.
 *
 * `getNCDatabasePath` ne peut **pas** servir ici : sur Android il ne résout que
 * `default`, `cache`, `files/…` et `databases/…`, tous sous le stockage interne
 * (`UtilsMigrate.getFolder`). Le répertoire externe de l'application —
 * `Android/data/<paquet>/files`, celui où `adb push` dépose sans root — ne fait
 * partie d'aucun de ces cas. On passe donc par `Filesystem.getUri`, et
 * `getNCDatabasePath` ne reste que comme second candidat, pour le cas où les
 * fichiers auraient été poussés en interne.
 */
let racinePromise = null;

/**
 * Pose `beytelhikma/books/` au nom de l'application.
 *
 * Sous le stockage cloisonné d'Android, un dossier appartient à qui l'a créé.
 * Un dossier posé par `adb shell mkdir` reste au shell, et l'application ne
 * peut plus le **traverser** — alors qu'un simple *fichier* déposé par adb
 * reste, lui, parfaitement lisible. D'où un défaut qui ne se voit pas : le
 * catalogue, posé à plat, s'ouvre ; le livre, en sous-dossier, est déclaré
 * absent, et la fiche affiche un `null` sans rien expliquer.
 *
 * L'application est donc le seul créateur légitime, et elle le fait avant
 * toute lecture. `recursive` rend l'appel inoffensif si le dossier est déjà là.
 */
async function assureDossiers(fs, racine) {
  for (const dossier of [RACINE, `${RACINE}/books`]) {
    try {
      await fs.mkdir({ path: dossier, directory: REPERTOIRE_EXTERNE, recursive: true });
    } catch {
      // Déjà présent — le cas courant, et le seul qu'on attende ici.
    }
  }
  return racine;
}

function racineAppareil() {
  racinePromise ??= (async () => {
    // Toute lecture passe par ici : c'est le seul endroit où attendre le pont.
    await attendrePont();
    const fs = filesystem();
    await assureDossiers(fs);
    const essais = [
      { directory: REPERTOIRE_EXTERNE, path: RACINE },
      { directory: REPERTOIRE_EXTERNE, path: '' },
    ];
    for (const essai of essais) {
      try {
        const { uri } = await fs.getUri(essai);
        if (!uri) continue;
        // `getUri` rend parfois le dossier avec sa barre finale : la garder
        // produisait des chemins en `beytelhikma//catalog.sqlite`. SQLite les
        // tolère, mais ils partent tels quels dans les rapports de mesure.
        const chemin = cheminDepuisUri(uri).replace(/\/+$/, '');
        return essai.path ? chemin : `${chemin}/${RACINE}`;
      } catch {
        // Candidat suivant : `getUri` refuse un dossier absent selon la version.
      }
    }
    // Dernier recours : le stockage interne, seul endroit que la famille NC
    // sache nommer elle-même.
    const { path } = await sqlite().getNCDatabasePath({
      path: `files/${RACINE}`,
      database: '',
    });
    if (!path) {
      throw new RepositoryError(
        `données introuvables sur l'appareil (dossier « ${RACINE} »)`,
        'db-missing',
      );
    }
    return path.replace(/\/$/, '');
  })();
  return racinePromise;
}

/**
 * Le manifeste dit **quelle** édition a été poussée. Le coder en dur ferait du
 * shim un compagnon d'un livre précis ; le lire le rend indépendant du choix
 * qu'a fait `fetch-real-data.mjs`.
 *
 * Deux emplacements sont tentés parce que le script écrit localement dans
 * `data/` et pousse le contenu sous `beytelhikma/` : selon qu'il pousse le
 * dossier ou son contenu, le manifeste atterrit à l'un ou à l'autre.
 */
let manifestePromise = null;

function manifeste() {
  manifestePromise ??= (async () => {
    await attendrePont();
    const fs = filesystem();
    const candidats = [
      `${RACINE}/manifest.json`,
      `${RACINE}/data/manifest.json`,
      'manifest.json',
    ];
    for (const path of candidats) {
      try {
        const { data } = await fs.readFile({
          directory: REPERTOIRE_EXTERNE,
          path,
          encoding: UTF8,
        });
        const lu = JSON.parse(typeof data === 'string' ? data : await data.text());
        const editionId = lu.editionId ?? lu.edition_id ?? null;
        return { ...lu, editionId, source: path };
      } catch {
        // Candidat suivant.
      }
    }
    throw new RepositoryError(
      `manifeste introuvable (essayé : ${candidats.join(', ')})`,
      'db-missing',
    );
  })();
  return manifestePromise;
}

// ------------------------------------------------------ connexions SQLite NC

/**
 * Un identifiant d'édition vient d'un fragment d'URL et désigne un **nom de
 * fichier** : `books/<edition_id>.sqlite`. La règle est celle de
 * `src/main/edition-id.js`, point exclu compris — l'admettre laisserait passer
 * `..`, qui est précisément ce qu'on refuse.
 */
const EDITION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function assertEditionId(value) {
  const id = String(value ?? '');
  if (!EDITION_ID.test(id)) {
    throw new RepositoryError(`identifiant d'édition invalide : ${id}`, 'db-missing');
  }
  return id;
}

/** Chemins des connexions ouvertes, pour ne jamais en créer deux fois la même. */
const ouvertes = new Set();

/**
 * Ouvre une base non conforme et rend son chemin, qui sert ensuite de clé aux
 * appels `query`. Deux étapes, pas une : `createNCConnection` enregistre la
 * connexion, `open` ouvre le fichier — en lecture seule, puisque la connexion
 * NC est créée `readonly`.
 */
async function ouvrir(chemin) {
  if (ouvertes.has(chemin)) return chemin;
  const plugin = sqlite();

  const { result } = await plugin.isNCDatabase({ databasePath: chemin });
  if (!result) {
    throw new RepositoryError(`fichier absent de l'appareil : ${chemin}`, 'db-missing');
  }

  await plugin.createNCConnection({ databasePath: chemin, version: 1 });
  ouvertes.add(chemin);
  // `open` prend le chemin comme nom de base : `getDatabaseName` laisse intact
  // tout ce qui contient une barre, la clé reste donc la même des deux côtés.
  await plugin.open({ database: chemin, readonly: true });
  return chemin;
}

/**
 * Referme. `closeNCConnection` ferme le fichier **et** retire la connexion du
 * dictionnaire natif : un `close` séparé ferait doublon et lèverait.
 */
async function fermer(chemin) {
  if (!ouvertes.has(chemin)) return;
  ouvertes.delete(chemin);
  try {
    await sqlite().closeNCConnection({ databasePath: chemin });
  } catch {
    // Une fermeture qui échoue ne doit pas empêcher d'en ouvrir une autre.
  }
}

/**
 * Toutes les lectures passent par là. `values` est obligatoire côté natif, même
 * vide ; `readonly` doit valoir la valeur donnée à la connexion, sinon le
 * greffon cherche `RW_<chemin>` et ne trouve rien.
 */
async function interroger(chemin, sql, params = []) {
  const reponse = await sqlite().query({
    database: chemin,
    statement: sql,
    values: params,
    readonly: true,
    isSQL92: true,
  });
  const lignes = reponse?.values ?? [];
  // iOS place ses noms de colonnes en tête du tableau ; l'enrobage ESM le
  // retire, et on ne passe pas par lui.
  return lignes.length && lignes[0]?.ios_columns ? lignes.slice(1) : lignes;
}

const all = (chemin, sql, params = []) => interroger(chemin, sql, params);

async function first(chemin, sql, params = []) {
  const lignes = await interroger(chemin, sql, params);
  return lignes[0] ?? null;
}

// ------------------------------------------------- la base de l'utilisateur

/**
 * `user.sqlite` ne passe **pas** par la famille NC, et c'est délibéré.
 *
 * Les méthodes NC ouvrent en lecture seule : elles servent à lire des fichiers
 * étrangers, posés là par quelqu'un d'autre — le catalogue et les livres, que
 * l'application ne fait que consommer. `user.sqlite` est l'inverse : c'est
 * notre base, la seule qu'on écrive, et la seule qu'aucun téléchargement ne
 * puisse reconstruire. Elle emprunte donc l'API ordinaire du greffon, avec son
 * dossier et sa convention de nom, où elle est en lecture-écriture.
 *
 * La conséquence pratique compte : elle vit dans le stockage **interne** de
 * l'application, hors de portée d'`adb push`, et elle survit à une purge des
 * fichiers externes.
 */
const BASE_UTILISATEUR = 'user';

let utilisateurPromise = null;

async function ouvrirUtilisateur() {
  utilisateurPromise ??= (async () => {
    await attendrePont();
    const plugin = sqlite();
    const consistance = await plugin.checkConnectionsConsistency({
      dbNames: [BASE_UTILISATEUR],
      openModes: ['no-encryption'],
    });
    if (!consistance?.result) {
      await plugin.createConnection({
        database: BASE_UTILISATEUR,
        encrypted: false,
        mode: 'no-encryption',
        version: 1,
        readonly: false,
      });
    }
    await plugin.open({ database: BASE_UTILISATEUR, readonly: false });
    return BASE_UTILISATEUR;
  })();
  return utilisateurPromise;
}

/** Lecture dans `user.sqlite` — `readonly: false`, la connexion l'étant. */
async function interrogerUtilisateur(sql, params = []) {
  const base = await ouvrirUtilisateur();
  const reponse = await sqlite().query({
    database: base,
    statement: sql,
    values: params,
    readonly: false,
    isSQL92: true,
  });
  const lignes = reponse?.values ?? [];
  return lignes.length && lignes[0]?.ios_columns ? lignes.slice(1) : lignes;
}

const allUser = (sql, params = []) => interrogerUtilisateur(sql, params);

async function firstUser(sql, params = []) {
  return (await interrogerUtilisateur(sql, params))[0] ?? null;
}

/** Écriture unitaire. Rend le nombre de lignes touchées et le dernier `rowid`. */
async function executerUtilisateur(sql, params = []) {
  const base = await ouvrirUtilisateur();
  const reponse = await sqlite().run({
    database: base,
    statement: sql,
    values: params,
    transaction: false,
    readonly: false,
    isSQL92: true,
  });
  return {
    changes: reponse?.changes?.changes ?? 0,
    lastId: reponse?.changes?.lastId ?? null,
  };
}

/** DDL et lots. `execute` ne prend pas de paramètres : n'y mettre que du SQL fixe. */
async function executerBrut(sql) {
  const base = await ouvrirUtilisateur();
  await sqlite().execute({ database: base, statements: sql, transaction: false, readonly: false });
}

// --------------------------------------------------------------- la graine

/**
 * Lit la graine embarquée : `www/assets/catalog.sqlite.zst`, posée là par
 * `prepare-www.mjs` depuis le cache `data/` que `scripts/fetch-seed.mjs`
 * remplit au build. Capacitor sert `www/` depuis `https://localhost`, la même
 * origine que la page : `connect-src 'self'` couvre ce `fetch`. Un montage
 * antérieur, sans graine, répond 404 — l'erreur remonte typée et l'écran la
 * dit, au lieu du rien silencieux d'avant.
 */
async function chargerGraine() {
  const url = new URL('../assets/catalog.sqlite.zst', import.meta.url).href;
  const reponse = await fetch(url, { cache: 'no-store' });
  if (!reponse.ok) {
    throw new RepositoryError(
      `graine de catalogue absente de l'application (HTTP ${reponse.status})`,
      'db-missing',
    );
  }
  return new Uint8Array(await reponse.arrayBuffer());
}

const planterGraine = creerPlanteurGraine({
  RepositoryError,
  chrono,
  filesystem,
  sqlite,
  decompressZstd,
  chargerGraine,
});

// ------------------------------------------------------------- le catalogue

let cataloguePromise = null;

/**
 * `catalog.sqlite` : 28,8 Mo, 8 568 éditions. La promesse est mémorisée, pas
 * son résultat — l'accueil lance sept lectures d'un coup, et mémoriser après
 * coup ouvrirait sept fois la même base.
 */
function catalogue() {
  if (cataloguePromise) return cataloguePromise;
  const promesse = (async () => {
    const racine = await racineAppareil();
    const chemin = `${racine}/catalog.sqlite`;
    // Premier lancement : l'APK embarque la graine de catalogue, et elle ne se
    // plante que si `catalog.sqlite` est absent — la raison est dans
    // `repo/graine.js`, c'est la règle d'`AppDatabase.#plantSeed`.
    await planterGraine(racine);
    const fin = chrono();
    await ouvrir(chemin);
    fin('catalogue:ouverture', chemin);
    // Le verdict FTS5 se prend une fois, à l'ouverture : c'est la mesure qui
    // décide du portage, elle ne doit pas dépendre d'un clic. Attendu, et non
    // lancé de côté : deux requêtes concurrentes sur la même connexion native
    // rendraient la première mesure illisible.
    await sonderFts(chemin, 'catalog_fts', 'edition_id').catch(() => {});
    return chemin;
  })();
  // Une ouverture ratée ne doit pas rester en cache : la suivante retenterait
  // la même promesse rejetée jusqu'au redémarrage.
  promesse.catch(() => {
    if (cataloguePromise === promesse) cataloguePromise = null;
  });
  cataloguePromise = promesse;
  return promesse;
}

// ---------------------------------------------------------------- les livres

/** Un seul livre ouvert à la fois : sql.js n'est plus là, mais la mémoire si. */
let livreCourant = null;
let livrePromise = null;

function livre(editionId) {
  const id = assertEditionId(editionId);
  if (livreCourant === id && livrePromise) return livrePromise;

  const precedentePromesse = livreCourant === id ? null : livrePromise;
  const promesse = (async () => {
    if (precedentePromesse) {
      const ancien = await precedentePromesse.catch(() => null);
      if (ancien) await fermer(ancien);
    }
    const racine = await racineAppareil();
    const chemin = `${racine}/books/${id}.sqlite`;
    const fin = chrono();
    await ouvrir(chemin);
    fin('livre:ouverture', id);
    await sonderFts(chemin, 'pages_fts', 'rowid').catch(() => {});
    return chemin;
  })();
  promesse.catch(() => {
    if (livrePromise === promesse) {
      livreCourant = null;
      livrePromise = null;
    }
  });
  livreCourant = id;
  livrePromise = promesse;
  return promesse;
}

/** Le fichier est-il là ? Sans l'ouvrir : la fiche doit rester lisible sans lui. */
async function livreInstalle(editionId) {
  if (!EDITION_ID.test(String(editionId ?? ''))) return false;
  try {
    const racine = await racineAppareil();
    const { result } = await sqlite().isNCDatabase({
      databasePath: `${racine}/books/${editionId}.sqlite`,
    });
    return Boolean(result);
  } catch {
    return false;
  }
}

/**
 * Ce que `#withDownloadStatus` fait dans `book-repository.js` : poser le statut
 * d'installation sur une page de résumés. Ici il n'y a pas de `user.sqlite`,
 * seule l'édition poussée est installée — mais les cartes de livre lisent
 * `downloadStatus`, et le laisser indéfini les montrerait toutes identiques.
 */
async function marquerInstalles(resumes) {
  if (!resumes.length) return resumes;
  const pousse = await manifeste()
    .then((m) => m.editionId)
    .catch(() => null);
  for (const livreResume of resumes) {
    livreResume.downloadStatus = livreResume.editionId === pousse ? 'installed' : null;
  }
  return resumes;
}

// -------------------------------------------------------------- verdict FTS5

/**
 * Le point décisif du spike, resserré à ce qui reste inconnu.
 *
 * Le build sql.js d'Electron ne contient pas FTS5 : `catalog_fts` et
 * `pages_fts` sont produites par le pipeline et illisibles par l'application,
 * qui se rabat sur des `LIKE`. Le moteur du greffon Capacitor, lui, sait faire
 * — c'est SQLCipher 4.10.0, et `libsqlcipher.so` porte `fts5`, `bm25`,
 * `highlight` et `snippet` ; les fichiers réels répondent à `MATCH` hors de
 * l'appareil. La question qui reste est donc plus étroite : la **couche
 * JavaScript du greffon** laisse-t-elle passer une requête `MATCH` jusqu'au
 * moteur ? Elle réécrit et analyse les instructions au passage
 * (`UtilsSQLStatement`), et c'est là que ça peut se perdre.
 *
 * Le message d'erreur est conservé mot pour mot : c'est lui qui distingue une
 * table absente d'un refus de la couche. Et parce qu'un message peut être
 * maquillé par les couches natives, on lit aussi `sqlite_master` — une table
 * déclarée mais illisible désigne le chemin d'appel, pas les données.
 */
const verdictsFts = new Map();

async function sonderFts(chemin, table, colonne) {
  if (verdictsFts.has(table)) return verdictsFts.get(table);

  const fin = chrono();
  let declaree = null;
  try {
    declaree = Boolean(
      await first(chemin, 'SELECT name FROM sqlite_master WHERE name = ? LIMIT 1', [table]),
    );
  } catch {
    declaree = null;
  }

  let verdict;
  try {
    const lignes = await all(
      chemin,
      `SELECT ${colonne} AS ref FROM ${table} WHERE ${table} MATCH ? LIMIT 5`,
      ['"كتاب"'],
    );
    verdict = { table, ok: true, detail: `MATCH ok — ${lignes.length} ligne(s)` };
  } catch (error) {
    const message = String(error?.message ?? error);
    verdict = {
      table,
      ok: false,
      detail:
        `échec — ${message}` +
        (declaree === null ? '' : declaree ? ' [table déclarée]' : ' [table absente]'),
    };
  }

  verdictsFts.set(table, verdict);
  fin(`fts5:${table}`, verdict.detail);
  // Une ligne de synthèse : c'est elle qu'on recopie dans le compte rendu.
  globalThis.__probe?.record(
    'fts5',
    0,
    [...verdictsFts.values()]
      .map((v) => `${v.table} ${v.ok ? 'ok' : 'ko'}`)
      .join(' · '),
  );
  return verdict;
}

// --------------------------------------------------- projections (verbatim)

/**
 * Projection commune « carte de livre ». Recopiée de `book-repository.js` :
 * c'est la forme que les vues attendent, pas une forme qu'on choisit ici.
 */
const SUMMARY_SELECT = `
  SELECT e.edition_id,
         e.work_id,
         e.title_ar,
         e.subtitle_ar,
         e.category_id,
         e.book_type_label,
         e.volume_count,
         e.language,
         e.cover_url,
         c.label_ar                                AS category_label,
         COALESCE(a.short_name_ar, a.full_name_ar) AS author_name,
         a.death_year_hijri                        AS author_death_year,
         r.page_count                              AS page_count,
         r.published_at                            AS published_at
  FROM editions e
  LEFT JOIN categories c       ON c.category_id = e.category_id
  LEFT JOIN edition_authors ea ON ea.edition_id = e.edition_id AND ea.role = 'author'
  LEFT JOIN authors a          ON a.author_id = ea.author_id
  LEFT JOIN book_releases r    ON r.edition_id = e.edition_id AND r.is_active = 1
  WHERE e.is_hidden = 0
`;

const bookSummary = (row) => ({
  editionId: row.edition_id,
  workId: row.work_id,
  title: row.title_ar,
  subtitle: row.subtitle_ar ?? null,
  categoryId: row.category_id ?? null,
  categoryLabel: row.category_label ?? null,
  bookType: row.book_type_label ?? null,
  authorName: row.author_name ?? null,
  authorDeathYear: row.author_death_year ?? null,
  volumeCount: row.volume_count ?? 1,
  language: row.language ?? 'ar',
  coverUrl: row.cover_url ?? null,
  pageCount: row.page_count ?? null,
  publishedAt: row.published_at ?? null,
});

const author = (row) => ({
  authorId: row.author_id,
  fullName: row.full_name_ar,
  shortName: row.short_name_ar ?? null,
  deathYearHijri: row.death_year_hijri ?? null,
  bio: row.bio_ar ?? null,
  portraitUrl: row.portrait_url ?? null,
  role: row.role ?? null,
  bookCount: row.book_count ?? null,
});

const page = (row) => ({
  pageId: row.page_id,
  volumeId: row.volume_id ?? null,
  printedPageNum: row.printed_page_num ?? null,
  sequenceNum: row.sequence_num,
  bodyHtml: row.body_html,
  bodyPlain: row.body_plain,
  footnotes: row.footnotes ?? null,
});

const tocEntry = (row) => ({
  tocId: row.toc_id,
  parentTocId: row.parent_toc_id ?? null,
  pageId: row.page_id,
  title: row.title_text,
  level: row.level ?? 1,
  sequenceNum: row.sequence_num,
  printedPageNum: row.printed_page_num ?? null,
  pageSequenceNum: row.page_sequence_num ?? null,
});

const volume = (row) => ({
  volumeId: row.volume_id,
  partNumber: row.part_number,
  label: row.label_ar ?? null,
  sequenceNum: row.sequence_num,
  firstPageId: row.first_page_id ?? null,
  lastPageId: row.last_page_id ?? null,
});

/** Caractères conservés de part et d'autre d'une correspondance. */
const SNIPPET_MARGIN = 60;

function snippetAround(text, pattern) {
  pattern.lastIndex = 0;
  const match = pattern.exec(text ?? '');
  if (!match) return { before: (text ?? '').slice(0, 120), match: '', after: '' };

  const start = Math.max(0, match.index - SNIPPET_MARGIN);
  const end = Math.min(text.length, match.index + match[0].length + SNIPPET_MARGIN);
  return {
    before: (start > 0 ? '…' : '') + text.slice(start, match.index).replace(/\s+/g, ' '),
    match: match[0],
    after:
      text.slice(match.index + match[0].length, end).replace(/\s+/g, ' ') +
      (end < text.length ? '…' : ''),
  };
}

// ------------------------------------------------------------- les réglages

/**
 * Réglages **en mémoire**. `user.sqlite` est hors périmètre : rien de ce que
 * l'utilisateur change ici ne survit à la fermeture, et c'est assumé.
 *
 * Les valeurs sont des chaînes, comme celles d'`app_settings`. Les clés de
 * police sont volontairement absentes : `resolveFont` replie sur le défaut que
 * l'appelant lui passe, et inventer une clé ici la ferait replier de toute
 * façon — en donnant l'illusion d'un choix. `reader.mode` est absent pour la
 * même raison, et il l'a appris à ses dépens : il disait `page` quand
 * `shared/reading-modes.js` disait `scroll`, et le défaut partagé n'était donc
 * jamais lu.
 */
const reglages = new Map(
  Object.entries({
    'app.locale': 'ar',
    'app.theme': 'paper',
    'reader.fontSize': '22',
  }),
);

// -------------------------------------------------------------- le dépôt

const repository = {
  // ------------------------------------------------------------- accueil

  getCategories: () =>
    garde('lecture des catégories', async () => {
      const db = await catalogue();
      return (
        await all(
          db,
          `SELECT c.category_id, c.label_ar, c.parent_id, c.sort_order,
                COUNT(e.edition_id) AS book_count
         FROM categories c
         LEFT JOIN editions e ON e.category_id = c.category_id AND e.is_hidden = 0
         GROUP BY c.category_id
         ORDER BY c.sort_order`,
        )
      ).map((row) => ({
        categoryId: row.category_id,
        label: row.label_ar,
        parentId: row.parent_id ?? null,
        bookCount: row.book_count ?? 0,
      }));
    }),

  /**
   * La première requête de l'accueil, donc la mesure qui dit si l'écran
   * s'ouvre. `total` compte *toutes* les disciplines peuplées, jamais
   * `rows.length` : six tuiles ne doivent pas laisser croire à six disciplines.
   */
  getTopCategories: ({ limit = 6, sample = 3 } = {}) =>
    garde('lecture des disciplines principales', async () => {
      const db = await catalogue();
      const fin = chrono();

      const visible =
        (await first(db, 'SELECT COUNT(*) AS n FROM editions WHERE is_hidden = 0'))?.n ?? 0;
      const total =
        (
          await first(
            db,
            `SELECT COUNT(*) AS n FROM (
             SELECT e.category_id FROM editions e
              WHERE e.is_hidden = 0 AND e.category_id IS NOT NULL
              GROUP BY e.category_id)`,
          )
        )?.n ?? 0;

      const lignes = await all(
        db,
        `SELECT c.category_id, c.label_ar, COUNT(e.edition_id) AS book_count
           FROM categories c
           JOIN editions e ON e.category_id = c.category_id AND e.is_hidden = 0
          GROUP BY c.category_id
          ORDER BY book_count DESC, c.sort_order
          LIMIT ?`,
        [limit],
      );

      const rows = [];
      for (const row of lignes) {
        rows.push({
          categoryId: row.category_id,
          label: row.label_ar,
          bookCount: row.book_count ?? 0,
          share: visible ? (row.book_count ?? 0) / visible : 0,
          books: (
            await all(
              db,
              `${SUMMARY_SELECT} AND e.category_id = ?
             GROUP BY e.edition_id ORDER BY r.published_at DESC, e.title_ar LIMIT ?`,
              [row.category_id, sample],
            )
          ).map(bookSummary),
        });
      }

      fin('accueil:premiere-requete', `${rows.length} disciplines sur ${total}`);
      return { total, rows };
    }),

  getRecentBooks: ({ limit = 12 } = {}) =>
    garde('lecture des nouveautés', async () => {
      const db = await catalogue();
      return marquerInstalles(
        (
          await all(
            db,
            `${SUMMARY_SELECT} GROUP BY e.edition_id
           ORDER BY r.published_at DESC, e.title_ar LIMIT ?`,
            [limit],
          )
        ).map(bookSummary),
      );
    }),

  getFeaturedAuthor: () =>
    garde("lecture de l'auteur en vedette", async () => {
      const db = await catalogue();
      const row = await first(
        db,
        `SELECT a.*, COUNT(ea.edition_id) AS book_count
         FROM authors a
         JOIN edition_authors ea ON ea.author_id = a.author_id
         GROUP BY a.author_id
         ORDER BY book_count DESC, a.full_name_ar
         LIMIT 1`,
      );
      return row ? author(row) : null;
    }),

  // -------------------------------------------------------------- listes

  getBooks: ({ offset = 0, limit = 20 } = {}) =>
    garde('lecture du catalogue', async () => {
      const db = await catalogue();
      return marquerInstalles(
        (
          await all(
            db,
            `${SUMMARY_SELECT} GROUP BY e.edition_id ORDER BY e.title_ar LIMIT ? OFFSET ?`,
            [limit, offset],
          )
        ).map(bookSummary),
      );
    }),

  getBooksByCategory: (categoryId, { limit = 20 } = {}) =>
    garde('lecture de la catégorie', async () => {
      const db = await catalogue();
      return marquerInstalles(
        (
          await all(
            db,
            `${SUMMARY_SELECT} AND e.category_id = ? GROUP BY e.edition_id
           ORDER BY e.title_ar LIMIT ?`,
            [categoryId, limit],
          )
        ).map(bookSummary),
      );
    }),

  // ---------------------------------------------------------------- fiche

  /**
   * Le lecteur lit `download.status` **avant** d'ouvrir quoi que ce soit : tout
   * ce qui n'est pas `installed` le renvoie à la fiche (`views/reader.js`,
   * `start()`). Sans `user.sqlite`, le statut se déduit donc de la seule chose
   * qui compte vraiment — le fichier est-il sur l'appareil.
   */
  getBookDetail: (editionId) =>
    garde('lecture de la fiche livre', async () => {
      const db = await catalogue();
      const summaryRow = await first(
        db,
        `${SUMMARY_SELECT} AND e.edition_id = ? GROUP BY e.edition_id LIMIT 1`,
        [editionId],
      );
      if (!summaryRow) {
        throw new RepositoryError(`édition introuvable : ${editionId}`, 'query-failed');
      }
      const summary = bookSummary(summaryRow);

      const meta =
        (await first(
          db,
          `SELECT e.bibliography_text, e.publisher_ar, e.edition_label_ar,
                  e.publication_year, e.work_id, e.book_type_label,
                  r.page_count, r.toc_count
           FROM editions e
           LEFT JOIN book_releases r ON r.edition_id = e.edition_id AND r.is_active = 1
           WHERE e.edition_id = ?`,
          [editionId],
        )) ?? {};

      const authors = (
        await all(
          db,
          `SELECT a.*, ea.role
         FROM edition_authors ea
         JOIN authors a ON a.author_id = ea.author_id
         WHERE ea.edition_id = ?
         ORDER BY ea.position`,
          [editionId],
        )
      ).map(author);

      const otherEditions = (
        await all(
          db,
          `${SUMMARY_SELECT} AND e.work_id = ? AND e.edition_id <> ? GROUP BY e.edition_id`,
          [meta.work_id ?? summary.workId, editionId],
        )
      ).map(bookSummary);

      const release = await first(
        db,
        `SELECT release_id, object_key, sha256, compressed_size, uncompressed_size
         FROM book_releases WHERE edition_id = ? AND is_active = 1 LIMIT 1`,
        [editionId],
      );

      const installe = await livreInstalle(editionId);
      const download = {
        status: installe ? 'installed' : null,
        percent: installe ? 1 : 0,
        error: null,
        compressedSize: release?.compressed_size ?? 0,
        uncompressedSize: release?.uncompressed_size ?? 0,
        releaseId: release?.release_id ?? null,
      };

      // Le fichier du livre peut ne pas être installé : la fiche reste lisible.
      let volumes = [];
      if (installe) {
        try {
          const book = await livre(editionId);
          volumes = (await all(book, 'SELECT * FROM volumes ORDER BY sequence_num')).map(volume);
        } catch {
          volumes = [];
        }
      }

      return {
        summary,
        authors,
        volumes,
        otherEditions,
        download,
        bibliographyText: meta.bibliography_text ?? null,
        publisher: meta.publisher_ar ?? null,
        editionLabel: meta.edition_label_ar ?? null,
        publicationYear: meta.publication_year ?? null,
        bookTypeLabel: meta.book_type_label ?? null,
        pageCount: meta.page_count ?? null,
        tocCount: meta.toc_count ?? null,
      };
    }),

  /**
   * Cinq bandes de certitude décroissante, chacune `{ rows, total }` — `total`
   * vient de SQL, jamais de `rows.length`, sinon le lien « les N autres »
   * annoncerait la taille de la tranche affichée. Repris tel quel.
   */
  getRelatedBooks: (editionId, { perBand = 6 } = {}) =>
    garde('lecture des livres en relation', async () => {
      const db = await catalogue();
      const self = await first(db, 'SELECT category_id FROM editions WHERE edition_id = ?', [
        editionId,
      ]);
      if (!self) {
        throw new RepositoryError(`édition introuvable : ${editionId}`, 'query-failed');
      }
      const categoryId = self.category_id ?? null;

      const band = async (where, params, order, orderParams = []) => ({
        rows: (
          await all(
            db,
            `${SUMMARY_SELECT} AND ${where} GROUP BY e.edition_id ${order} LIMIT ?`,
            [...params, ...orderParams, perBand],
          )
        ).map(bookSummary),
        total:
          (
            await first(
              db,
              `SELECT COUNT(*) AS n FROM editions e WHERE e.is_hidden = 0 AND ${where}`,
              params,
            )
          )?.n ?? 0,
      });

      const linked = (column, other) =>
        `e.edition_id IN (SELECT ${column} FROM edition_relations
                           WHERE ${other} = ? AND relation_type = ?)`;

      const editions = await band(
        linked('to_edition_id', 'from_edition_id', 'same_group'),
        [editionId, 'same_group'],
        'ORDER BY r.page_count DESC, e.title_ar',
      );

      const partOf = await band(
        linked('to_edition_id', 'from_edition_id', 'part_of'),
        [editionId, 'part_of'],
        'ORDER BY e.title_ar',
      );

      const contains = await band(
        linked('from_edition_id', 'to_edition_id', 'part_of'),
        [editionId, 'part_of'],
        'ORDER BY e.title_ar',
      );

      const authorIds = (
        await all(
          db,
          "SELECT author_id FROM edition_authors WHERE edition_id = ? AND role = 'author'",
          [editionId],
        )
      ).map((row) => row.author_id);

      const certain = [
        editionId,
        ...editions.rows.map((b) => b.editionId),
        ...partOf.rows.map((b) => b.editionId),
        ...contains.rows.map((b) => b.editionId),
      ];
      const notShown = (ids) => `e.edition_id NOT IN (${ids.map(() => '?').join(',')})`;

      const sameAuthor = authorIds.length
        ? await band(
            `${notShown(certain)} AND e.edition_id IN (
               SELECT edition_id FROM edition_authors
                WHERE author_id IN (${authorIds.map(() => '?').join(',')}))`,
            [...certain, ...authorIds],
            'ORDER BY (e.category_id = ?) DESC, r.page_count DESC, e.title_ar',
            [categoryId],
          )
        : { rows: [], total: 0 };
      if (authorIds.length) {
        sameAuthor.total =
          (
            await first(
              db,
              `SELECT COUNT(DISTINCT e.edition_id) AS n
               FROM editions e
               JOIN edition_authors ea ON ea.edition_id = e.edition_id
              WHERE e.is_hidden = 0 AND e.edition_id <> ?
                AND ea.author_id IN (${authorIds.map(() => '?').join(',')})`,
              [editionId, ...authorIds],
            )
          )?.n ?? 0;
      }

      const excluded = [...certain, ...sameAuthor.rows.map((b) => b.editionId)];

      const sameCategory =
        categoryId == null
          ? { rows: [], total: 0 }
          : await band(
              `e.category_id = ? AND ${notShown(excluded)}`,
              [categoryId, ...excluded],
              'ORDER BY r.page_count DESC, e.title_ar',
            );
      if (categoryId != null) {
        sameCategory.total =
          (
            await first(
              db,
              'SELECT COUNT(*) AS n FROM editions WHERE is_hidden = 0 AND category_id = ?',
              [categoryId],
            )
          )?.n ?? 0;
      }

      await marquerInstalles([
        ...editions.rows,
        ...partOf.rows,
        ...contains.rows,
        ...sameAuthor.rows,
        ...sameCategory.rows,
      ]);

      return {
        editions,
        partOf,
        contains,
        sameAuthor: { ...sameAuthor, authorIds },
        sameCategory: { ...sameCategory, categoryId },
      };
    }),

  // -------------------------------------------------------------- lecteur

  getToc: (editionId) =>
    garde('lecture du sommaire', async () => {
      const db = await livre(editionId);
      return (
        await all(
          db,
          `SELECT t.*, p.printed_page_num, p.sequence_num AS page_sequence_num
         FROM toc t
         JOIN pages p ON p.page_id = t.page_id
         ORDER BY t.sequence_num`,
        )
      ).map(tocEntry);
    }),

  getPageCount: (editionId) =>
    garde('comptage des pages', async () => {
      const db = await livre(editionId);
      return (await first(db, 'SELECT COUNT(*) AS n FROM pages'))?.n ?? 0;
    }),

  getPages: (editionId, { offset = 0, limit = 20 } = {}) =>
    garde('lecture des pages', async () => {
      const db = await livre(editionId);
      const fin = chrono();
      const lignes = await all(db, 'SELECT * FROM pages ORDER BY sequence_num LIMIT ? OFFSET ?', [
        limit,
        offset,
      ]);
      fin('livre:page', `${lignes.length} page(s) à partir de ${offset}`);
      return lignes.map(page);
    }),

  getPageById: (editionId, pageId) =>
    garde("lecture d'une page", async () => {
      const db = await livre(editionId);
      const fin = chrono();
      const row = await first(db, 'SELECT * FROM pages WHERE page_id = ? LIMIT 1', [pageId]);
      fin('livre:page', `page ${pageId}`);
      return row ? page(row) : null;
    }),

  /**
   * Recherche dans un livre — et second test de FTS5, celui qui compte pour
   * l'utilisateur : une requête réelle, avec un terme réel, pas une sonde.
   *
   * FTS5 d'abord, `LIKE` sur `body_search` ensuite : la colonne normalisée est
   * au schéma, le repli n'est donc pas une dégradation muette. Le panneau note
   * lequel des deux a servi, sans quoi une mesure rapide ne dirait pas si elle
   * mesure l'index ou le balayage.
   *
   * Les chapitres passent toujours par `LIKE` : `toc` n'est indexée nulle part.
   */
  searchInBook: (editionId, term, { limit = 50 } = {}) =>
    garde('recherche dans le livre', async () => {
      const { arabicSearchPattern, normalizeArabic } = await arabe();
      const needle = normalizeArabic(term ?? '');
      if (needle.length < 2) return { chapters: [], pages: [], term: needle };

      const db = await livre(editionId);
      // `%` et `_` sont des jokers LIKE : sans échappement, un terme les
      // contenant ramènerait le livre entier.
      const pattern = `%${needle.replace(/[\\%_]/g, '\\$&')}%`;
      const highlight = arabicSearchPattern(needle);

      const chapters = (
        await all(
          db,
          `SELECT t.toc_id, t.page_id, t.title_text, t.level,
                p.printed_page_num, p.sequence_num
           FROM toc t JOIN pages p ON p.page_id = t.page_id
          WHERE t.title_normalized LIKE ? ESCAPE '\\'
          ORDER BY t.sequence_num LIMIT ?`,
          [pattern, limit],
        )
      ).map((row) => ({
        tocId: row.toc_id,
        pageId: row.page_id,
        title: row.title_text,
        level: row.level ?? 1,
        printedPageNum: row.printed_page_num ?? null,
        sequenceNum: row.sequence_num,
      }));

      const fin = chrono();
      let lignes = null;
      let moteur = 'fts5';
      try {
        // `pages_fts` est contentless (`content=''`) : ses colonnes ne se
        // relisent pas, seul `rowid` sort — et le pipeline y écrit `page_id`.
        // La citation en phrase évite qu'un terme à plusieurs mots soit lu
        // comme une expression de requête FTS5.
        lignes = await all(
          db,
          `SELECT p.page_id, p.sequence_num, p.printed_page_num, p.body_plain
             FROM pages_fts
             JOIN pages p ON p.page_id = pages_fts.rowid
            WHERE pages_fts MATCH ?
            ORDER BY p.sequence_num LIMIT ?`,
          [`"${needle.replace(/"/g, '""')}"`, limit],
        );
      } catch (error) {
        moteur = `like (fts5 refusé : ${String(error?.message ?? error)})`;
        lignes = await all(
          db,
          `SELECT page_id, sequence_num, printed_page_num, body_plain
             FROM pages
            WHERE body_search LIKE ? ESCAPE '\\'
            ORDER BY sequence_num LIMIT ?`,
          [pattern, limit],
        );
      }
      fin('recherche:livre', `${moteur} — ${lignes.length} page(s)`);

      const pages = lignes.map((row) => ({
        pageId: row.page_id,
        sequenceNum: row.sequence_num,
        printedPageNum: row.printed_page_num ?? null,
        snippet: snippetAround(row.body_plain, highlight),
      }));

      return { chapters, pages, term: needle };
    }),

  // ------------------------------------------------------------- réglages

  getSettings: async () => Object.fromEntries(reglages),

  saveSetting: async (key, value) => {
    reglages.set(String(key), String(value));
  },

  // ------------------------------------------------- traversées obligatoires
  //
  // Ces sept-là ne sont **pas** portées : elles rendent la forme vide.
  //
  // Elles ne pouvaient pas lever pour autant. `views/home.js` (`load`) et
  // `views/reader.js` (`start`) les appellent dans un `Promise.all` **sans**
  // `.catch()` : une seule qui lève emporte tout l'écran, et la tranche
  // verticale que ce spike doit mesurer s'arrête avant d'avoir rien ouvert.
  // Une forme vide, elle, traverse : l'accueil montre les disciplines, le
  // lecteur ouvre à la première page. Ce que ces méthodes lisent vit dans
  // `user.sqlite`, explicitement hors périmètre.

  /** `views/home.js:23` — pas de reprise : le héros retombe sur les nouveautés. */
  getContinueReading: async () => null,

  /** `views/home.js:27` — étagère vide : la section entière disparaît. */
  getLibrary: async () => ({
    rows: [],
    total: 0,
    counts: { all: 0, reading: 0, done: 0 },
    orphans: 0,
  }),

  /** `views/reader.js:186` et `views/book-detail.js:26` — on ouvre page un. */
  getProgress: async () => null,

  /** `views/reader.js:1524`, à chaque tourne-page : lever ferait un toast par page. */
  saveProgress: async () => {},

  /** `views/home.js:30` — la frise se retire d'elle-même sous deux siècles. */
  getEras: async () => [],

  /** `views/home.js:31` — rien à dater tant qu'il n'y a pas de frise. */
  getUndatedCount: async () => 0,

  /** `views/home.js:39` — la carte de l'auteur en vedette se passe des œuvres. */
  getBooksByAuthor: async () => [],
};

// ----------------------------------------------------- le canal poussé

/**
 * Abonnés au canal des téléchargements. Dans Electron, c'est le processus
 * principal qui pousse par IPC ; ici la file vit dans la page, et le canal se
 * réduit à un ensemble d'abonnés.
 */
const abonnes = new Set();

function emettreChangement(jobs) {
  for (const abonne of abonnes) {
    try {
      abonne(jobs);
    } catch (erreur) {
      // Un abonné qui lève ne doit pas empêcher les autres d'être servis, ni
      // interrompre le téléchargement qui vient de progresser.
      console.warn('[beytelhikma] abonné en échec :', erreur);
    }
  }
}

// ------------------------------------------------------------------- zstd

let fzstdPromise = null;

/**
 * Décompression zstd **dans la page**. `fzstd` est embarqué par
 * `prepare-www.mjs` dans `www/js/vendor/`, jamais résolu par spécificateur :
 * le rendu n'a pas de bundler. L'import est différé pour que `verify.mjs`,
 * qui charge ce fichier depuis `src/` où le dossier n'existe pas, n'ait jamais
 * à le résoudre.
 *
 * C'est le pendant navigateur du `zlib.createZstdDecompress` que le processus
 * principal d'Electron obtient de Node — et ce qui évite un module natif.
 */
async function decompressZstd(octets) {
  fzstdPromise ??= import('./vendor/fzstd.js');
  const { decompress } = await fzstdPromise;
  return decompress(octets instanceof Uint8Array ? octets : new Uint8Array(octets));
}

// ------------------------------------------------- fermetures explicites

/**
 * Referme le catalogue **et oublie la promesse**.
 *
 * Sur Android, renommer par-dessus un fichier ouvert réussit sans erreur, et la
 * connexion continue de lire l'ancien inode : une mise à jour de catalogue
 * s'écrirait correctement et ne se lirait qu'au redémarrage suivant, sans que
 * rien ne le signale. Refermer ne suffit donc pas — il faut aussi que le shim
 * cesse de se croire ouvert, sinon la prochaine lecture sert la promesse
 * mémorisée et rouvre... rien.
 */
async function fermerCatalogue() {
  const promesse = cataloguePromise;
  cataloguePromise = null;
  if (!promesse) return;
  const chemin = await promesse.catch(() => null);
  if (chemin) await fermer(chemin);
}

/** Même raison pour un livre, avant de le supprimer ou de le remplacer. */
async function fermerLivre(editionId) {
  const id = assertEditionId(editionId);
  if (livreCourant !== id) return;
  const promesse = livrePromise;
  livreCourant = null;
  livrePromise = null;
  if (!promesse) return;
  const chemin = await promesse.catch(() => null);
  if (chemin) await fermer(chemin);
}

// ------------------------------------------------------- outils partagés

/**
 * Deux modules partagés, chargés **en amorce** et lus en synchrone.
 *
 * Ils viennent de `src/shared/`, jamais recopiés : `arabic.js` est le reflet
 * exact de `normalize_ar` de `tools/_common.py`, et c'est ce contrat qui a
 * produit les colonnes normalisées du corpus. Une seconde implémentation
 * divergerait en silence, et la recherche se dégraderait sans qu'aucun test
 * n'échoue. Même raison pour la liste des cursus, qui vit dans un seul fichier.
 *
 * L'import est différé **et** amorcé : différé parce que depuis `src/`, où
 * `verify.mjs` charge ce fichier, le dossier `shared/` n'existe pas — il n'est
 * en place que dans `www/`, que `prepare-www.mjs` compose. Amorcé parce que
 * les modules les consomment en synchrone, avec un repli : rendre `undefined`
 * une poignée de millisecondes laisse jouer ce repli, rendre une promesse le
 * casserait.
 */
let arabicModule = null;
let curriculaModule = null;
let popularModule = null;

import(new URL('../shared/arabic.js', import.meta.url).href)
  .then((module) => {
    arabicModule = module;
  })
  .catch(() => {
    // Hors de `www/` : les appelants ont tous un repli littéral.
  });

import(new URL('../shared/curricula.js', import.meta.url).href)
  .then((module) => {
    curriculaModule = module;
  })
  .catch(() => {});

import(new URL('../shared/popular.js', import.meta.url).href)
  .then((module) => {
    popularModule = module;
  })
  .catch(() => {});

function arabicSearchPattern(terme, flags = 'g') {
  return arabicModule ? arabicModule.arabicSearchPattern(terme, flags) : null;
}

/**
 * Normalisation arabe, **en synchrone**.
 *
 * Le repli rend la chaîne telle quelle plutôt que rien : les appelants
 * enchaînent aussitôt un `.includes` ou un `.replace`, et leur rendre autre
 * chose qu'une chaîne les casse — c'est exactement ce qui est arrivé en
 * câblant `arabe()`, qui rend une **promesse du module** et non la fonction.
 * Le résultat serait alors moins bon, jamais faux : la comparaison porte sur
 * des colonnes déjà normalisées par le pipeline, donc un terme non normalisé
 * trouve moins, il n'invente pas.
 */
function normalizeArabic(texte) {
  if (arabicModule) return arabicModule.normalizeArabic(texte);
  return String(texte ?? '');
}

// --------------------------------------------------------- les modules

/**
 * Ce que les modules reçoivent. Aucun d'eux n'importe quoi que ce soit : ils
 * sont des fabriques, et c'est ici — le seul endroit — que l'assemblage est
 * connu. Quatre agents ont pu les écrire en parallèle sans se marcher dessus.
 */
const ctx = {
  RepositoryError,
  garde,
  chrono,
  // catalogue et livres — lecture seule, famille NC
  catalogue,
  livre,
  livreInstalle,
  fermerCatalogue,
  fermerLivre,
  all,
  first,
  sonderFts,
  arabicSearchPattern,
  /** Lu comme une valeur par `catalogue-plus`, d'où l'accesseur. */
  get CURRICULA() {
    return curriculaModule?.CURRICULA;
  },
  /** Même chose pour les ouvrages de référence : accesseur, jamais destructuré. */
  get POPULAR_EDITION_IDS() {
    return popularModule?.POPULAR_EDITION_IDS;
  },
  // `user.sqlite` — lecture-écriture, API ordinaire du greffon
  allUser,
  firstUser,
  executerUtilisateur,
  executerBrut,
  // projections reprises verbatim de `book-repository.js`
  SUMMARY_SELECT,
  bookSummary,
  author,
  page,
  tocEntry,
  volume,
  snippetAround,
  // appareil et pont
  racineAppareil,
  filesystem,
  sqlite,
  pont,
  manifeste,
  assertEditionId,
  normalizeArabic,
  decompressZstd,
  emettreChangement,
};

/**
 * L'ordre compte. Les modules passent **après** le littéral : le shim y garde
 * des versions inertes — `getLibrary`, `getProgress`, `getSettings`… — qui
 * n'existaient que pour empêcher les `Promise.all` sans `catch` de
 * `views/home.js` et `views/reader.js` d'emporter l'écran entier. Maintenant
 * qu'elles ont de vraies implémentations, celles-ci doivent l'emporter.
 */
const methodesUtilisateur = creerMethodesUtilisateur(ctx);

/**
 * La migration de `user.sqlite` vit dans le module `utilisateur`, qui garde
 * ses propres accès. Les trois autres écrivent pourtant dans la même base —
 * `polices` y inscrit ses familles, `telechargements` l'état des installations
 * — et frapperaient sinon une base non migrée : `installFont` échouerait
 * **après** avoir déposé ses fichiers, qui resteraient orphelins.
 *
 * On ne peut pas poser la garde dans `ouvrirUtilisateur` : la migration écrit
 * elle-même par `executerBrut`, et s'attendrait donc elle-même. Elle est donc
 * posée sur les primitives **remises aux autres modules**, et sur elles seules.
 */
const assurerSchema = methodesUtilisateur.__assurerSchema;
delete methodesUtilisateur.__assurerSchema;

// `Object.create` et non un spread : `ctx.CURRICULA` est un **accesseur**, que
// `{...ctx}` évaluerait une fois pour toutes — donc `undefined`, puisque son
// module n'est pas encore chargé au moment de l'assemblage. La chaîne de
// prototypes, elle, relit à chaque accès.
const ctxGarde = Object.assign(Object.create(ctx), {
  allUser: async (...args) => (await assurerSchema(), allUser(...args)),
  firstUser: async (...args) => (await assurerSchema(), firstUser(...args)),
  executerUtilisateur: async (...args) => (
    await assurerSchema(), executerUtilisateur(...args)
  ),
  executerBrut: async (...args) => (await assurerSchema(), executerBrut(...args)),
});

Object.assign(
  repository,
  creerMethodesCatalogue(ctxGarde),
  methodesUtilisateur,
  creerMethodesTelechargements(ctxGarde),
  creerMethodesPolices(ctxGarde),
);

/**
 * Ce qui reste. Fabriqué en boucle depuis `METHODS`, jamais à la main : une
 * liste écrite deux fois est une liste qui diverge, et c'est précisément ce que
 * `verify.mjs` cherche.
 */
for (const nom of METHODS) {
  if (typeof repository[nom] === 'function') continue;
  repository[nom] = async () => {
    throw new RepositoryError(`méthode non portée dans l'exemple : ${nom}`, 'not-ported');
  };
}

export { repository };

/**
 * Le geste retour d'Android, branché une fois pour la session.
 *
 * Ici et pas dans une vue : c'est le seul fichier du rendu qui diffère sous
 * Capacitor, et le seul, donc, où une ligne propre à la plateforme a sa place.
 * Le greffon se prend sur `globalThis.Capacitor.Plugins` comme les deux autres
 * — le rendu se sert sans bundler, et un `import '@capacitor/app'` serait un
 * spécificateur nu qu'aucun navigateur ne résout.
 *
 * Hors appareil — `verify.mjs`, un navigateur de bureau — le greffon est absent
 * et `brancherRetour` ne branche rien.
 */
brancherRetour({
  App: pont()?.App,
  document: globalThis.document,
  history: globalThis.history,
  quitter: () => pont()?.App?.exitApp?.(),
});

/** S'abonne au canal poussé ; rend la fonction de désabonnement. */
export function onDownloadsChanged(callback) {
  abonnes.add(callback);
  return () => abonnes.delete(callback);
}

/** Réglages chargés une fois par session, comme dans le rendu d'origine. */
let settingsCache = null;

export async function settings() {
  settingsCache ??= await repository.getSettings();
  return settingsCache;
}

export async function setSetting(key, value) {
  settingsCache ??= await repository.getSettings();
  settingsCache[key] = String(value);
  await repository.saveSetting(key, String(value));
}
