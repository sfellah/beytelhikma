import { currentLocale } from './i18n.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Jeu d'icônes tracées à la main (24×24, contour). Les maquettes utilisent
 * Material Symbols, servi par une police distante : l'application est hors
 * ligne, on dessine donc les mêmes intentions en SVG local.
 */
const ICONS = {
  home: [
    ['path', 'M3 10.5 12 3l9 7.5V20a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 20z'],
    ['path', 'M9.5 21.5V13h5v8.5'],
  ],
  bookOpen: [
    ['path', 'M12 7a4 4 0 0 0-4-4H2v15h6a4 4 0 0 1 4 3'],
    ['path', 'M12 7a4 4 0 0 1 4-4h6v15h-6a4 4 0 0 0-4 3'],
  ],
  book: [
    ['path', 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20'],
    ['path', 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z'],
  ],
  compass: [
    ['circle', 12, 12, 9],
    ['polygon', '15.5 8.5 13.5 13.5 8.5 15.5 10.5 10.5'],
  ],
  pen: [
    ['line', 12, 20.5, 21, 20.5],
    ['path', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z'],
  ],
  sliders: [
    ['line', 4, 21, 4, 14],
    ['line', 4, 10, 4, 3],
    ['line', 12, 21, 12, 12],
    ['line', 12, 8, 12, 3],
    ['line', 20, 21, 20, 16],
    ['line', 20, 12, 20, 3],
    ['line', 1, 14, 7, 14],
    ['line', 9, 8, 15, 8],
    ['line', 17, 16, 23, 16],
  ],
  logout: [
    ['path', 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4'],
    ['polyline', '16 17 21 12 16 7'],
    ['line', 21, 12, 9, 12],
  ],
  search: [
    ['circle', 11, 11, 7],
    ['line', 16.2, 16.2, 21, 21],
  ],
  bell: [
    ['path', 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9'],
    ['path', 'M13.7 21a2 2 0 0 1-3.4 0'],
  ],
  user: [
    ['path', 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2'],
    ['circle', 12, 7, 4],
  ],
  arrowRight: [
    ['line', 4, 12, 20, 12],
    ['polyline', '13 5 20 12 13 19'],
  ],
  arrowLeft: [
    ['line', 20, 12, 4, 12],
    ['polyline', '11 5 4 12 11 19'],
  ],
  arrowUpRight: [
    ['line', 6, 18, 18, 6],
    ['polyline', '9 6 18 6 18 15'],
  ],
  more: [
    ['dot', 5, 12],
    ['dot', 12, 12],
    ['dot', 19, 12],
  ],
  moreVertical: [
    ['dot', 12, 5],
    ['dot', 12, 12],
    ['dot', 12, 19],
  ],
  help: [
    ['circle', 12, 12, 9],
    ['path', 'M9.4 9.3a2.7 2.7 0 1 1 3.6 2.5c-.7.3-1.1 1-1.1 1.8v.5'],
    ['dot', 11.9, 17],
  ],
  fullscreen: [
    ['polyline', '9 3 3 3 3 9'],
    ['polyline', '15 3 21 3 21 9'],
    ['polyline', '21 15 21 21 15 21'],
    ['polyline', '3 15 3 21 9 21'],
  ],
  fullscreenExit: [
    ['polyline', '3 9 9 9 9 3'],
    ['polyline', '21 9 15 9 15 3'],
    ['polyline', '15 21 15 15 21 15'],
    ['polyline', '9 21 9 15 3 15'],
  ],
  /* « format_size » : un grand A et un petit, comme dans la maquette. */
  formatSize: [
    ['polyline', '2.5 18 7.5 5 12.5 18'],
    ['line', 4.4, 14, 10.6, 14],
    ['polyline', '15 18 18 9.5 21 18'],
    ['line', 16, 15.4, 20, 15.4],
  ],
  noteAdd: [
    ['path', 'M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8'],
    ['line', 18, 2, 18, 8],
    ['line', 15, 5, 21, 5],
    ['line', 8.5, 13, 14.5, 13],
    ['line', 8.5, 17, 12.5, 17],
  ],
  copy: [
    ['rect', 9, 9, 12, 12],
    ['path', 'M5 15H4.4A1.4 1.4 0 0 1 3 13.6V4.4A1.4 1.4 0 0 1 4.4 3h9.2A1.4 1.4 0 0 1 15 4.4V5'],
  ],
  translate: [
    ['line', 2.5, 6, 12.5, 6],
    ['line', 7.5, 3.5, 7.5, 6],
    ['path', 'M10.5 6c-.6 4.5-3.4 8.4-7.5 10.5'],
    ['path', 'M5 10.5c1.2 3.2 3.6 5.6 6.5 6.8'],
    ['polyline', '12.5 21 17.2 10 21.9 21'],
    ['line', 14.4, 17, 20, 17],
  ],
  highlight: [
    ['path', 'M9 14l-2.5 2.5L4 19l3.5 1.5L10 18'],
    ['path', 'M11 12.5 17.5 6a2.1 2.1 0 0 1 3 3L14 15.5z'],
  ],
  play: [['polygon', '7 4 20 12 7 20']],
  bookmark: [['path', 'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z']],
  close: [
    ['line', 6, 6, 18, 18],
    ['line', 18, 6, 6, 18],
  ],
  toc: [
    ['line', 8, 6, 21, 6],
    ['line', 8, 12, 21, 12],
    ['line', 8, 18, 21, 18],
    ['dot', 3.5, 6],
    ['dot', 3.5, 12],
    ['dot', 3.5, 18],
  ],
  download: [
    ['path', 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'],
    ['polyline', '7 10 12 15 17 10'],
    ['line', 12, 15, 12, 3],
  ],
  share: [
    ['circle', 18, 5, 3],
    ['circle', 6, 12, 3],
    ['circle', 18, 19, 3],
    ['line', 8.6, 13.5, 15.4, 17.5],
    ['line', 15.4, 6.5, 8.6, 10.5],
  ],
  grid: [
    ['rect', 3, 3, 7, 7],
    ['rect', 14, 3, 7, 7],
    ['rect', 14, 14, 7, 7],
    ['rect', 3, 14, 7, 7],
  ],
  rows: [
    ['rect', 3, 4, 4, 4],
    ['rect', 3, 10, 4, 4],
    ['rect', 3, 16, 4, 4],
    ['line', 10, 6, 21, 6],
    ['line', 10, 12, 21, 12],
    ['line', 10, 18, 21, 18],
  ],
  sort: [
    ['line', 4, 6, 18, 6],
    ['line', 4, 12, 13, 12],
    ['line', 4, 18, 8, 18],
  ],
  chevronLeft: [['polyline', '15 5 8 12 15 19']],
  chevronRight: [['polyline', '9 5 16 12 9 19']],
  check: [['polyline', '20 6 9 17 4 12']],
  plusSquare: [
    ['rect', 3, 3, 18, 18],
    ['line', 12, 8, 12, 16],
    ['line', 8, 12, 16, 12],
  ],
  bank: [
    ['polygon', '12 3 22 8 2 8'],
    ['line', 5, 8, 5, 17],
    ['line', 10, 8, 10, 17],
    ['line', 14, 8, 14, 17],
    ['line', 19, 8, 19, 17],
    ['line', 2, 21, 22, 21],
  ],
  globe: [
    ['circle', 12, 12, 9],
    ['line', 3, 12, 21, 12],
    ['path', 'M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18'],
  ],
  clock: [
    ['circle', 12, 12, 9],
    ['polyline', '12 7 12 12 16 14'],
  ],
  sun: [
    ['circle', 12, 12, 4],
    ['line', 12, 2, 12, 5],
    ['line', 12, 19, 12, 22],
    ['line', 2, 12, 5, 12],
    ['line', 19, 12, 22, 12],
    ['line', 5, 5, 7, 7],
    ['line', 17, 17, 19, 19],
    ['line', 19, 5, 17, 7],
    ['line', 7, 17, 5, 19],
  ],
  minus: [['line', 5, 12, 19, 12]],
  plus: [
    ['line', 12, 5, 12, 19],
    ['line', 5, 12, 19, 12],
  ],
  type: [
    ['polyline', '4 7 4 4 20 4 20 7'],
    ['line', 9, 20, 15, 20],
    ['line', 12, 4, 12, 20],
  ],
  trash: [
    ['polyline', '3 6 21 6'],
    ['path', 'M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6'],
    ['path', 'M5.5 6h13l-1 13.5A1.5 1.5 0 0 1 16 21H8a1.5 1.5 0 0 1-1.5-1.5z'],
    ['line', 10, 10.5, 10, 17],
    ['line', 14, 10.5, 14, 17],
  ],
  filter: [
    ['polygon', '3 4 21 4 14 12.5 14 20 10 21.5 10 12.5'],
  ],
  chevronDown: [['polyline', '5 9 12 16 19 9']],
  chevronUp: [['polyline', '5 15 12 8 19 15']],
  folder: [
    ['path', 'M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h9A1.5 1.5 0 0 1 21 10v8.5A1.5 1.5 0 0 1 19.5 20h-15A1.5 1.5 0 0 1 3 18.5z'],
  ],
  notes: [
    ['path', 'M5 3.5h9.5L19 8v12.5H5z'],
    ['polyline', '14 3.5 14 8.5 19 8.5'],
    ['line', 8, 12, 16, 12],
    ['line', 8, 16, 13, 16],
  ],
};

function shape(spec) {
  const [kind, ...values] = spec;
  if (kind === 'dot') {
    const node = document.createElementNS(SVG_NS, 'circle');
    node.setAttribute('cx', values[0]);
    node.setAttribute('cy', values[1]);
    node.setAttribute('r', 1.5);
    node.setAttribute('fill', 'currentColor');
    node.setAttribute('stroke', 'none');
    return node;
  }
  const node = document.createElementNS(SVG_NS, kind);
  if (kind === 'path') node.setAttribute('d', values[0]);
  else if (kind === 'circle') {
    node.setAttribute('cx', values[0]);
    node.setAttribute('cy', values[1]);
    node.setAttribute('r', values[2]);
  } else if (kind === 'line') {
    node.setAttribute('x1', values[0]);
    node.setAttribute('y1', values[1]);
    node.setAttribute('x2', values[2]);
    node.setAttribute('y2', values[3]);
  } else if (kind === 'rect') {
    node.setAttribute('x', values[0]);
    node.setAttribute('y', values[1]);
    node.setAttribute('width', values[2]);
    node.setAttribute('height', values[3]);
    node.setAttribute('rx', 1.5);
  } else if (kind === 'polyline' || kind === 'polygon') {
    node.setAttribute('points', values[0]);
  }
  return node;
}

/** Renvoie l'icône [name] en SVG ; `size` est en pixels. */
export function icon(name, { size = 22, className = '', fill = false } = {}) {
  const shapes = ICONS[name] ?? ICONS.book;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', 1.6);
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `icon ${className}`.trim());
  for (const spec of shapes) svg.append(shape(spec));
  if (fill) svg.setAttribute('fill', 'currentColor');
  return svg;
}

/** Icône choisie pour une discipline, d'après son intitulé arabe. */
export function categoryIcon(label) {
  const table = {
    التفسير: 'book',
    الحديث: 'pen',
    الفقه: 'bank',
    اللغة: 'globe',
    التاريخ: 'clock',
    الأدب: 'bookOpen',
    التصوف: 'sun',
    العقيدة: 'bank',
    السيرة: 'clock',
  };
  return table[label] ?? 'book';
}

/**
 * Flèches de sens de lecture.
 *
 * `arrowLeft` et `arrowRight` désignent une direction à l'écran, pas une
 * intention : en arabe « avancer » pointe à gauche, en anglais à droite. Une
 * flèche figée désignerait donc l'inverse de ce qu'elle fait dès que
 * l'interface bascule — c'est le défaut qu'on a vu sur la carte « كل المكتبة »
 * de l'accueil.
 *
 * `forward` = entrer, ouvrir, page suivante. `backward` = revenir, page
 * précédente.
 */
export function arrowForward(options) {
  return icon(currentLocale() === 'ar' ? 'arrowLeft' : 'arrowRight', options);
}

export function arrowBackward(options) {
  return icon(currentLocale() === 'ar' ? 'arrowRight' : 'arrowLeft', options);
}

/**
 * Mêmes deux sens, tracés en chevron : la barre du lecteur et la pagination
 * n'ont pas la place d'une flèche pleine. La règle est celle des flèches — le
 * sens vient de la direction de l'interface, jamais d'une constante.
 */
export function chevronForward(options) {
  return icon(currentLocale() === 'ar' ? 'chevronLeft' : 'chevronRight', options);
}

export function chevronBackward(options) {
  return icon(currentLocale() === 'ar' ? 'chevronRight' : 'chevronLeft', options);
}

/** La direction de l'interface, pour qui doit décider autre chose qu'une icône. */
export function isRtl() {
  return currentLocale() === 'ar';
}
