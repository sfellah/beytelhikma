import 'dart:io';
import 'dart:ui' as ui;

import 'package:beytelhikma/app.dart';
import 'package:beytelhikma/models/author.dart';
import 'package:beytelhikma/models/book_category.dart';
import 'package:beytelhikma/models/book_detail.dart';
import 'package:beytelhikma/models/book_page.dart';
import 'package:beytelhikma/models/book_summary.dart';
import 'package:beytelhikma/models/library_entry.dart';
import 'package:beytelhikma/models/reading_progress.dart';
import 'package:beytelhikma/models/toc_entry.dart';
import 'package:beytelhikma/repositories/book_repository.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;

/// Rendu hors écran de l'accueil, pour relire le design sans lancer l'appli.
/// Le fichier ne finit pas par `_test.dart` : `flutter test` ne le prend pas.
///
/// Usage :
///   `flutter test test/screenshots/capture_home.dart`
///
/// Les données viennent d'un repository en dur (mêmes textes que les bases
/// d'exemple) : sous l'horloge simulée des tests, SQLite ne rend pas la main.
void main() {
  const outDir = String.fromEnvironment(
    'out',
    defaultValue: 'build/screenshots',
  );

  setUpAll(_loadSystemArabicFonts);

  for (final (name, size) in const [
    ('home_mobile', Size(430, 1500)),
    ('home_wide', Size(1240, 1200)),
  ]) {
    testWidgets('capture $name', (tester) async {
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(BeytElHikmaApp(repository: _DemoRepository()));
      await tester.pumpAndSettle();

      final boundary = _findBoundary(
        tester.binding.rootElement!.renderObject!,
      )!;

      // `toImage` se termine sur le thread de rastérisation : hors de
      // `runAsync`, l'horloge simulée ne le laisse jamais aboutir.
      await tester.runAsync(() async {
        final image = await boundary.toImage();
        final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
        final file = File(p.join(outDir, '$name.png'));
        await file.parent.create(recursive: true);
        await file.writeAsBytes(bytes!.buffer.asUint8List());
        // ignore: avoid_print
        print('écrit : ${file.absolute.path}');
      });
    });
  }
}

RenderRepaintBoundary? _findBoundary(RenderObject node) {
  if (node is RenderRepaintBoundary) return node;
  RenderRepaintBoundary? found;
  node.visitChildren((child) => found ??= _findBoundary(child));
  return found;
}

