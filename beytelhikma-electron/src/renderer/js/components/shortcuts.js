import { t } from '../i18n.js';
import { isRtl } from '../icons.js';
import { canGoFullscreen } from '../platform.js';
import { shortcutsDialog } from './modal.js';

/**
 * Les deux touches de feuilletage désignent un sens, pas une direction fixe :
 * elles sont écrites en jetons et résolues à l'affichage. En arabe on avance
 * vers la gauche, en anglais vers la droite — figées, elles annonceraient
 * l'inverse de ce que fait le clavier dès que l'interface bascule.
 */
const KEY_FORWARD = 'key:forward';
const KEY_BACKWARD = 'key:backward';

/**
 * La fiche des raccourcis du lecteur — la liste, et rien d'autre.
 *
 * Elle vit ici et non dans `views/reader.js` parce que ce n'est plus le lecteur
 * qui l'ouvre : la barre du lecteur a rendu son outil « ؟ », qui prenait une
 * place de doigt pour une fiche que le tactile ne peut pas utiliser. Elle se
 * consulte depuis `/settings`, où l'on va quand on veut apprendre l'outil, et
 * la touche `؟` continue de l'ouvrir en lecture pour qui a un clavier.
 *
 * Deux appelants, donc une seule liste : c'est la même règle que les thèmes,
 * les polices et les modes de lecture, et c'est de deux copies qu'étaient nées
 * chacune des pannes précédentes.
 */
const SHORTCUTS = [
  { keys: [KEY_FORWARD], label: 'reader.shortcut.nextPage' },
  { keys: [KEY_BACKWARD], label: 'reader.shortcut.previousPage' },
  { keys: ['Page ↓', 'Page ↑'], sep: '/', label: 'reader.shortcut.paging' },
  { keys: ['Home', 'End'], sep: '/', label: 'reader.shortcut.ends' },
  { keys: ['Ctrl', '+'], label: 'reader.shortcut.bigger' },
  { keys: ['Ctrl', '−'], label: 'reader.shortcut.smaller' },
  { keys: ['Ctrl', 'reader.shortcut.wheel'], label: 'reader.shortcut.size' },
  { keys: ['Ctrl', 'F'], label: 'reader.shortcut.find' },
  { keys: ['B'], label: 'reader.shortcut.bookmark' },
  { keys: ['N'], label: 'reader.shortcut.notes' },
  { keys: ['C'], label: 'reader.shortcut.toc' },
  { keys: ['V'], label: 'reader.shortcut.mode' },
  // Le plein écran n'existe pas partout : la fiche ne l'annonce que là où il
  // est offert. Une ligne pour une touche absente est une promesse en trop.
  { keys: ['F11'], label: 'reader.shortcut.fullscreen', needs: 'fullscreen' },
  { keys: ['؟'], label: 'reader.shortcut.thisList' },
  { keys: ['Esc'], label: 'reader.shortcut.escape' },
];

/**
 * Ouvre la fiche et rend de quoi la refermer.
 *
 * La fiche est posée sur `body` : un changement de route ne l'emporterait pas,
 * c'est à l'appelant de la ranger quand il s'en va.
 */
export function openShortcuts() {
  return shortcutsDialog({
    title: t('reader.shortcutsTitle'),
    // Les touches passent aussi par `t()` : « ← » n'a pas de clé et ressort
    // tel quel, tandis que « عجلة الفأرة » en a une et se traduit. Une seule
    // règle, plutôt qu'une liste d'exceptions à tenir.
    shortcuts: SHORTCUTS.filter((entry) => entry.needs !== 'fullscreen' || canGoFullscreen()).map(
      (entry) => ({
        ...entry,
        keys: entry.keys.map((key) => {
          if (key === KEY_FORWARD) return isRtl() ? '←' : '→';
          if (key === KEY_BACKWARD) return isRtl() ? '→' : '←';
          return t(key);
        }),
        label: t(entry.label),
      }),
    ),
  });
}
