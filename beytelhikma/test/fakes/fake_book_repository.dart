import 'package:beytelhikma/models/author.dart';
import 'package:beytelhikma/models/book_category.dart';
import 'package:beytelhikma/models/book_detail.dart';
import 'package:beytelhikma/models/book_page.dart';
import 'package:beytelhikma/models/book_summary.dart';
import 'package:beytelhikma/models/library_entry.dart';
import 'package:beytelhikma/models/reading_progress.dart';
import 'package:beytelhikma/models/toc_entry.dart';
import 'package:beytelhikma/models/volume.dart';
import 'package:beytelhikma/repositories/book_repository.dart';

/// Repository en mémoire pour les tests d'interface.
class FakeBookRepository implements BookRepository {
  FakeBookRepository({this.failing = false});

  final bool failing;
  final Map<String, ReadingProgress> _progress = {};
  final Map<String, String> _settings = {};

  static const _book = BookSummary(
    editionId: 'ed-test-01',
    workId: 'wrk-test',
    title: 'كتاب الاختبار',
    categoryId: 1,
    categoryLabel: 'الحديث',
    authorName: 'المؤلف',
    volumeCount: 1,
    pageCount: 2,
  );

  T _check<T>(T value) {
    if (failing) throw const RepositoryException('panne simulée');
    return value;
  }

  @override
  Future<void> warmUp() async {}

  @override
  Future<List<BookCategory>> getCategories() async => _check(const [
    BookCategory(categoryId: 1, label: 'الحديث', bookCount: 1),
  ]);

  @override
  Future<List<BookSummary>> getRecentBooks({int limit = 12}) async =>
      _check(const [_book]);

  @override
  Future<List<BookSummary>> getBooks({int offset = 0, int limit = 20}) async =>
      _check(const [_book]);

  @override
  Future<List<BookSummary>> getBooksByCategory(
    int categoryId, {
    int limit = 20,
  }) async => _check(const [_book]);

  @override
  Future<BookDetail> getBookDetail(String editionId) async => _check(
    const BookDetail(
      summary: _book,
      authors: [Author(authorId: 'aut-test', fullName: 'المؤلف الكامل')],
      volumes: [Volume(volumeId: 1, partNumber: 1, label: 'الجزء الأول')],
      bibliographyText: 'وصف الكتاب',
      publisher: 'دار الاختبار',
      pageCount: 2,
    ),
  );

  @override
  Future<Author?> getFeaturedAuthor() async =>
      _check(const Author(authorId: 'aut-test', fullName: 'المؤلف الكامل'));

  @override
  Future<List<BookSummary>> getBooksByAuthor(
    String authorId, {
    int limit = 10,
  }) async => _check(const [_book]);

  @override
  Future<List<TocEntry>> getToc(String editionId) async =>
      _check([TocEntry(tocId: 1, pageId: 1, title: 'الباب الأول')]);

  @override
  Future<int> getPageCount(String editionId) async => _check(2);

  @override
  Future<List<BookPage>> getPages(
    String editionId, {
    int offset = 0,
    int limit = 20,
  }) async => _check(const [
    BookPage(
      pageId: 1,
      sequenceNum: 1,
      printedPageNum: 1,
      bodyHtml: '<h2>الباب الأول</h2><p>نص الصفحة الأولى</p>',
      bodyPlain: 'الباب الأول\nنص الصفحة الأولى',
    ),
    BookPage(
      pageId: 2,
      sequenceNum: 2,
      printedPageNum: 2,
      bodyHtml: '<p>نص الصفحة الثانية</p>',
      bodyPlain: 'نص الصفحة الثانية',
      footnotes: '(1) حاشية',
    ),
  ]);

  @override
  Future<BookPage?> getPageById(String editionId, int pageId) async {
    final pages = await getPages(editionId);
    for (final page in pages) {
      if (page.pageId == pageId) return page;
    }
    return null;
  }

  @override
  Future<List<LibraryEntry>> getLibrary() async => _check([
    LibraryEntry(
      book: _book,
      status: 'installed',
      progress: _progress['ed-test-01'],
    ),
  ]);

  @override
  Future<LibraryEntry?> getContinueReading() async {
    final progress = _progress['ed-test-01'];
    if (progress == null) return _check(null);
    return _check(
      LibraryEntry(book: _book, status: 'installed', progress: progress),
    );
  }

  @override
  Future<ReadingProgress?> getProgress(String editionId) async =>
      _check(_progress[editionId]);

  @override
  Future<void> saveProgress(ReadingProgress progress) async {
    _progress[progress.editionId] = progress;
  }

  @override
  Future<Map<String, String>> getSettings() async => _check(_settings);

  @override
  Future<void> saveSetting(String key, String value) async {
    _settings[key] = value;
  }
}
