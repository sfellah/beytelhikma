import 'package:flutter/material.dart';

import '../../../models/author.dart';
import '../../../models/book_summary.dart';

/// Bloc « شخصية الشهر » : auteur mis en avant et ses ouvrages.
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

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                CircleAvatar(
                  radius: 26,
                  backgroundColor: theme.colorScheme.secondaryContainer,
                  child: Text(
                    author.displayName.characters.first,
                    style: theme.textTheme.headlineMedium?.copyWith(
                      color: theme.colorScheme.onSecondaryContainer,
                    ),
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        author.displayName,
                        style: theme.textTheme.titleMedium,
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
              const SizedBox(height: 14),
              Text(
                author.bio!,
                style: theme.textTheme.bodyMedium,
                maxLines: 4,
                overflow: TextOverflow.ellipsis,
              ),
            ],
            if (books.isNotEmpty) ...[
              const SizedBox(height: 16),
              Text('أبرز مؤلفاته', style: theme.textTheme.labelLarge),
              const SizedBox(height: 6),
              for (final book in books)
                InkWell(
                  borderRadius: BorderRadius.circular(8),
                  onTap: () => onBookTap(book),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    child: Row(
                      children: [
                        Icon(
                          Icons.book_outlined,
                          size: 18,
                          color: theme.colorScheme.outline,
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            book.title,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: theme.textTheme.labelLarge,
                          ),
                        ),
                        Icon(
                          Icons.chevron_left,
                          size: 18,
                          color: theme.colorScheme.outline,
                        ),
                      ],
                    ),
                  ),
                ),
            ],
          ],
        ),
      ),
    );
  }
}
