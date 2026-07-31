import { all, first } from './app-database.js';

/** Erreur remontée à l'interface : message lisible + cause technique. */
export class RepositoryError extends Error {
  constructor(what, cause) {
    super(`Échec : ${what}`);
    this.name = 'RepositoryError';
    this.what = what;
    this.cause = cause;
  }
}

/** Projection commune « carte de livre ». */
const SUMMARY_SELECT = `
  SELECT e.edition_id,
         e.work_id,
         e.title_ar,
         e.subtitle_ar,
         e.category_id,
         e.volume_count,
         e.language,
         e.cover_url,
         c.label_ar                                AS category_label,
         COALESCE(a.short_name_ar, a.full_name_ar) AS author_name,
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
  authorName: row.author_name ?? null,
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
});

const volume = (row) => ({
  volumeId: row.volume_id,
  partNumber: row.part_number,
  label: row.label_ar ?? null,
  sequenceNum: row.sequence_num,
  firstPageId: row.first_page_id ?? null,
  lastPageId: row.last_page_id ?? null,
});

const progress = (row) =>
  row.current_page_id == null
    ? null
    : {
        editionId: row.edition_id,
        pageId: row.current_page_id,
        sequenceNum: row.current_sequence_num ?? 1,
        percent: row.progress_percent ?? 0,
        updatedAt: row.last_opened_at ?? null,
      };

/**
 * Implémentation local-first : catalogue et livres lus dans les fichiers SQLite
 * installés, état utilisateur écrit dans `user.sqlite`. Seul ce module connaît
 * le SQL ; l'interface ne voit que des objets simples.
 */
export class BookRepository {
  #db;

  constructor(database) {
    this.#db = database;
  }

  async #guard(what, run) {
    try {
      return await run();
    } catch (error) {
      throw new RepositoryError(what, error);
    }
  }

  /** Marque comme installés les livres livrés avec l'application. */
  warmUp() {
    return this.#guard('initialisation de la bibliothèque', async () => {
      const catalog = await this.#db.catalog();
      const editions = all(
        catalog,
        `SELECT e.edition_id, r.release_id, r.uncompressed_size, r.published_at
         FROM editions e
         LEFT JOIN book_releases r ON r.edition_id = e.edition_id AND r.is_active = 1
         WHERE e.is_hidden = 0`,
      );
      await this.#db.writeUser((user) => {
        for (const row of editions) {
          user.run(
            `INSERT OR IGNORE INTO downloaded_books
               (edition_id, release_id, local_path, download_status,
                downloaded_bytes, total_bytes, downloaded_at, progress_percent)
             VALUES (?,?,?,?,?,?,?,0)`,
            [
              row.edition_id,
              row.release_id ?? null,
              `books/${row.edition_id}.sqlite`,
              'installed',
              row.uncompressed_size ?? 0,
              row.uncompressed_size ?? 0,
              row.published_at ?? null,
            ],
          );
        }
      });
    });
  }

  // --------------------------------------------------------------- catalogue

  getCategories() {
    return this.#guard('lecture des catégories', async () => {
      const db = await this.#db.catalog();
      return all(
        db,
        `SELECT c.category_id, c.label_ar, c.parent_id, c.sort_order,
                COUNT(e.edition_id) AS book_count
         FROM categories c
         LEFT JOIN editions e ON e.category_id = c.category_id AND e.is_hidden = 0
         GROUP BY c.category_id
         ORDER BY c.sort_order`,
      ).map((row) => ({
        categoryId: row.category_id,
        label: row.label_ar,
        parentId: row.parent_id ?? null,
        bookCount: row.book_count ?? 0,
      }));
    });
  }

  getRecentBooks({ limit = 12 } = {}) {
    return this.#guard('lecture des nouveautés', async () => {
      const db = await this.#db.catalog();
      return all(
        db,
        `${SUMMARY_SELECT} GROUP BY e.edition_id
         ORDER BY r.published_at DESC, e.title_ar LIMIT ?`,
        [limit],
      ).map(bookSummary);
    });
  }

  getBooks({ offset = 0, limit = 20 } = {}) {
    return this.#guard('lecture du catalogue', async () => {
      const db = await this.#db.catalog();
      return all(
        db,
        `${SUMMARY_SELECT} GROUP BY e.edition_id ORDER BY e.title_ar LIMIT ? OFFSET ?`,
        [limit, offset],
      ).map(bookSummary);
    });
  }

  getBooksByCategory(categoryId, { limit = 20 } = {}) {
    return this.#guard('lecture de la catégorie', async () => {
      const db = await this.#db.catalog();
      return all(
        db,
        `${SUMMARY_SELECT} AND e.category_id = ? GROUP BY e.edition_id
         ORDER BY e.title_ar LIMIT ?`,
        [categoryId, limit],
      ).map(bookSummary);
    });
  }

  getBookDetail(editionId) {
    return this.#guard('lecture de la fiche livre', async () => {
      const catalog = await this.#db.catalog();
      const summaryRow = first(
        catalog,
        `${SUMMARY_SELECT} AND e.edition_id = ? GROUP BY e.edition_id LIMIT 1`,
        [editionId],
      );
      if (!summaryRow) throw new Error(`édition introuvable : ${editionId}`);
      const summary = bookSummary(summaryRow);

      const meta =
        first(
          catalog,
          `SELECT e.bibliography_text, e.publisher_ar, e.edition_label_ar,
                  e.publication_year, e.work_id, e.book_type_label,
                  r.page_count, r.toc_count
           FROM editions e
           LEFT JOIN book_releases r ON r.edition_id = e.edition_id AND r.is_active = 1
           WHERE e.edition_id = ?`,
          [editionId],
        ) ?? {};

      const authors = all(
        catalog,
        `SELECT a.*, ea.role
         FROM edition_authors ea
         JOIN authors a ON a.author_id = ea.author_id
         WHERE ea.edition_id = ?
         ORDER BY ea.position`,
        [editionId],
      ).map(author);

      const otherEditions = all(
        catalog,
        `${SUMMARY_SELECT} AND e.work_id = ? AND e.edition_id <> ? GROUP BY e.edition_id`,
        [meta.work_id ?? summary.workId, editionId],
      ).map(bookSummary);

      // Le fichier du livre peut ne pas être installé : la fiche reste lisible.
      let volumes = [];
      try {
        const book = await this.#db.book(editionId);
        volumes = all(book, 'SELECT * FROM volumes ORDER BY sequence_num').map(
          volume,
        );
      } catch {
        volumes = [];
      }

      return {
        summary,
        authors,
        volumes,
        otherEditions,
        bibliographyText: meta.bibliography_text ?? null,
        publisher: meta.publisher_ar ?? null,
        editionLabel: meta.edition_label_ar ?? null,
        publicationYear: meta.publication_year ?? null,
        bookTypeLabel: meta.book_type_label ?? null,
        pageCount: meta.page_count ?? null,
        tocCount: meta.toc_count ?? null,
      };
    });
  }

  getFeaturedAuthor() {
    return this.#guard("lecture de l'auteur en vedette", async () => {
      const db = await this.#db.catalog();
      const row = first(
        db,
        `SELECT a.*, COUNT(ea.edition_id) AS book_count
         FROM authors a
         JOIN edition_authors ea ON ea.author_id = a.author_id
         GROUP BY a.author_id
         ORDER BY book_count DESC, a.full_name_ar
         LIMIT 1`,
      );
      return row ? author(row) : null;
    });
  }

  getBooksByAuthor(authorId, { limit = 10 } = {}) {
    return this.#guard("lecture des livres de l'auteur", async () => {
      const db = await this.#db.catalog();
      return all(
        db,
        `${SUMMARY_SELECT} AND e.edition_id IN (
           SELECT edition_id FROM edition_authors WHERE author_id = ?
         )
         GROUP BY e.edition_id ORDER BY e.title_ar LIMIT ?`,
        [authorId, limit],
      ).map(bookSummary);
    });
  }

  // ----------------------------------------------------------------- contenu

  getToc(editionId) {
    return this.#guard('lecture du sommaire', async () => {
      const db = await this.#db.book(editionId);
      return all(db, 'SELECT * FROM toc ORDER BY sequence_num').map(tocEntry);
    });
  }

  getPageCount(editionId) {
    return this.#guard('comptage des pages', async () => {
      const db = await this.#db.book(editionId);
      return first(db, 'SELECT COUNT(*) AS n FROM pages')?.n ?? 0;
    });
  }

  getPages(editionId, { offset = 0, limit = 20 } = {}) {
    return this.#guard('lecture des pages', async () => {
      const db = await this.#db.book(editionId);
      return all(
        db,
        'SELECT * FROM pages ORDER BY sequence_num LIMIT ? OFFSET ?',
        [limit, offset],
      ).map(page);
    });
  }

  getPageById(editionId, pageId) {
    return this.#guard("lecture d'une page", async () => {
      const db = await this.#db.book(editionId);
      const row = first(db, 'SELECT * FROM pages WHERE page_id = ? LIMIT 1', [
        pageId,
      ]);
      return row ? page(row) : null;
    });
  }

  // ------------------------------------------------------------ bibliothèque

  getLibrary() {
    return this.#guard('lecture de la bibliothèque', async () => {
      const user = await this.#db.user();
      const installed = all(
        user,
        `SELECT * FROM downloaded_books
         ORDER BY last_opened_at DESC, downloaded_at DESC`,
      );
      return installed.length ? this.#joinWithCatalog(installed) : [];
    });
  }

  getContinueReading() {
    return this.#guard('lecture de la reprise', async () => {
      const user = await this.#db.user();
      const rows = all(
        user,
        `SELECT * FROM downloaded_books
         WHERE last_opened_at IS NOT NULL
         ORDER BY last_opened_at DESC LIMIT 1`,
      );
      if (!rows.length) return null;
      const entries = await this.#joinWithCatalog(rows);
      return entries[0] ?? null;
    });
  }

  async #joinWithCatalog(installedRows) {
    const catalog = await this.#db.catalog();
    const ids = installedRows.map((row) => row.edition_id);
    const placeholders = ids.map(() => '?').join(',');
    const booksById = new Map(
      all(
        catalog,
        `${SUMMARY_SELECT} AND e.edition_id IN (${placeholders}) GROUP BY e.edition_id`,
        ids,
      ).map((row) => [row.edition_id, bookSummary(row)]),
    );

    const entries = [];
    for (const row of installedRows) {
      const book = booksById.get(row.edition_id);
      if (!book) continue;
      entries.push({
        book,
        status: row.download_status ?? 'installed',
        progress: progress(row),
        lastOpenedAt: row.last_opened_at ?? null,
        percent: row.progress_percent ?? 0,
      });
    }
    return entries;
  }

  getProgress(editionId) {
    return this.#guard('lecture de la progression', async () => {
      const user = await this.#db.user();
      const row = first(
        user,
        `SELECT * FROM downloaded_books
         WHERE edition_id = ? AND current_page_id IS NOT NULL LIMIT 1`,
        [editionId],
      );
      return row ? progress(row) : null;
    });
  }

  saveProgress({ editionId, pageId, sequenceNum, percent, updatedAt }) {
    return this.#guard('enregistrement de la progression', async () => {
      await this.#db.writeUser((user) => {
        user.run(
          `INSERT INTO downloaded_books
             (edition_id, download_status, current_page_id,
              current_sequence_num, progress_percent, last_opened_at)
           VALUES (?, 'installed', ?, ?, ?, ?)
           ON CONFLICT(edition_id) DO UPDATE SET
             current_page_id      = excluded.current_page_id,
             current_sequence_num = excluded.current_sequence_num,
             progress_percent     = excluded.progress_percent,
             last_opened_at       = excluded.last_opened_at`,
          [
            editionId,
            pageId,
            sequenceNum ?? 1,
            percent ?? 0,
            updatedAt ?? new Date().toISOString(),
          ],
        );
      });
    });
  }

  // --------------------------------------------------------------- réglages

  getSettings() {
    return this.#guard('lecture des réglages', async () => {
      const user = await this.#db.user();
      return Object.fromEntries(
        all(user, 'SELECT key, value FROM app_settings').map((row) => [
          row.key,
          row.value,
        ]),
      );
    });
  }

  saveSetting(key, value) {
    return this.#guard("enregistrement d'un réglage", async () => {
      await this.#db.writeUser((user) => {
        user.run(
          'INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)',
          [key, String(value)],
        );
      });
    });
  }
}

/** Méthodes exposées au rendu par IPC (aucune autre n'est appelable). */
export const REPOSITORY_METHODS = [
  'warmUp',
  'getCategories',
  'getRecentBooks',
  'getBooks',
  'getBooksByCategory',
  'getBookDetail',
  'getFeaturedAuthor',
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
];
