import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BOOK_MAX_PAGES,
  COVER_FAMILIES,
  PATINA_DARKEN,
  PATINA_GILT_MIN,
  PATINA_GILT_RANGE,
  PATINA_UNDATED_AGE,
  TREATISE_MAX_PAGES,
  coverAge,
  coverFamily,
  coverShape,
  coverStyle,
  hijriCentury,
} from '../src/shared/book-cover.js';

/* -------------------------------------------------------------------- forme */

const edition = (over = {}) => ({
  bookType: 'كتاب',
  volumeCount: 1,
  pageCount: 245,
  ...over,
});

test('coverShape sépare les cinq formes d’objet', () => {
  assert.equal(coverShape(edition({ pageCount: 12 })), 'treatise');
  assert.equal(coverShape(edition({ pageCount: 245 })), 'book');
  assert.equal(coverShape(edition({ pageCount: 1191 })), 'tome');
  assert.equal(coverShape(edition({ volumeCount: 4, pageCount: 3000 })), 'compendium');
  assert.equal(coverShape(edition({ bookType: 'رسالة جامعية' })), 'document');
});

test('coverShape bascule aux bornes exactes de pagination', () => {
  assert.equal(coverShape(edition({ pageCount: TREATISE_MAX_PAGES })), 'treatise');
  assert.equal(coverShape(edition({ pageCount: TREATISE_MAX_PAGES + 1 })), 'book');
  assert.equal(coverShape(edition({ pageCount: BOOK_MAX_PAGES })), 'book');
  assert.equal(coverShape(edition({ pageCount: BOOK_MAX_PAGES + 1 })), 'tome');
});

test('coverShape range les quatre libellés qui ne sont pas des livres', () => {
  for (const type of ['رسالة جامعية', 'مجلة', 'دروس مفرغة', 'رسالة']) {
    assert.equal(coverShape(edition({ bookType: type })), 'document', type);
  }
  // Y compris quand la nature contredit la pagination : ce n'est pas un livre.
  assert.equal(coverShape(edition({ bookType: 'مجلة', volumeCount: 9 })), 'document');
});

test('coverShape tolère une pagination absente', () => {
  // `page_count` vient de la release active ; une édition sans release ne doit
  // pas basculer en métn court par défaut — un métn se déclare par sa brièveté,
  // il ne se déduit pas d'une donnée manquante.
  assert.equal(coverShape(edition({ pageCount: null })), 'book');
  assert.equal(coverShape(edition({ pageCount: 0 })), 'book');
  assert.equal(coverShape({}), 'book');
  assert.equal(coverShape(null), 'book');
});

test('coverShape absorbe un libellé de type dénormalisé', () => {
  assert.equal(coverShape(edition({ bookType: 'كِتَاب' })), 'book');
});

/* ------------------------------------------------------------------- patine */

test('hijriCentury suit la formule du catalogue', () => {
  // `(année - 1) / 100 + 1`, la même expression que `catalog-query.js` : l'an 100
  // clôt le premier siècle, l'an 101 ouvre le deuxième.
  assert.equal(hijriCentury(1), 1);
  assert.equal(hijriCentury(100), 1);
  assert.equal(hijriCentury(101), 2);
  assert.equal(hijriCentury(1421), 15);
});

test('coverAge va de 0 pour le plus récent à 1 pour le plus ancien', () => {
  assert.equal(coverAge(1421), 0);
  assert.equal(coverAge(60), 1);
  // Monotone, sans palier : c'est ce qui distingue une patine d'une tranche.
  const ages = [60, 458, 968, 1030, 1421].map(coverAge);
  for (let index = 1; index < ages.length; index += 1) {
    assert.ok(ages[index] < ages[index - 1], `patine non décroissante en ${index}`);
  }
});

test('coverAge donne une patine médiane sans date exploitable', () => {
  // 29 % des éditions n'ont pas de date. Ce n'est plus un cinquième style :
  // l'absence se pose au milieu de l'échelle et ne se remarque pas.
  for (const missing of [null, undefined, 0, -1, '', 'inconnu', Number.NaN]) {
    assert.equal(coverAge(missing), PATINA_UNDATED_AGE, `valeur ${missing}`);
  }
});

test('coverAge borne les valeurs hors échelle', () => {
  // Un auteur mort au XVIe siècle hégirien n'existe pas encore, mais une donnée
  // aberrante ne doit pas produire une teinte éclaircie.
  assert.equal(coverAge(1600), 0);
  // sql.js rend parfois les entiers tels quels, parfois via JSON.
  assert.equal(coverAge('505'), coverAge(505));
});

test('la patine assombrit et dore à mesure que le livre est ancien', () => {
  const base = { categoryLabel: 'التفسير', pageCount: 245 };
  const neuf = coverStyle({ ...base, authorDeathYear: 1421 });
  const vieux = coverStyle({ ...base, authorDeathYear: 60 });

  // Le plus récent garde la teinte de famille intacte.
  assert.equal(neuf.from, COVER_FAMILIES.quran.from);
  assert.ok(vieux.from < neuf.from, 'la teinte doit foncer avec l’âge');
  assert.equal(neuf.gilt, PATINA_GILT_MIN);
  assert.equal(vieux.gilt, PATINA_GILT_MIN + PATINA_GILT_RANGE);
});

test('la patine ne dépasse jamais PATINA_DARKEN', () => {
  const vieux = coverStyle({ categoryLabel: 'الأدب', authorDeathYear: 60 });
  const canal = (hex) => Number.parseInt(hex.slice(1, 3), 16);
  const base = canal(COVER_FAMILIES.adab.from);
  assert.equal(canal(vieux.from), Math.round(base * (1 - PATINA_DARKEN)));
});

/* ------------------------------------------------------------------ famille */

