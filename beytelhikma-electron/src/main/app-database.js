import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import zlib from 'node:zlib';
import initSqlJs from 'sql.js';

const require = createRequire(import.meta.url);

/** sql.js compile le WASM une seule fois par processus. */
let enginePromise = null;
function engine() {
  enginePromise ??= initSqlJs({
    locateFile: (file) => require.resolve(`sql.js/dist/${file}`),
  });
  return enginePromise;
}

export const USER_DB_SCHEMA_VERSION = 2;

/**
 * Au-delà de cette taille, `new SQL.Database(buffer)` charge le livre entier en
 * mémoire WASM et devient très lent, voire échoue. Les livres du corpus Shamela
 * vont jusqu'à ~800 Mo pour les plus gros : on prévient plutôt que de laisser
 * planter sans explication.
 */
const BOOK_SIZE_WARNING = 128 * 1024 * 1024;

/**
 * Annotations personnelles (`DATAMODEL.md`, §4). Trois tables plutôt qu'une :
 * une note peut exister sans surlignage (note de page), un surlignage sans note,
 * et une note peut commenter un surlignage — `notes.highlight_id` porte ce lien.
 *
 * `start_offset` / `end_offset` comptent les caractères du **texte rendu** de la
 * page. `selected_text`, `prefix_text` et `suffix_text` permettent de retrouver
 * le passage si le rendu bouge : les décalages seuls seraient trop fragiles.
 */
const ANNOTATION_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS bookmarks (
     bookmark_id TEXT PRIMARY KEY,
     edition_id  TEXT NOT NULL,
     page_id     INTEGER NOT NULL,
     text_offset INTEGER,
     label       TEXT,
     created_at  TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS highlights (
     highlight_id  TEXT PRIMARY KEY,
     edition_id    TEXT NOT NULL,
     page_id       INTEGER NOT NULL,
     start_offset  INTEGER NOT NULL DEFAULT 0,
     end_offset    INTEGER NOT NULL DEFAULT 0,
     selected_text TEXT NOT NULL,
     prefix_text   TEXT,
     suffix_text   TEXT,
     color         TEXT NOT NULL,
     created_at    TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS notes (
     note_id      TEXT PRIMARY KEY,
     edition_id   TEXT NOT NULL,
     page_id      INTEGER,
     highlight_id TEXT,
     content      TEXT NOT NULL,
     created_at   TEXT NOT NULL,
     updated_at   TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_bookmarks_edition  ON bookmarks (edition_id, page_id)`,
  `CREATE INDEX IF NOT EXISTS idx_highlights_edition ON highlights (edition_id, page_id)`,
  `CREATE INDEX IF NOT EXISTS idx_notes_edition      ON notes (edition_id, page_id)`,
  `CREATE INDEX IF NOT EXISTS idx_notes_highlight    ON notes (highlight_id)`,
];

/**
 * Migrations de `user.sqlite`, indexées par la version qu'elles produisent.
 * Une base fraîche part de `USER_SCHEMA` et saute directement à la version
 * courante ; une base existante rejoue les paliers manquants.
 */
const USER_MIGRATIONS = {
  2: ANNOTATION_SCHEMA,
};

const USER_SCHEMA = [
  `CREATE TABLE downloaded_books (
     edition_id           TEXT PRIMARY KEY,
     release_id           TEXT,
     local_path           TEXT,
     download_status      TEXT NOT NULL DEFAULT 'installed',
     downloaded_bytes     INTEGER NOT NULL DEFAULT 0,
     total_bytes          INTEGER NOT NULL DEFAULT 0,
     downloaded_at        TEXT,
     last_opened_at       TEXT,
     current_page_id      INTEGER,
     current_sequence_num INTEGER,
     progress_percent     REAL NOT NULL DEFAULT 0
   )`,
  `CREATE TABLE collections (
     collection_id TEXT PRIMARY KEY,
     name          TEXT NOT NULL,
     description   TEXT,
     sort_order    INTEGER NOT NULL DEFAULT 0,
     created_at    TEXT NOT NULL,
     updated_at    TEXT NOT NULL
   )`,
  `CREATE TABLE collection_books (
     collection_id TEXT NOT NULL,
     edition_id    TEXT NOT NULL,
     sort_order    INTEGER NOT NULL DEFAULT 0,
     added_at      TEXT NOT NULL,
     PRIMARY KEY (collection_id, edition_id)
   )`,
  `CREATE TABLE app_settings (
     key   TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,
  ...ANNOTATION_SCHEMA,
  `CREATE TABLE user_info (schema_version INTEGER NOT NULL)`,
  `INSERT INTO user_info (schema_version) VALUES (${USER_DB_SCHEMA_VERSION})`,
  // `user_version` reste posé : c'est le contrat qu'un autre client (l'ex-port
  // Flutter s'y fiait via sqflite) lirait pour décider s'il doit créer le
  // schéma. Sans lui, un client tiers lit 0, rejoue ses `CREATE TABLE` et
  // refuse d'ouvrir la base — impossible de partager une racine de bibliothèque.
  `PRAGMA user_version = ${USER_DB_SCHEMA_VERSION}`,
];

/** Le fichier du livre n'est pas installé : l'appelant doit le télécharger. */
export class BookNotInstalledError extends Error {
  constructor(editionId) {
    super(`livre non installé : ${editionId}`);
    this.name = 'BookNotInstalledError';
    this.editionId = editionId;
  }
}

/**
 * Emplacement de la bibliothèque à installer, par ordre de priorité :
 *
 *  1. `BEYTELHIKMA_LIBRARY` — pour pointer une bibliothèque arbitraire ;
 *  2. `dist/shamela/` — la sortie de `tools/import_shamela.py` ;
 *  3. `assets/sample/` — les 5 livres factices, pour qu'un dépôt fraîchement
 *     cloné démarre sans avoir lancé l'import.
 *
 * Un dossier de bibliothèque contient `catalog.sqlite` et `books/`.
 */
export function resolveLibrarySource(projectRoot) {
  const candidates = [
    process.env.BEYTELHIKMA_LIBRARY,
    path.join(projectRoot, '..', 'dist', 'shamela'),
    path.join(projectRoot, 'assets', 'sample'),
  ].filter(Boolean);

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'catalog.sqlite'))) return path.resolve(dir);
  }
  throw new Error(
    `aucune bibliothèque trouvée (cherché : ${candidates.join(', ')}). ` +
      'Lancer `python tools/import_shamela.py` ou définir BEYTELHIKMA_LIBRARY.',
  );
}

