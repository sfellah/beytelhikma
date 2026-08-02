/**
 * Spike A — le lecteur en `<Text>` imbriqués.
 *
 * Ce que l'écran cherche à établir, dans l'ordre d'importance :
 *
 * 1. **poser** une annotation, c'est-à-dire obtenir les décalages caractère
 *    d'une sélection faite au doigt ;
 * 2. **toucher** un surlignage déjà posé pour ouvrir sa note ;
 * 3. tenir la mise en page des vers et l'exposant des notes.
 *
 * Sur les vers, le pronostic de départ était faux et le spike l'a corrigé :
 * `views.css:2011` ne met pas les hémistiches en colonnes, il **centre** le
 * vers (`text-align: center; font-style: italic`). Il n'y a donc aucun bloc à
 * imbriquer dans le flux, `textAlign: 'center'` suffit, et un surlignage qui
 * traverse la césure reste d'un seul tenant. Le cas le plus redouté n'existe
 * pas.
 *
 * Le point 2 marche, et bien : on découpe les runs aux frontières des
 * surlignages et chaque morceau devient un `<Text onPress>`. Le point 1 est le
 * sujet du bouton « capturer » : il essaie les voies documentées et rapporte
 * ce qu'il obtient, plutôt que de le supposer.
 */
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { FOOTNOTES, PAGE_HTML, SEEDED_HIGHLIGHTS } from './fixture';
import { locateAll, parseHtml, renderedText, splitRun, toBlocks } from './parse';
import { Criterion, ManualCriterion, Panel, T } from './ui';

/** Style d'un morceau selon les balises en ligne traversées. */
function markStyle(marks) {
  const style = {};
  for (const mark of marks) {
    if (mark === 'b' || mark === 'strong') style.fontWeight = '700';
    if (mark === 'i' || mark === 'em') style.fontStyle = 'italic';
    if (mark === 'u') style.textDecorationLine = 'underline';
    if (mark === 'span.title') Object.assign(style, { fontWeight: '700', color: T.primary });
    // RN n'a pas de `vertical-align: super` : un exposant ne peut être que plus
    // petit, et remonté à la main par un `lineHeight` réduit. C'est une
    // approximation, pas l'équivalent de `views.css:2016`.
    if (mark === 'sup.fn' || mark === 'sup') {
      Object.assign(style, { fontSize: 12, lineHeight: 16, color: T.primary });
    }
    if (mark === 'sub') Object.assign(style, { fontSize: 12, lineHeight: 30 });
  }
  return style;
}

function blockStyle(block) {
  if (block.tag.startsWith('h')) return s.heading;
  if (block.cls === 'verse') return s.verse;
  if (block.cls === 'center') return s.center;
  return s.para;
}

