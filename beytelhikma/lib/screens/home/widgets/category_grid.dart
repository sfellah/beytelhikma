import 'package:flutter/material.dart';

import '../../../models/book_category.dart';
import '../../../theme/app_theme.dart';

/// Grille des disciplines. Chaque tuile alterne entre trois pastilles d'accent,
/// comme la section « التخصصات العلمية » de la maquette.
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

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: GridView.builder(
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
          maxCrossAxisExtent: 200,
          mainAxisSpacing: 14,
          crossAxisSpacing: 14,
          childAspectRatio: 1.3,
        ),
        itemCount: categories.length,
        itemBuilder: (context, index) => _CategoryTile(
          category: categories[index],
          accent: _Accent.values[index % _Accent.values.length],
          icon: _icons[categories[index].label] ?? Icons.category_outlined,
          onTap: () => onTap(categories[index]),
        ),
      ),
    );
  }
}

enum _Accent { tertiary, secondary, primary }

class _CategoryTile extends StatelessWidget {
  const _CategoryTile({
    required this.category,
    required this.accent,
    required this.icon,
    required this.onTap,
  });

  final BookCategory category;
  final _Accent accent;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final theme = Theme.of(context);

    final (bubble, foreground) = switch (accent) {
      _Accent.tertiary => (
        scheme.tertiaryContainer.withValues(alpha: 0.35),
        scheme.tertiary,
      ),
      _Accent.secondary => (
        scheme.secondaryContainer.withValues(alpha: 0.5),
        scheme.secondary,
      ),
      _Accent.primary => (
        scheme.primaryContainer.withValues(alpha: 0.35),
        scheme.primary,
      ),
    };

    return InkWell(
      borderRadius: BorderRadius.circular(AppRadius.container),
      onTap: onTap,
      child: Container(
        decoration: BoxDecoration(
          color: scheme.surfaceContainerLow,
          borderRadius: BorderRadius.circular(AppRadius.container),
          border: Border.all(
            color: scheme.outlineVariant.withValues(alpha: 0.35),
          ),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              width: 46,
              height: 46,
              decoration: BoxDecoration(color: bubble, shape: BoxShape.circle),
              child: Icon(icon, size: 22, color: foreground),
            ),
            const SizedBox(height: 12),
            Text(
              category.label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: theme.textTheme.titleMedium,
            ),
            const SizedBox(height: 2),
            Text(
              '${category.bookCount} كتاب',
              style: theme.textTheme.labelSmall,
            ),
          ],
        ),
      ),
    );
  }
}
