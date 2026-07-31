import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { arabicSearchPattern, normalizeArabic } from '../shared/arabic.js';
import { all, first } from './app-database.js';
import { buildCount, buildFacetQuery, buildList } from './catalog-query.js';
import { DownloadQueue } from './download-manager.js';

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
  // `pageId` est l'identifiant source, global au corpus (sept chiffres) : il ne
  // doit jamais être montré. Ce qu'on affiche est le numéro imprimé, et à
  // défaut le rang de la page dans le livre.
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

/** Caractères conservés de part et d'autre d'une correspondance. */
const SNIPPET_MARGIN = 60;

/**
 * Extrait centré sur la première correspondance de [pattern] dans [text].
 * Renvoie les trois morceaux séparément : l'interface décide de la mise en
 * forme, et aucune chaîne HTML ne traverse l'IPC.
 */
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

/**
 * Implémentation local-first : catalogue et livres lus dans les fichiers SQLite
 * installés, état utilisateur écrit dans `user.sqlite`. Seul ce module connaît
 * le SQL ; l'interface ne voit que des objets simples.
 */
export class BookRepository {
  #db;
  #downloads = null;
  #nameIndex = null;

  constructor(database, { downloads = null } = {}) {
    this.#db = database;
    this.#downloads = downloads;
  }

  get downloads() {
    return this.#downloads;
  }