export default function NativeReader() {
  const [tapped, setTapped] = useState(null);
  const [capture, setCapture] = useState(null);

  const { blocks, placed, acrossIntact } = useMemo(() => {
    const tree = parseHtml(PAGE_HTML);
    const full = renderedText(tree);
    const found = toBlocks(tree);
    const positioned = locateAll(full, SEEDED_HIGHLIGHTS);

    // Le surlignage qui traverse la césure d'un vers tient-il dans un seul
    // bloc ? S'il en franchit deux, il se dessinera en deux morceaux.
    const across = positioned.find((highlight) => highlight.highlightId === 'hl-across');
    const holder = across
      ? found.filter((block) =>
          block.runs.some((run) => run.end > across.start && run.start < across.end),
        )
      : [];

    return { blocks: found, placed: positioned, acrossIntact: holder.length === 1 };
  }, []);

  /** Un morceau de texte, surligné ou non, touchable si surligné. */
  const renderPiece = (piece, key) => {
    if (piece.marks.includes('br')) return <Text key={key}>{'\n'}</Text>;
    if (!piece.text) return null;
    const { highlight } = piece;
    return (
      <Text
        key={key}
        style={[markStyle(piece.marks), highlight && { backgroundColor: highlight.color }]}
        onPress={highlight ? () => setTapped(highlight) : undefined}
        suppressHighlighting
      >
        {piece.text}
      </Text>
    );
  };

  const renderBlock = (block, index) => {
    if (block.tag === 'hr') return <View key={index} style={s.rule} />;
    const pieces = block.runs.flatMap((run) => splitRun(run, placed));
    return (
      <Text key={index} style={blockStyle(block)} selectable>
        {pieces.map(renderPiece)}
      </Text>
    );
  };

  /**
   * Essaie d'obtenir les bornes de la sélection courante par les seules voies
   * qui existent, et rapporte le résultat brut — y compris s'il dément
   * l'attente.
   */
  const tryCapture = () => {
    const lines = [
      `globalThis.getSelection : ${typeof globalThis.getSelection}`,
      `globalThis.document : ${typeof globalThis.document}`,
      `onSelectionChange sur <Text> : ${
        'onSelectionChange' in (Text.defaultProps ?? {}) ? 'présent' : 'absent — jamais déclenché'
      }`,
    ];
    setCapture(lines.join('\n'));
  };

  return (
    <View style={s.screen}>
      <ScrollView style={s.page} contentContainerStyle={s.pageInner}>
        {blocks.map(renderBlock)}
        <View style={s.rule} />
        <Text style={s.footnotes} selectable>
          {FOOTNOTES}
        </Text>
      </ScrollView>

      <Panel
        title="Spike A — <Text> imbriqués"
        subtitle="Sélectionne un passage au doigt, puis appuie sur « capturer »."
      >
        <Criterion
          label="Décalages d'une sélection utilisateur"
          state={capture ? 'ko' : 'wait'}
          detail={capture ?? 'appuie sur « capturer » après avoir sélectionné'}
        />
        <Pressable style={s.capture} onPress={tryCapture}>
          <Text style={s.captureText}>capturer la sélection</Text>
        </Pressable>

        <Criterion
          label="Toucher un surlignage"
          state={tapped ? 'ok' : 'wait'}
          detail={tapped ? `${tapped.highlightId} — ${tapped.note}` : 'touche une bande colorée'}
        />
        <Criterion
          label="Surlignage traversant la césure d'un vers"
          state={acrossIntact ? 'ok' : 'ko'}
          detail={
            acrossIntact
              ? 'un seul bloc : le vers centré garde le flux, la bande rouge est continue'
              : 'réparti sur deux blocs : il se dessine en deux morceaux'
          }
        />
        <ManualCriterion label="Vers centrés et en italique" hint="comme views.css:2011" />
        <ManualCriterion
          label="Appel de note en exposant"
          hint="RN n'a pas vertical-align : approximé par une taille réduite"
        />
      </Panel>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: T.paper },
  page: { flex: 1 },
  pageInner: { padding: 18, paddingBottom: 28 },
  para: {
    fontSize: 19,
    lineHeight: 38,
    color: T.ink,
    textAlign: 'justify',
    writingDirection: 'rtl',
    marginBottom: 16,
  },
  heading: {
    fontSize: 22,
    fontWeight: '600',
    color: T.primary,
    textAlign: 'center',
    writingDirection: 'rtl',
    lineHeight: 34,
    marginBottom: 20,
  },
  center: {
    fontSize: 19,
    lineHeight: 38,
    color: T.ink,
    textAlign: 'center',
    writingDirection: 'rtl',
    marginBottom: 16,
  },
  // `views.css:2011` — centré, italique. Pas de colonnes.
  verse: {
    fontSize: 19,
    lineHeight: 38,
    color: T.ink,
    textAlign: 'center',
    fontStyle: 'italic',
    writingDirection: 'rtl',
    marginBottom: 16,
  },
  rule: { height: 1, backgroundColor: T.line, marginVertical: 18 },
  footnotes: {
    fontSize: 14,
    lineHeight: 25,
    color: T.muted,
    writingDirection: 'rtl',
    textAlign: 'right',
  },
  capture: {
    alignSelf: 'flex-start',
    marginLeft: 24,
    marginBottom: 8,
    paddingVertical: 5,
    paddingHorizontal: 14,
    borderRadius: 6,
    backgroundColor: T.primary,
  },
  captureText: { color: '#fff', fontSize: 12 },
});
