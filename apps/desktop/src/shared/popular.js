/**
 * Les ouvrages de référence : une sélection, pas une mesure.
 *
 * Rien n'est compté. `tools/stats.py` compte des téléchargements d'installeurs
 * et des lectures de pointeur, jamais des ouvertures de livre. « Populaire »
 * est donc ici un **choix éditorial** assumé — les deux Sahih, les quatre
 * Sunan, Fath al-Bari, Lisan al-Arab — et non un classement. C'est pour cela
 * qu'il n'existe ni tri « par popularité » ni compteur affiché : l'un
 * l'affirmerait, l'autre l'inventerait.
 *
 * La liste vit ici et nulle part ailleurs, comme celle des cursus et pour la
 * même raison : au catalogue, corriger un seul choix d'édition obligerait à
 * monter `schema_version` et à republier 8 589 manifestes. Ici, elle suit la
 * version de l'application.
 *
 * **Le choix porte sur l'édition, pas sur l'œuvre.** Le catalogue publié porte
 * jusqu'à dix-neuf éditions d'un même livre — dix-neuf pour `صحيح مسلم`, onze
 * pour `فتح الباري`. C'est l'édition qui est publiée, téléchargée et lue : le
 * critère retenu est l'impression **de référence**, celle dont la numérotation
 * est citée.
 *
 * Sur une autre bibliothèque — les cinq livres d'exemple, un import partiel —
 * ces identifiants ne répondent pas : `resolvePopular` les écarte et le dit.
 *
 * Les noms sont dans les catalogues de chaînes (`popular.*`), pas ici : une
 * liste de titres arabes en dur dans un module partagé ne se traduit pas.
 */

/** L'ordre est celui de l'affichage : il va du hadith vers la langue et l'histoire. */
export const POPULAR_EDITION_IDS = [
  // — hadith : les six livres, le Muwatta et le Musnad
  'sh-1458', // صحيح البخاري - ط السلطانية
  'sh-1481', // صحيح مسلم - ت عبد الباقي
  'sh-1480', // سنن أبي داود - ت محيي الدين عبد الحميد
  'sh-2859', // سنن الترمذي - ت بشار
  'sh-797', // سنن النسائي - ط المصرية
  'sh-1095', // سنن ابن ماجه - ت عبد الباقي
  'sh-6494', // موطأ مالك - رواية يحيى - ت الأعظمي
  'sh-6193', // مسند أحمد - ط الرسالة
  // — le commentaire le plus consulté après les deux Sahih
  'sh-1455', // فتح الباري بشرح البخاري - ط السلفية
  // — usage quotidien
  'sh-1637', // رياض الصالحين - ت الفحل
  'sh-5413', // بلوغ المرام من أدلة الأحكام - ت الفحل
  // — tafsir
  'sh-2994', // تفسير ابن كثير - ت السلامة
  'sh-2839', // تفسير الطبري جامع البيان - ت التركي
  'sh-5614', // تفسير القرطبي = الجامع لأحكام القرآن
  // — fiqh comparé et usul
  'sh-2437', // المغني لابن قدامة - ت التركي
  'sh-1618', // المجموع شرح المهذب - ط المنيرية
  'sh-5841', // بداية المجتهد ونهاية المقتصد
  // — fatawa
  'sh-2561', // مجموع الفتاوى
  // — langue
  'sh-1462', // لسان العرب
  // — histoire et sira
  'sh-188', // زاد المعاد في هدي خير العباد - ط عطاءات العلم
  'sh-1785', // البداية والنهاية - ت التركي
  'sh-3974', // سير أعلام النبلاء - ط الرسالة
  'sh-3519', // تاريخ الطبري = تاريخ الرسل والملوك
];

/**
 * Construit **une fois**, au chargement du module.
 *
 * `isPopular` est appelée une fois par carte dessinée, et un écran
 * d'exploration en monte quarante. Un `Array.includes` sur vingt-trois entrées
 * passerait inaperçu aujourd'hui et deviendrait un défaut le jour où la liste
 * grandit.
 */
const POPULAR = new Set(POPULAR_EDITION_IDS);

export function isPopular(editionId) {
  return POPULAR.has(editionId);
}

/**
 * Les éditions que le catalogue installé sait ouvrir, **dans l'ordre de la
 * liste**, et le compte de celles qu'il ne connaît pas.
 *
 * L'ordre vient de la liste et non de l'argument : c'est une suite écrite à la
 * main, les deux Sahih viennent d'abord parce qu'ils viennent d'abord.
 *
 * `missing` n'est pas une erreur, c'est un chiffre : sur les cinq livres
 * d'exemple il vaut vingt-trois, et la section s'efface.
 */
export function resolvePopular(knownEditionIds) {
  const known = knownEditionIds instanceof Set ? knownEditionIds : new Set(knownEditionIds);
  const ids = POPULAR_EDITION_IDS.filter((editionId) => known.has(editionId));
  return { ids, missing: POPULAR_EDITION_IDS.length - ids.length };
}
