import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { composeNote } from '../src/shared/note-draft.js';

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8').replaceAll('\r\n', '\n');

const readerSource = read('../src/renderer/js/views/reader.js');
const viewsCss = read('../src/renderer/styles/views.css');

/** Le corps d'une méthode, jusqu'à l'accolade fermante de son indentation. */
const methode = (source, entete) => {
  const start = source.indexOf(entete);
  assert.notEqual(start, -1, `méthode absente : ${entete}`);
  return source.slice(start, source.indexOf('\n  }', start));
};

/** Un dépôt en trompe-l'œil : il retient ce qu'on lui a demandé d'écrire. */
function atelier({ reponse }) {
  const ecrits = { highlights: [], notes: [] };
  const ordre = [];
  return {
    ecrits,
    ordre,
    gestes: {
      ask: async () => {
        ordre.push('ask');
        return reponse;
      },
      createHighlight: async () => {
        ordre.push('highlight');
        const highlight = { highlightId: 7, pageId: 3 };
        ecrits.highlights.push(highlight);
        return highlight;
      },
      saveNote: async (highlight, content) => {
        ordre.push('note');
        const note = { noteId: 1, highlightId: highlight.highlightId, content };
        ecrits.notes.push(note);
        return note;
      },
    },
  };
}

// -------------------------------------------------- annuler n'écrit rien

test('annuler la saisie ne laisse ni surlignage ni note', async () => {
  // Le défaut vécu : le surlignage était posé *avant* l'ouverture de l'éditeur.
  // « Annuler » ne rendait alors que la note, et le passage restait teinté sans
  // que rien à l'écran ne dise comment le retirer.
  const { ecrits, ordre, gestes } = atelier({ reponse: null });
  assert.equal(await composeNote(gestes), null);
  assert.deepEqual(ecrits.highlights, []);
  assert.deepEqual(ecrits.notes, []);
  assert.deepEqual(ordre, ['ask']);
});

test('une note vide vaut un refus : rien n’est écrit', async () => {
  // Une note sans texte n'est pas une note, et la poser laisserait derrière
  // elle un surlignage que personne n'a demandé.
  const { ecrits, gestes } = atelier({ reponse: '' });
  assert.equal(await composeNote(gestes), null);
  assert.deepEqual(ecrits.highlights, []);
  assert.deepEqual(ecrits.notes, []);
});

test('valider écrit le surlignage puis la note, dans cet ordre', async () => {
  const { ecrits, ordre, gestes } = atelier({ reponse: 'ملاحظة' });
  const note = await composeNote(gestes);
  assert.deepEqual(ordre, ['ask', 'highlight', 'note']);
  assert.equal(ecrits.highlights.length, 1);
  assert.equal(note.content, 'ملاحظة');
  // La note est ancrée sur le surlignage qui vient d'être posé.
  assert.equal(note.highlightId, 7);
});

test('un surlignage qui échoue ne laisse pas de note orpheline', async () => {
  // Une note sans ancre ne se repeindrait sur aucune page.
  let notes = 0;
  const note = await composeNote({
    ask: async () => 'ملاحظة',
    createHighlight: async () => null,
    saveNote: async () => {
      notes += 1;
      return {};
    },
  });
  assert.equal(note, null);
  assert.equal(notes, 0);
});

// ------------------------------------------- le lecteur suit la même règle

