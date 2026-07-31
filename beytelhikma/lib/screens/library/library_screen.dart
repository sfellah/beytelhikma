import 'package:flutter/material.dart';

import '../../models/library_entry.dart';
import '../../repositories/book_repository.dart';
import '../../widgets/book_card.dart';
import '../../widgets/repository_scope.dart';
import '../../widgets/state_views.dart';
import '../book_detail/book_detail_screen.dart';

/// « مكتبتي » : les livres installés sur l'appareil et leur progression.
class LibraryScreen extends StatefulWidget {
  const LibraryScreen({super.key});

  @override
  State<LibraryScreen> createState() => _LibraryScreenState();
}

enum _LibraryFilter { all, reading, notStarted }

class _LibraryScreenState extends State<LibraryScreen> {
  late Future<List<LibraryEntry>> _future;
  _LibraryFilter _filter = _LibraryFilter.all;

  BookRepository get _repository => RepositoryScope.of(context);

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _future = _repository.getLibrary();
  }

  void _reload() => setState(() => _future = _repository.getLibrary());

  List<LibraryEntry> _applyFilter(List<LibraryEntry> entries) =>
      switch (_filter) {
        _LibraryFilter.all => entries,
        _LibraryFilter.reading =>
          entries.where((entry) => entry.isStarted).toList(growable: false),
        _LibraryFilter.notStarted =>
          entries.where((entry) => !entry.isStarted).toList(growable: false),
      };

  Future<void> _open(LibraryEntry entry) async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => BookDetailScreen(editionId: entry.book.editionId),
      ),
    );
    if (mounted) _reload();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('مكتبتي')),
      body: AsyncView<List<LibraryEntry>>(
        future: _future,
        onRetry: _reload,
        isEmpty: (entries) => entries.isEmpty,
        emptyMessage: 'لم تُثبَّت أي كتب بعد',
        loadingLabel: 'جارٍ فتح مكتبتك…',
        builder: (context, entries) {
          final filtered = _applyFilter(entries);
          return RefreshIndicator(
            onRefresh: () async => _reload(),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
              children: [
                SegmentedButton<_LibraryFilter>(
                  segments: const [
                    ButtonSegment(
                      value: _LibraryFilter.all,
                      label: Text('الكل'),
                    ),
                    ButtonSegment(
                      value: _LibraryFilter.reading,
                      label: Text('قيد القراءة'),
                    ),
                    ButtonSegment(
                      value: _LibraryFilter.notStarted,
                      label: Text('لم تبدأ'),
                    ),
                  ],
                  selected: {_filter},
                  showSelectedIcon: false,
                  onSelectionChanged: (selection) =>
                      setState(() => _filter = selection.first),
                ),
                const SizedBox(height: 12),
                if (filtered.isEmpty)
                  const Padding(
                    padding: EdgeInsets.only(top: 64),
                    child: EmptyView(message: 'لا توجد كتب في هذا التصنيف'),
                  )
                else
                  for (final entry in filtered)
                    BookListTile(
                      book: entry.book,
                      progress: entry.percent,
                      onTap: () => _open(entry),
                      trailing: entry.isStarted
                          ? null
                          : Icon(
                              Icons.download_done_outlined,
                              size: 18,
                              color: Theme.of(context).colorScheme.outline,
                            ),
                    ),
              ],
            ),
          );
        },
      ),
    );
  }
}
