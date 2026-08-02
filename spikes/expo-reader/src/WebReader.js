/**
 * Spike B — le lecteur en WebView.
 *
 * La page embarquée fait tourner `content-html.js` et `annotations.js` sans
 * une ligne de changement. Ce que l'écran mesure n'est donc pas « une WebView
 * sait-elle faire ça », mais « le code du lecteur marche-t-il tel quel sur un
 * téléphone ».
 *
 * Reste à regarder, parce que c'est le vrai prix de cette voie : le temps de
 * premier rendu, et le fait que la sélection passe par le menu système du
 * navigateur embarqué, pas par celui de l'application.
 */
import { useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { FOOTNOTES, PAGE_HTML, SEEDED_HIGHLIGHTS } from './fixture';
import { buildPage } from './webPage';
import { Criterion, ManualCriterion, Panel, T } from './ui';

export default function WebReader() {
  const [ready, setReady] = useState(null);
  const [selection, setSelection] = useState(null);
  const [tapped, setTapped] = useState(null);
  const [millis, setMillis] = useState(null);
  const started = useRef(Date.now());

  const html = useMemo(
    () => buildPage({ html: PAGE_HTML, footnotes: FOOTNOTES, highlights: SEEDED_HIGHLIGHTS }),
    [],
  );

  const onMessage = (event) => {
    let payload;
    try {
      payload = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (payload.kind === 'ready') {
      setReady(payload);
      setMillis(Date.now() - started.current);
    }
    // On garde aussi les rapports vides : « aucun événement reçu » et
    // « événement reçu, sélection illisible » sont deux pannes différentes, et
    // un état unique les confondrait.
    if (payload.kind === 'selection') setSelection(payload);
    if (payload.kind === 'tap') setTapped(payload.highlight);
  };

  return (
    <View style={s.screen}>
      <WebView
        originWhitelist={['about:blank']}
        source={{ html }}
        onMessage={onMessage}
        style={s.web}
        // Le lecteur ne doit jamais naviguer : la page est le document, pas un
        // point d'entrée vers le web. Même règle que `src/main/navigation.js`.
        onShouldStartLoadWithRequest={(request) => request.url === 'about:blank'}
        javaScriptEnabled
        // Empêche le zoom de casser la colonne de lecture.
        scalesPageToFit={false}
      />

      <Panel
        title="Spike B — WebView, code du lecteur inchangé"
        subtitle="content-html.js et annotations.js copiés mot pour mot."
      >
        <Criterion
          label="La page se monte et se peint"
          state={ready ? 'ok' : 'wait'}
          detail={
            ready
              ? `${ready.length} caractères, ${ready.marks} surlignages posés, premier rendu en ${millis} ms`
              : 'chargement…'
          }
        />
        <Criterion
          label="Décalages d'une sélection utilisateur"
          state={selection ? (selection.empty ? 'ko' : 'ok') : 'wait'}
          detail={
            !selection
              ? 'sélectionne un passage au doigt'
              : selection.empty
                ? `${selection.events} événement(s) reçu(s), mais : ${selection.reason}`
                : `[${selection.startOffset}, ${selection.endOffset}] après ${selection.events} événement(s) — « ${selection.selectedText.slice(0, 40)} »`
          }
        />
        <Criterion
          label="Contexte conservé autour de la sélection"
          state={
            !selection || selection.empty
              ? 'wait'
              : selection.prefixText || selection.suffixText
                ? 'ok'
                : 'ko'
          }
          detail={
            selection && !selection.empty
              ? `avant : « …${selection.prefixText.slice(-24)} » / après : « ${selection.suffixText.slice(0, 24)}… »`
              : "c'est ce qui permet de retrouver l'ancre après une réédition"
          }
        />
        <Criterion
          label="Toucher un surlignage"
          state={tapped ? 'ok' : 'wait'}
          detail={tapped ? `${tapped.highlightId} — ${tapped.note}` : 'touche une bande colorée'}
        />
        <ManualCriterion
          label="Vers, exposants, justification"
          hint="doit être identique au lecteur de bureau"
        />
      </Panel>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: T.paper },
  web: { flex: 1, backgroundColor: T.paper },
});
