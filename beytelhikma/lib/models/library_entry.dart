import 'book_summary.dart';
import 'reading_progress.dart';

/// Livre installé sur l'appareil, avec sa progression éventuelle.
class LibraryEntry {
  const LibraryEntry({
    required this.book,
    required this.status,
    this.progress,
    this.lastOpenedAt,
  });

  final BookSummary book;
  final String status;
  final ReadingProgress? progress;
  final DateTime? lastOpenedAt;

  bool get isInstalled => status == 'installed';
  bool get isStarted => (progress?.percent ?? 0) > 0;
  double get percent => progress?.percent ?? 0;
}
