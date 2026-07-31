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
/**
 * Repli d'alif pour l'ordre alphabétique. `authors.full_name_ar` n'a pas de
 * colonne normalisée au schéma, et `ORDER BY` trie sur les points de code :
 * « أحمد » se rangerait avant « ابن » alors que l'usage les confond. On replie
 * donc les trois hamzas portées comme le fait `normalize_ar` de
 * `tools/_common.py` — c'est la seule divergence qui se voit à l'œil.
 */
const arabicOrder = (column) =>
  `REPLACE(REPLACE(REPLACE(${column}, 'أ', 'ا'), 'إ', 'ا'), 'آ', 'ا')`;

/** Tris proposés sur les auteurs. Clé inconnue : on retombe sur `count`. */
const AUTHOR_SORTS = {
  count: 'book_count DESC, a.full_name_ar',
  name: `${arabicOrder('COALESCE(a.short_name_ar, a.full_name_ar)')} ASC`,
  // Les auteurs sans date de décès ferment la marche : les dater est faux.
  death: 'a.death_year_hijri IS NULL, a.death_year_hijri ASC, a.full_name_ar',
};

/**
 * Les trois listes de livres qui méritent un écran à elles seules. Une seule
 * requête paramétrée pour les trois : elles ne diffèrent que par leur filtre
 * et par l'intitulé qui les nomme.
 */
const BOOK_SCOPES = {
  author: {
    where: 'e.edition_id IN (SELECT edition_id FROM edition_authors WHERE author_id = ?)',
    params: (id) => [id],
    label: 'SELECT COALESCE(short_name_ar, full_name_ar) AS label FROM authors WHERE author_id = ?',
  },
  category: {
    where: 'e.category_id = ?',
    params: (id) => [Number(id)],
    label: 'SELECT label_ar AS label FROM categories WHERE category_id = ?',
  },
  era: {
    where: `e.edition_id IN (
      SELECT ea.edition_id
      FROM edition_authors ea
      JOIN authors a ON a.author_id = ea.author_id
      WHERE a.death_year_hijri IS NOT NULL
        AND (a.death_year_hijri - 1) / 100 + 1 = ?
    )`,
    params: (id) => [Number(id)],
    label: null,
  },
};

/** Filtres de la bibliothèque, appliqués sur la progression enregistrée. */
const LIBRARY_FILTERS = {
  all: () => true,
  reading: (row) => (row.progress_percent ?? 0) > 0 && (row.progress_percent ?? 0) < 1,
  done: (row) => (row.progress_percent ?? 0) >= 1,
};

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
  // Décide de la mise en page : tout ce qui n'est pas « كتاب » est un objet
  // d'une autre nature (رسالة جامعية, مجلة, دروس مفرغة) et doit le montrer.
  bookType: row.book_type_label ?? null,
  authorName: row.author_name ?? null,
  // Renseignée pour 69 % des auteurs : elle donne la reliure de la couverture
  // (`src/shared/book-cover.js`), et son absence est un cas prévu, pas un trou.
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

/** Couleur retenue quand l'interface n'en propose pas (jaune de la maquette). */
const HIGHLIGHT_DEFAULT_COLOR = '#f2c744';

const highlight = (row) =>
  row == null
    ? null
    : {
        highlightId: row.highlight_id,
        editionId: row.edition_id,
        pageId: row.page_id,
        startOffset: row.start_offset ?? 0,
        endOffset: row.end_offset ?? 0,
        selectedText: row.selected_text,
        prefixText: row.prefix_text ?? null,
        suffixText: row.suffix_text ?? null,
        color: row.color ?? HIGHLIGHT_DEFAULT_COLOR,
        createdAt: row.created_at,
      };

const note = (row) =>
  row == null
    ? null
    : {
        noteId: row.note_id,
        editionId: row.edition_id,
        pageId: row.page_id ?? null,
        highlightId: row.highlight_id ?? null,
        content: row.content,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };

