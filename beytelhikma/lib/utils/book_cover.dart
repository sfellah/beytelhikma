/// Composition des couvertures. Aucun livre du corpus n'a d'image :
/// `editions.cover_url` est nulle partout et les deux générateurs l'écrivent
/// ainsi. La couverture est donc dessinée, et dessinée **à partir de ce que le
/// catalogue sait** plutôt qu'au hasard d'un hachage d'identifiant.
///
/// Trois canaux, trois informations distinctes :
///
/// - la **forme** de l'objet décide de la mise en page — un متن de douze pages
///   et une موسوعة en vingt tomes ne doivent pas se ressembler, et c'est ce
///   qu'on veut savoir avant d'ouvrir ;
/// - la **famille** de la catégorie décide de la matière — teinte et motif ;
/// - le **siècle** de l'auteur décide de la patine — plus c'est ancien, plus la
///   teinte fonce et plus la dorure monte. Variable continue et non rupture de
///   style : une date absente donne une patine médiane, qui ne se remarque pas.
///
/// Reflet **exact** de `beytelhikma-electron/src/shared/book-cover.js` : mêmes
/// clés, mêmes teintes, mêmes seuils. `test/book-cover.test.js`, côté Electron,
/// lit ce fichier et compare les deux tables — sans quoi les deux clients
/// dériveraient comme ont dérivé leurs palettes d'origine.
///
/// Voir `docs/superpowers/specs/2026-07-31-couvertures-composees-design.md`.
library;

import 'dart:ui' show Color;

import 'arabic.dart';

/// La mise en page d'une couverture, donnée par la forme de l'objet. La
/// richesse de la reliure suit le poids : c'est ce qui rend la règle lisible
/// sans légende.
enum CoverShape {
  /// Métn de 120 pages ou moins : le titre est tout ce qu'il y a à dire.
  treatise,

  /// Un tome, de 121 à 400 pages : dégradé, trame discrète, double filet.
  book,

  /// Un tome de plus de 400 pages : panneau géométrique, titre en bandeau bas.
  tome,

  /// Plusieurs tomes : médaillon `شمسة`, titre en cartouche, double encadrement.
  compendium,

  /// Ce qui n'est pas un livre — رسالة جامعية, مجلة, دروس مفرغة. Papier clair,
  /// encre sombre, dos de reliure teinté.
  document,
}

/// Le seul libellé de `book_type_label` qui désigne un livre.
const bookTypeLabel = 'كتاب';

/// Seuils de pagination, mesurés sur les 397 éditions de `dist/shamela` pour
/// répartir le corpus sans qu'une mise en page devienne anecdotique :
/// 30 % / 27 % / 13 % / 21 % / 9 %.
const treatiseMaxPages = 120;
const bookMaxPages = 400;

CoverShape coverShape({String? bookType, int? volumeCount, int? pageCount}) {
  if (bookType != null &&
      normalizeArabic(bookType) != normalizeArabic(bookTypeLabel)) {
    return CoverShape.document;
  }
  if ((volumeCount ?? 1) > 1) return CoverShape.compendium;
  final pages = pageCount ?? 0;
  if (pages > 0 && pages <= treatiseMaxPages) return CoverShape.treatise;
  if (pages > bookMaxPages) return CoverShape.tome;
  return CoverShape.book;
}

/// Six géométries, pas neuf : deux familles partagent parfois la même trame et
/// n'en changent que la teinte.
enum CoverPattern { girih, knot, octagon, vine, kufi, grid }

class CoverMaterial {
  const CoverMaterial(this.from, this.to, this.pattern);

  /// Teintes en `0xAARRGGBB`, et non en `Color`, pour que la table de parité de
  /// `book-cover.test.js` puisse les lire dans ce fichier sans analyser Dart.
  final int from;
  final int to;
  final CoverPattern pattern;

  Color get start => Color(from);
  Color get end => Color(to);
}

/// Les teintes et le motif de chaque famille.
const coverFamilies = <String, CoverMaterial>{
  'quran': CoverMaterial(0xFF062B22, 0xFF0E4A3A, CoverPattern.girih),
  'aqida': CoverMaterial(0xFF101A33, 0xFF22345C, CoverPattern.knot),
  'hadith': CoverMaterial(0xFF2E2013, 0xFF5C4425, CoverPattern.knot),
  'fiqh': CoverMaterial(0xFF1E2A12, 0xFF3F5423, CoverPattern.octagon),
  'raqaiq': CoverMaterial(0xFF2A1836, 0xFF4C2F5E, CoverPattern.vine),
  'tarikh': CoverMaterial(0xFF3A2A12, 0xFF6B5119, CoverPattern.kufi),
  'lugha': CoverMaterial(0xFF12303A, 0xFF24525F, CoverPattern.grid),
  'adab': CoverMaterial(0xFF3A1418, 0xFF6B2A2F, CoverPattern.vine),
  'amma': CoverMaterial(0xFF1F2120, 0xFF414442, CoverPattern.grid),
};

const fallbackFamily = 'amma';

