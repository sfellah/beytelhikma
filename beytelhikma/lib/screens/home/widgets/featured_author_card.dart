import 'package:flutter/material.dart';

import '../../../models/author.dart';
import '../../../models/book_summary.dart';
import '../../../theme/app_theme.dart';

/// Bloc « شخصية الشهر » : portrait cerclé d'or, notice, puis les ouvrages.
class FeaturedAuthorCard extends StatelessWidget {
  const FeaturedAuthorCard({
    required this.author,
    required this.books,
    required this.onBookTap,
    super.key,
  });

  final Author author;
  final List<BookSummary> books;
  final ValueChanged<BookSummary> onBookTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 62,
                  height: 62,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: scheme.secondaryContainer,
                    border: Border.all(color: scheme.secondary, width: 2),
                  ),
                  child: Center(
                    child: Text(
                      author.displayName.characters.first,
                      style: theme.textTheme.headlineMedium?.copyWith(
                        color: scheme.onSecondaryContainer,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        author.displayName,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      if (author.deathYearHijri != null)
                        Text(
                          'ت. ${author.deathYearHijri} هـ',
                          style: theme.textTheme.labelSmall,
                        ),
                    ],
                  ),
                ),
              ],
            ),
            if (author.bio != null) ...[
              const SizedBox(height: 16),
              Text(
                author.bio!,
                style: theme.textTheme.bodyMedium,
                maxLines: 4,
                overflow: TextOverflow.ellipsis,
              ),
            ],
            if (books.isNotEmpty) ...[
              const SizedBox(height: 20),
              Text('أبرز مؤلفاته:', style: theme.textTheme.labelLarge),
              const SizedBox(height: 8),
              for (final book in books)
                _AuthorBookRow(book: book, onTap: () => onBookTap(book)),
            ],
          ],
        ),
      ),
    );
  }
}

class _AuthorBookRow extends StatelessWidget {
  const _AuthorBookRow({required this.book, required this.onTap});

  final BookSummary book;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return InkWell(
      borderRadius: BorderRadius.circular(AppRadius.small),
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 4),
        child: Row(
          children: [
            Container(
              width: 30,
              height: 38,
              decoration: BoxDecoration(
                color: scheme.tertiaryContainer.withValues(alpha: 0.35),
                borderRadius: BorderRadius.circular(AppRadius.small),
              ),
              child: Icon(
                Icons.book_outlined,
                size: 15,
                color: scheme.tertiary,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                book.title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.labelLarge,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
