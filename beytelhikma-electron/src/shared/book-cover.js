/**
 * Composition des couvertures. Aucun livre du corpus n'a d'image : `cover_url`
 * est nulle partout et les deux générateurs l'écrivent ainsi. La couverture est
 * donc dessinée, et dessinée **à partir de ce que le catalogue sait** plutôt
 * qu'au hasard d'un hachage d'identifiant.
 *
 * Trois canaux, trois informations distinctes :
 *
 * - la **forme** de l'objet décide de la mise en page — un متن de douze pages et
 *   une موسوعة en vingt tomes ne doivent pas se ressembler, et c'est ce qu'on
 *   veut savoir avant d'ouvrir ;
 * - la **famille** de la catégorie décide de la matière — teinte et motif ;
 * - le **siècle** de l'auteur décide de la patine — plus c'est ancien, plus la
 *   teinte fonce et plus la dorure monte. Variable continue et non rupture de
 *   style : une date absente donne une patine médiane, qui ne se remarque pas.
 *
 * Seule table du projet : tout client qui renaîtrait ailleurs devra la refléter
 * exactement et porter un test de parité qui lit cette source — c'est faute
 * d'un tel test que les palettes des deux clients d'origine avaient divergé.
 *
 * Voir `docs/superpowers/specs/2026-07-31-couvertures-composees-design.md`.
 */
import { normalizeArabic } from './arabic.js';

/* -------------------------------------------------------------------- forme */

/**
 * Le seul libellé de `book_type_label` qui désigne un livre. Tout le reste —
 * رسالة جامعية, مجلة, دروس مفرغة, رسالة — est un objet d'une autre nature, et
 * le montrer comme un livre serait mentir sur ce qu'on va ouvrir.
 */
const BOOK_TYPE = 'كتاب';

/**
 * Seuils de pagination, mesurés sur les 397 éditions de `dist/shamela` pour
 * répartir le corpus sans qu'une mise en page devienne anecdotique :
 * 30 % / 27 % / 13 % / 21 % / 9 %.
 */
export const TREATISE_MAX_PAGES = 120;
export const BOOK_MAX_PAGES = 400;

/**
 * La richesse de la reliure suit le poids de l'objet — c'est ce qui rend la
 * règle lisible sans légende : plus c'est lourd, plus c'est orné.
 */
export function coverShape(book) {
  const type = book?.bookType;
  if (type && normalizeArabic(type) !== normalizeArabic(BOOK_TYPE)) return 'document';
  if (Number(book?.volumeCount) > 1) return 'compendium';
  const pages = Number(book?.pageCount) || 0;
  if (pages > 0 && pages <= TREATISE_MAX_PAGES) return 'treatise';
  if (pages > BOOK_MAX_PAGES) return 'tome';
  return 'book';
}

/* ------------------------------------------------------------------ famille */

/**
 * Les teintes et le motif de chaque famille, avant patine. `pattern` nomme une
 * géométrie, pas une famille : deux familles partagent parfois la même trame et
 * n'en changent que la couleur.
 */
export const COVER_FAMILIES = {
  quran: { from: '#062b22', to: '#0e4a3a', pattern: 'girih' },
  aqida: { from: '#101a33', to: '#22345c', pattern: 'knot' },
  hadith: { from: '#2e2013', to: '#5c4425', pattern: 'knot' },
  fiqh: { from: '#1e2a12', to: '#3f5423', pattern: 'octagon' },
  raqaiq: { from: '#2a1836', to: '#4c2f5e', pattern: 'vine' },
  tarikh: { from: '#3a2a12', to: '#6b5119', pattern: 'kufi' },
  lugha: { from: '#12303a', to: '#24525f', pattern: 'grid' },
  adab: { from: '#3a1418', to: '#6b2a2f', pattern: 'vine' },
  amma: { from: '#1f2120', to: '#414442', pattern: 'grid' },
};

export const FALLBACK_FAMILY = 'amma';

/**
 * Les libellés tels qu'ils figurent au catalogue — les 40 catégories de
 * `dist/shamela` puis les 7 de `assets/sample`. On indexe par libellé et non par
 * `category_id` parce que les identifiants ne concordent pas entre les deux jeux
 * de données : `category_id = 1` vaut `العقيدة` côté Shamela et `التفسير` côté
 * échantillon. Le libellé, lui, est stable.
 */
