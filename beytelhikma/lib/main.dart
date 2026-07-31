import 'package:flutter/material.dart';

import 'app.dart';
import 'repositories/sqlite_book_repository.dart';
import 'services/database/app_database.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  await AppDatabase.instance.initialize();
  final repository = SqliteBookRepository();
  await repository.warmUp();

  runApp(BeytElHikmaApp(repository: repository));
}
