import 'package:flutter/material.dart';

import '../../../models/book_category.dart';

/// Grille des disciplines. L'icône dépend du libellé, avec un repli neutre.
class CategoryGrid extends StatelessWidget {
  const CategoryGrid({
    required this.categories,
    required this.onTap,
    super.key,
  });

  final List<BookCategory> categories;
  final ValueChanged<BookCategory> onTap;

  static const _icons = <String, IconData>{
    'التفسير': Icons.menu_book_outlined,
    'الحديث': Icons.history_edu_outlined,
    'الفقه': Icons.account_balance_outlined,
    'اللغة': Icons.translate_outlined,
    'التاريخ': Icons.history_outlined,
    'الأدب': Icons.auto_stories_outlined,
    'التصوف': Icons.self_improvement_outlined,
  };

  @override
  Widget build(BuildContext context) {
    if (categories.isEmpty) return const SizedBox.shrink();
    final theme = Theme.of(context);

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: GridView.builder(
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
          maxCrossAxisExtent: 190,
          mainAxisSpacing: 12,
          crossAxisSpacing: 12,
          childAspectRatio: 1.55,
        ),
        itemCount: categories.length,
        itemBuilder: (context, index) {
          final category = categories[index];
          return InkWell(
            borderRadius: BorderRadius.circular(12),
            onTap: () => onTap(category),
            child: Container(
              decoration: BoxDecoration(
                color: theme.colorScheme.surfaceContainerLow,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: theme.colorScheme.outlineVariant.withValues(
                    alpha: 0.45,
                  ),
                ),
              ),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      color: theme.colorScheme.secondaryContainer.withValues(
                        alpha: 0.45,
                      ),
                      shape: BoxShape.circle,
                    ),
                    child: Icon(
                      _icons[category.label] ?? Icons.category_outlined,
                      size: 20,
                      color: theme.colorScheme.onSecondaryContainer,
                    ),
                  ),
                  const SizedBox(height: 10),
                  Text(category.label, style: theme.textTheme.titleMedium),
                  Text(
                    '${category.bookCount} كتاب',
                    style: theme.textTheme.labelSmall,
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}