/**
 * Les 40 catégories de `dist/shamela` puis les 7 de `assets/sample`, avec la
 * famille attendue. C'est la table du document de conception, rejouée : si le
 * regroupement change, ce test le dit.
 */
const CATEGORY_PARITY = [
  ['العقيدة', 'aqida'],
  ['الفرق والردود', 'aqida'],
  ['التفسير', 'quran'],
  ['علوم القرآن وأصول التفسير', 'quran'],
  ['التجويد والقراءات', 'quran'],
  ['كتب السنة', 'hadith'],
  ['شروح الحديث', 'hadith'],
  ['التخريج والأطراف', 'hadith'],
  ['العلل والسؤلات الحديثية', 'hadith'],
  ['علوم الحديث', 'hadith'],
  ['أصول الفقه', 'fiqh'],
  ['علوم الفقه والقواعد الفقهية', 'fiqh'],
  ['المنطق', 'fiqh'],
  ['الفقه الحنفي', 'fiqh'],
  ['الفقه المالكي', 'fiqh'],
  ['الفقه الشافعي', 'fiqh'],
  ['الفقه الحنبلي', 'fiqh'],
  ['الفقه العام', 'fiqh'],
  ['مسائل فقهية', 'fiqh'],
  ['السياسة الشرعية والقضاء', 'fiqh'],
  ['الفرائض والوصايا', 'fiqh'],
  ['الفتاوى', 'fiqh'],
  ['الرقائق والآداب والأذكار', 'raqaiq'],
  ['السيرة النبوية', 'tarikh'],
  ['التاريخ', 'tarikh'],
  ['التراجم والطبقات', 'tarikh'],
  ['الأنساب', 'tarikh'],
  ['البلدان والرحلات', 'tarikh'],
  ['كتب اللغة', 'lugha'],
  ['الغريب والمعاجم', 'lugha'],
  ['النحو والصرف', 'lugha'],
  ['الأدب', 'adab'],
  ['العروض والقوافي', 'adab'],
  ['الشعر ودواوينه', 'adab'],
  ['البلاغة', 'adab'],
  ['الجوامع', 'amma'],
  ['فهارس الكتب والأدلة', 'amma'],
  ['الطب', 'amma'],
  ['كتب عامة', 'amma'],
  ['علوم أخرى', 'amma'],
  // `assets/sample` — sept libellés, dont quatre que `dist/shamela` ne connaît
  // pas sous cette forme. L'indexation par libellé les couvre sans table à part.
  ['الحديث', 'hadith'],
  ['الفقه', 'fiqh'],
  ['اللغة', 'lugha'],
  ['التصوف', 'raqaiq'],
];

test('coverFamily range les 44 libellés du catalogue', () => {
  for (const [label, expected] of CATEGORY_PARITY) {
    assert.equal(coverFamily(label), expected, `libellé : ${label}`);
  }
});

test('coverFamily couvre les 40 catégories de dist/shamela', () => {
  // Garde-fou de complétude : si l'importeur gagne une catégorie, la table du
  // test doit grandir avec elle.
  const shamela = CATEGORY_PARITY.slice(0, 40);
  assert.equal(new Set(shamela.map(([label]) => label)).size, 40);
});

test('coverFamily replie sur amma pour un libellé inconnu ou absent', () => {
  for (const unknown of [null, undefined, '', '   ', 'كتب المستقبل', 'Poetry']) {
    assert.equal(coverFamily(unknown), 'amma', `valeur ${unknown}`);
  }
});

test('coverFamily absorbe harakāt, hamza et tatweel', () => {
  // La table s'écrit en arabe lisible mais se consulte sur la forme normalisée :
  // un libellé importé vocalisé doit tomber dans la même famille.
  assert.equal(coverFamily('التَّفْسِير'), 'quran');
  assert.equal(coverFamily('اصول الفقه'), 'fiqh');
  assert.equal(coverFamily('الفتاوي'), 'fiqh');
  assert.equal(coverFamily('كتب عامه'), 'amma');
  assert.equal(coverFamily('الــعــقــيــدة'), 'aqida');
});

test('chaque famille porte des teintes et un motif', () => {
  const families = new Set(CATEGORY_PARITY.map(([, family]) => family));
  assert.equal(families.size, 9);
  for (const family of families) {
    const entry = COVER_FAMILIES[family];
    assert.ok(entry, `famille ${family} absente de COVER_FAMILIES`);
    assert.match(entry.from, /^#[0-9a-f]{6}$/);
    assert.match(entry.to, /^#[0-9a-f]{6}$/);
    assert.ok(entry.pattern, `famille ${family} sans motif`);
  }
});

/* -------------------------------------------------------------- composition */

test('coverStyle croise les trois canaux', () => {
  const style = coverStyle({
    categoryLabel: 'التفسير',
    authorDeathYear: 1421,
    bookType: 'كتاب',
    volumeCount: 3,
    pageCount: 900,
  });
  assert.deepEqual(style, {
    shape: 'compendium',
    family: 'quran',
    age: 0,
    from: '#062b22',
    to: '#0e4a3a',
    gilt: PATINA_GILT_MIN,
    pattern: 'girih',
  });
});

test('coverStyle survit à un livre sans catégorie, sans auteur ni pagination', () => {
  // Une fiche minimale doit rester affichable : les trois canaux ont un repli.
  for (const book of [{}, null, undefined, { categoryLabel: null }]) {
    const style = coverStyle(book);
    assert.equal(style.shape, 'book');
    assert.equal(style.family, 'amma');
    assert.equal(style.age, PATINA_UNDATED_AGE);
    assert.match(style.from, /^#[0-9a-f]{6}$/);
    assert.ok(style.gilt > 0 && style.gilt < 1);
  }
});
