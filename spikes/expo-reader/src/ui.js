/** Jetons et pièces communes aux trois écrans du spike. */
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

export const T = {
  ink: '#1c1a17',
  muted: '#6b635a',
  paper: '#f6f1e7',
  surface: '#fffdf8',
  line: '#e0d7c8',
  primary: '#003527',
  ok: '#1e7f4f',
  ko: '#b3261e',
  wait: '#8a7f70',
};

/** Une ligne de verdict. [state] : 'ok' | 'ko' | 'wait'. */
export function Criterion({ label, state, detail }) {
  const color = state === 'ok' ? T.ok : state === 'ko' ? T.ko : T.wait;
  const glyph = state === 'ok' ? '✓' : state === 'ko' ? '✗' : '·';
  return (
    <View style={s.row}>
      <Text style={[s.glyph, { color }]}>{glyph}</Text>
      <View style={s.grow}>
        <Text style={s.label}>{label}</Text>
        {detail ? <Text style={s.detail}>{detail}</Text> : null}
      </View>
    </View>
  );
}

/** Critère que seul l'œil tranche : deux boutons, réponse gardée. */
export function ManualCriterion({ label, hint }) {
  const [state, setState] = useState('wait');
  return (
    <View>
      <Criterion label={label} state={state} detail={hint} />
      <View style={s.buttons}>
        <Pressable style={[s.button, state === 'ok' && s.buttonOn]} onPress={() => setState('ok')}>
          <Text style={s.buttonText}>correct</Text>
        </Pressable>
        <Pressable style={[s.button, state === 'ko' && s.buttonOff]} onPress={() => setState('ko')}>
          <Text style={s.buttonText}>cassé</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Panneau de verdict, en bas de chaque écran.
 *
 * Sa hauteur est **plafonnée** et son contenu défile : sans cela, cinq
 * critères et leurs boutons mangeaient la moitié d'un écran de téléphone, et
 * la page de livre — ce qu'on est venu regarder — n'avait plus la place de se
 * montrer.
 */
export function Panel({ title, subtitle, children }) {
  return (
    <View style={s.panel}>
      <Text style={s.panelTitle}>{title}</Text>
      {subtitle ? <Text style={s.panelSubtitle}>{subtitle}</Text> : null}
      <ScrollView style={s.panelScroll} contentContainerStyle={s.panelInner}>
        {children}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 5 },
  glyph: { fontSize: 15, fontWeight: '700', width: 16, textAlign: 'center' },
  grow: { flex: 1 },
  label: { fontSize: 13, color: T.ink },
  detail: { fontSize: 11, color: T.muted, marginTop: 2 },
  buttons: { flexDirection: 'row', gap: 8, marginTop: 4, marginBottom: 6, marginLeft: 24 },
  button: {
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: T.line,
    backgroundColor: T.surface,
  },
  buttonOn: { backgroundColor: '#dff0e4', borderColor: T.ok },
  buttonOff: { backgroundColor: '#f7dedc', borderColor: T.ko },
  buttonText: { fontSize: 12, color: T.ink },
  panel: {
    backgroundColor: T.surface,
    borderTopWidth: 1,
    borderColor: T.line,
    paddingHorizontal: 12,
    paddingTop: 10,
    // Le panneau ne prend jamais plus du tiers de l'écran : au-delà, il défile.
    maxHeight: '38%',
  },
  panelScroll: { flexGrow: 0 },
  panelInner: { paddingBottom: 10 },
  panelTitle: { fontSize: 13, fontWeight: '700', color: T.primary, marginBottom: 2 },
  panelSubtitle: { fontSize: 11, color: T.muted, marginBottom: 8 },
});
