import 'package:flutter/material.dart';

import '../../models/book_detail.dart';
import '../../models/reading_progress.dart';
import '../../models/toc_entry.dart';
import '../../repositories/book_repository.dart';
import '../../widgets/cover_image.dart';
import '../../widgets/repository_scope.dart';
import '../../widgets/state_views.dart';
import '../reader/reader_screen.dart';
import 'widgets/metadata_table.dart';
import 'widgets/toc_tree.dart';

/// Ce que la fiche a besoin d'afficher, chargé en une passe.
class BookDetailData {
  const BookDetailData({
    required this.detail,
    required this.toc,
    required this.progress,
  });

  final BookDetail detail;
  final List<TocEntry> toc;
  final ReadingProgress? progress;
}

class BookDetailScreen extends StatefulWidget {
  const BookDetailScreen({required this.editionId, super.key});

  final String editionId;

  @override
  State<BookDetailScreen> createState() => _BookDetailScreenState();
}

class _BookDetailScreenState extends State<BookDetailScreen> {
  late Future<BookDetailData> _future;

  BookRepository get _repository => RepositoryScope.of(context);

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _future = _load();
  }

  Future<BookDetailData> _load() async {
    final repository = _repository;
    final detail = await repository.getBookDetail(widget.editionId);
    List<TocEntry> toc = const [];
    try {
      toc = TocEntry.buildTree(await repository.getToc(widget.editionId));
    } on RepositoryException {
      // Livre non installé : la fiche reste consultable sans sommaire.
    }
    final progress = await repository.getProgress(widget.editionId);
    return BookDetailData(detail: detail, toc: toc, progress: progress);
  }

  void _reload() => setState(() => _future = _load());

  Future<void> _read({int? pageId}) async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) =>
            ReaderScreen(editionId: widget.editionId, startPageId: pageId),
      ),
    );
    if (mounted) _reload();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: AsyncView<BookDetailData>(
        future: _future,
        onRetry: _reload,
        loadingLabel: 'جارٍ تحميل بطاقة الكتاب…',
        builder: (context, data) => _DetailBody(
          data: data,
          onRead: _read,
          onTocTap: (entry) => _read(pageId: entry.pageId),
        ),
      ),
    );
  }
}

class _DetailBody extends StatelessWidget {
  const _DetailBody({
    required this.data,
    required this.onRead,
    required this.onTocTap,
  });

  final BookDetailData data;
  final void Function({int? pageId}) onRead;
  final ValueChanged<TocEntry> onTocTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final detail = data.detail;
    final progress = data.progress;
    final author = detail.mainAuthor;

    return CustomScrollView(
      slivers: [
        SliverAppBar(
          pinned: true,
          expandedHeight: 300,
          backgroundColor: theme.colorScheme.surface,
          flexibleSpace: FlexibleSpaceBar(
            background: _CoverHeader(detail: detail),
            collapseMode: CollapseMode.parallax,
          ),
        ),
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 20, 16, 32),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (detail.summary.categoryLabel != null)
                  Chip(label: Text(detail.summary.categoryLabel!)),
                const SizedBox(height: 10),
                Text(
                  detail.title,
                  style: theme.textTheme.displayLarge?.copyWith(
                    color: theme.colorScheme.primary,
                  ),
                ),
                if (detail.summary.subtitle != null)
                  Padding(
                    padding: const EdgeInsetsDirectional.only(top: 6),
                    child: Text(
                      detail.summary.subtitle!,
                      style: theme.textTheme.labelMedium,
                    ),
                  ),
                if (author != null) ...[
                  const SizedBox(height: 16),
                  Row(
                    children: [
                      CircleAvatar(
                        radius: 20,
                        backgroundColor: theme.colorScheme.secondaryContainer,
                        child: Text(
                          author.displayName.characters.first,
                          style: theme.textTheme.titleMedium?.copyWith(
                            color: theme.colorScheme.onSecondaryContainer,
                          ),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              author.fullName,
                              style: theme.textTheme.titleMedium,
                            ),
                            Text(
                              author.deathYearHijri != null
                                  ? 'المؤلف • ت. ${author.deathYearHijri} هـ'
                                  : 'المؤلف',
                              style: theme.textTheme.labelSmall,
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ],
                const SizedBox(height: 22),
                Row(
                  children: [
                    Expanded(
                      child: FilledButton.icon(
                        onPressed: () => onRead(pageId: progress?.pageId),
                        icon: const Icon(Icons.menu_book_outlined, size: 20),
                        label: Text(
                          progress == null
                              ? 'ابدأ القراءة'
                              : 'متابعة القراءة • ${progress.percentRounded}٪',
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    IconButton.filledTonal(
                      onPressed: () =>
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              content: Text('المجموعات قيد الإنجاز'),
                            ),
                          ),
                      icon: const Icon(Icons.bookmark_add_outlined),
                      tooltip: 'إضافة إلى مجموعة',
                    ),
                  ],
                ),
                if (progress != null) ...[
                  const SizedBox(height: 14),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(4),
                    child: LinearProgressIndicator(
                      value: progress.percent.clamp(0, 1),
                      minHeight: 5,
                    ),
                  ),
                ],
                if (detail.bibliographyText?.isNotEmpty == true) ...[
                  const SizedBox(height: 28),
                  Text('عن الكتاب', style: theme.textTheme.headlineMedium),
                  const SizedBox(height: 10),
                  Text(
                    detail.bibliographyText!,
                    style: theme.textTheme.bodyLarge,
                  ),
                ],
                if (detail.metadataRows.isNotEmpty) ...[
                  const SizedBox(height: 28),
                  Text('بيانات النشر', style: theme.textTheme.headlineMedium),
                  const SizedBox(height: 12),
                  MetadataTable(rows: detail.metadataRows),
                ],
                if (detail.volumes.length > 1) ...[
                  const SizedBox(height: 28),
                  Text('الأجزاء', style: theme.textTheme.headlineMedium),
                  const SizedBox(height: 8),
                  for (final volume in detail.volumes)
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      leading: const Icon(Icons.layers_outlined),
                      title: Text(
                        volume.displayLabel,
                        style: theme.textTheme.labelLarge,
                      ),
                      trailing: const Icon(Icons.chevron_left),
                      onTap: () => onRead(pageId: volume.firstPageId),
                    ),
                ],
                const SizedBox(height: 28),
                Text('فهرس المحتويات', style: theme.textTheme.headlineMedium),
                const SizedBox(height: 8),
                if (data.toc.isEmpty)
                  const EmptyView(
                    message: 'لا يتوفر فهرس لهذا الكتاب',
                    icon: Icons.toc_outlined,
                  )
                else
                  TocTree(entries: data.toc, onTap: onTocTap),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _CoverHeader extends StatelessWidget {
  const _CoverHeader({required this.detail});

  final BookDetail detail;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      color: theme.colorScheme.surfaceContainerLow,
      padding: const EdgeInsets.only(top: 72, bottom: 20),
      child: Center(
        child: SizedBox(
          width: 148,
          child: AspectRatio(
            aspectRatio: 2 / 3,
            child: DecoratedBox(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(10),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.18),
                    blurRadius: 18,
                    offset: const Offset(0, 8),
                  ),
                ],
              ),
              child: CoverImage(book: detail.summary),
            ),
          ),
        ),
      ),
    );
  }
}
