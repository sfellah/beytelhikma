/// Page d'un livre. `bodyHtml` est le rendu fidèle, `bodyPlain` sert à la copie.
class BookPage {
  const BookPage({
    required this.pageId,
    required this.sequenceNum,
    required this.bodyHtml,
    required this.bodyPlain,
    this.volumeId,
    this.printedPageNum,
    this.footnotes,
    this.hints,
  });

  final int pageId;
  final int sequenceNum;
  final String bodyHtml;
  final String bodyPlain;
  final int? volumeId;
  final int? printedPageNum;
  final String? footnotes;
  final String? hints;

  bool get hasFootnotes => footnotes?.trim().isNotEmpty == true;

  factory BookPage.fromMap(Map<String, Object?> map) => BookPage(
    pageId: map['page_id']! as int,
    sequenceNum: map['sequence_num']! as int,
    bodyHtml: (map['body_html'] as String?) ?? '',
    bodyPlain: (map['body_plain'] as String?) ?? '',
    volumeId: map['volume_id'] as int?,
    printedPageNum: map['printed_page_num'] as int?,
    footnotes: map['footnotes'] as String?,
    hints: map['hints'] as String?,
  );

  Map<String, Object?> toJson() => {
    'page_id': pageId,
    'sequence_num': sequenceNum,
    'body_html': bodyHtml,
    'body_plain': bodyPlain,
    'volume_id': volumeId,
    'printed_page_num': printedPageNum,
    'footnotes': footnotes,
    'hints': hints,
  };
}
