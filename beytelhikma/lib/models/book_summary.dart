/// Vue « carte » d'une édition : ce que le catalogue suffit à fournir.
class BookSummary {
  const BookSummary({
    required this.editionId,
    required this.workId,
    required this.title,
    this.subtitle,
    this.categoryId,
    this.categoryLabel,
    this.bookType,
    this.authorName,
    this.authorDeathYear,
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

  /// `book_type_label` : « كتاب » ou l'un des quatre autres — رسالة جامعية,
  /// مجلة, دروس مفرغة, رسالة. Décide de la mise en page de la couverture : ce
  /// qui n'est pas un livre ne doit pas se présenter comme un livre.
  final String? bookType;
  final String? authorName;

  /// Année de décès hégirienne de l'auteur, renseignée pour 69 % du corpus.
  /// Elle donne la reliure de la couverture (`lib/utils/book_cover.dart`) ;
  /// son absence est un cas prévu, pas un trou.
  final int? authorDeathYear;
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
    bookType: map['book_type_label'] as String?,
    authorName: map['author_name'] as String?,
    authorDeathYear: map['author_death_year'] as int?,
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
    'book_type_label': bookType,
    'author_name': authorName,
    'author_death_year': authorDeathYear,
    'volume_count': volumeCount,
    'page_count': pageCount,
    'cover_url': coverUrl,
    'language': language,
  };
}
