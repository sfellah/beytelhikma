import 'dart:io';

import 'package:beytelhikma/models/reading_progress.dart';
import 'package:beytelhikma/models/toc_entry.dart';
import 'package:beytelhikma/repositories/sqlite_book_repository.dart';
import 'package:beytelhikma/services/database/app_database.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

/// Le repository est testé contre les vraies bases d'exemple : ce sont les
/// mêmes fichiers que ceux embarqués dans l'application.
void main() {
  late Directory root;
  late SqliteBookRepository repository;
  late AppDatabase database;

  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  setUp(() async {
    root = await Directory.systemTemp.createTemp('beytelhikma_test');
    await Directory(p.join(root.path, 'books')).create(recursive: true);
    await File(
      'assets/sample/catalog.sqlite',
    ).copy(p.join(root.path, 'catalog.sqlite'));
    for (final file in Directory('assets/sample/books').listSync()) {
      if (file is File && file.path.endsWith('.sqlite')) {
        await file.copy(p.join(root.path, 'books', p.basename(file.path)));
      }
    }
    database = AppDatabase.withRoot(root);
    repository = SqliteBookRepository(database: database);
    await repository.warmUp();
  });

  tearDown(() async {
    await database.close();
    await root.delete(recursive: true);
  });

  test('le catalogue expose les éditions avec auteur et catégorie', () async {
    final books = await repository.getBooks();

    expect(books, hasLength(5));
    final muqaddima = books.firstWhere(
      (book) => book.editionId == 'ed-muqaddima-01',
    );
    expect(muqaddima.title, 'مقدمة ابن خلدون');
    expect(muqaddima.authorName, 'ابن خلدون');
    expect(muqaddima.categoryLabel, 'التاريخ');
    expect(muqaddima.pageCount, 5);
  });

  test('les catégories comptent leurs livres', () async {
    final categories = await repository.getCategories();
    final hadith = categories.firstWhere((c) => c.label == 'الحديث');

    expect(hadith.bookCount, 2);
    expect(categories.every((c) => c.categoryId > 0), isTrue);
  });

  test('la fiche livre agrège métadonnées, auteurs et volumes', () async {
    final detail = await repository.getBookDetail('ed-bukhari-01');

    expect(detail.title, 'صحيح البخاري');
    expect(detail.mainAuthor?.fullName, 'محمد بن إسماعيل البخاري');
    expect(detail.volumes, hasLength(2));
    expect(detail.publisher, 'دار طوق النجاة');
    expect(detail.metadataRows.containsKey('عدد الأجزاء'), isTrue);
  });

  test('le sommaire se reconstruit en arbre', () async {
    final flat = await repository.getToc('ed-muqaddima-01');
    final tree = TocEntry.buildTree(flat);

    expect(flat, hasLength(4));
    expect(tree, hasLength(3));
    expect(tree[1].children, hasLength(1));
  });

  test('les pages sont ordonnées et fenêtrées', () async {
    final all = await repository.getPages('ed-bukhari-01');
    final window = await repository.getPages(
      'ed-bukhari-01',
      offset: 3,
      limit: 2,
    );

    expect(all, hasLength(5));
    expect(all.map((page) => page.sequenceNum), [1, 2, 3, 4, 5]);
    expect(window.map((page) => page.printedPageNum), [21, 22]);
    expect(all.first.bodyHtml, contains('<h2>'));
  });

  test('la bibliothèque est amorcée avec les livres installés', () async {
    final library = await repository.getLibrary();

    expect(library, hasLength(5));
    expect(library.every((entry) => entry.isInstalled), isTrue);
    expect(library.every((entry) => entry.isStarted), isFalse);
  });

  test('la progression est enregistrée puis relue', () async {
    await repository.saveProgress(
      const ReadingProgress(
        editionId: 'ed-ihya-01',
        pageId: 3,
        sequenceNum: 3,
        percent: 0.75,
      ),
    );

    final progress = await repository.getProgress('ed-ihya-01');
    expect(progress?.pageId, 3);
    expect(progress?.percentRounded, 75);

    final resume = await repository.getContinueReading();
    expect(resume?.book.editionId, 'ed-ihya-01');
    expect(resume?.isStarted, isTrue);
  });

  test('les réglages du lecteur persistent', () async {
    await repository.saveSetting('reader.font_size', '24.0');
    await repository.saveSetting('reader.palette', 'night');

    final settings = await repository.getSettings();
    expect(settings['reader.font_size'], '24.0');
    expect(settings['reader.palette'], 'night');
  });
}
