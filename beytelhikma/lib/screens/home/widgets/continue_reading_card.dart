import 'package:flutter/material.dart';

import '../../../models/library_entry.dart';
import '../../../widgets/cover_image.dart';

/// Reprise de lecture — pendant du bloc « أكمل القراءة » de `home.html`.
class ContinueReadingCard extends StatelessWidget {
  const ContinueReadingCard({
    required this.entry,
    required this.onTap,
    super.key,
  });

  final LibraryEntry entry;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final book = entry.book;

    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(
                width: 88,
                height: 132,
                child: CoverImage(book: book, showTitle: false),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (book.categoryLabel != null)
                      Chip(
                        label: Text(book.categoryLabel!),
                        visualDensity: VisualDensity.compact,
                        materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      ),
                    const SizedBox(height: 8),
                    Text(
                      book.title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.titleMedium?.copyWith(
                        color: theme.colorScheme.primary,
                      ),
                    ),
                    if (book.authorName != null)
                      Padding(
                        padding: const EdgeInsetsDirectional.only(top: 4),
                        child: Text(
                          book.authorName!,
                          style: theme.textTheme.labelMedium,
                        ),
                      ),
                    const SizedBox(height: 14),
                    ClipRRect(
                      borderRadius: BorderRadius.circular(4),
                      child: LinearProgressIndicator(
                        value: entry.percent.clamp(0, 1),
                        minHeight: 5,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        Text(
                          '${(entry.percent * 100).round()}٪ مكتمل',
                          style: theme.textTheme.labelSmall,
                        ),
                        const Spacer(),
                        TextButton.icon(
                          onPressed: onTap,
                          icon: const Icon(Icons.play_arrow, size: 18),
                          label: const Text('متابعة'),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
