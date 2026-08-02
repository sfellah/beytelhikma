/**
 * Spike : porter le lecteur de Beyt El Hikma sur mobile.
 *
 * Trois écrans, une seule page de livre, les mêmes surlignages pré-posés. La
 * question à trancher n'est pas « est-ce que ça s'affiche » — les trois
 * affichent — mais **est-ce qu'on peut poser une annotation et la toucher**,
 * puisque c'est la fonction centrale du lecteur.
 *
 * A     `<Text>` imbriqués      — toucher oui, poser non (mesuré)
 * A bis `<TextInput>` figé      — poser oui, toucher non (mesuré)
 * B     WebView, code inchangé  — les deux ?
 *
 * Les onglets sont **en bas**. En haut, ils tombaient sous la barre d'état
 * d'Android — `SafeAreaView` ne pose aucune marge haute là-bas, contrairement
 * à ce que son nom laisse croire — et surtout hors d'atteinte du pouce sur un
 * téléphone tenu d'une main, alors qu'on passe le spike à en changer.
 */
import { useState } from 'react';
import { Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import InputReader from './src/InputReader';
import NativeReader from './src/NativeReader';
import WebReader from './src/WebReader';
import { T } from './src/ui';

const TABS = [
  { key: 'native', label: 'A', hint: '<Text>', screen: NativeReader },
  { key: 'input', label: 'A bis', hint: '<TextInput>', screen: InputReader },
  { key: 'web', label: 'B', hint: 'WebView', screen: WebReader },
];

function Spike() {
  const [active, setActive] = useState('native');
  const insets = useSafeAreaInsets();
  const Screen = TABS.find((tab) => tab.key === active).screen;

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" backgroundColor={T.paper} />

      {/* Remonter l'écran par sa clé : chaque onglet repart d'un état propre,
          sinon un critère validé sur un écran teinterait le suivant. */}
      <View style={s.stage}>
        <Screen key={active} />
      </View>

      <View style={[s.tabs, { paddingBottom: Math.max(insets.bottom, 8) }]}>
        {TABS.map((tab) => {
          const on = active === tab.key;
          return (
            <Pressable
              key={tab.key}
              style={[s.tab, on && s.tabOn]}
              onPress={() => setActive(tab.key)}
              hitSlop={8}
            >
              <Text style={[s.label, on && s.labelOn]}>{tab.label}</Text>
              <Text style={[s.hint, on && s.hintOn]}>{tab.hint}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Spike />
    </SafeAreaProvider>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.paper },
  stage: { flex: 1 },
  tabs: {
    flexDirection: 'row',
    backgroundColor: T.surface,
    borderTopWidth: 1,
    borderColor: T.line,
    paddingTop: 8,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    marginHorizontal: 6,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabOn: { backgroundColor: '#e7efea' },
  label: { fontSize: 14, fontWeight: '700', color: T.muted },
  labelOn: { color: T.primary },
  hint: { fontSize: 10, color: T.muted, marginTop: 1 },
  hintOn: { color: T.primary },
});
