import 'package:flutter/widgets.dart';

import '../repositories/book_repository.dart';

/// Injection du repository dans l'arbre : l'UI ne connaît que l'interface.
class RepositoryScope extends InheritedWidget {
  const RepositoryScope({
    required this.repository,
    required super.child,
    super.key,
  });

  final BookRepository repository;

  static BookRepository of(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<RepositoryScope>();
    assert(scope != null, 'Aucun RepositoryScope au-dessus de ce widget');
    return scope!.repository;
  }

  @override
  bool updateShouldNotify(RepositoryScope oldWidget) =>
      oldWidget.repository != repository;
}