/**
 * Accès aux trois bases de l'application (voir DATAMODEL.md) :
 *
 *  * `catalog.sqlite`            — catalogue, lecture seule ;
 *  * `books/<edition_id>.sqlite` — contenu d'un livre, lecture seule ;
 *  * `user.sqlite`               — bibliothèque, progression, réglages.
 *
 * Les fichiers sont livrés dans un dossier *source* — `dist/shamela/` produit par
 * `tools/import_shamela.py`, ou `assets/sample/` à défaut — puis copiés au
 * premier accès dans le dossier de données : le reste du code lit déjà des
 * fichiers *installés*, comme il le fera avec le CDN. Seul le catalogue est
 * copié depuis la source ; les livres sont installés par `download-manager.js`.
 *
 * sql.js travaille en mémoire : toute écriture dans `user.sqlite` est
 * immédiatement réexportée sur disque (le fichier pèse quelques kilo-octets).
 */
export class AppDatabase {
  #source;
  #seedArchive;
  #root;
  #catalog = null;
  #user = null;
  #books = new Map();

  /**
   * [librarySource] est un dossier de développement, absent d'une application
   * empaquetée : [seedArchive] prend alors le relais pour le seul catalogue.
   * Sans source, aucun livre ne peut venir d'ailleurs que du bucket — ce qui
   * est exactement le comportement voulu en production.
   */
  constructor({ librarySource = null, seedArchive = null, storageRoot }) {
    this.#source = librarySource;
    this.#seedArchive = seedArchive;
    this.#root = storageRoot;
  }

  get root() {
    return this.#root;
  }

  get librarySource() {
    return this.#source;
  }

