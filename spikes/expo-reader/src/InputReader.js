/**
 * Spike A bis — le lecteur en `<TextInput>` non modifiable.
 *
 * C'est la seule voie de React Native qui donne les bornes d'une sélection :
 * `onSelectionChange` n'existe que sur `TextInput` (RN #23147, fermée sans
 * implémentation). L'écran mesure ce qu'elle coûte.
 *
 * Deux coûts, tous deux visibles ici :
 *
 * - **le repère change**. Un `TextInput` est un champ unique : pour que la page
 *   ait des paragraphes, il faut insérer des sauts de ligne, qui sont des
 *   caractères. Les décalages rendus ne sont donc plus ceux de
 *   `renderedText()` côté Electron. `toCanonical` ci-dessous fait la
 *   traduction — elle est possible, mais c'est une pièce de plus à tenir juste,
 *   et une annotation posée ici ne se retrouve chez l'autre client que si elle
 *   est exacte.
 * - **le toucher se perd**. Les `<Text onPress>` imbriqués dans un `TextInput`
 *   ne reçoivent pas l'événement. Le critère reste ouvert plutôt que déclaré
 *   perdu : si l'appareil dit le contraire, il faut le voir.
 */
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { PAGE_HTML, SEEDED_HIGHLIGHTS } from './fixture';
import { locateAll, parseHtml, renderedText, splitRun, toBlocks } from './parse';
import { Criterion, Panel, T } from './ui';

/** Séparateur visuel entre deux blocs — des caractères bien réels. */
const BLOCK_BREAK = '\n\n';

/**
 * Construit la valeur du champ et la table qui ramène un décalage du champ
 * vers le repère canonique des annotations.
 */
function buildSegments(blocks, placed) {
  const segments = [];
  let inputCursor = 0;

  const push = (text, canonicalStart, piece) => {
    if (!text) return;
    segments.push({
      text,
      inputStart: inputCursor,
      inputEnd: inputCursor + text.length,
      canonicalStart,
      piece,
    });
    inputCursor += text.length;
  };

  blocks.forEach((block, index) => {
    if (index > 0) push(BLOCK_BREAK, null, null); // hors repère canonique
    if (block.tag === 'hr') {
      push('—————', null, null);
      return;
    }
    for (const run of block.runs) {
      for (const piece of splitRun(run, placed)) {
        if (piece.marks.includes('br')) push('\n', null, null);
        else push(piece.text, piece.start, piece);
      }
    }
  });

  return { segments, value: segments.map((segment) => segment.text).join('') };
}

/** Décalage du champ -> décalage canonique, ou `null` hors du texte du livre. */
function toCanonical(segments, offset) {
  for (const segment of segments) {
    if (offset < segment.inputStart || offset > segment.inputEnd) continue;
    if (segment.canonicalStart === null) return null;
    return segment.canonicalStart + (offset - segment.inputStart);
  }
  return null;
}

export default function InputReader() {
  const [mode, setMode] = useState('readonly');
  const [selection, setSelection] = useState(null);
  const [tapped, setTapped] = useState(null);

  const { segments, value, placed } = useMemo(() => {
    const tree = parseHtml(PAGE_HTML);
    const full = renderedText(tree);
    const blocks = toBlocks(tree);
    const found = locateAll(full, SEEDED_HIGHLIGHTS);
    return { ...buildSegments(blocks, found), placed: found };
  }, []);

  const onSelectionChange = ({ nativeEvent }) => {
    const { start, end } = nativeEvent.selection;
    if (start === end) return setSelection(null);
    setSelection({
      start,
      end,
      canonicalStart: toCanonical(segments, start),
      canonicalEnd: toCanonical(segments, end),
      text: value.slice(start, end),
    });
  };

  const readonlyProps =
    mode === 'readonly'
      ? { editable: false }
      : // Android désactive parfois la sélection avec `editable={false}` :
        // second réglage, modifiable mais sans clavier ni curseur.
        { editable: true, showSoftInputOnFocus: false, caretHidden: true };

  const drift =
    selection?.canonicalStart != null ? selection.start - selection.canonicalStart : null;

  return (
    <View style={s.screen}>
      <ScrollView style={s.page} contentContainerStyle={s.pageInner}>
        <TextInput
          multiline
          scrollEnabled={false}
          {...readonlyProps}
          onSelectionChange={onSelectionChange}
          style={s.field}
        >
          {segments.map((segment, index) => {
            const highlight = segment.piece?.highlight;
            return (
              <Text
                key={index}
                style={highlight ? { backgroundColor: highlight.color } : undefined}
                onPress={highlight ? () => setTapped(highlight) : undefined}
              >
                {segment.text}
              </Text>
            );
          })}
        </TextInput>
      </ScrollView>

      <Panel
        title="Spike A bis — <TextInput> non modifiable"
        subtitle="Sélectionne un passage : les bornes s'affichent seules."
      >
        <View style={s.modes}>
          {['readonly', 'nokeyboard'].map((name) => (
            <Pressable
              key={name}
              style={[s.mode, mode === name && s.modeOn]}
              onPress={() => setMode(name)}
            >
              <Text style={s.modeText}>
                {name === 'readonly' ? 'editable={false}' : 'sans clavier'}
              </Text>
            </Pressable>
          ))}
        </View>

        <Criterion
          label="Décalages d'une sélection utilisateur"
          state={selection ? 'ok' : 'wait'}
          detail={
            selection
              ? `champ [${selection.start}, ${selection.end}] — « ${selection.text.slice(0, 40)} »`
              : 'sélectionne du texte dans la page'
          }
        />
        <Criterion
          label="Décalages dans le repère canonique"
          state={selection ? (selection.canonicalStart == null ? 'ko' : 'ok') : 'wait'}
          detail={
            selection
              ? selection.canonicalStart == null
                ? 'sélection commencée sur un séparateur inséré : hors repère'
                : `canonique [${selection.canonicalStart}, ${selection.canonicalEnd}] — écart de ${drift} caractères, traduit par toCanonical()`
              : 'exige la table de traduction, les sauts de ligne étant des caractères'
          }
        />
        <Criterion
          label="Toucher un surlignage"
          state={tapped ? 'ok' : 'wait'}
          detail={
            tapped
              ? `${tapped.highlightId} — l'événement est passé, contrairement à RN #23147`
              : 'touche une bande colorée — attendu : rien ne se passe'
          }
        />
      </Panel>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: T.paper },
  page: { flex: 1 },
  pageInner: { padding: 18, paddingBottom: 28 },
  field: {
    fontSize: 19,
    lineHeight: 34,
    color: T.ink,
    textAlign: 'right',
    writingDirection: 'rtl',
    padding: 0,
  },
  modes: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  mode: {
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: T.line,
    backgroundColor: T.surface,
  },
  modeOn: { backgroundColor: '#dff0e4', borderColor: T.ok },
  modeText: { fontSize: 12, color: T.ink },
});
