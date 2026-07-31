import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import '../models/author.dart';
import '../models/book_category.dart';
import '../models/book_detail.dart';
import '../models/book_page.dart';
import '../models/book_summary.dart';
import '../models/library_entry.dart';
import '../models/reading_progress.dart';
import '../models/toc_entry.dart';
import '../models/volume.dart';
import '../services/database/app_database.dart';
import 'book_repository.dart';

/// Implémentation local-first : catalogue et livres lus dans les fichiers
/// SQLite installés, état utilisateur écrit dans `user.sqlite`.
class SqliteBookRepository implements BookRepository {
  SqliteBookRepository({AppDatabase? database})
    : _db = database ?? AppDatabase.instance;

  final AppDatabase _db;

  /// Projection commune « carte de livre ».
  static const _summarySelect = '''
    SELECT e.edition_id,
           e.work_id,
           e.title_ar,
           e.subtitle_ar,
           e.category_id,
           e.volume_count,
           e.language,
           e.cover_url,
           c.label_ar                                   AS category_label,
           COALESCE(a.short_name_ar, a.full_name_ar)    AS author_name,
           r.page_count                                 AS page_count,
           r.published_at                               AS published_at
    FROM editions e
    LEFT JOIN categories c      ON c.category_id = e.category_id
    LEFT JOIN edition_authors ea ON ea.edition_id = e.edition_id AND ea.role = 'author'
    LEFT JOIN authors a          ON a.author_id = ea.author_id
    LEFT JOIN book_releases r    ON r.edition_id = e.edition_id AND r.is_active = 1
    WHERE e.is_hidden = 0
  ''';

  Future<T> _guard<T>(String what, Future<T> Function() run) async {
    try {
      return await run();
    } on Object catch (error) {
      throw RepositoryException('Échec : $what', error);
    }
  }

  @override
  Future<void> warmUp() =>
      _guard('initialisation de la bibliothèque', () async {
        final catalog = await _db.catalog();
        final user = await _db.user();
        final editions = await catalog.rawQuery('''
      SELECT e.edition_id, r.release_id, r.uncompressed_size, r.published_at
      FROM editions e
      LEFT JOIN book_releases r ON r.edition_id = e.edition_id AND r.is_active = 1
      WHERE e.is_hidden = 0
    ''');
        final batch = user.batch();
        for (final row in editions) {
          batch.rawInsert(
            '''INSERT OR IGNORE INTO downloaded_books
             (edition_id, release_id, local_path, download_status,
              downloaded_bytes, total_bytes, downloaded_at, progress_percent)
           VALUES (?,?,?,?,?,?,?,0)''',
            [
              row['edition_id'],
              row['release_id'],
              'books/${row['edition_id']}.sqlite',
              'installed',
              row['uncompressed_size'] ?? 0,
              row['uncompressed_size'] ?? 0,
              row['published_at'],
            ],
          );
        }
        await batch.commit(noResult: true);
      });

  // ------------------------------------------------------------- catalogue

  @override
  Future<List<BookCategory>> getCategories() =>
      _guard('lecture des catégories', () async {
        final db = await _db.catalog();
        final rows = await db.rawQuery('''
          SELECT c.category_id, c.label_ar, c.parent_id, c.sort_order,
                 COUNT(e.edition_id) AS book_count
          FROM categories c
          LEFT JOIN editions e ON e.category_id = c.category_id AND e.is_hidden = 0
          GROUP BY c.category_id
          ORDER BY c.sort_order
        ''');
        return rows.map(BookCategory.fromMap).toList(growable: false);
      });

  @override
  Future<List<BookSummary>> getRecentBooks({
    int limit = 12,
  }) => _guard('lecture des nouveautés', () async {
    final db = await _db.catalog();
    final rows = await db.rawQuery(
      '$_summarySelect GROUP BY e.edition_id ORDER BY r.published_at DESC, e.title_ar LIMIT ?',
      [limit],
    );
    return rows.map(BookSummary.fromMap).toList(growable: false);
  });

  @override
  Future<List<BookSummary>> getBooks({
    int offset = 0,
    int limit = 20,
  }) => _guard('lecture du catalogue', () async {
    final db = await _db.catalog();
    final rows = await db.rawQuery(
      '$_summarySelect GROUP BY e.edition_id ORDER BY e.title_ar LIMIT ? OFFSET ?',
      [limit, offset],
    );
    return rows.map(BookSummary.fromMap).toList(growable: false);
  });

