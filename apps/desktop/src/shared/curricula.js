/**
 * Les cursus : des listes de livres **ordonnées**, à suivre du premier au
 * dernier, avec une progression qui se calcule seule.
 *
 * Ils vivent ici et nulle part ailleurs — pas dans `catalog.sqlite`. Un cursus
 * est une opinion pédagogique, pas une donnée du corpus : le mettre au
 * catalogue obligerait à monter `schema_version` et à republier huit mille
 * manifestes pour corriger l'ordre de deux métons. Ici, il suit la version de
 * l'application.
 *
 * Rien n'est stocké côté `user.sqlite` non plus : la progression d'un cursus
 * **se dérive** de celle de ses livres, déjà tenue par `downloaded_books`.
 * Une table d'inscription aurait deux vérités à réconcilier, dont une que
 * l'utilisateur ne peut pas corriger.
 *
 * Les identifiants sont ceux du corpus Shamela publié (`sh-<book_id>`). Sur une
 * autre bibliothèque — les cinq livres d'exemple, un import partiel — ils ne
 * répondent pas : `resolveCurriculum` les écarte et le dit. Un cursus n'affiche
 * jamais une étape qu'on ne peut pas ouvrir.
 *
 * Les noms sont dans les catalogues de chaînes (`curriculum.<id>.name`), pas
 * ici : une liste de titres arabes en dur dans un module partagé ne se traduit
 * pas et échapperait à `test/no-hardcoded-strings.test.js`.
 */

/**
 * Le seul cursus qui existe **tel quel dans la source** : les seize recueils de
 * `متون طالب العلم` d'عبد المحسن القاسم, que Shamela regroupe déjà par
 * `group_id`. L'ordre ci-dessous est celui des niveaux, que ni le titre ni la
 * taille ne donnent — les recueils « الإضافية » suivent les cinq niveaux.
 */
const MUTUN_TALIB_AL_ILM = [
  'sh-548', // المستوى التمهيدي
  'sh-550', // المستوى الأول
  'sh-551', // المستوى الثاني
  'sh-553', // المستوى الثالث
  'sh-554', // المستوى الرابع
  'sh-895', // المستوى الخامس - 1
  'sh-1005', // المستوى الخامس - 2
  'sh-1006', // المستوى الخامس - 3
  'sh-1007', // الإضافية - 1
  'sh-1010', // الإضافية - 2
  'sh-1011', // الإضافية - 3
  'sh-1012', // الإضافية - 4
  'sh-1013', // الإضافية - 5
  'sh-1014', // الإضافية - 6
  'sh-1015', // الإضافية - 8
  'sh-1016', // الإضافية - 10
];

/**
 * Les six autres sont les échelles classiques d'une discipline : un méton court
 * qu'on apprend, puis son commentaire, puis l'ouvrage de référence. Elles sont
 * composées ici, parce que la source ne porte aucun ordre pédagogique.
 *
 * Deux étapes ne sont pas le méton nu — le corpus ne l'a pas isolé :
 * `sh-4212` porte `كتاب التوحيد` **avec** son commentaire, et `sh-2970` est le
 * commentaire d'ابن أبي العز sur `الطحاوية`. Le libellé de l'étape le dit.
 */
export const CURRICULA = [
  { id: 'mutunTalibAlIlm', category: 'general', steps: MUTUN_TALIB_AL_ILM },
  {
    id: 'aqida',
    category: 'aqida',
    steps: [
      'sh-225', // ثلاثة الأصول وشروط الصلاة والقواعد الأربع
      'sh-7002', // كشف الشبهات
      'sh-4212', // كتاب التوحيد، avec قرة عيون الموحدين
      'sh-7003', // لمعة الاعتقاد
      'sh-5479', // العقيدة الواسطية
      'sh-2970', // شرح العقيدة الطحاوية لابن أبي العز
    ],
  },
  {
    id: 'hadith',
    category: 'hadith',
    steps: [
      'sh-4692', // الأربعون النووية
      'sh-4096', // عمدة الأحكام
      'sh-1637', // رياض الصالحين
      'sh-5413', // بلوغ المرام
      'sh-1003', // المحرر في الحديث
    ],
  },
  {
    id: 'mustalah',
    category: 'hadith',
    steps: [
      'sh-592', // نخبة الفكر
      'sh-296', // نزهة النظر
      'sh-8477', // الباعث الحثيث
      'sh-334', // ألفية العراقي
      'sh-3345', // تدريب الراوي
    ],
  },
  {
    id: 'fiqhHanbali',
    category: 'fiqh',
    steps: [
      'sh-4490', // منهج السالكين
      'sh-4196', // عمدة الفقه
      'sh-4122', // زاد المستقنع
      'sh-8414', // الروض المربع
      'sh-3883', // الشرح الممتع
      'sh-2437', // المغني
    ],
  },
  {
    id: 'usul',
    category: 'fiqh',
    steps: [
      'sh-2176', // الورقات
      'sh-3610', // الأصول من علم الأصول
      'sh-4425', // روضة الناظر
      'sh-267', // مذكرة أصول الفقه
    ],
  },
  {
    id: 'nahw',
    category: 'lugha',
    steps: [
      'sh-4242', // الآجرومية
      'sh-2850', // ملحة الإعراب
      'sh-4246', // متن قطر الندى
      'sh-2466', // شرح قطر الندى
      'sh-336', // ألفية ابن مالك
      'sh-3598', // شرح ابن عقيل
      'sh-4406', // أوضح المسالك
    ],
  },
];

export const CURRICULUM_IDS = CURRICULA.map((curriculum) => curriculum.id);

/**
 * Les étapes que le catalogue installé sait ouvrir, dans l'ordre du cursus, et
 * le compte de celles qu'il ne connaît pas.
 *
 * `missing` n'est pas une erreur : un import partiel — trois livres par
 * discipline — répond à une poignée d'identifiants. C'est un chiffre à
 * afficher, pour qu'un cursus de six étapes dont deux manquent ne se donne
 * jamais pour complet.
 */
export function resolveCurriculum(curriculum, knownEditionIds) {
  const known = knownEditionIds instanceof Set ? knownEditionIds : new Set(knownEditionIds);
  const steps = curriculum.steps.filter((editionId) => known.has(editionId));
  return { steps, missing: curriculum.steps.length - steps.length };
}
