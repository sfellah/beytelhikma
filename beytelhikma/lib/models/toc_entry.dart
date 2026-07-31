/// Entrée du sommaire. La hiérarchie est reconstruite via [parentTocId].
class TocEntry {
  TocEntry({
    required this.tocId,
    required this.pageId,
    required this.title,
    this.parentTocId,
    this.level = 1,
    this.sequenceNum = 0,
    List<TocEntry>? children,
  }) : children = children ?? <TocEntry>[];

  final int tocId;
  final int pageId;
  final String title;
  final int? parentTocId;
  final int level;
  final int sequenceNum;
  final List<TocEntry> children;

  bool get hasChildren => children.isNotEmpty;

  factory TocEntry.fromMap(Map<String, Object?> map) => TocEntry(
    tocId: map['toc_id']! as int,
    pageId: map['page_id']! as int,
    title: (map['title_text'] as String?) ?? '',
    parentTocId: map['parent_toc_id'] as int?,
    level: (map['level'] as int?) ?? 1,
    sequenceNum: (map['sequence_num'] as int?) ?? 0,
  );

  /// Reconstruit l'arbre à partir d'une liste plate triée.
  static List<TocEntry> buildTree(List<TocEntry> flat) {
    final byId = {for (final entry in flat) entry.tocId: entry};
    final roots = <TocEntry>[];
    for (final entry in flat) {
      final parent = entry.parentTocId == null ? null : byId[entry.parentTocId];
      if (parent == null) {
        roots.add(entry);
      } else {
        parent.children.add(entry);
      }
    }
    return roots;
  }
}
