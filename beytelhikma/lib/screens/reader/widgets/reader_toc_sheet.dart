import 'package:flutter/material.dart';

import '../../../models/toc_entry.dart';
import '../reader_settings.dart';

/// Sommaire accessible depuis le lecteur, aux couleurs de l'ambiance choisie.
class ReaderTocSheet extends StatelessWidget {
  const ReaderTocSheet({
    required this.entries,
    required this.palette,
    required this.onTap,
    this.currentPageId,
    super.key,
  });

  final List<TocEntry> entries;
  final ReaderPalette palette;
  final ValueChanged<TocEntry> onTap;
  final int? currentPageId;

  @override
  Widget build(BuildContext context) {
    final flat = <TocEntry>[];
    void walk(List<TocEntry> nodes) {
      for (final node in nodes) {
        flat.add(node);
        walk(node.children);
      }
    }

    walk(entries);

    return FractionallySizedBox(
      heightFactor: 0.7,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 10),
            child: Text(
              'الفهرس',
              style: TextStyle(
                color: palette.onSurface,
                fontSize: 17,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          Expanded(
            child: flat.isEmpty
                ? Center(
                    child: Text(
                      'لا يتوفر فهرس',
                      style: TextStyle(color: palette.muted),
                    ),
                  )
                : ListView.builder(
                    itemCount: flat.length,
                    itemBuilder: (context, index) {
                      final entry = flat[index];
                      final isCurrent = entry.pageId == currentPageId;
                      return ListTile(
                        dense: entry.level > 1,
                        contentPadding: EdgeInsetsDirectional.only(
                          start: 20.0 + 16 * (entry.level - 1),
                          end: 20,
                        ),
                        title: Text(
                          entry.title,
                          style: TextStyle(
                            color: isCurrent
                                ? palette.accent
                                : palette.onSurface,
                            fontSize: entry.level > 1 ? 14 : 15,
                            fontWeight: isCurrent || entry.level == 1
                                ? FontWeight.w600
                                : FontWeight.w400,
                          ),
                        ),
                        trailing: Text(
                          '${entry.pageId}',
                          style: TextStyle(color: palette.muted, fontSize: 12),
                        ),
                        onTap: () => onTap(entry),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}