/// Charge une police arabe du système sous les noms attendus par le thème,
/// sinon le moteur de test dessine des rectangles.
Future<void> _loadSystemArabicFonts() async {
  const candidates = [
    r'C:\Windows\Fonts\trado.ttf',
    r'C:\Windows\Fonts\arial.ttf',
    '/System/Library/Fonts/Supplemental/Arial.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  ];
  final path = candidates.firstWhere(
    (candidate) => File(candidate).existsSync(),
    orElse: () => '',
  );
  if (path.isEmpty) return;

  final bytes = await File(path).readAsBytes();
  for (final family in const [
    'Amiri',
    'Scheherazade New',
    'Noto Naskh Arabic',
    'Traditional Arabic',
    'Noto Kufi Arabic',
    'Dubai',
    'Segoe UI',
    'Times New Roman',
    'Playfair Display',
    'Source Serif 4',
    'Georgia',
    'serif',
    'sans-serif',
  ]) {
    final loader = FontLoader(family)
      ..addFont(Future.value(bytes.buffer.asByteData()));
    await loader.load();
  }
}

/// Copie des données d'exemple, servie sans latence ni SQLite.
class _DemoRepository implements BookRepository {
  static const _books = [
    BookSummary(
      editionId: 'ed-muqaddima-01',
      workId: 'wrk-muqaddima',
      title: 'مقدمة ابن خلدون',
      subtitle: 'كتاب العبر وديوان المبتدأ والخبر',
      categoryId: 5,
      categoryLabel: 'التاريخ',
      authorName: 'ابن خلدون',
      pageCount: 5,
    ),
    BookSummary(
      editionId: 'ed-muwatta-01',
      workId: 'wrk-muwatta',
      title: 'الموطأ',
      categoryId: 2,
      categoryLabel: 'الحديث',
      authorName: 'الإمام مالك',
      pageCount: 4,
    ),
    BookSummary(
      editionId: 'ed-bukhari-01',
      workId: 'wrk-bukhari',
      title: 'صحيح البخاري',
      categoryId: 2,
      categoryLabel: 'الحديث',
      authorName: 'الإمام البخاري',
      volumeCount: 2,
      pageCount: 5,
    ),
    BookSummary(
      editionId: 'ed-ihya-01',
      workId: 'wrk-ihya',
      title: 'إحياء علوم الدين',
      categoryId: 7,
      categoryLabel: 'التصوف',
      authorName: 'الغزالي',
      pageCount: 4,
    ),
    BookSummary(
      editionId: 'ed-mutanabbi-01',
      workId: 'wrk-diwan-mutanabbi',
      title: 'ديوان المتنبي',
      categoryId: 6,
      categoryLabel: 'الأدب',
      authorName: 'المتنبي',
      pageCount: 3,
    ),
  ];

  static const _author = Author(
    authorId: 'aut-ibn-khaldun',
    fullName: 'عبد الرحمن بن خلدون',
    shortName: 'ابن خلدون',
    deathYearHijri: 808,
    bio:
        'أبو زيد عبد الرحمن بن محمد بن خلدون الحضرمي، مؤرخ ومؤسس علم '
        'العمران البشري، وصاحب المقدمة التي أرست أسس علم الاجتماع.',
  );

  static const _progress = ReadingProgress(
    editionId: 'ed-muqaddima-01',
    pageId: 2,
    sequenceNum: 2,
    percent: 0.45,
  );

  @override
  Future<void> warmUp() async {}

  @override
  Future<List<BookCategory>> getCategories() async => const [
    BookCategory(categoryId: 1, label: 'التفسير', bookCount: 3),
    BookCategory(categoryId: 2, label: 'الحديث', bookCount: 2),
    BookCategory(categoryId: 3, label: 'الفقه', bookCount: 4),
    BookCategory(categoryId: 4, label: 'اللغة', bookCount: 2),
    BookCategory(categoryId: 5, label: 'التاريخ', bookCount: 1),
    BookCategory(categoryId: 6, label: 'الأدب', bookCount: 1),
  ];

  @override
  Future<List<BookSummary>> getRecentBooks({int limit = 12}) async => _books;

  @override
  Future<List<BookSummary>> getBooks({int offset = 0, int limit = 20}) async =>
      _books;

  @override
  Future<List<BookSummary>> getBooksByCategory(
    int categoryId, {
    int limit = 20,
  }) async => _books.where((book) => book.categoryId == categoryId).toList();

  @override
  Future<BookDetail> getBookDetail(String editionId) async => BookDetail(
    summary: _books.firstWhere((book) => book.editionId == editionId),
    authors: const [_author],
  );

  @override
  Future<Author?> getFeaturedAuthor() async => _author;

  @override
  Future<List<BookSummary>> getBooksByAuthor(
    String authorId, {
    int limit = 10,
  }) async => _books.take(3).toList();

  @override
  Future<List<TocEntry>> getToc(String editionId) async => [
    TocEntry(tocId: 1, pageId: 1, title: 'ديباجة الكتاب'),
  ];

  @override
  Future<int> getPageCount(String editionId) async => 5;

  @override
  Future<List<BookPage>> getPages(
    String editionId, {
    int offset = 0,
    int limit = 20,
  }) async => const [
    BookPage(
      pageId: 2,
      sequenceNum: 2,
      printedPageNum: 6,
      bodyHtml: '<p>اعلم أن فن التاريخ فن عزيز المذهب</p>',
      bodyPlain: 'اعلم أن فن التاريخ فن عزيز المذهب',
    ),
  ];

  @override
  Future<BookPage?> getPageById(String editionId, int pageId) async =>
      const BookPage(
        pageId: 2,
        sequenceNum: 2,
        printedPageNum: 6,
        bodyHtml: '',
        bodyPlain:
            'اعلم أن فن التاريخ فن عزيز المذهب، جم الفوائد، شريف الغاية، '
            'إذ هو يوقفنا على أحوال الماضين من الأمم في أخلاقهم',
      );

  @override
  Future<List<LibraryEntry>> getLibrary() async => [
    for (final book in _books)
      LibraryEntry(
        book: book,
        status: 'installed',
        progress: book.editionId == _progress.editionId ? _progress : null,
      ),
  ];

  @override
  Future<LibraryEntry?> getContinueReading() async => LibraryEntry(
    book: _books.first,
    status: 'installed',
    progress: _progress,
  );

  @override
  Future<ReadingProgress?> getProgress(String editionId) async =>
      editionId == _progress.editionId ? _progress : null;

  @override
  Future<void> saveProgress(ReadingProgress progress) async {}

  @override
  Future<Map<String, String>> getSettings() async => const {};

  @override
  Future<void> saveSetting(String key, String value) async {}
}
