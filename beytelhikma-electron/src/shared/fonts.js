/**
 * La liste des polices, et rien d'autre.
 *
 * Elle vit ici pour une raison qu'on a payée : `views/reader.js` en déclarait
 * trois, `views/settings.js` deux. Noto Naskh Arabic était donc accessible
 * depuis le lecteur et invisible depuis les réglages, alors que
 * `.reader--font-naskh` et `--font-naskh` existaient bel et bien. C'est la
 * panne du thème `sepia`, rejouée sur les polices — et `test/fonts.test.js`
 * l'interdit désormais.
 *
 * Le `script` n'est pas décoratif : il dit ce que la famille sait rendre. Le
 * corpus est arabe, l'interface parle deux langues — proposer EB Garamond pour
 * le texte d'un livre serait un choix sans effet, et proposer Amiri à une
 * interface anglaise le serait tout autant.
 */
export const FONTS = [
  // Arabes — le livre.
  { key: 'amiri', family: 'Amiri', script: 'arab', label: 'fonts.amiri', stack: "'Amiri', serif" },
  {
    key: 'naskh',
    family: 'Noto Naskh Arabic',
    script: 'arab',
    label: 'fonts.naskh',
    stack: "'Noto Naskh Arabic', serif",
  },
  {
    key: 'plex',
    family: 'IBM Plex Sans Arabic',
    script: 'arab',
    label: 'fonts.plex',
    stack: "'IBM Plex Sans Arabic', sans-serif",
  },

  // Latines — l'interface en anglais. Les trois faces de lecture longue les
  // plus établies : Literata est dessinée pour Google Books donc pour l'écran,
  // EB Garamond est la référence du livre imprimé, Source Serif tient le petit
  // corps.
  {
    key: 'literata',
    family: 'Literata',
    script: 'latn',
    label: 'fonts.literata',
    stack: "'Literata', Georgia, serif",
  },
  {
    key: 'garamond',
    family: 'EB Garamond',
    script: 'latn',
    label: 'fonts.garamond',
    stack: "'EB Garamond', Georgia, serif",
  },
  {
    key: 'sourceserif',
    family: 'Source Serif 4',
    script: 'latn',
    label: 'fonts.sourceserif',
    stack: "'Source Serif 4', Georgia, serif",
  },
];

/** Le naskh de bibliothèque : c'est l'identité du projet, donc le défaut. */
export const DEFAULT_READER_FONT = 'amiri';

/**
 * Le défaut de l'**interface**, par écriture — et ce n'est pas celui du
 * lecteur. Amiri est une face de livre : posée sur les menus, elle a changé
 * l'aspect de toute l'application d'un coup. L'arabe manœuvre en IBM Plex,
 * l'anglais en Literata, faite pour lire à l'écran.
 */
export const DEFAULT_INTERFACE_FONT = { arab: 'plex', latn: 'literata' };

/**
 * Les clés qu'écrivait l'ancien écran des réglages. Une base d'utilisateur les
 * porte encore ; elles se replient plutôt que de laisser le lecteur sans face.
 */
const LEGACY = { serif: 'amiri', sans: 'plex' };

export function fontsForScript(script) {
  return FONTS.filter((font) => font.script === script);
}

const byKey = new Map(FONTS.map((font) => [font.key, font]));

/**
 * Rend une clé utilisable pour ce script. Une face d'une autre écriture est
 * traitée comme inconnue : elle ne rendrait pas le texte qu'on lui donne.
 *
 * Le repli est **passé par l'appelant** : lire et manœuvrer ne demandent pas la
 * même face, et un défaut unique ferait peindre les menus dans une face de
 * livre. À défaut, la première famille de l'écriture.
 */
export function resolveFont(stored, script, fallback = null) {
  const key = LEGACY[stored] ?? stored;
  const font = byKey.get(key);
  if (font?.script === script) return font.key;

  const repli = byKey.get(fallback);
  return repli?.script === script ? repli.key : fontsForScript(script)[0].key;
}

export function fontStack(key, script, fallback = null) {
  return byKey.get(resolveFont(key, script, fallback)).stack;
}