const FAMILY_BY_LABEL = {
  // --- قرآن -----------------------------------------------------------------
  'التفسير': 'quran',
  'علوم القرآن وأصول التفسير': 'quran',
  'التجويد والقراءات': 'quran',
  // --- عقيدة ----------------------------------------------------------------
  'العقيدة': 'aqida',
  'الفرق والردود': 'aqida',
  // --- حديث -----------------------------------------------------------------
  'كتب السنة': 'hadith',
  'شروح الحديث': 'hadith',
  'التخريج والأطراف': 'hadith',
  'العلل والسؤلات الحديثية': 'hadith',
  'علوم الحديث': 'hadith',
  'الحديث': 'hadith',
  // --- فقه ------------------------------------------------------------------
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
  // --- رقائق ----------------------------------------------------------------
  'الرقائق والآداب والأذكار': 'raqaiq',
  'التصوف': 'raqaiq',
  // --- تاريخ ----------------------------------------------------------------
  'السيرة النبوية': 'tarikh',
  'التاريخ': 'tarikh',
  'التراجم والطبقات': 'tarikh',
  'الأنساب': 'tarikh',
  'البلدان والرحلات': 'tarikh',
  // --- لغة ------------------------------------------------------------------
  'كتب اللغة': 'lugha',
  'الغريب والمعاجم': 'lugha',
  'النحو والصرف': 'lugha',
  'اللغة': 'lugha',
  // --- أدب ------------------------------------------------------------------
  'الأدب': 'adab',
  'العروض والقوافي': 'adab',
  'الشعر ودواوينه': 'adab',
  'البلاغة': 'adab',
  // --- عام ------------------------------------------------------------------
  'الجوامع': 'amma',
  'فهارس الكتب والأدلة': 'amma',
  'الطب': 'amma',
  'كتب عامة': 'amma',
  'علوم أخرى': 'amma',
};

/**
 * La table s'écrit en arabe lisible, telle qu'on lit les libellés au catalogue ;
 * la recherche, elle, se fait sur la forme normalisée. Un libellé importé avec
 * des harakāt ou une hamza dénormalisée trouve donc la même famille — c'est la
 * même normalisation que celle qui a produit `pages.body_search`.
 */
const FAMILY_BY_NORMALIZED_LABEL = new Map(
  Object.entries(FAMILY_BY_LABEL).map(([label, family]) => [
    normalizeArabic(label),
    family,
  ]),
);

export function coverFamily(categoryLabel) {
  const key = normalizeArabic(categoryLabel);
  if (!key) return FALLBACK_FAMILY;
  return FAMILY_BY_NORMALIZED_LABEL.get(key) ?? FALLBACK_FAMILY;
}

/* ------------------------------------------------------------------- patine */

/**
 * Le siècle ne coupe plus le corpus en tranches : il le teint. Une date absente
 * — 29 % des éditions — vaut `PATINA_UNDATED_AGE`, au milieu de l'échelle, donc
 * elle ne se signale pas. C'est ce qui distingue une variable continue d'un
 * cinquième cas : l'ignorance n'a plus de style à elle.
 */
export const PATINA_NEWEST_CENTURY = 15;
export const PATINA_SPAN = 14;
export const PATINA_UNDATED_AGE = 0.5;
export const PATINA_DARKEN = 0.22;
export const PATINA_GILT_MIN = 0.3;
export const PATINA_GILT_RANGE = 0.22;

export function hijriCentury(deathYearHijri) {
  const year = Number(deathYearHijri);
  if (!Number.isFinite(year) || year <= 0) return null;
  return Math.floor((year - 1) / 100) + 1;
}

/** 0 pour le plus récent, 1 pour le plus ancien. */
export function coverAge(deathYearHijri) {
  const century = hijriCentury(deathYearHijri);
  if (century == null) return PATINA_UNDATED_AGE;
  const age = (PATINA_NEWEST_CENTURY - century) / PATINA_SPAN;
  return Math.min(Math.max(age, 0), 1);
}

/** Assombrit vers le noir : `#0e4a3a` reste `#0e4a3a` à neuf, fonce en vieillissant. */
function darken(hex, amount) {
  const value = Number.parseInt(hex.slice(1), 16);
  const channel = (shift) => {
    const raw = (value >> shift) & 0xff;
    return Math.round(raw * (1 - amount))
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}

/* -------------------------------------------------------------- composition */

/**
 * Tout ce dont une couverture a besoin pour se dessiner, en un seul appel.
 * `book` est une projection « carte » (`bookSummary()`), ou n'importe quel objet
 * portant `categoryLabel`, `authorDeathYear`, `bookType`, `volumeCount` et
 * `pageCount`.
 */
export function coverStyle(book) {
  const family = coverFamily(book?.categoryLabel);
  const { from, to, pattern } = COVER_FAMILIES[family];
  const age = coverAge(book?.authorDeathYear);
  return {
    shape: coverShape(book),
    family,
    age,
    from: darken(from, PATINA_DARKEN * age),
    to: darken(to, PATINA_DARKEN * age),
    gilt: PATINA_GILT_MIN + PATINA_GILT_RANGE * age,
    pattern,
  };
}
