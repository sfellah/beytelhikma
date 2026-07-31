/// Auteur d'une édition. Tous les champs hors identité peuvent manquer.
class Author {
  const Author({
    required this.authorId,
    required this.fullName,
    this.shortName,
    this.deathYearHijri,
    this.bio,
    this.portraitUrl,
    this.role = 'author',
  });

  final String authorId;
  final String fullName;
  final String? shortName;
  final int? deathYearHijri;
  final String? bio;
  final String? portraitUrl;
  final String role;

  /// Nom court si disponible, sinon nom complet.
  String get displayName =>
      shortName?.isNotEmpty == true ? shortName! : fullName;

  factory Author.fromMap(Map<String, Object?> map) => Author(
    authorId: map['author_id']! as String,
    fullName: map['full_name_ar']! as String,
    shortName: map['short_name_ar'] as String?,
    deathYearHijri: map['death_year_hijri'] as int?,
    bio: map['bio_ar'] as String?,
    portraitUrl: map['portrait_url'] as String?,
    role: (map['role'] as String?) ?? 'author',
  );

  Map<String, Object?> toJson() => {
    'author_id': authorId,
    'full_name_ar': fullName,
    'short_name_ar': shortName,
    'death_year_hijri': deathYearHijri,
    'bio_ar': bio,
    'portrait_url': portraitUrl,
    'role': role,
  };
}