  async #guard(what, run) {
    try {
      return await run();
    } catch (error) {
      throw new RepositoryError(what, error);
    }
  }

  // ------------------------------------------------------------ téléchargement

  /**
   * Construit la file de téléchargement câblée sur ce dépôt : elle lui demande
   * la release active et lui délègue l'écriture dans `user.sqlite`.
   */
  createDownloadQueue() {
    this.#downloads = new DownloadQueue({
      storageRoot: this.#db.root,
      librarySource: this.#db.librarySource,
      resolveRelease: (editionId) => this.#activeRelease(editionId),
      persist: (editionId, patch) => this.#persistDownload(editionId, patch),
    });
    return this.#downloads;
  }

  async #activeRelease(editionId) {
    const catalog = await this.#db.catalog();
    const row = first(
      catalog,
      `SELECT release_id, download_url, sha256, compressed_size, uncompressed_size
       FROM book_releases WHERE edition_id = ? AND is_active = 1 LIMIT 1`,
      [editionId],
    );
    if (!row) return null;
    return {
      releaseId: row.release_id,
      url: row.download_url,
      sha256: row.sha256,
      compressedSize: row.compressed_size ?? 0,
      uncompressedSize: row.uncompressed_size ?? 0,
    };
  }

  async #persistDownload(editionId, patch) {
    await this.#db.writeUser((user) => {
      user.run(
        `INSERT INTO downloaded_books
           (edition_id, release_id, local_path, download_status,
            downloaded_bytes, total_bytes, downloaded_at, progress_percent)
         VALUES (?,?,?,?,?,?,?,0)
         ON CONFLICT(edition_id) DO UPDATE SET
           release_id       = COALESCE(excluded.release_id, downloaded_books.release_id),
           local_path       = COALESCE(excluded.local_path, downloaded_books.local_path),
           download_status  = excluded.download_status,
           downloaded_bytes = excluded.downloaded_bytes,
           total_bytes      = CASE WHEN excluded.total_bytes > 0
                                   THEN excluded.total_bytes
                                   ELSE downloaded_books.total_bytes END,
           downloaded_at    = COALESCE(excluded.downloaded_at, downloaded_books.downloaded_at)`,
        [
          editionId,
          patch.releaseId ?? null,
          patch.localPath ?? null,
          patch.status,
          patch.receivedBytes ?? 0,
          patch.totalBytes ?? 0,
          patch.status === 'installed' ? new Date().toISOString() : null,
        ],
      );
    });
  }

  downloadBook(editionId) {
    return this.#guard('mise en file du téléchargement', async () => {
      if (!this.#downloads) throw new Error('gestionnaire de téléchargement absent');
      return this.#downloads.enqueue(editionId);
    });
  }

  cancelDownload(editionId) {
    return this.#guard("annulation du téléchargement", async () => {
      this.#downloads?.cancel(editionId);
    });
  }

  retryDownload(editionId) {
    return this.#guard('réessai du téléchargement', async () => {
      if (!this.#downloads) throw new Error('gestionnaire de téléchargement absent');
      return this.#downloads.retry(editionId);
    });
  }

  /**
   * Supprime le fichier du livre. [keepProgress] décide du sort de l'état
   * utilisateur : conservé (le livre repasse en `removed`) ou effacé avec la
   * ligne et les appartenances aux collections.
   */
  deleteBook(editionId, { keepProgress = true } = {}) {
    return this.#guard('suppression du livre', async () => {
      if (this.#downloads?.isBusy(editionId)) {
        throw new Error('téléchargement en cours : annuler avant de supprimer');
      }

      this.#db.closeBook(editionId);
      const root = this.#db.root;
      fs.rmSync(path.join(root, 'books', `${editionId}.sqlite`), { force: true });
      fs.rmSync(path.join(root, 'downloads', `${editionId}.zst.part`), { force: true });
      fs.rmSync(path.join(root, 'downloads', `${editionId}.sqlite.tmp`), { force: true });

      await this.#db.writeUser((user) => {
        if (keepProgress) {
          user.run(
            `UPDATE downloaded_books
                SET download_status = 'removed', downloaded_bytes = 0, local_path = NULL
              WHERE edition_id = ?`,
            [editionId],
          );
        } else {
          user.run('DELETE FROM downloaded_books WHERE edition_id = ?', [editionId]);
          user.run('DELETE FROM collection_books WHERE edition_id = ?', [editionId]);
        }
      });
    });
  }

  /**
   * Confronte les fichiers réellement présents aux lignes de `downloaded_books`.
   * Remplace l'ancien `warmUp()`, qui déclarait tout le catalogue installé.
   */
  reconcileLibrary() {
    return this.#guard('réconciliation de la bibliothèque', async () => {
      const present = new Set(this.#db.installedBooks());
      const user = await this.#db.user();
      const rows = all(user, 'SELECT edition_id, download_status FROM downloaded_books');
      const known = new Set(rows.map((row) => row.edition_id));

      await this.#db.writeUser((db) => {
        for (const row of rows) {
          if (present.has(row.edition_id)) {
            if (row.download_status !== 'installed') {
              db.run(
                "UPDATE downloaded_books SET download_status = 'installed' WHERE edition_id = ?",
                [row.edition_id],
              );
            }
          } else if (row.download_status === 'installed') {
            db.run(
              `UPDATE downloaded_books
                  SET download_status = 'removed', downloaded_bytes = 0, local_path = NULL
                WHERE edition_id = ?`,
              [row.edition_id],
            );
          } else if (
            row.download_status === 'downloading' ||
            row.download_status === 'verifying'
          ) {
            db.run("UPDATE downloaded_books SET download_status = 'queued' WHERE edition_id = ?", [
              row.edition_id,
            ]);
          }
        }
        // Fichier posé à la main, sans ligne : on l'adopte.
        for (const editionId of present) {
          if (known.has(editionId)) continue;
          db.run(
            `INSERT INTO downloaded_books
               (edition_id, local_path, download_status, downloaded_bytes,
                total_bytes, downloaded_at, progress_percent)
             VALUES (?,?, 'installed', 0, 0, ?, 0)`,
            [editionId, `books/${editionId}.sqlite`, new Date().toISOString()],
          );
        }
      });

      // Les téléchargements interrompus repartent seuls.
      if (this.#downloads) {
        const resumable = all(
          await this.#db.user(),
          "SELECT edition_id FROM downloaded_books WHERE download_status = 'queued'",
        );
        for (const row of resumable) this.#downloads.enqueue(row.edition_id);
      }
    });
  }

  getDownloads() {
    return this.#guard('lecture des téléchargements', async () => this.#downloads?.snapshot() ?? []);
  }

  clearFailedDownloads() {
    return this.#guard('nettoyage des téléchargements échoués', async () => {
      this.#downloads?.clearFailed();
    });
  }

  getStorageUsage() {
    return this.#guard("lecture de l'espace occupé", async () => {
      const dir = path.join(this.#db.root, 'books');
      const ids = this.#db.installedBooks();
      let bytes = 0;
      for (const editionId of ids) {
        try {
          bytes += fs.statSync(path.join(dir, `${editionId}.sqlite`)).size;
        } catch {
          // Fichier disparu entre le listage et la mesure : il ne compte pas.
        }
      }
      return { bookCount: ids.length, bytes };
    });
  }

  /**
   * Joint le statut d'installation aux résumés d'une page de résultats.
   * Une seule requête `user.sqlite` par appel, pas une par livre.
   */
  async #withDownloadStatus(summaries) {
    if (!summaries.length) return summaries;
    const user = await this.#db.user();
    const ids = summaries.map((book) => book.editionId);
    const placeholders = ids.map(() => '?').join(',');
    const byId = new Map(
      all(
        user,
        `SELECT edition_id, download_status FROM downloaded_books
          WHERE edition_id IN (${placeholders})`,
        ids,
      ).map((row) => [row.edition_id, row.download_status]),
    );
    const live = new Map(
      (this.#downloads?.snapshot() ?? []).map((job) => [job.editionId, job.status]),
    );
    for (const book of summaries) {
      book.downloadStatus = live.get(book.editionId) ?? byId.get(book.editionId) ?? null;
    }
    return summaries;
  }

  // ------------------------------------------------------------- exploration

  /** Identifiants des livres installés, pour le filtre de statut. */
  async #installedIds() {
    const user = await this.#db.user();
    return all(
      user,
      "SELECT edition_id FROM downloaded_books WHERE download_status = 'installed'",
    ).map((row) => row.edition_id);
  }

  /**
   * Index mémoire des titres, des auteurs et des éditeurs, tous normalisés.
   *
   * Deux raisons de ne pas faire ça en SQL. D'abord `authors.full_name_ar`,
   * `editions.publisher_ar` et `editions.title_ar` ne sont pas normalisés en
   * base et le schéma ne bouge pas : un `LIKE` manquerait toute variante de
   * hamza. Ensuite `catalog_fts` est inutilisable ici — le build sql.js
   * embarqué ne contient pas le module FTS5, seulement FTS4.
   *
   * Quelques milliers de chaînes, construites une fois par session.
   */
  async #names() {
    if (this.#nameIndex) return this.#nameIndex;
    const catalog = await this.#db.catalog();

    const titles = all(
      catalog,
      `SELECT edition_id, title_ar, subtitle_ar FROM editions WHERE is_hidden = 0`,
    ).map((row) => ({
      editionId: row.edition_id,
      needle: normalizeArabic(`${row.title_ar} ${row.subtitle_ar ?? ''}`),
    }));

    const authors = all(
      catalog,
      `SELECT a.author_id, COALESCE(a.short_name_ar, a.full_name_ar) AS label,
              a.full_name_ar, COUNT(DISTINCT e.edition_id) AS n
         FROM authors a
         JOIN edition_authors ea ON ea.author_id = a.author_id
         JOIN editions e         ON e.edition_id = ea.edition_id AND e.is_hidden = 0
        GROUP BY a.author_id`,
    ).map((row) => ({
      value: row.author_id,
      label: row.label,
      count: row.n,
      needle: normalizeArabic(`${row.full_name_ar} ${row.label}`),
    }));

    const publishers = all(
      catalog,
      `SELECT publisher_ar AS label, COUNT(*) AS n FROM editions
        WHERE is_hidden = 0 AND publisher_ar IS NOT NULL AND publisher_ar <> ''
        GROUP BY publisher_ar`,
    ).map((row) => ({
      value: row.label,
      label: row.label,
      count: row.n,
      needle: normalizeArabic(row.label),
    }));

    this.#nameIndex = { titles, authors, publishers };
    return this.#nameIndex;
  }

  /**
   * Traduit `text` en une liste d'`edition_id`. Un terme peut désigner un titre
   * **ou** un auteur : les deux ensembles sont réunis, jamais croisés. La
   * requête sortante ne porte plus de texte, seulement des identifiants.
   */
  async #resolveText(query) {
    if (!query.text?.trim()) return query;
    const needle = normalizeArabic(query.text);
    if (!needle) return query;

    const { titles, authors } = await this.#names();
    const ids = new Set(
      titles.filter((entry) => entry.needle.includes(needle)).map((entry) => entry.editionId),
    );

    const matchedAuthors = authors
      .filter((entry) => entry.needle.includes(needle))
      .map((entry) => entry.value);
    if (matchedAuthors.length) {
      const catalog = await this.#db.catalog();
      for (const row of all(
        catalog,
        `SELECT edition_id FROM edition_authors
          WHERE author_id IN (${matchedAuthors.map(() => '?').join(',')})`,
        matchedAuthors,
      )) {
        ids.add(row.edition_id);
      }
    }

    // Un tableau vide est significatif : « aucun résultat », pas « pas de filtre ».
    return { ...query, text: null, ids: [...ids] };
  }

  exploreBooks(query = {}) {
    return this.#guard('exploration du catalogue', async () => {
      const db = await this.#db.catalog();
      const options = { installedIds: await this.#installedIds() };
      const resolved = await this.#resolveText(query);
      const list = buildList(resolved, options);
      const count = buildCount(resolved, options);
      const books = await this.#withDownloadStatus(
        all(db, list.sql, list.params).map(bookSummary),
      );
      const totals = first(db, count.sql, count.params) ?? { n: 0, bytes: 0 };
      return { books, total: totals.n, bytes: totals.bytes };
    });
  }

  getFacets(query = {}) {
    return this.#guard('lecture des facettes', async () => {
      const db = await this.#db.catalog();
      const options = { installedIds: await this.#installedIds() };
      const resolved = await this.#resolveText(query);

      const labelsById = new Map(
        all(db, 'SELECT category_id, label_ar FROM categories').map((row) => [
          row.category_id,
          row.label_ar,
        ]),
      );
      const facet = (key, label) => {
        const built = buildFacetQuery(resolved, key, options);
        return all(db, built.sql, built.params).map((row) => ({
          value: row.value,
          label: label(row.value),
          count: row.n,
        }));
      };

      // Le statut se compte à part : ses deux valeurs ne sortent pas d'un GROUP BY.
      const withoutStatus = { ...resolved, status: null };
      const countFor = (status) => {
        const built = buildCount({ ...withoutStatus, status }, options);
        return first(db, built.sql, built.params)?.n ?? 0;
      };

      return {
        categories: facet('categories', (id) => labelsById.get(id) ?? String(id)),
        types: facet('types', (value) => value),
        centuries: facet('centuries', (value) => `القرن ${value}`),
        publishers: facet('publishers', (value) => value).slice(0, 30),
        status: [
          { value: 'installed', label: 'مُنزَّل', count: countFor('installed') },
          { value: 'missing', label: 'غير مُنزَّل', count: countFor('missing') },
        ],
      };
    });
  }

  suggestValues(facetKey, term) {
    return this.#guard('suggestion de valeurs', async () => {
      const index = await this.#names();
      const list = index[facetKey];
      if (!list) throw new Error(`facette sans suggestions : ${facetKey}`);
      const needle = normalizeArabic(term ?? '');
      if (needle.length < 2) return [];
      return list
        .filter((entry) => entry.needle.includes(needle))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20)
        .map(({ value, label, count }) => ({ value, label, count }));
    });
  }

  getSelectionWeight(editionIds = []) {
    return this.#guard('pesée de la sélection', async () => {
      if (!editionIds.length) return { count: 0, bytes: 0 };
      const installed = new Set(await this.#installedIds());
      const pending = editionIds.filter((id) => !installed.has(id));
      if (!pending.length) return { count: 0, bytes: 0 };
      const db = await this.#db.catalog();
      const row = first(
        db,
        `SELECT COUNT(*) AS n, COALESCE(SUM(compressed_size), 0) AS bytes
           FROM book_releases
          WHERE is_active = 1 AND edition_id IN (${pending.map(() => '?').join(',')})`,
        pending,
      );
      return { count: row?.n ?? 0, bytes: row?.bytes ?? 0 };
    });
  }

  downloadSelection(editionIds = []) {
    return this.#guard('mise en file de la sélection', async () => {
      if (!this.#downloads) throw new Error('gestionnaire de téléchargement absent');
      const installed = new Set(await this.#installedIds());
      let queued = 0;
      for (const editionId of editionIds) {
        if (installed.has(editionId)) continue;
        this.#downloads.enqueue(editionId);
        queued += 1;
      }
      return queued;
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
      return this.#withDownloadStatus(
        all(
          db,
          `${SUMMARY_SELECT} GROUP BY e.edition_id
           ORDER BY r.published_at DESC, e.title_ar LIMIT ?`,
          [limit],
        ).map(bookSummary),
      );
    });
  }

  getBooks({ offset = 0, limit = 20 } = {}) {
    return this.#guard('lecture du catalogue', async () => {
      const db = await this.#db.catalog();
      return this.#withDownloadStatus(
        all(
          db,
          `${SUMMARY_SELECT} GROUP BY e.edition_id ORDER BY e.title_ar LIMIT ? OFFSET ?`,
          [limit, offset],
        ).map(bookSummary),
      );
    });
  }

  getBooksByCategory(categoryId, { limit = 20 } = {}) {
    return this.#guard('lecture de la catégorie', async () => {
      const db = await this.#db.catalog();
      return this.#withDownloadStatus(
        all(
          db,
          `${SUMMARY_SELECT} AND e.category_id = ? GROUP BY e.edition_id
           ORDER BY e.title_ar LIMIT ?`,
          [categoryId, limit],
        ).map(bookSummary),
      );
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

      const release = await this.#activeRelease(editionId);
      const user = await this.#db.user();
      const stored = first(
        user,
        'SELECT download_status FROM downloaded_books WHERE edition_id = ?',
        [editionId],
      );
      const job = (this.#downloads?.snapshot() ?? []).find((item) => item.editionId === editionId);
      const download = {
        status: job?.status ?? stored?.download_status ?? null,
        percent: job?.percent ?? 0,
        error: job?.error ?? null,
        compressedSize: release?.compressedSize ?? 0,
        uncompressedSize: release?.uncompressedSize ?? 0,
        releaseId: release?.releaseId ?? null,
      };

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
        download,
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

  /** Tous les auteurs du catalogue, avec le nombre d'éditions rattachées. */
  getAuthors({ limit = 200 } = {}) {
    return this.#guard('lecture des auteurs', async () => {
      const db = await this.#db.catalog();
      return all(
        db,
        `SELECT a.*, COUNT(DISTINCT e.edition_id) AS book_count
         FROM authors a
         JOIN edition_authors ea ON ea.author_id = a.author_id
         JOIN editions e         ON e.edition_id = ea.edition_id AND e.is_hidden = 0
         GROUP BY a.author_id
         HAVING book_count > 0
         ORDER BY book_count DESC, a.full_name_ar
         LIMIT ?`,
        [limit],
      ).map(author);
    });
  }

  /**
   * Siècles hégiriens dérivés de la date de décès des auteurs : c'est le
   * classement usuel du patrimoine arabe, et la seule donnée temporelle fiable
   * du catalogue (les éditions n'ont pas de date de composition).
   */
  getEras() {
    return this.#guard('lecture des siècles', async () => {
      const db = await this.#db.catalog();
      return all(
        db,
        `SELECT (a.death_year_hijri - 1) / 100 + 1        AS century,
                COUNT(DISTINCT e.edition_id)              AS book_count
         FROM authors a
         JOIN edition_authors ea ON ea.author_id = a.author_id
         JOIN editions e         ON e.edition_id = ea.edition_id AND e.is_hidden = 0
         WHERE a.death_year_hijri IS NOT NULL AND a.death_year_hijri > 0
         GROUP BY century
         ORDER BY century`,
      ).map((row) => ({
        century: row.century,
        bookCount: row.book_count ?? 0,
      }));
    });
  }

  getBooksByCentury(century, { limit = 60 } = {}) {
    return this.#guard('lecture du siècle', async () => {
      const db = await this.#db.catalog();
      return this.#withDownloadStatus(
        all(
          db,
          `${SUMMARY_SELECT} AND e.edition_id IN (
             SELECT ea.edition_id
             FROM edition_authors ea
             JOIN authors a ON a.author_id = ea.author_id
             WHERE a.death_year_hijri IS NOT NULL
               AND (a.death_year_hijri - 1) / 100 + 1 = ?
           )
           GROUP BY e.edition_id ORDER BY e.title_ar LIMIT ?`,
          [Number(century), limit],
        ).map(bookSummary),
      );
    });
  }

  getBooksByAuthor(authorId, { limit = 10 } = {}) {
    return this.#guard("lecture des livres de l'auteur", async () => {
      const db = await this.#db.catalog();
      return this.#withDownloadStatus(
        all(
          db,
          `${SUMMARY_SELECT} AND e.edition_id IN (
             SELECT edition_id FROM edition_authors WHERE author_id = ?
           )
           GROUP BY e.edition_id ORDER BY e.title_ar LIMIT ?`,
          [authorId, limit],
        ).map(bookSummary),
      );
    });
  }

  // ----------------------------------------------------------------- contenu

  getToc(editionId) {
    return this.#guard('lecture du sommaire', async () => {
      const db = await this.#db.book(editionId);
      return all(
        db,
        `SELECT t.*, p.printed_page_num, p.sequence_num AS page_sequence_num
         FROM toc t
         JOIN pages p ON p.page_id = t.page_id
         ORDER BY t.sequence_num`,
      ).map(tocEntry);
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

  /**
   * Recherche dans le contenu d'un livre.
   *
   * `pages_fts` n'est pas interrogeable — le build sql.js embarqué ne contient
   * pas FTS5 — mais le schéma expose `pages.body_search` et
   * `toc.title_normalized`, déjà normalisés par le pipeline. Un `LIKE` dessus
   * donne le même rappel.
   */
  searchInBook(editionId, term, { limit = 50 } = {}) {
    return this.#guard('recherche dans le livre', async () => {
      const needle = normalizeArabic(term ?? '');
      if (needle.length < 2) return { chapters: [], pages: [], term: needle };

      const db = await this.#db.book(editionId);
      // `%` et `_` sont des jokers LIKE : sans échappement, un terme les
      // contenant ramènerait le livre entier.
      const pattern = `%${needle.replace(/[\\%_]/g, '\\$&')}%`;
      const highlight = arabicSearchPattern(needle);

      const chapters = all(
        db,
        `SELECT t.toc_id, t.page_id, t.title_text, t.level,
                p.printed_page_num, p.sequence_num
           FROM toc t JOIN pages p ON p.page_id = t.page_id
          WHERE t.title_normalized LIKE ? ESCAPE '\\'
          ORDER BY t.sequence_num LIMIT ?`,
        [pattern, limit],
      ).map((row) => ({
        tocId: row.toc_id,
        pageId: row.page_id,
        title: row.title_text,
        level: row.level ?? 1,
        printedPageNum: row.printed_page_num ?? null,
        sequenceNum: row.sequence_num,
      }));

      const pages = all(
        db,
        `SELECT page_id, sequence_num, printed_page_num, body_plain
           FROM pages
          WHERE body_search LIKE ? ESCAPE '\\'
          ORDER BY sequence_num LIMIT ?`,
        [pattern, limit],
      ).map((row) => ({
        pageId: row.page_id,
        sequenceNum: row.sequence_num,
        printedPageNum: row.printed_page_num ?? null,
        snippet: snippetAround(row.body_plain, highlight),
      }));

      return { chapters, pages, term: needle };
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
         WHERE download_status = 'installed'
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
         WHERE last_opened_at IS NOT NULL AND download_status = 'installed'
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

  // ------------------------------------------------------------- collections

  /**
   * Collections personnelles. Elles vivent dans `user.sqlite` et ne contiennent
   * que des références : supprimer une collection n'efface jamais un livre.
   * Une collection peut contenir des livres non installés — c'est autant une
   * liste d'envies qu'un rangement.
   */
  getCollections() {
    return this.#guard('lecture des collections', async () => {
      const user = await this.#db.user();
      const installed = new Set(await this.#installedIds());
      const rows = all(user, 'SELECT * FROM collections ORDER BY sort_order, created_at');
      const links = all(user, 'SELECT collection_id, edition_id FROM collection_books');

      return rows.map((row) => {
        const members = links.filter((link) => link.collection_id === row.collection_id);
        return {
          id: row.collection_id,
          name: row.name,
          description: row.description ?? null,
          bookCount: members.length,
          installedCount: members.filter((link) => installed.has(link.edition_id)).length,
          createdAt: row.created_at,
        };
      });
    });
  }

  createCollection(name) {
    return this.#guard("création d'une collection", async () => {
      const label = String(name ?? '').trim();
      if (!label) throw new Error('nom de collection vide');
      const id = randomUUID();
      const now = new Date().toISOString();
      await this.#db.writeUser((user) => {
        user.run(
          `INSERT INTO collections (collection_id, name, description, sort_order, created_at, updated_at)
           VALUES (?,?,NULL,
                   (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM collections), ?, ?)`,
          [id, label, now, now],
        );
      });
      return id;
    });
  }

  renameCollection(collectionId, name) {
    return this.#guard("renommage d'une collection", async () => {
      const label = String(name ?? '').trim();
      if (!label) throw new Error('nom de collection vide');
      await this.#db.writeUser((user) => {
        user.run('UPDATE collections SET name = ?, updated_at = ? WHERE collection_id = ?', [
          label,
          new Date().toISOString(),
          collectionId,
        ]);
      });
    });
  }

  deleteCollection(collectionId) {
    return this.#guard("suppression d'une collection", async () => {
      await this.#db.writeUser((user) => {
        // Les liens partent, les livres restent installés.
        user.run('DELETE FROM collection_books WHERE collection_id = ?', [collectionId]);
        user.run('DELETE FROM collections WHERE collection_id = ?', [collectionId]);
      });
    });
  }

  addToCollection(collectionId, editionIds = []) {
    return this.#guard('ajout à une collection', async () => {
      if (!editionIds.length) return 0;
      const now = new Date().toISOString();
      let added = 0;
      await this.#db.writeUser((user) => {
        for (const editionId of editionIds) {
          user.run(
            `INSERT OR IGNORE INTO collection_books (collection_id, edition_id, sort_order, added_at)
             VALUES (?,?,
                     (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM collection_books
                       WHERE collection_id = ?), ?)`,
            [collectionId, editionId, collectionId, now],
          );
          // `getRowsModified` rend le compte du dernier statement : une
          // insertion ignorée rend 0, une insertion effective rend 1.
          if (user.getRowsModified() > 0) added += 1;
        }
      });
      return added;
    });
  }

  removeFromCollection(collectionId, editionId) {
    return this.#guard("retrait d'une collection", async () => {
      await this.#db.writeUser((user) => {
        user.run('DELETE FROM collection_books WHERE collection_id = ? AND edition_id = ?', [
          collectionId,
          editionId,
        ]);
      });
    });
  }

  getCollectionBooks(collectionId) {
    return this.#guard("lecture d'une collection", async () => {
      const user = await this.#db.user();
      const rows = all(
        user,
        'SELECT edition_id FROM collection_books WHERE collection_id = ? ORDER BY sort_order',
        [collectionId],
      );
      if (!rows.length) return [];

      const catalog = await this.#db.catalog();
      const ids = rows.map((row) => row.edition_id);
      const books = await this.#withDownloadStatus(
        all(
          catalog,
          `${SUMMARY_SELECT} AND e.edition_id IN (${ids.map(() => '?').join(',')})
           GROUP BY e.edition_id`,
          ids,
        ).map(bookSummary),
      );
      // L'ordre de la collection prime sur celui du catalogue ; une édition
      // absente du catalogue courant est simplement ignorée.
      const byId = new Map(books.map((book) => [book.editionId, book]));
      return ids.map((id) => byId.get(id)).filter(Boolean);
    });
  }

  // --------------------------------------------------------------- réglages

  /** Efface tous les fichiers de livres, en conservant les progressions. */
  deleteAllBooks() {
    return this.#guard('suppression de tous les livres', async () => {
      const ids = this.#db.installedBooks();
      for (const editionId of ids) {
        if (this.#downloads?.isBusy(editionId)) continue;
        await this.deleteBook(editionId, { keepProgress: true });
      }
      return ids.length;
    });
  }

  /** Applique `minio.base_url` à la file en cours, sans redémarrage. */
  setDownloadBaseUrl(url) {
    return this.#guard("réglage de l'adresse du serveur", async () => {
      const value = String(url ?? '').trim();
      await this.saveSetting('minio.base_url', value);
      this.#downloads?.setBaseUrl(value || null);
    });
  }

  /** Informations qu'on réclame quand quelque chose ne va pas. */
  getAbout() {
    return this.#guard("lecture des informations d'application", async () => {
      const catalog = await this.#db.catalog();
      const user = await this.#db.user();
      return {
        librarySource: this.#db.librarySource,
        storageRoot: this.#db.root,
        schemaVersion: first(user, 'SELECT schema_version FROM user_info')?.schema_version ?? null,
        editionCount: first(catalog, 'SELECT COUNT(*) AS n FROM editions WHERE is_hidden = 0')?.n ?? 0,
        categoryCount: first(catalog, 'SELECT COUNT(*) AS n FROM categories')?.n ?? 0,
      };
    });
  }

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
  'reconcileLibrary',
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
  'getCategories',
  'getRecentBooks',
  'getBooks',
  'getBooksByCategory',
  'getBookDetail',
  'getFeaturedAuthor',
  'getAuthors',
  'getEras',
  'getBooksByCentury',
  'getBooksByAuthor',
  'getToc',
  'getPageCount',
  'getPages',
  'getPageById',
  'searchInBook',
  'getLibrary',
  'getContinueReading',
  'getProgress',
  'saveProgress',
  'getSettings',
  'saveSetting',
  'getCollections',
  'createCollection',
  'renameCollection',
  'deleteCollection',
  'addToCollection',
  'removeFromCollection',
  'getCollectionBooks',
  'deleteAllBooks',
  'setDownloadBaseUrl',
  'getAbout',
];
