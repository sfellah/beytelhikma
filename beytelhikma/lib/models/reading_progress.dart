/// Progression de lecture, stockée dans `user.sqlite`.
class ReadingProgress {
  const ReadingProgress({
    required this.editionId,
    required this.pageId,
    this.sequenceNum = 1,
    this.percent = 0,
    this.updatedAt,
  });

  final String editionId;
  final int pageId;
  final int sequenceNum;
  final double percent;
  final DateTime? updatedAt;

  int get percentRounded => (percent * 100).round();

  factory ReadingProgress.fromMap(Map<String, Object?> map) => ReadingProgress(
    editionId: map['edition_id']! as String,
    pageId: (map['current_page_id'] as int?) ?? 1,
    sequenceNum: (map['current_sequence_num'] as int?) ?? 1,
    percent: ((map['progress_percent'] as num?) ?? 0).toDouble(),
    updatedAt: switch (map['last_opened_at']) {
      final String value => DateTime.tryParse(value),
      _ => null,
    },
  );

  Map<String, Object?> toJson() => {
    'edition_id': editionId,
    'current_page_id': pageId,
    'current_sequence_num': sequenceNum,
    'progress_percent': percent,
    'last_opened_at': updatedAt?.toIso8601String(),
  };
}