/// Les libellés tels qu'ils figurent au catalogue — les 40 catégories de
/// `dist/shamela` puis les 7 de `assets/sample`. On indexe par libellé et non
/// par `category_id` parce que les identifiants ne concordent pas entre les deux
/// jeux de données : `category_id = 1` vaut `العقيدة` côté Shamela et `التفسير`
/// côté échantillon. Le libellé, lui, est stable.
const _familyByLabel = <String, String>{
  // --- قرآن ------------------------------------------------------------------
  'التفسير': 'quran',
  'علوم القرآن وأصول التفسير': 'quran',
  'التجويد والقراءات': 'quran',
  // --- عقيدة -----------------------------------------------------------------
  'العقيدة': 'aqida',
  'الفرق والردود': 'aqida',
  // --- حديث ------------------------------------------------------------------
  'كتب السنة': 'hadith',
  'شروح الحديث': 'hadith',
  'التخريج والأطراف': 'hadith',
  'العلل والسؤلات الحديثية': 'hadith',
  'علوم الحديث': 'hadith',
  'الحديث': 'hadith',
  // --- فقه -------------------------------------------------------------------
  'أصول الفقه': 'fiqh',
  'علوم الفقه والقواعد الفقهية': 'fiqh',
  'المنطق': 'fiqh',
  'الفقه الحنفي': 'fiqh',
  'الفقه المالكي': 'fiqh',
  'الفقه الشافعي': 'fiqh',
  'الفقه الحنبلي': 'fiqh',
  'الفقه العام': 'fiqh',
  'مسائل فقهية': 'fiqh',
  'السياسة الشرعية والقضاء': 'fiqh',
  'الفرائض والوصايا': 'fiqh',
  'الفتاوى': 'fiqh',
  'الفقه': 'fiqh',
  // --- رقائق -----------------------------------------------------------------
  'الرقائق والآداب والأذكار': 'raqaiq',
  'التصوف': 'raqaiq',
  // --- تاريخ -----------------------------------------------------------------
  'السيرة النبوية': 'tarikh',
  'التاريخ': 'tarikh',
  'التراجم والطبقات': 'tarikh',
  'الأنساب': 'tarikh',
  'البلدان والرحلات': 'tarikh',
  // --- لغة -------------------------------------------------------------------
  'كتب اللغة': 'lugha',
  'الغريب والمعاجم': 'lugha',
  'النحو والصرف': 'lugha',
  'اللغة': 'lugha',
  // --- أدب -------------------------------------------------------------------
  'الأدب': 'adab',
  'العروض والقوافي': 'adab',
  'الشعر ودواوينه': 'adab',
  'البلاغة': 'adab',
  // --- عام -------------------------------------------------------------------
  'الجوامع': 'amma',
  'فهارس الكتب والأدلة': 'amma',
  'الطب': 'amma',
  'كتب عامة': 'amma',
  'علوم أخرى': 'amma',
};

/// La table s'écrit en arabe lisible, telle qu'on lit les libellés au catalogue ;
/// la recherche, elle, se fait sur la forme normalisée. Un libellé importé avec
/// des harakāt ou une hamza dénormalisée trouve donc la même famille.
final _familyByNormalizedLabel = <String, String>{
  for (final entry in _familyByLabel.entries)
    normalizeArabic(entry.key): entry.value,
};

/// Le siècle ne coupe plus le corpus en tranches : il le teint. Une date absente
/// — 29 % des éditions — vaut [patinaUndatedAge], au milieu de l'échelle, donc
/// elle ne se signale pas. C'est ce qui distingue une variable continue d'un
/// cinquième cas : l'ignorance n'a plus de style à elle.
const patinaNewestCentury = 15;
const patinaSpan = 14;
const patinaUndatedAge = 0.5;
const patinaDarken = 0.22;
const patinaGiltMin = 0.3;
const patinaGiltRange = 0.22;

/// `(année - 1) / 100 + 1`, division entière — la même expression que celle qui
/// range les livres par siècle dans l'écran Exploration.
int? hijriCentury(int? deathYearHijri) {
  if (deathYearHijri == null || deathYearHijri <= 0) return null;
  return (deathYearHijri - 1) ~/ 100 + 1;
}

/// 0 pour le plus récent, 1 pour le plus ancien.
double coverAge(int? deathYearHijri) {
  final century = hijriCentury(deathYearHijri);
  if (century == null) return patinaUndatedAge;
  return ((patinaNewestCentury - century) / patinaSpan).clamp(0.0, 1.0);
}

/// Assombrit vers le noir. `Color.lerp` vers noir donnerait le même résultat,
/// mais l'opération est faite sur l'entier pour rester le calque exact du
/// `darken()` JavaScript, que la table de parité compare.
int _darken(int argb, double amount) {
  int channel(int shift) =>
      (((argb >> shift) & 0xFF) * (1 - amount)).round() & 0xFF;
  return 0xFF000000 | (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

String coverFamily(String? categoryLabel) {
  final key = normalizeArabic(categoryLabel);
  if (key.isEmpty) return fallbackFamily;
  return _familyByNormalizedLabel[key] ?? fallbackFamily;
}

/// Tout ce dont une couverture a besoin pour se dessiner, en un seul appel :
/// la mise en page, et les teintes déjà patinées.
class CoverStyle {
  const CoverStyle({
    required this.shape,
    required this.family,
    required this.pattern,
    required this.age,
    required this.start,
    required this.end,
    required this.gilt,
  });

  final CoverShape shape;
  final String family;
  final CoverPattern pattern;

  /// 0 pour le plus récent, 1 pour le plus ancien.
  final double age;

  final Color start;
  final Color end;

  /// Opacité de la dorure, de [patinaGiltMin] à `patinaGiltMin + patinaGiltRange`.
  final double gilt;
}

CoverStyle coverStyleFor({
  String? categoryLabel,
  int? authorDeathYear,
  String? bookType,
  int? volumeCount,
  int? pageCount,
}) {
  final family = coverFamily(categoryLabel);
  final material = coverFamilies[family]!;
  final age = coverAge(authorDeathYear);
  return CoverStyle(
    shape: coverShape(
      bookType: bookType,
      volumeCount: volumeCount,
      pageCount: pageCount,
    ),
    family: family,
    pattern: material.pattern,
    age: age,
    start: Color(_darken(material.from, patinaDarken * age)),
    end: Color(_darken(material.to, patinaDarken * age)),
    gilt: patinaGiltMin + patinaGiltRange * age,
  );
}
