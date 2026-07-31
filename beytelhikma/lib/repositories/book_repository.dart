import '../models/author.dart';
import '../models/book_category.dart';
import '../models/book_detail.dart';
import '../models/book_page.dart';
import '../models/book_summary.dart';
import '../models/library_entry.dart';
import '../models/reading_progress.dart';
import '../models/toc_entry.dart';

/// Contrat unique dont dépend l'UI. Aucune implémentation concrète ne doit
/// remonter dans `screens/` ou `widgets/`.
abstract interface class BookRepository {
  /// Prépare les bases et déclare comme installés les livres déjà présents.
  Future<void> warmUp();

  // ------------------------------------------------------------- catalogue
  Future<List<BookCategory>> getCategories();

  Future<List<BookSummary>> getRecentBooks({int limit = 12});

  Future<List<BookSummary>> getBooks({int offset = 0, int limit = 20});

  Future<List<BookSummary>> getBooksByCategory(
    int categoryId, {
    int limit = 20,
  });

  Future<BookDetail> getBookDetail(String editionId);

  Future<Author?> getFeaturedAuthor();

  Future<List<BookSummary>> getBooksByAuthor(String authorId, {int limit = 10});

  // ---------------------------------------------------------------- contenu
  Future<List<TocEntry>> getToc(String editionId);

  Future<int> getPageCount(String editionId);

  /// Pages triées par `sequence_num`, fenêtrées pour le lazy-loading.
  Future<List<BookPage>> getPages(
    String editionId, {
    int offset = 0,
    int limit = 20,
  });

  Future<BookPage?> getPageById(String editionId, int pageId);

  // ----------------------------------------------------------- bibliothèque
  Future<List<LibraryEntry>> getLibrary();

  Future<LibraryEntry?> getContinueReading();

  Future<ReadingProgress?> getProgress(String editionId);

  Future<void> saveProgress(ReadingProgress progress);

  // -------------------------------------------------------------- réglages
  Future<Map<String, String>> getSettings();

  Future<void> saveSetting(String key, String value);
}

/// Erreur métier remontée à l'UI (états `error` des écrans).
class RepositoryException implements Exception {
  const RepositoryException(this.message, [this.cause]);

  final String message;
  final Object? cause;

  @override
  String toString() => 'RepositoryException: $message';
}
