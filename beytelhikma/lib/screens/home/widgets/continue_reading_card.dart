import 'package:flutter/material.dart';

import '../../../models/library_entry.dart';
import '../../../theme/app_theme.dart';
import '../../../widgets/cover_image.dart';

/// Carte du livre en cours, calquée sur le bloc héros de `home.html` :
/// couverture barrée de sa progression, puce de discipline, citation encadrée
/// d'un filet doré, pied de carte avec le pourcentage lu.
class ContinueReadingCard extends StatelessWidget {
  const ContinueReadingCard({
    required this.entry,
    required this.onTap,
    this.excerpt,
    super.key,
  });

  final LibraryEntry entry;
  final VoidCallback onTap;
  final String? excerpt;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final book = entry.book;
    final quote = excerpt?.trim();

    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(
                width: 104,
                height: 156,
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    PhysicalModel(
                      color: Colors.transparent,
                      elevation: 6,
                      shadowColor: Colors.black.withValues(alpha: 0.35),
                      borderRadius: BorderRadius.circular(AppRadius.small),
                      child: CoverImage(
                        book: book,
                        borderRadius: AppRadius.small,
                        showTitle: false,
                      ),
                    ),
                    PositionedDirectional(
                      start: 0,
                      end: 0,
                      bottom: 0,
                      child: LinearProgressIndicator(
                        value: entry.percent.clamp(0, 1),
                        minHeight: 4,
                        backgroundColor: scheme.surfaceContainerHighest
                            .withValues(alpha: 0.7),
                        valueColor: AlwaysStoppedAnimation(scheme.primary),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 20),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        if (book.categoryLabel != null)
                          Chip(
                            label: Text(book.categoryLabel!),
                            visualDensity: VisualDensity.compact,
                            materialTapTargetSize:
                                MaterialTapTargetSize.shrinkWrap,
                          ),
                        const Spacer(),
                        Icon(Icons.more_horiz, size: 18, color: scheme.outline),
                      ],
                    ),
                    const SizedBox(height: 10),
                    Text(
                      book.title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.titleMedium?.copyWith(
                        color: scheme.primary,
                        fontWeight: FontWeight.w700,
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
                    if (quote != null && quote.isNotEmpty) ...[
                      const SizedBox(height: 16),
                      Container(
                        padding: const EdgeInsetsDirectional.only(start: 14),
                        decoration: BoxDecoration(
                          border: BorderDirectional(
                            start: BorderSide(
                              color: scheme.secondary,
                              width: 3,
                            ),
                          ),
                        ),
                        child: Text(
                          '«$quote»',
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: theme.textTheme.bodyMedium?.copyWith(
                            fontStyle: FontStyle.italic,
                            color: scheme.onSurface,
                          ),
                        ),
                      ),
                    ],
                    const SizedBox(height: 18),
                    Row(
                      children: [
                        Text(
                          '${(entry.percent * 100).round()}٪ مكتمل',
                          style: theme.textTheme.labelSmall,
                        ),
                        const Spacer(),
                        Icon(
                          Icons.play_circle_outline,
                          size: 22,
                          color: scheme.primary,
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
