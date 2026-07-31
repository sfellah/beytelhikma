import 'dart:io';

import 'package:beytelhikma/models/toc_entry.dart';
import 'package:beytelhikma/repositories/sqlite_book_repository.dart';
import 'package:beytelhikma/services/database/app_database.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

/// Vérifie que la sortie de `tools/import_shamela.py` est lue telle quelle par
/// le repository, sans aucune adaptation du code applicatif.
///
/// Le dossier `dist/shamela/` n'est pas versionné : ces tests sont ignorés tant
/// qu'aucun import n'a été lancé.
///
///     python tools/import_shamela.py --books-per-category 3
void main() {
  // Chemin absolu : sqflite_ffi n'accepte pas un chemin relatif.
  final distPath = Directory(Directory('../dist/shamela').absolute.path);
  final available =
      distPath.existsSync() &&
      File(p.join(distPath.path, 'catalog.sqlite')).existsSync();

  late AppDatabase database;
  late SqliteBookRepository repository;

  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  setUp(() async {
    if (!available) return;
    // `user.sqlite` est un artefact d'exécution, pas une sortie de l'importeur.
    // On repart d'une base vierge : un fichier laissé par le client Electron
    // ferait échouer l'ouverture (il ne pose pas `PRAGMA user_version`, donc
    // sqflite rejoue `onCreate` sur des tables déjà présentes).
    final userDb = File(p.join(distPath.path, 'user.sqlite'));
    if (userDb.existsSync()) userDb.deleteSync();

    // `withRoot` court-circuite les assets embarqués : l'app lit directement
    // l'arborescence produite par l'importeur.
    database = AppDatabase.withRoot(distPath);
    repository = SqliteBookRepository(database: database);
    await repository.warmUp();
  });

  tearDown(() async {
    if (!available) return;
    await database.close();
  });

  test(
    'le catalogue importé expose les 40 disciplines peuplées',
    () async {
      final categories = await repository.getCategories();

      expect(categories, hasLength(40));
      expect(categories.every((c) => c.label.isNotEmpty), isTrue);
      expect(categories.every((c) => c.bookCount > 0), isTrue);
    },
    skip: available ? false : 'dist/shamela absent',
  );

  test(
    'chaque édition porte titre, auteur, catégorie et pagination',
    () async {
      final books = await repository.getBooks(limit: 500);

      expect(books, isNotEmpty);
      for (final book in books) {
        expect(book.title, isNotEmpty, reason: book.editionId);
        expect(book.authorName, isNotNull, reason: book.editionId);
        expect(book.categoryLabel, isNotNull, reason: book.editionId);
        expect(book.pageCount, greaterThan(0), reason: book.editionId);
        expect(
          book.volumeCount,
          greaterThanOrEqualTo(1),
          reason: book.editionId,
        );
      }
    },
    skip: available ? false : 'dist/shamela absent',
  );

  test(
    'les pages sont denses et débarrassées du balisage source',
    () async {
      final books = await repository.getBooks(limit: 500);

      var withMultipleVolumes = 0;
      for (final book in books) {
        final detail = await repository.getBookDetail(book.editionId);
        expect(detail.volumes, isNotEmpty, reason: book.editionId);
        if (detail.volumes.length > 1) withMultipleVolumes++;

        final pages = await repository.getPages(book.editionId, limit: 5);
        expect(pages, isNotEmpty, reason: book.editionId);
        for (var i = 0; i < pages.length; i++) {
          expect(pages[i].sequenceNum, i + 1, reason: book.editionId);
          // Ni table, ni image base64, ni retour chariot ne doivent survivre au
          // pipeline : aucun des deux clients ne sait les rendre.
          expect(pages[i].bodyHtml, isNot(contains('<table')));
          expect(pages[i].bodyHtml, isNot(contains('data:image')));
          expect(pages[i].bodyHtml, isNot(contains('\r')));
          // `body_plain` peut porter un `<` littéral venu du texte source ;
          // ce qu'il ne doit jamais porter, c'est une balise.
          expect(pages[i].bodyPlain, isNot(contains('<p>')));
          expect(pages[i].bodyPlain, isNot(contains('<span')));
          expect(pages[i].bodyPlain, isNot(contains('</')));
        }
      }
      expect(withMultipleVolumes, greaterThan(0));
    },
    skip: available ? false : 'dist/shamela absent',
  );

  test(
    'les sommaires sont hiérarchiques',
    () async {
      final books = await repository.getBooks(limit: 500);

      var nested = 0;
      for (final book in books) {
        // `getToc` renvoie une liste plate ; l'arbre se reconstruit ensuite.
        final flat = await repository.getToc(book.editionId);
        if (flat.isEmpty) continue;
        final tree = TocEntry.buildTree(flat);
        expect(tree, isNotEmpty, reason: book.editionId);
        expect(
          tree.length,
          lessThanOrEqualTo(flat.length),
          reason: book.editionId,
        );
        if (tree.any((entry) => entry.children.isNotEmpty)) nested++;
      }
      expect(nested, greaterThan(0));
    },
    skip: available ? false : 'dist/shamela absent',
  );
}
