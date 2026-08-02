/**
 * Page cobaye. Elle n'est pas inventée : chaque forme vient soit du jeu
 * d'exemple (`assets/sample`), soit de ce que `tools/shamela/text.py` produit
 * réellement sur le corpus.
 *
 * Le point important, découvert en lisant `convert_segment` : le pipeline réel
 * n'émet qu'un HTML étroit — `<p>`, `<h2 class="title">`, `<span class="title">`,
 * `<br>`, `<hr>`, et des tableaux **aplatis en `<p>`** séparés par « ǀ ». La
 * liste blanche de `content-html.js` est plus large (`ul`, `ol`, `li`, `div`,
 * `blockquote`) mais rien ne les produit. Un lecteur natif n'a donc pas à
 * résoudre le mélange bloc/inline — c'est la meilleure nouvelle du spike.
 */

/** Séparateur de cellules des tableaux aplatis (`text.py:29`). */
export const CELL_SEPARATOR = ' ǀ ';

export const PAGE_HTML = [
  // Titre de tête : le corpus réel émet `<h2 class="title">`.
  '<h2 class="title">ديباجة الكتاب</h2>',

  // Prose longue : éprouve la justification et la coupure de ligne arabe.
  '<p>الحمد لله الذي له العزة والجبروت، وبيده الملك والملكوت، وله الأسماء الحسنى والنعوت.</p>',

  // Marqueur de note en exposant, au fil du texte.
  '<p>أما بعد، فإن فنَّ التاريخ من الفنون التي تتداولها الأمم والأجيال، وتُشدُّ إليه الركائب ',
  'والرحال، وتسمو إلى معرفته السُّوقة والأغفال، وتتنافس فيه الملوك والأقيال.<sup class="fn">1</sup></p>',

  // Titre **en ligne** au milieu d'un paragraphe : forme réelle du corpus,
  // celle qui interdit de traiter un titre comme un bloc.
  '<p>قال المؤلف في <span class="title">الفصل الأول</span> ما ملخصه أن الاجتماع الإنساني ضروري، ',
  'وأن الإنسان مدنيٌّ بالطبع.</p>',

  // Vers : deux hémistiches séparés par des espaces insécables. C'est le cas
  // qui décide, parce qu'un alignement en deux colonnes sort du flux de texte.
  '<p class="verse">على قدر أهل العزم تأتي العزائمُ &nbsp;&nbsp;&nbsp; وتأتي على قدر الكرام المكارمُ</p>',
  '<p class="verse">وتعظم في عين الصغير صغارُها &nbsp;&nbsp;&nbsp; وتصغر في عين العظيم العظائمُ</p>',
  '<p class="verse">الخيل والليل والبيداء تعرفني &nbsp;&nbsp;&nbsp; والسيف والرمح والقرطاس والقلمُ<sup class="fn">2</sup></p>',

  // Filet, puis saut de ligne dur : deux éléments qui ne portent aucun texte.
  '<hr>',
  '<p>سطر أول<br>سطر ثانٍ بعد فاصل صريح</p>',

  // Tableau aplati par l'importeur.
  `<p>الباب الأول${CELL_SEPARATOR}صفحة ١٢${CELL_SEPARATOR}في العمران</p>`,

  '<p>اعلم أن فنَّ التاريخ فنٌّ عزيز المذهب، جمُّ الفوائد، شريف الغاية، إذ هو يوقفنا على أحوال ',
  'الماضين من الأمم في أخلاقهم، والأنبياء في سِيَرهم، والملوك في دولهم وسياستهم.</p>',
].join('');

export const FOOTNOTES = [
  '(1) الأقيال: جمع قَيْل، وهو الملك من ملوك حِمْيَر.',
  '(2) البيداء: الصحراء.',
].join('\n');

/**
 * Surlignages pré-posés, au format exact de `user.sqlite` : décalages **et**
 * texte avec contexte. Leurs décalages sont laissés à `null` — ils sont
 * calculés au premier rendu par recherche du `selectedText`, exactement comme
 * la troisième branche de `locate()` dans `annotations.js`. Le spike n'a donc
 * pas à connaître d'avance le repère de chaque plateforme.
 */
export const SEEDED_HIGHLIGHTS = [
  {
    highlightId: 'hl-prose',
    color: '#f2c94c',
    selectedText: 'الملك والملكوت',
    hasNote: true,
    note: 'Surlignage de prose, au fil du texte.',
  },
  {
    highlightId: 'hl-verse',
    color: '#6fcf97',
    selectedText: 'الخيل والليل والبيداء',
    hasNote: false,
    note: 'Surlignage sur le premier hémistiche d’un vers.',
  },
  {
    // Franchit délibérément la frontière des deux hémistiches : c'est ce
    // surlignage qui révèle si la mise en page en colonnes a coupé le flux.
    highlightId: 'hl-across',
    color: '#eb5757',
    selectedText: 'تعرفني &nbsp;&nbsp;&nbsp; والسيف'.replace(/&nbsp;/g, ' '),
    hasNote: false,
    note: 'Traverse la césure du vers — échoue si les hémistiches sont deux blocs.',
  },
];