  @override
  Future<List<BookSummary>> getBooksByCategory(
    int categoryId, {
    int limit = 20,
  }) => _guard('lecture de la catégorie', () async {
    final db = await _db.catalog();
    final rows = await db.rawQuery(
      '$_summarySelect AND e.category_id = ? GROUP BY e.edition_id ORDER BY e.title_ar LIMIT ?',
      [categoryId, limit],
    );
    return rows.map(BookSummary.fromMap).toList(growable: false);
  });

  @override
  Future<BookDetail> getBookDetail(
    String editionId,
  ) => _guard('lecture de la fiche livre', () async {
    final catalog = await _db.catalog();
    final rows = await catalog.rawQuery(
      '$_summarySelect AND e.edition_id = ? GROUP BY e.edition_id LIMIT 1',
      [editionId],
    );
    if (rows.isEmpty) {
      throw StateError('édition introuvable : $editionId');
    }
    final summary = BookSummary.fromMap(rows.first);

    final meta = await catalog.rawQuery(
      '''SELECT e.bibliography_text, e.publisher_ar, e.edition_label_ar,
                    e.publication_year, e.work_id,
                    r.page_count, r.toc_count
             FROM editions e
             LEFT JOIN book_releases r ON r.edition_id = e.edition_id AND r.is_active = 1
             WHERE e.edition_id = ?''',
      [editionId],
    );
    final metaRow = meta.isEmpty ? const <String, Object?>{} : meta.first;

    final authorRows = await catalog.rawQuery(
      '''SELECT a.*, ea.role
             FROM edition_authors ea
             JOIN authors a ON a.author_id = ea.author_id
             WHERE ea.edition_id = ?
             ORDER BY ea.position''',
      [editionId],
    );

    final otherRows = await catalog.rawQuery(
      '$_summarySelect AND e.work_id = ? AND e.edition_id <> ? GROUP BY e.edition_id',
      [metaRow['work_id'] ?? summary.workId, editionId],
    );

    List<Volume> volumes = const [];
    try {
      final book = await _db.book(editionId);
      final volumeRows = await book.query('volumes', orderBy: 'sequence_num');
      volumes = volumeRows.map(Volume.fromMap).toList(growable: false);
    } on Object {
      // Le fichier du livre n'est pas installé : la fiche reste affichable.
    }

    return BookDetail(
      summary: summary,
      authors: authorRows.map(Author.fromMap).toList(growable: false),
      volumes: volumes,
      bibliographyText: metaRow['bibliography_text'] as String?,
      publisher: metaRow['publisher_ar'] as String?,
      editionLabel: metaRow['edition_label_ar'] as String?,
      publicationYear: metaRow['publication_year'] as int?,
      pageCount: metaRow['page_count'] as int?,
      tocCount: metaRow['toc_count'] as int?,
      otherEditions: otherRows.map(BookSummary.fromMap).toList(growable: false),
    );
  });

  @override
  Future<Author?> getFeaturedAuthor() =>
      _guard('lecture de l\'auteur en vedette', () async {
        final db = await _db.catalog();
        final rows = await db.rawQuery('''
          SELECT a.*, COUNT(ea.edition_id) AS book_count
          FROM authors a
          JOIN edition_authors ea ON ea.author_id = a.author_id
          GROUP BY a.author_id
          ORDER BY book_count DESC, a.full_name_ar
          LIMIT 1
        ''');
        return rows.isEmpty ? null : Author.fromMap(rows.first);
      });

  @override
  Future<List<BookSummary>> getBooksByAuthor(
    String authorId, {
    int limit = 10,
  }) => _guard('lecture des livres de l\'auteur', () async {
    final db = await _db.catalog();
    final rows = await db.rawQuery(
      '''$_summarySelect AND e.edition_id IN (
               SELECT edition_id FROM edition_authors WHERE author_id = ?
             )
             GROUP BY e.edition_id ORDER BY e.title_ar LIMIT ?''',
      [authorId, limit],
    );
    return rows.map(BookSummary.fromMap).toList(growable: false);
  });

  // ---------------------------------------------------------------- contenu

  @override
  Future<List<TocEntry>> getToc(String editionId) =>
      _guard('lecture du sommaire', () async {
        final db = await _db.book(editionId);
        final rows = await db.query('toc', orderBy: 'sequence_num');
        return rows.map(TocEntry.fromMap).toList(growable: false);
      });

  @override
  Future<int> getPageCount(String editionId) =>
      _guard('comptage des pages', () async {
        final db = await _db.book(editionId);
        final rows = await db.rawQuery('SELECT COUNT(*) AS n FROM pages');
        return (rows.first['n'] as int?) ?? 0;
      });

