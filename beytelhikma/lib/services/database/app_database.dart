import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:sqflite/sqflite.dart' as sqflite_plugin;
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

/// Accès aux trois bases de l'application (voir DATAMODEL.md) :
///
/// * `catalog.sqlite` — catalogue, en lecture seule ;
/// * `books/<edition_id>.sqlite` — contenu d'un livre, en lecture seule ;
/// * `user.sqlite` — bibliothèque, progression et réglages, créée localement.
///
/// Tant que le pipeline de téléchargement n'existe pas, catalogue et livres
/// sont embarqués dans `assets/sample/` puis copiés au premier accès : le reste
/// du code lit déjà des fichiers installés, comme il le fera avec le CDN.
class AppDatabase {
  AppDatabase._() : _useBundledAssets = true;

  /// Pointe l'application sur un dossier déjà peuplé (tests, ou plus tard un
  /// dossier de téléchargement) au lieu des assets embarqués.
  AppDatabase.withRoot(Directory root)
    : _useBundledAssets = false,
      _root = root;

  static final AppDatabase instance = AppDatabase._();

  final bool _useBundledAssets;

  static const catalogAsset = 'assets/sample/catalog.sqlite';
  static const booksAssetDir = 'assets/sample/books';
  static const userDbSchemaVersion = 1;

  Database? _catalog;
  Database? _user;
  final Map<String, Database> _books = {};
  Directory? _root;
  bool _ffiInitialised = false;

  /// À appeler une fois avant `runApp`.
  Future<void> initialize() async {
    if (!_ffiInitialised) {
      final isDesktop =
          !kIsWeb &&
          (Platform.isWindows || Platform.isLinux || Platform.isMacOS);
      if (isDesktop) {
        sqfliteFfiInit();
        databaseFactory = databaseFactoryFfi;
      } else {
        databaseFactory = sqflite_plugin.databaseFactory;
      }
      _ffiInitialised = true;
    }
    await _storageRoot();
  }

  Future<Directory> _storageRoot() async {
    if (_root != null) return _root!;
    final base = await getApplicationSupportDirectory();
    final root = Directory(p.join(base.path, 'beytelhikma'));
    await Directory(p.join(root.path, 'books')).create(recursive: true);
    return _root = root;
  }

  /// Copie l'asset vers [target] s'il n'y est pas encore, ou si sa taille diffère
  /// (le régénérateur de données d'exemple change la taille du fichier).
  Future<File> _materializeAsset(String assetPath, String targetPath) async {
    final file = File(targetPath);
    if (!_useBundledAssets) return file;
    final data = await rootBundle.load(assetPath);
    final bytes = data.buffer.asUint8List(
      data.offsetInBytes,
      data.lengthInBytes,
    );
    if (file.existsSync() && await file.length() == bytes.length) return file;
    await file.writeAsBytes(bytes, flush: true);
    return file;
  }

  Future<Database> catalog() async {
    if (_catalog != null) return _catalog!;
    final root = await _storageRoot();
    final file = await _materializeAsset(
      catalogAsset,
      p.join(root.path, 'catalog.sqlite'),
    );
    return _catalog = await databaseFactory.openDatabase(
      file.path,
      options: OpenDatabaseOptions(readOnly: true, singleInstance: true),
    );
  }

  Future<Database> book(String editionId) async {
    final cached = _books[editionId];
    if (cached != null) return cached;
    final root = await _storageRoot();
    final file = await _materializeAsset(
      '$booksAssetDir/$editionId.sqlite',
      p.join(root.path, 'books', '$editionId.sqlite'),
    );
    final db = await databaseFactory.openDatabase(
      file.path,
      options: OpenDatabaseOptions(readOnly: true, singleInstance: true),
    );
    return _books[editionId] = db;
  }

  Future<Database> user() async {
    if (_user != null) return _user!;
    final root = await _storageRoot();
    return _user = await databaseFactory.openDatabase(
      p.join(root.path, 'user.sqlite'),
      options: OpenDatabaseOptions(
        version: userDbSchemaVersion,
        onCreate: (db, _) async => _createUserSchema(db),
        singleInstance: true,
      ),
    );
  }

  static Future<void> _createUserSchema(Database db) async {
    final batch = db.batch();
    batch.execute('''
      CREATE TABLE downloaded_books (
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
      )
    ''');
    batch.execute('''
      CREATE TABLE collections (
        collection_id TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        description   TEXT,
        sort_order    INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      )
    ''');
    batch.execute('''
      CREATE TABLE collection_books (
        collection_id TEXT NOT NULL,
        edition_id    TEXT NOT NULL,
        sort_order    INTEGER NOT NULL DEFAULT 0,
        added_at      TEXT NOT NULL,
        PRIMARY KEY (collection_id, edition_id)
      )
    ''');
    batch.execute('''
      CREATE TABLE app_settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    ''');
    await batch.commit(noResult: true);
  }

  @visibleForTesting
  Future<void> close() async {
    await _catalog?.close();
    await _user?.close();
    for (final db in _books.values) {
      await db.close();
    }
    _catalog = null;
    _user = null;
    _books.clear();
  }
}