test('la sélection passe par la composition, sans rien poser d’avance', () => {
  // L'entrée « note » de la feuille de sélection ne doit plus surligner puis
  // demander : c'est cet ordre-là qui produisait le surlignage fantôme.
  assert.match(
    readerSource,
    /item\('noteAdd', t\('reader\.addNote'\), \(\) => this\.#noteOnSelection\(\)\)/,
  );

  const corps = methode(readerSource, '  async #noteOnSelection() {');
  assert.match(corps, /composeNote\(\{/);
  // L'écriture est un argument de `composeNote`, jamais un appel qui la précède.
  const avant = corps.slice(0, corps.indexOf('composeNote'));
  assert.doesNotMatch(avant, /#persistHighlight\(/);
  assert.match(corps, /createHighlight: \(\) => this\.#persistHighlight\(/);
});

test('éditer une note existante ne défait jamais son surlignage', () => {
  // L'autre moitié de la règle : ce chemin-ci n'a rien créé, renoncer ne doit
  // donc rien supprimer — ni la note, ni la couleur qu'on annotait.
  const corps = methode(readerSource, '  async #editNote(highlight, existing) {');
  assert.match(corps, /if \(content === null\) return;/);
  assert.doesNotMatch(corps, /#removeHighlight\(/);
  assert.doesNotMatch(corps, /composeNote\(/);
});

test('la feuille de note a une issue par tous les chemins', () => {
  // Croix, « annuler », `Escape`, geste retour, démontage de la vue : une seule
  // issue, sans quoi la promesse reste pendante et le geste n'aboutit jamais.
  const cascade = methode(readerSource, '  #closeTopLayer() {');
  assert.match(cascade, /#noteSheetOpen\(\)[\s\S]*#settleNote\(null\)/);
  // Et elle passe **avant** les autres couches : c'est la plus haute.
  assert.ok(cascade.indexOf('#noteSheetOpen') < cascade.indexOf('#footnoteOpen'));

  const depart = methode(readerSource, '  dispose() {');
  assert.match(depart, /#settleNote\(null\)/);

  // Une tape sur le texte ne jette pas ce qu'on est en train de taper, et ne
  // tourne pas la page sous la feuille.
  const clic = methode(readerSource, '  #onContentClick(event) {');
  assert.match(clic, /if \(this\.#noteSheetOpen\(\)\) return;/);
});

test('le lecteur n’ouvre plus la modale de note', () => {
  // La modale centrée est ce qui poussait la lecture sur un téléphone.
  assert.doesNotMatch(readerSource, /noteDialog/);
});

// ------------------------------------------------ la feuille n'est pas intrusive

test('la feuille est ancrée en bas, par-dessus, et ne redimensionne rien', () => {
  const bloc = viewsCss.slice(
    viewsCss.indexOf('.reader__note-sheet {'),
    viewsCss.indexOf('.reader__note-head {'),
  );
  assert.notEqual(bloc, '');
  assert.match(bloc, /position: absolute/);
  assert.match(bloc, /bottom: 0/);
  // Retrait du système respecté, et propriétés logiques seulement.
  assert.match(bloc, /var\(--safe-bottom\)/);
  assert.match(bloc, /inset-inline: 0/);
  assert.doesNotMatch(bloc, /(^|[^-])\b(left|right):/m);
  // Refermée, elle ne capte pas le doigt : un voile qui le capte vole la
  // sélection au texte.
  assert.match(bloc, /pointer-events: none/);
  assert.match(
    viewsCss.slice(viewsCss.indexOf('.reader__note-sheet.is-open {')),
    /^[\s\S]{0,200}pointer-events: auto/,
  );
});

test('le clavier virtuel déplace la feuille, jamais la colonne', () => {
  const corps = methode(readerSource, '  #watchKeyboard() {');
  // Ce que le clavier recouvre est mesuré, et c'est la feuille qui s'en écarte.
  assert.match(corps, /--reader-keyboard/);
  // L'ancre de lecture est remise où elle était : `#followScroll` déduit la
  // page courante de ce qui est à l'écran, et la laisser bouger changerait de
  // page sous le texte qu'on écrit.
  assert.match(corps, /scroll\.scrollTop = top/);
  assert.match(
    viewsCss.slice(viewsCss.indexOf('.reader__note-sheet.is-open {')),
    /translateY\(calc\(-1 \* var\(--reader-keyboard, 0px\)\)\)/,
  );
});
