import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'repositories/book_repository.dart';
import 'screens/shell/app_shell.dart';
import 'theme/app_theme.dart';
import 'widgets/repository_scope.dart';

/// Racine de l'application. La locale par défaut est l'arabe (interface RTL) ;
/// la direction du contenu d'un livre reste imposée séparément par le lecteur.
class BeytElHikmaApp extends StatelessWidget {
  const BeytElHikmaApp({required this.repository, super.key});

  final BookRepository repository;

  @override
  Widget build(BuildContext context) {
    return RepositoryScope(
      repository: repository,
      child: MaterialApp(
        title: 'بيت الحكمة',
        debugShowCheckedModeBanner: false,
        theme: AppTheme.light(),
        darkTheme: AppTheme.dark(),
        locale: const Locale('ar'),
        supportedLocales: const [Locale('ar'), Locale('fr'), Locale('en')],
        localizationsDelegates: const [
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        home: const AppShell(),
      ),
    );
  }
}
