import 'package:flutter/material.dart';

import '../models/book_summary.dart';
import '../theme/app_theme.dart';
import 'cover_image.dart';

/// Carte verticale du carrousel « nouveautés ».
class BookCard extends StatelessWidget {
  const BookCard({
    required this.book,
    required this.onTap,
    this.width = 148,
    this.progress,
    super.key,
  });

  final BookSummary book;
  final VoidCallback onTap;
  final double width;
  final double? progress;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return SizedBox(
      width: width,
      child: InkWell(
        borderRadius: BorderRadius.circular(10),
        onTap: onTap,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            AspectRatio(
              aspectRatio: 2 / 3,
              child: PhysicalModel(
                color: Colors.transparent,
                elevation: 4,
                shadowColor: theme.colorScheme.primary.withValues(alpha: 0.25),
                borderRadius: BorderRadius.circular(AppRadius.small),
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    CoverImage(book: book, borderRadius: AppRadius.small),
                    if (progress != null && progress! > 0)
                      PositionedDirectional(
                        start: 0,
                        end: 0,
                        bottom: 0,
                        child: LinearProgressIndicator(
                          value: progress!.clamp(0, 1),
                          minHeight: 4,
                          backgroundColor: Colors.black.withValues(alpha: 0.25),
                          valueColor: AlwaysStoppedAnimation(
                            theme.colorScheme.inversePrimary,
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 14),
            Text(
              book.title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: theme.textTheme.labelLarge?.copyWith(
                fontWeight: FontWeight.w700,
              ),
            ),
            if (book.authorName != null)
              Padding(
                padding: const EdgeInsetsDirectional.only(top: 3),
                child: Text(
                  book.authorName!,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.labelSmall,
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// Rangée horizontale : utilisée par « ma bibliothèque » et les listes.
class BookListTile extends StatelessWidget {
  const BookListTile({
    required this.book,
    required this.onTap,
    this.progress,
    this.trailing,
    super.key,
  });

  final BookSummary book;
  final VoidCallback onTap;
  final double? progress;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 8),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 56,
              height: 80,
              child: CoverImage(book: book, showTitle: false),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    book.title,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.titleMedium,
                  ),
                  if (book.authorName != null)
                    Padding(
                      padding: const EdgeInsetsDirectional.only(top: 4),
                      child: Text(
                        book.authorName!,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.labelMedium,
                      ),
                    ),
                  if (progress != null && progress! > 0) ...[
                    const SizedBox(height: 10),
                    ClipRRect(
                      borderRadius: BorderRadius.circular(4),
                      child: LinearProgressIndicator(
                        value: progress!.clamp(0, 1),
                        minHeight: 4,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '${(progress! * 100).round()}٪ مكتمل',
                      style: theme.textTheme.labelSmall,
                    ),
                  ],
                ],
              ),
            ),
            if (trailing != null) ...[const SizedBox(width: 8), trailing!],
          ],
        ),
      ),
    );
  }
}
