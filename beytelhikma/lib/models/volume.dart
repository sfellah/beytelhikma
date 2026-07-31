/// Volume (جزء) d'une édition.
class Volume {
  const Volume({
    required this.volumeId,
    required this.partNumber,
    this.label,
    this.sequenceNum = 0,
    this.firstPageId,
    this.lastPageId,
  });

  final int volumeId;
  final int partNumber;
  final String? label;
  final int sequenceNum;
  final int? firstPageId;
  final int? lastPageId;

  String get displayLabel =>
      label?.isNotEmpty == true ? label! : 'الجزء $partNumber';

  factory Volume.fromMap(Map<String, Object?> map) => Volume(
    volumeId: map['volume_id']! as int,
    partNumber: (map['part_number'] as int?) ?? 1,
    label: map['label_ar'] as String?,
    sequenceNum: (map['sequence_num'] as int?) ?? 0,
    firstPageId: map['first_page_id'] as int?,
    lastPageId: map['last_page_id'] as int?,
  );

  Map<String, Object?> toJson() => {
    'volume_id': volumeId,
    'part_number': partNumber,
    'label_ar': label,
    'sequence_num': sequenceNum,
    'first_page_id': firstPageId,
    'last_page_id': lastPageId,
  };
}