  async initialize() {
    fs.mkdirSync(path.join(this.#root, 'books'), { recursive: true });
    this.#syncInstalledLibrary();
    this.#plantSeed();
    await engine();
  }

  /**
   * Décompresse la graine embarquée, **si et seulement si** aucun catalogue
   * n'est installé.
   *
   * La graine est figée à la date du build. Le catalogue installé, lui, a pu
   * être mis à jour depuis le bucket. L'écraser ferait régresser le catalogue
   * de l'utilisateur à chaque installation d'une nouvelle version de
   * l'application — une mise à jour qui retire des livres.
   */
  #plantSeed() {
    if (!this.#seedArchive) return;
    const cible = path.join(this.#root, 'catalog.sqlite');
    if (fs.existsSync(cible)) return;
    if (!fs.existsSync(this.#seedArchive)) return;

    // Écriture de côté puis renommage : une coupure ne laisse jamais un
    // catalogue tronqué qui serait pris pour valide au démarrage suivant.
    const staged = `${cible}.seed`;
    fs.writeFileSync(staged, zlib.zstdDecompressSync(fs.readFileSync(this.#seedArchive)));
    fs.renameSync(staged, cible);
  }

  /**
   * Si la bibliothèque source a changé depuis la dernière ouverture, les copies
   * installées appartiennent à un autre catalogue : on les jette.
   *
   * Seul le cache est purgé — `user.sqlite` (progression, collections) survit.
   * Les lignes qui pointent des éditions absentes du nouveau catalogue sont
   * simplement ignorées à la lecture.
   */
  #syncInstalledLibrary() {
    // Sans source locale — application empaquetée — il n'y a pas de changement
    // de source à détecter : le catalogue vient de la graine puis du bucket.
    if (!this.#source) return;

    const marker = path.join(this.#root, 'library.json');
    const current = { source: path.resolve(this.#source) };

    let previous = null;
    try {
      previous = JSON.parse(fs.readFileSync(marker, 'utf8'));
    } catch {
      previous = null; // absent ou illisible : on réinstalle
    }

    if (previous?.source !== current.source) {
      // Le catalogue part : il appartient à l'ancienne source. Les livres, non.
      //
      // Cette méthode purgeait aussi `books/`. C'était correct quand la source
      // était un dossier de développement qu'on changeait à la main. Avec un
      // catalogue qui se met à jour tout seul depuis le bucket, ce serait
      // retélécharger la bibliothèque entière à chaque rafraîchissement.
      //
      // La réconciliation se fait désormais par édition, à la lecture, en
      // comparant `downloaded_books.release_id` au `release_id` actif
      // (`BookRepository.#joinWithCatalog`). Aucun fichier de livre n'est
      // supprimé ici. Jamais.
      fs.rmSync(path.join(this.#root, 'catalog.sqlite'), { force: true });
      fs.mkdirSync(path.join(this.#root, 'books'), { recursive: true });
      fs.writeFileSync(
        marker,
        JSON.stringify({ ...current, installedAt: new Date().toISOString() }, null, 2),
      );
    }
  }

  /**
   * Copie le fichier depuis la bibliothèque source vers [target] s'il n'y est
   * pas encore, si sa taille diffère, ou s'il est plus récent.
   *
   * La date compte autant que la taille : `tools/publish_minio.py` réécrit les
   * `object_key` du catalogue sans forcément en changer la taille. Sans ce
   * critère, l'application resterait sur l'ancien catalogue et continuerait de
   * chercher les livres en `local://`.
   */
  #materialize(relativePath, targetPath) {
    // Application empaquetée : il n'y a pas de source à recopier, le fichier
    // installé est la seule vérité.
    if (!this.#source) {
      if (fs.existsSync(targetPath)) return targetPath;
      throw new Error(
        `catalogue absent : ni bibliothèque source, ni graine embarquée, ni ${relativePath} installé`,
      );
    }

    const source = path.join(this.#source, relativePath);
    if (!fs.existsSync(source)) {
      if (fs.existsSync(targetPath)) return targetPath;
      throw new Error(`fichier absent de la bibliothèque : ${relativePath}`);
    }
    const from = fs.statSync(source);
    const to = fs.existsSync(targetPath) ? fs.statSync(targetPath) : null;
    if (!to || to.size !== from.size || to.mtimeMs < from.mtimeMs) {
      fs.copyFileSync(source, targetPath);
    }
    return targetPath;
  }

  async #open(filePath) {
    const SQL = await engine();
    const bytes = fs.statSync(filePath).size;
    if (bytes > BOOK_SIZE_WARNING) {
      console.warn(
        `[beytelhikma] ${path.basename(filePath)} pèse ${Math.round(bytes / 1024 / 1024)} Mo : ` +
          'sql.js le charge intégralement en mémoire, le chargement sera long.',
      );
    }
    return new SQL.Database(fs.readFileSync(filePath));
  }

  async catalog() {
    if (this.#catalog) return this.#catalog;
    const file = this.#materialize('catalog.sqlite', path.join(this.#root, 'catalog.sqlite'));
    this.#catalog = await this.#open(file);
    return this.#catalog;
  }

  /**
   * Referme le catalogue en mémoire et le rouvre depuis le disque.
   *
   * sql.js charge le fichier entier en mémoire : sans cette fermeture, l'ancien
   * catalogue resterait servi jusqu'au redémarrage et l'échange n'aurait
   * visiblement aucun effet.
   */
  async reloadCatalog() {
    this.#catalog?.close();
    this.#catalog = null;
    return this.catalog();
  }

  /**
   * Ouvre un livre **installé**. Contrairement au catalogue, aucun fichier n'est
   * copié ici : c'est `download-manager.js` qui installe les livres.
   */
  async book(editionId) {
    const cached = this.#books.get(editionId);
    if (cached) return cached;
    const file = path.join(this.#root, 'books', `${editionId}.sqlite`);
    if (!fs.existsSync(file)) throw new BookNotInstalledError(editionId);
    const db = await this.#open(file);
    this.#books.set(editionId, db);
    return db;
  }

  /** Le livre est-il déjà chargé en mémoire ? */
  isBookOpen(editionId) {
    return this.#books.has(editionId);
  }

  /** Ferme un livre et le retire du cache : préalable à sa suppression. */
  closeBook(editionId) {
    const db = this.#books.get(editionId);
    if (!db) return;
    db.close();
    this.#books.delete(editionId);
  }

  /** Identifiants des livres dont le fichier est présent sur le disque. */
  installedBooks() {
    const dir = path.join(this.#root, 'books');
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.sqlite'))
      .map((name) => name.slice(0, -'.sqlite'.length))
      .sort();
  }

  async user() {
    if (this.#user) return this.#user;
    const SQL = await engine();
    const file = path.join(this.#root, 'user.sqlite');
    if (fs.existsSync(file)) {
      this.#user = new SQL.Database(fs.readFileSync(file));
      if (this.#migrateUser()) this.#persistUser();
    } else {
      this.#user = new SQL.Database();
      for (const statement of USER_SCHEMA) this.#user.run(statement);
      this.#persistUser();
    }
    return this.#user;
  }

  /**
   * Rejoue les paliers manquants sur une base existante. `user_version` fait
   * foi : c'est le PRAGMA standard SQLite, celui que tout autre client lirait,
   * et il doit porter la même valeur après migration.
   */
  #migrateUser() {
    const db = this.#user;
    const version = all(db, 'PRAGMA user_version')[0]?.user_version ?? 0;
    if (version >= USER_DB_SCHEMA_VERSION) return false;

    for (let step = version + 1; step <= USER_DB_SCHEMA_VERSION; step += 1) {
      for (const statement of USER_MIGRATIONS[step] ?? []) db.run(statement);
    }
    db.run(`PRAGMA user_version = ${USER_DB_SCHEMA_VERSION}`);
    // `user_info` est propre à cette implémentation : une base créée par un
    // autre client ne l'a pas, et son absence ne doit pas casser la migration.
    if (first(db, "SELECT name FROM sqlite_master WHERE type='table' AND name='user_info'")) {
      db.run('UPDATE user_info SET schema_version = ?', [USER_DB_SCHEMA_VERSION]);
    }
    return true;
  }

  /** Réécrit `user.sqlite` sur disque : sql.js ne connaît que la mémoire. */
  #persistUser() {
    if (!this.#user) return;
    const file = path.join(this.#root, 'user.sqlite');
    fs.writeFileSync(file, Buffer.from(this.#user.export()));
  }

  /** Exécute [run] puis persiste la base utilisateur. */
  async writeUser(run) {
    const db = await this.user();
    const result = run(db);
    this.#persistUser();
    return result;
  }

  close() {
    this.#catalog?.close();
    this.#user?.close();
    for (const db of this.#books.values()) db.close();
    this.#catalog = null;
    this.#user = null;
    this.#books.clear();
  }
}

/** Exécute une requête et renvoie les lignes sous forme d'objets. */
export function all(db, sql, params = []) {
  const statement = db.prepare(sql);
  try {
    statement.bind(params);
    const rows = [];
    while (statement.step()) rows.push(statement.getAsObject());
    return rows;
  } finally {
    statement.free();
  }
}

/** Première ligne d'une requête, ou `null`. */
export function first(db, sql, params = []) {
  return all(db, sql, params)[0] ?? null;
}
