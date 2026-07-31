/// Vue « carte » d'une édition : ce que le catalogue suffit à fournir.
class BookSummary {
  const BookSummary({
    required this.editionId,
    required this.workId,
    required this.title,
    this.subtitle,
    this.categoryId,
    this.categoryLabel,
    this.authorName,
    this.volumeCount = 1,
    this.pageCount,
    this.coverUrl,
    this.language = 'ar',
  });

  final String editionId;
  final String workId;
  final String title;
  final String? subtitle;
  final int? categoryId;
  final String? categoryLabel;
  final String? authorName;
  final int volumeCount;
  final int? pageCount;
  final String? coverUrl;
  final String language;

  bool get hasMultipleVolumes => volumeCount > 1;

  factory BookSummary.fromMap(Map<String, Object?> map) => BookSummary(
    editionId: map['edition_id']! as String,
    workId: (map['work_id'] as String?) ?? '',
    title: map['title_ar']! as String,
    subtitle: map['subtitle_ar'] as String?,
    categoryId: map['category_id'] as int?,
    categoryLabel: map['category_label'] as String?,
    authorName: map['author_name'] as String?,
    volumeCount: (map['volume_count'] as int?) ?? 1,
    pageCount: map['page_count'] as int?,
    coverUrl: map['cover_url'] as String?,
    language: (map['language'] as String?) ?? 'ar',
  );

  Map<String, Object?> toJson() => {
    'edition_id': editionId,
    'work_id': workId,
    'title_ar': title,
    'subtitle_ar': subtitle,
    'category_id': categoryId,
    'category_label': categoryLabel,
    'author_name': authorName,
    'volume_count': volumeCount,
    'page_count': pageCount,
    'cover_url': coverUrl,
    'language': language,
  };
}
