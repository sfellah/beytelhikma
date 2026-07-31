import 'package:flutter/material.dart';

import '../../../models/toc_entry.dart';

/// Sommaire hiérarchique : les entrées avec enfants sont dépliables.
class TocTree extends StatelessWidget {
  const TocTree({required this.entries, required this.onTap, super.key});

  final List<TocEntry> entries;
  final ValueChanged<TocEntry> onTap;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final entry in entries) _TocNode(entry: entry, onTap: onTap),
      ],
    );
  }
}

class _TocNode extends StatelessWidget {
  const _TocNode({required this.entry, required this.onTap});

  final TocEntry entry;
  final ValueChanged<TocEntry> onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final title = Text(
      entry.title,
      style: entry.level <= 1
          ? theme.textTheme.labelLarge
          : theme.textTheme.labelMedium,
    );

    if (!entry.hasChildren) {
      return InkWell(
        onTap: () => onTap(entry),
        child: Padding(
          padding: EdgeInsetsDirectional.only(
            start: 8.0 * entry.level,
            top: 10,
            bottom: 10,
            end: 4,
          ),
          child: Row(
            children: [
              Expanded(child: title),
              Text('ص ${entry.pageId}', style: theme.textTheme.labelSmall),
              const SizedBox(width: 4),
              Icon(
                Icons.chevron_left,
                size: 18,
                color: theme.colorScheme.outline,
              ),
            ],
          ),
        ),
      );
    }

    return Theme(
      data: theme.copyWith(dividerColor: Colors.transparent),
      child: ExpansionTile(
        initiallyExpanded: entry.level <= 1,
        tilePadding: EdgeInsetsDirectional.only(
          start: 8.0 * entry.level,
          end: 4,
        ),
        childrenPadding: const EdgeInsetsDirectional.only(start: 12),
        title: title,
        subtitle: Text('ص ${entry.pageId}', style: theme.textTheme.labelSmall),
        trailing: IconButton(
          icon: const Icon(Icons.menu_book_outlined, size: 18),
          tooltip: 'اقرأ من هنا',
          onPressed: () => onTap(entry),
        ),
        children: [
          for (final child in entry.children)
            _TocNode(entry: child, onTap: onTap),
        ],
      ),
    );
  }
}
