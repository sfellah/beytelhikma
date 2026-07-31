import 'author.dart';
import 'book_summary.dart';
import 'volume.dart';

/// Fiche complète d'une édition : catalogue + volumes + auteurs.
class BookDetail {
  const BookDetail({
    required this.summary,
    this.authors = const <Author>[],
    this.volumes = const <Volume>[],
    this.bibliographyText,
    this.publisher,
    this.editionLabel,
    this.publicationYear,
    this.pageCount,
    this.tocCount,
    this.otherEditions = const <BookSummary>[],
  });

  final BookSummary summary;
  final List<Author> authors;
  final List<Volume> volumes;
  final String? bibliographyText;
  final String? publisher;
  final String? editionLabel;
  final int? publicationYear;
  final int? pageCount;
  final int? tocCount;

  /// Autres éditions de la même œuvre (relation `same_work`).
  final List<BookSummary> otherEditions;

  String get editionId => summary.editionId;
  String get title => summary.title;

  Author? get mainAuthor {
    for (final author in authors) {
      if (author.role == 'author') return author;
    }
    return authors.isEmpty ? null : authors.first;
  }

  /// Métadonnées présentes uniquement : l'UI n'affiche pas de ligne vide.
  Map<String, String> get metadataRows => {
    if (publisher?.isNotEmpty == true) 'الناشر': publisher!,
    if (editionLabel?.isNotEmpty == true) 'الطبعة': editionLabel!,
    if (publicationYear != null) 'سنة النشر': '$publicationYear',
    if (summary.hasMultipleVolumes) 'عدد الأجزاء': '${summary.volumeCount}',
    if (pageCount != null) 'عدد الصفحات': '$pageCount',
    if (summary.categoryLabel?.isNotEmpty == true)
      'التصنيف': summary.categoryLabel!,
  };
}
