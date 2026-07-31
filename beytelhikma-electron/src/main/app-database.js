import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
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

export const USER_DB_SCHEMA_VERSION = 1;

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
  `CREATE TABLE user_info (schema_version INTEGER NOT NULL)`,
  `INSERT INTO user_info (schema_version) VALUES (${USER_DB_SCHEMA_VERSION})`,
];

/**
 * Accès aux trois bases de l'application (voir DATAMODEL.md) :
 *
 *  * `catalog.sqlite`            — catalogue, lecture seule ;
 *  * `books/<edition_id>.sqlite` — contenu d'un livre, lecture seule ;
 *  * `user.sqlite`               — bibliothèque, progression, réglages.
 *
 * Tant que le pipeline de téléchargement n'existe pas, catalogue et livres sont
 * livrés dans `assets/sample/` puis copiés au premier accès dans le dossier de
 * données : le reste du code lit déjà des fichiers *installés*, comme il le fera
 * avec le CDN.
 *
 * sql.js travaille en mémoire : toute écriture dans `user.sqlite` est
 * immédiatement réexportée sur disque (le fichier pèse quelques kilo-octets).
 */
export class AppDatabase {
  #assetsDir;
  #root;
  #catalog = null;
  #user = null;
  #books = new Map();

  constructor({ assetsDir, storageRoot }) {
    this.#assetsDir = assetsDir;
    this.#root = storageRoot;
  }

  get root() {
    return this.#root;
  }

  async initialize() {
    fs.mkdirSync(path.join(this.#root, 'books'), { recursive: true });
    await engine();
  }

  /**
   * Copie l'asset vers [target] s'il n'y est pas encore, ou si sa taille diffère
   * (le générateur de données d'exemple change la taille du fichier).
   */
  #materialize(assetRelativePath, targetPath) {
    const source = path.join(this.#assetsDir, assetRelativePath);
    if (!fs.existsSync(source)) {
      if (fs.existsSync(targetPath)) return targetPath;
      throw new Error(`asset introuvable : ${assetRelativePath}`);
    }
    const size = fs.statSync(source).size;
    if (!fs.existsSync(targetPath) || fs.statSync(targetPath).size !== size) {
      fs.copyFileSync(source, targetPath);
    }
    return targetPath;
  }

  async #open(filePath) {
    const SQL = await engine();
    return new SQL.Database(fs.readFileSync(filePath));
  }

  async catalog() {
    if (this.#catalog) return this.#catalog;
    const file = this.#materialize(
      'sample/catalog.sqlite',
      path.join(this.#root, 'catalog.sqlite'),
    );
    this.#catalog = await this.#open(file);
    return this.#catalog;
  }

  async book(editionId) {
    const cached = this.#books.get(editionId);
    if (cached) return cached;
    const file = this.#materialize(
      `sample/books/${editionId}.sqlite`,
      path.join(this.#root, 'books', `${editionId}.sqlite`),
    );
    const db = await this.#open(file);
    this.#books.set(editionId, db);
    return db;
  }

  async user() {
    if (this.#user) return this.#user;
    const SQL = await engine();
    const file = path.join(this.#root, 'user.sqlite');
    if (fs.existsSync(file)) {
      this.#user = new SQL.Database(fs.readFileSync(file));
    } else {
      this.#user = new SQL.Database();
      for (const statement of USER_SCHEMA) this.#user.run(statement);
      this.#persistUser();
    }
    return this.#user;
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