const bookmark = (row) =>
  row == null
    ? null
    : {
        bookmarkId: row.bookmark_id,
        editionId: row.edition_id,
        pageId: row.page_id,
        textOffset: row.text_offset ?? null,
        label: row.label ?? null,
        createdAt: row.created_at,
      };

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
  /** Ordre alphabétique du catalogue, construit une fois par session. */
  #titleOrderCache = null;

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
      `SELECT release_id, object_key, sha256, compressed_size, uncompressed_size
       FROM book_releases WHERE edition_id = ? AND is_active = 1 LIMIT 1`,
      [editionId],
    );
    if (!row) return null;
    return {
      releaseId: row.release_id,
      objectKey: row.object_key,
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
          // Les annotations suivent la progression : effacer l'un sans l'autre
          // laisserait des notes pointant un livre qu'on ne sait plus nommer.
          user.run('DELETE FROM notes WHERE edition_id = ?', [editionId]);
          user.run('DELETE FROM highlights WHERE edition_id = ?', [editionId]);
          user.run('DELETE FROM bookmarks WHERE edition_id = ?', [editionId]);
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

  /**
   * File en cours, chaque travail portant le titre du livre : l'écran de suivi
   * ne doit pas montrer d'`edition_id` brut.
   */
  getDownloads() {
    return this.#guard('lecture des téléchargements', async () => {
      const jobs = this.#downloads?.snapshot() ?? [];
      if (!jobs.length) return jobs;
      const titles = await this.#titlesFor(jobs.map((job) => job.editionId));
      return jobs.map((job) => ({ ...job, title: titles.get(job.editionId) ?? job.editionId }));
    });
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

  /**
   * Identifiants des auteurs dont le nom répond à [text], ou `null` quand il
   * n'y a rien à filtrer. Le tri passe par l'index mémoire de `#names()` :
   * `full_name_ar` n'est pas normalisé au schéma, un `LIKE` manquerait toute
   * variante de hamza.
   */
  async #authorIdsMatching(text) {
    const needle = normalizeArabic(text ?? '');
    if (!needle) return null;
    const { authors } = await this.#names();
    return authors.filter((entry) => entry.needle.includes(needle)).map((entry) => entry.value);
  }

  /**
   * Auteurs du catalogue, paginés, avec le nombre d'éditions rattachées.
   *
   * Le corpus Shamela en compte plusieurs milliers : les ramener tous pour n'en
   * montrer qu'un écran chargeait la mémoire et, pire, laissait l'interface
   * annoncer un total tronqué. `total` porte donc sur la sélection entière.
   */
  getAuthors({ offset = 0, limit = 60, sort = 'count', text = null } = {}) {
    return this.#guard('lecture des auteurs', async () => {
      const db = await this.#db.catalog();
      const matching = await this.#authorIdsMatching(text);
      // Un tableau vide est significatif : « aucun auteur », pas « pas de filtre ».
      if (matching?.length === 0) return { rows: [], total: 0 };

      const where = matching
        ? `AND a.author_id IN (${matching.map(() => '?').join(',')})`
        : '';
      const params = matching ?? [];

      const total =
        first(
          db,
          `SELECT COUNT(*) AS n FROM (
             SELECT a.author_id
             FROM authors a
             JOIN edition_authors ea ON ea.author_id = a.author_id
             JOIN editions e         ON e.edition_id = ea.edition_id AND e.is_hidden = 0
             WHERE 1 = 1 ${where}
             GROUP BY a.author_id
           )`,
          params,
        )?.n ?? 0;

      const rows = all(
        db,
        `SELECT a.*, COUNT(DISTINCT e.edition_id) AS book_count
         FROM authors a
         JOIN edition_authors ea ON ea.author_id = a.author_id
         JOIN editions e         ON e.edition_id = ea.edition_id AND e.is_hidden = 0
         WHERE 1 = 1 ${where}
         GROUP BY a.author_id
         HAVING book_count > 0
         ORDER BY ${AUTHOR_SORTS[sort] ?? AUTHOR_SORTS.count}
         LIMIT ? OFFSET ?`,
        [...params, limit, offset],
      ).map(author);

      return { rows, total };
    });
  }

  /**
   * Ce que l'en-tête des auteurs annonce. Compté en SQL, sur tout le fonds :
   * le déduire d'une page de résultats donnerait un chiffre faux dès que la
   * liste dépasse un écran.
   */
  getAuthorStats() {
    return this.#guard('lecture du décompte des auteurs', async () => {
      const db = await this.#db.catalog();
      const row =
        first(
          db,
          `SELECT COUNT(DISTINCT a.author_id)  AS authors,
                  COUNT(DISTINCT e.edition_id) AS books,
                  MIN(CASE WHEN a.death_year_hijri > 0
                           THEN (a.death_year_hijri - 1) / 100 + 1 END) AS first_century,
                  MAX(CASE WHEN a.death_year_hijri > 0
                           THEN (a.death_year_hijri - 1) / 100 + 1 END) AS last_century
           FROM authors a
           JOIN edition_authors ea ON ea.author_id = a.author_id
           JOIN editions e         ON e.edition_id = ea.edition_id AND e.is_hidden = 0`,
        ) ?? {};
      return {
        authorCount: row.authors ?? 0,
        bookCount: row.books ?? 0,
        firstCentury: row.first_century ?? null,
        lastCentury: row.last_century ?? null,
      };
    });
  }

  /**
   * Une liste de livres qui mérite un écran : ceux d'un auteur, d'une
   * discipline ou d'un siècle. `total` est compté à part — sans lui, l'écran ne
   * pourrait qu'annoncer ce qu'il a reçu, c'est-à-dire mentir dès la page deux.
   */
  getBooksIn({ scope = 'author', id, offset = 0, limit = 24 } = {}) {
    return this.#guard("lecture d'une liste de livres", async () => {
      const target = BOOK_SCOPES[scope];
      if (!target) throw new Error(`portée de liste inconnue : ${scope}`);

      const db = await this.#db.catalog();
      const params = target.params(id);

      const total =
        first(
          db,
          `SELECT COUNT(*) AS n FROM editions e
            WHERE e.is_hidden = 0 AND ${target.where}`,
          params,
        )?.n ?? 0;

      const rows = await this.#withDownloadStatus(
        all(
          db,
          `${SUMMARY_SELECT} AND ${target.where}
           GROUP BY e.edition_id ORDER BY e.title_ar LIMIT ? OFFSET ?`,
          [...params, limit, offset],
        ).map(bookSummary),
      );

      const label = target.label ? (first(db, target.label, [id])?.label ?? null) : null;
      return { rows, total, label };
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

  /**
   * Ordre alphabétique du catalogue, en identifiants seuls et gardé pour la
   * session. Le titre vit dans `catalog.sqlite`, l'installation dans
   * `user.sqlite` : deux fichiers, deux instances sql.js, aucun `ORDER BY` ne
   * peut les traverser. On lit donc l'ordre une fois du côté catalogue et on y
   * pioche ce qui est installé — plutôt qu'un `IN (?,?,…)` de plusieurs milliers
   * de paramètres, que SQLite refuserait.
   */
  async #titleOrder() {
    if (this.#titleOrderCache) return this.#titleOrderCache;
    const catalog = await this.#db.catalog();
    this.#titleOrderCache = all(
      catalog,
      'SELECT edition_id FROM editions WHERE is_hidden = 0 ORDER BY title_ar',
    ).map((row) => row.edition_id);
    return this.#titleOrderCache;
  }

  /**
   * Bibliothèque paginée. Le tri et le filtre portent sur `user.sqlite`, qui ne
   * contient qu'une ligne courte par livre installé ; seule la page demandée
   * est ensuite jointe au catalogue. La jointure passe ainsi de N livres à
   * `limit` — c'est elle qui coûtait, pas le décompte.
   */
  getLibrary({ offset = 0, limit = 24, filter = 'all', sort = 'recent' } = {}) {
    return this.#guard('lecture de la bibliothèque', async () => {
      const user = await this.#db.user();
      const order = await this.#titleOrder();
      // Une ligne de `downloaded_books` peut désigner une édition que le
      // catalogue courant ne connaît plus. Elle ne compte pas : sinon le total
      // annoncerait des pages que la jointure ne saurait pas remplir.
      const known = new Set(order);
      const installed = all(
        user,
        `SELECT * FROM downloaded_books
         WHERE download_status = 'installed'
         ORDER BY last_opened_at DESC, downloaded_at DESC`,
      ).filter((row) => known.has(row.edition_id));

      const counts = {
        all: installed.length,
        reading: installed.filter(LIBRARY_FILTERS.reading).length,
        done: installed.filter(LIBRARY_FILTERS.done).length,
      };

      let selected = installed.filter(LIBRARY_FILTERS[filter] ?? LIBRARY_FILTERS.all);
      if (sort === 'title') {
        const byId = new Map(selected.map((row) => [row.edition_id, row]));
        selected = (await this.#titleOrder()).map((id) => byId.get(id)).filter(Boolean);
      }

      const rows = selected.length
        ? await this.#joinWithCatalog(selected.slice(offset, offset + limit))
        : [];
      return { rows, total: selected.length, counts };
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

  /**
   * Contenu d'une collection, paginé. Une collection peut porter tout le
   * catalogue : seule la page demandée est jointe, et `missing` dit combien de
   * livres restent à télécharger sur l'ensemble — pas sur la page, sinon le
   * bouton « tout télécharger » proposerait moins qu'il n'y a.
   */
  getCollectionBooks(collectionId, { offset = 0, limit = 24 } = {}) {
    return this.#guard("lecture d'une collection", async () => {
      const user = await this.#db.user();
      const ids = all(
        user,
        'SELECT edition_id FROM collection_books WHERE collection_id = ? ORDER BY sort_order',
        [collectionId],
      ).map((row) => row.edition_id);
      if (!ids.length) return { rows: [], total: 0, missing: [] };

      const installed = new Set(
        all(
          user,
          "SELECT edition_id FROM downloaded_books WHERE download_status = 'installed'",
        ).map((row) => row.edition_id),
      );
      const missing = ids.filter((id) => !installed.has(id));

      const slice = ids.slice(offset, offset + limit);
      const catalog = await this.#db.catalog();
      const books = await this.#withDownloadStatus(
        all(
          catalog,
          `${SUMMARY_SELECT} AND e.edition_id IN (${slice.map(() => '?').join(',')})
           GROUP BY e.edition_id`,
          slice,
        ).map(bookSummary),
      );
      // L'ordre de la collection prime sur celui du catalogue ; une édition
      // absente du catalogue courant est simplement ignorée.
      const byId = new Map(books.map((book) => [book.editionId, book]));
      return { rows: slice.map((id) => byId.get(id)).filter(Boolean), total: ids.length, missing };
    });
  }

  // ------------------------------------------------------------ annotations

  /**
   * Toutes les annotations d'un livre, en un aller-retour : le lecteur les
   * réapplique page par page sans requêter à chaque tournage.
   */
  getBookAnnotations(editionId) {
    return this.#guard('lecture des annotations', async () => {
      const user = await this.#db.user();
      return {
        highlights: all(
          user,
          'SELECT * FROM highlights WHERE edition_id = ? ORDER BY page_id, start_offset',
          [editionId],
        ).map(highlight),
        notes: all(
          user,
          'SELECT * FROM notes WHERE edition_id = ? ORDER BY created_at DESC',
          [editionId],
        ).map(note),
        bookmarks: all(
          user,
          'SELECT * FROM bookmarks WHERE edition_id = ? ORDER BY page_id',
          [editionId],
        ).map(bookmark),
      };
    });
  }

  saveHighlight(input) {
    return this.#guard("enregistrement d'un surlignage", async () => {
      const text = String(input.selectedText ?? '').trim();
      if (!text) throw new Error('surlignage sans texte');
      const id = input.highlightId ?? randomUUID();
      const now = new Date().toISOString();
      await this.#db.writeUser((user) => {
        user.run(
          `INSERT INTO highlights
             (highlight_id, edition_id, page_id, start_offset, end_offset,
              selected_text, prefix_text, suffix_text, color, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(highlight_id) DO UPDATE SET
             color        = excluded.color,
             start_offset = excluded.start_offset,
             end_offset   = excluded.end_offset`,
          [
            id,
            input.editionId,
            input.pageId,
            input.startOffset ?? 0,
            input.endOffset ?? 0,
            text,
            input.prefixText ?? null,
            input.suffixText ?? null,
            input.color ?? HIGHLIGHT_DEFAULT_COLOR,
            now,
          ],
        );
      });
      const user = await this.#db.user();
      return highlight(first(user, 'SELECT * FROM highlights WHERE highlight_id = ?', [id]));
    });
  }

  /** Le surlignage part avec les notes qui ne commentaient que lui. */
  deleteHighlight(highlightId) {
    return this.#guard("suppression d'un surlignage", async () => {
      await this.#db.writeUser((user) => {
        user.run('DELETE FROM notes WHERE highlight_id = ?', [highlightId]);
        user.run('DELETE FROM highlights WHERE highlight_id = ?', [highlightId]);
      });
    });
  }

  saveNote(input) {
    return this.#guard("enregistrement d'une note", async () => {
      const content = String(input.content ?? '').trim();
      if (!content) throw new Error('note vide');
      const id = input.noteId ?? randomUUID();
      const now = new Date().toISOString();
      await this.#db.writeUser((user) => {
        user.run(
          `INSERT INTO notes
             (note_id, edition_id, page_id, highlight_id, content, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?)
           ON CONFLICT(note_id) DO UPDATE SET
             content      = excluded.content,
             page_id      = COALESCE(excluded.page_id, notes.page_id),
             highlight_id = COALESCE(excluded.highlight_id, notes.highlight_id),
             updated_at   = excluded.updated_at`,
          [
            id,
            input.editionId,
            input.pageId ?? null,
            input.highlightId ?? null,
            content,
            now,
            now,
          ],
        );
      });
      const user = await this.#db.user();
      return note(first(user, 'SELECT * FROM notes WHERE note_id = ?', [id]));
    });
  }

  deleteNote(noteId) {
    return this.#guard("suppression d'une note", async () => {
      await this.#db.writeUser((user) => {
        user.run('DELETE FROM notes WHERE note_id = ?', [noteId]);
      });
    });
  }

  /** Pose ou retire la marque-page de la page : le lecteur n'a qu'un bouton. */
  toggleBookmark({ editionId, pageId, label = null, textOffset = null }) {
    return this.#guard("bascule d'une marque-page", async () => {
      const user = await this.#db.user();
      const existing = first(
        user,
        'SELECT bookmark_id FROM bookmarks WHERE edition_id = ? AND page_id = ?',
        [editionId, pageId],
      );
      if (existing) {
        await this.#db.writeUser((db) => {
          db.run('DELETE FROM bookmarks WHERE bookmark_id = ?', [existing.bookmark_id]);
        });
        return { added: false, bookmark: null };
      }
      const id = randomUUID();
      await this.#db.writeUser((db) => {
        db.run(
          `INSERT INTO bookmarks (bookmark_id, edition_id, page_id, text_offset, label, created_at)
           VALUES (?,?,?,?,?,?)`,
          [id, editionId, pageId, textOffset, label, new Date().toISOString()],
        );
      });
      const fresh = await this.#db.user();
      return {
        added: true,
        bookmark: bookmark(first(fresh, 'SELECT * FROM bookmarks WHERE bookmark_id = ?', [id])),
      };
    });
  }

  deleteBookmark(bookmarkId) {
    return this.#guard("suppression d'une marque-page", async () => {
      await this.#db.writeUser((user) => {
        user.run('DELETE FROM bookmarks WHERE bookmark_id = ?', [bookmarkId]);
      });
    });
  }

  /**
   * Vue transversale des annotations, tous livres confondus, pour l'écran
   * « ملاحظاتي ». Le filtre texte passe par `normalizeArabic` en mémoire : les
   * volumes sont de l'ordre du millier, et un `LIKE` ignorerait les variantes de
   * hamza que l'utilisateur a lui-même tapées.
   */
  getAnnotations({ kind = 'all', text = null, editionId = null, offset = 0, limit = 30 } = {}) {
    return this.#guard('lecture des annotations', async () => {
      const user = await this.#db.user();
      const clause = editionId ? ' WHERE edition_id = ?' : '';
      const params = editionId ? [editionId] : [];

      const items = [];
      if (kind === 'all' || kind === 'note') {
        items.push(
          ...all(user, `SELECT * FROM notes${clause}`, params).map((row) => ({
            ...note(row),
            kind: 'note',
            sortKey: row.updated_at ?? row.created_at,
            searchText: `${row.content}`,
          })),
        );
      }
      if (kind === 'all' || kind === 'highlight') {
        items.push(
          ...all(user, `SELECT * FROM highlights${clause}`, params).map((row) => ({
            ...highlight(row),
            kind: 'highlight',
            sortKey: row.created_at,
            searchText: row.selected_text,
          })),
        );
      }
      if (kind === 'all' || kind === 'bookmark') {
        items.push(
          ...all(user, `SELECT * FROM bookmarks${clause}`, params).map((row) => ({
            ...bookmark(row),
            kind: 'bookmark',
            sortKey: row.created_at,
            searchText: row.label ?? '',
          })),
        );
      }

      const needle = normalizeArabic(text ?? '');
      const filtered = needle
        ? items.filter((item) => normalizeArabic(item.searchText).includes(needle))
        : items;
      filtered.sort((a, b) => String(b.sortKey).localeCompare(String(a.sortKey)));

      const visible = filtered.slice(offset, offset + limit);
      const titles = await this.#titlesFor(visible.map((item) => item.editionId));
      // Une note peut commenter un surlignage : on rapproche les deux ici plutôt
      // qu'en SQL, la page est déjà en mémoire.
      const highlightsById = new Map(
        all(user, 'SELECT * FROM highlights').map((row) => [row.highlight_id, highlight(row)]),
      );

      // Les compteurs des onglets ignorent le filtre de type : sinon l'onglet
      // qu'on ne regarde pas annoncerait toujours zéro.
      const countOf = (table) =>
        first(user, `SELECT COUNT(*) AS n FROM ${table}${clause}`, params)?.n ?? 0;

      return {
        total: filtered.length,
        counts: {
          note: countOf('notes'),
          highlight: countOf('highlights'),
          bookmark: countOf('bookmarks'),
        },
        items: visible.map(({ searchText, sortKey, ...item }) => ({
          ...item,
          bookTitle: titles.get(item.editionId) ?? item.editionId,
          highlight: item.highlightId ? highlightsById.get(item.highlightId) ?? null : null,
        })),
      };
    });
  }

  /** Titres du catalogue pour un lot d'éditions ; les absentes sont ignorées. */
  async #titlesFor(editionIds) {
    const ids = [...new Set(editionIds.filter(Boolean))];
    if (!ids.length) return new Map();
    const catalog = await this.#db.catalog();
    return new Map(
      all(
        catalog,
        `SELECT edition_id, title_ar FROM editions
          WHERE edition_id IN (${ids.map(() => '?').join(',')})`,
        ids,
      ).map((row) => [row.edition_id, row.title_ar]),
    );
  }

  // ------------------------------------------------- recherche transversale

  /**
   * Recherche le terme dans **tous les livres installés**, un par un.
   *
   * sql.js charge chaque livre entièrement en mémoire : un livre ouvert pour la
   * seule recherche est refermé aussitôt, sinon parcourir la bibliothèque la
   * ferait grossir sans fin. Les livres déjà ouverts (celui qu'on lit) restent
   * en cache.
   *
   * [maxBooks] borne le balayage ; le compte réel est renvoyé pour que
   * l'interface dise ce qui n'a pas été exploré plutôt que de le taire.
   */
  searchLibrary(term, { limit = 60, perBook = 5, maxBooks = 60 } = {}) {
    return this.#guard('recherche dans la bibliothèque', async () => {
      const needle = normalizeArabic(term ?? '');
      if (needle.length < 2) {
        return { results: [], total: 0, scanned: 0, installed: 0, skipped: 0, term: needle };
      }

      const installed = await this.#installedIds();
      const scanning = installed.slice(0, maxBooks);
      const titles = await this.#titlesFor(scanning);
      const pattern = `%${needle.replace(/[\\%_]/g, '\\$&')}%`;
      const marker = arabicSearchPattern(needle);

      const results = [];
      let total = 0;
      for (const editionId of scanning) {
        const wasOpen = this.#db.isBookOpen(editionId);
        let book;
        try {
          book = await this.#db.book(editionId);
        } catch {
          continue; // fichier disparu entre le listage et la lecture
        }
        try {
          const count =
            first(book, `SELECT COUNT(*) AS n FROM pages WHERE body_search LIKE ? ESCAPE '\\'`, [
              pattern,
            ])?.n ?? 0;
          if (!count) continue;
          total += count;

          const hits = all(
            book,
            `SELECT page_id, sequence_num, printed_page_num, body_plain
               FROM pages WHERE body_search LIKE ? ESCAPE '\\'
              ORDER BY sequence_num LIMIT ?`,
            [pattern, perBook],
          );
          results.push({
            editionId,
            title: titles.get(editionId) ?? editionId,
            matchCount: count,
            pages: hits.map((row) => ({
              pageId: row.page_id,
              sequenceNum: row.sequence_num,
              printedPageNum: row.printed_page_num ?? null,
              snippet: snippetAround(row.body_plain, marker),
            })),
          });
        } finally {
          if (!wasOpen) this.#db.closeBook(editionId);
        }
        if (results.length >= limit) break;
      }

      results.sort((a, b) => b.matchCount - a.matchCount);
      return {
        results,
        total,
        scanned: scanning.length,
        installed: installed.length,
        skipped: Math.max(0, installed.length - scanning.length),
        term: needle,
      };
    });
  }

  // ------------------------------------------------------ gestion des livres

  /**
   * Table de gestion des téléchargements : une page du catalogue enrichie de ce
   * que la file et le disque savent. C'est la même requête que l'exploration —
   * filtres, tri, pagination — plus la taille réellement occupée.
   */
  getManagedBooks(query = {}) {
    return this.#guard('lecture des livres gérés', async () => {
      const { books, total, bytes } = await this.exploreBooks({ limit: 25, ...query });
      const user = await this.#db.user();
      const ids = books.map((book) => book.editionId);

      const stateById = new Map(
        ids.length
          ? all(
              user,
              `SELECT edition_id, download_status, downloaded_at, last_opened_at,
                      progress_percent, current_sequence_num
                 FROM downloaded_books WHERE edition_id IN (${ids.map(() => '?').join(',')})`,
              ids,
            ).map((row) => [row.edition_id, row])
          : [],
      );

      const catalog = await this.#db.catalog();
      const sizeById = new Map(
        ids.length
          ? all(
              catalog,
              `SELECT edition_id, compressed_size, uncompressed_size, page_count
                 FROM book_releases
                WHERE is_active = 1 AND edition_id IN (${ids.map(() => '?').join(',')})`,
              ids,
            ).map((row) => [row.edition_id, row])
          : [],
      );

      const jobs = new Map((this.#downloads?.snapshot() ?? []).map((job) => [job.editionId, job]));
      const booksDir = path.join(this.#db.root, 'books');

      return {
        total,
        bytes,
        rows: books.map((book) => {
          const state = stateById.get(book.editionId) ?? {};
          const size = sizeById.get(book.editionId) ?? {};
          const job = jobs.get(book.editionId) ?? null;
          let localBytes = 0;
          try {
            localBytes = fs.statSync(path.join(booksDir, `${book.editionId}.sqlite`)).size;
          } catch {
            localBytes = 0; // pas installé, ou effacé à la main
          }
          return {
            ...book,
            downloadStatus: job?.status ?? state.download_status ?? null,
            percent: job?.percent ?? 0,
            error: job?.error ?? null,
            compressedSize: size.compressed_size ?? 0,
            uncompressedSize: size.uncompressed_size ?? 0,
            localBytes,
            pageCount: book.pageCount ?? size.page_count ?? null,
            downloadedAt: state.downloaded_at ?? null,
            lastOpenedAt: state.last_opened_at ?? null,
            progressPercent: state.progress_percent ?? 0,
          };
        }),
      };
    });
  }

  /** Supprime un lot de livres : la table de gestion agit sur une sélection. */
  deleteBooks(editionIds = [], { keepProgress = true } = {}) {
    return this.#guard('suppression des livres', async () => {
      let removed = 0;
      for (const editionId of editionIds) {
        if (this.#downloads?.isBusy(editionId)) continue;
        await this.deleteBook(editionId, { keepProgress });
        removed += 1;
      }
      return removed;
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

  /**
   * Applique `distribution.base_url` à la file en cours, sans redémarrage.
   *
   * Le catalogue ne porte que des clés relatives : changer cette valeur suffit
   * à servir la même bibliothèque depuis un autre bucket, sans rien
   * retélécharger de ce qui est déjà installé.
   */
  setDownloadBaseUrl(url) {
    return this.#guard("réglage de l'adresse du serveur", async () => {
      const value = String(url ?? '').trim();
      await this.saveSetting('distribution.base_url', value);
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
  'getAuthorStats',
  'getBooksIn',
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