  @override
  Future<List<BookPage>> getPages(
    String editionId, {
    int offset = 0,
    int limit = 20,
  }) => _guard('lecture des pages', () async {
    final db = await _db.book(editionId);
    final rows = await db.query(
      'pages',
      orderBy: 'sequence_num',
      limit: limit,
      offset: offset,
    );
    return rows.map(BookPage.fromMap).toList(growable: false);
  });

  @override
  Future<BookPage?> getPageById(String editionId, int pageId) =>
      _guard('lecture d\'une page', () async {
        final db = await _db.book(editionId);
        final rows = await db.query(
          'pages',
          where: 'page_id = ?',
          whereArgs: [pageId],
          limit: 1,
        );
        return rows.isEmpty ? null : BookPage.fromMap(rows.first);
      });

  // ----------------------------------------------------------- bibliothèque

  @override
  Future<List<LibraryEntry>> getLibrary() =>
      _guard('lecture de la bibliothèque', () async {
        final user = await _db.user();
        final installed = await user.query(
          'downloaded_books',
          orderBy: 'last_opened_at DESC, downloaded_at DESC',
        );
        if (installed.isEmpty) return const [];
        return _joinWithCatalog(installed);
      });

  @override
  Future<LibraryEntry?> getContinueReading() =>
      _guard('lecture de la reprise', () async {
        final user = await _db.user();
        final rows = await user.query(
          'downloaded_books',
          where: 'last_opened_at IS NOT NULL',
          orderBy: 'last_opened_at DESC',
          limit: 1,
        );
        if (rows.isEmpty) return null;
        final entries = await _joinWithCatalog(rows);
        return entries.isEmpty ? null : entries.first;
      });

  Future<List<LibraryEntry>> _joinWithCatalog(
    List<Map<String, Object?>> installedRows,
  ) async {
    final catalog = await _db.catalog();
    final ids = installedRows
        .map((row) => row['edition_id'] as String)
        .toList();
    final placeholders = List.filled(ids.length, '?').join(',');
    final bookRows = await catalog.rawQuery(
      '$_summarySelect AND e.edition_id IN ($placeholders) GROUP BY e.edition_id',
      ids,
    );
    final booksById = {
      for (final row in bookRows)
        row['edition_id'] as String: BookSummary.fromMap(row),
    };

    final entries = <LibraryEntry>[];
    for (final row in installedRows) {
      final book = booksById[row['edition_id'] as String];
      if (book == null) continue;
      final lastOpened = switch (row['last_opened_at']) {
        final String value => DateTime.tryParse(value),
        _ => null,
      };
      entries.add(
        LibraryEntry(
          book: book,
          status: (row['download_status'] as String?) ?? 'installed',
          progress: row['current_page_id'] == null
              ? null
              : ReadingProgress.fromMap(row),
          lastOpenedAt: lastOpened,
        ),
      );
    }
    return entries;
  }

  @override
  Future<ReadingProgress?> getProgress(String editionId) =>
      _guard('lecture de la progression', () async {
        final user = await _db.user();
        final rows = await user.query(
          'downloaded_books',
          where: 'edition_id = ? AND current_page_id IS NOT NULL',
          whereArgs: [editionId],
          limit: 1,
        );
        return rows.isEmpty ? null : ReadingProgress.fromMap(rows.first);
      });

  @override
  Future<void> saveProgress(ReadingProgress progress) =>
      _guard('enregistrement de la progression', () async {
        final user = await _db.user();
        await user.rawInsert(
          '''INSERT INTO downloaded_books
               (edition_id, download_status, current_page_id,
                current_sequence_num, progress_percent, last_opened_at)
             VALUES (?, 'installed', ?, ?, ?, ?)
             ON CONFLICT(edition_id) DO UPDATE SET
               current_page_id      = excluded.current_page_id,
               current_sequence_num = excluded.current_sequence_num,
               progress_percent     = excluded.progress_percent,
               last_opened_at       = excluded.last_opened_at''',
          [
            progress.editionId,
            progress.pageId,
            progress.sequenceNum,
            progress.percent,
            (progress.updatedAt ?? DateTime.now()).toIso8601String(),
          ],
        );
      });

  // -------------------------------------------------------------- réglages

  @override
  Future<Map<String, String>> getSettings() =>
      _guard('lecture des réglages', () async {
        final user = await _db.user();
        final rows = await user.query('app_settings');
        return {
          for (final row in rows) row['key'] as String: row['value'] as String,
        };
      });

  @override
  Future<void> saveSetting(String key, String value) =>
      _guard('enregistrement d\'un réglage', () async {
        final user = await _db.user();
        await user.insert('app_settings', {
          'key': key,
          'value': value,
        }, conflictAlgorithm: ConflictAlgorithm.replace);
      });
}
