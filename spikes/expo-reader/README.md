# Spike — le lecteur de Beyt El Hikma sur mobile

Deux façons de porter le lecteur, mises côte à côte sur **la même page de
livre**, avec **les mêmes surlignages pré-posés**, pour trancher une seule
question : peut-on **poser** une annotation et la **toucher** ?

Tout le reste — afficher du texte arabe, justifier, centrer un vers — les trois
écrans le font. Ce n'est donc pas ce qui décide.

```bash
npm install
npm run verify     # les deux contrôles hors appareil (voir plus bas)
npm start          # puis scanner le QR avec Expo Go
```

Aucun module natif : **Expo Go suffit**, pas de build de développement.

## Les trois écrans

| Onglet | Voie | Ce qu'il éprouve |
| --- | --- | --- |
| **A** | `<Text>` imbriqués | Peindre et **toucher** un surlignage. Le bouton « capturer » interroge les deux voies documentées pour obtenir les bornes d'une sélection, et affiche ce qu'il trouve. |
| **A bis** | `<TextInput>` figé | `onSelectionChange`, seule API de RN qui rende des bornes. Deux réglages au choix (`editable={false}` et « sans clavier »), parce qu'Android désactive parfois la sélection avec le premier. |
| **B** | WebView | `content-html.js` et `annotations.js` **copiés mot pour mot** depuis `beytelhikma-electron`. Si l'écran marche, ce n'est pas un équivalent qui marche : c'est le code du projet, inchangé. |

Chaque écran porte son propre panneau de verdict. Les critères mécaniques se
remplissent seuls ; ceux que seul l'œil tranche (vers, exposants) ont deux
boutons.

## La page cobaye

`src/fixture.js`. Aucune forme n'est inventée : chacune vient soit
d'`assets/sample`, soit de ce que `tools/shamela/text.py` produit sur le corpus
réel — `<p>`, `<h2 class="title">`, `<span class="title">` **en ligne**,
`<sup class="fn">`, `<br>`, `<hr>`, et un tableau aplati en `<p>` séparé par
« ǀ ».

Trois surlignages, dont un — `hl-across` — qui **traverse délibérément la
césure d'un vers**. C'était le cas redouté.

## Ce qui est déjà établi, sans appareil

Deux contrôles tournent sous Node et n'ont besoin d'aucun téléphone.

### `npm run check` — le repère de décalages

`src/parse.js` doit compter les caractères exactement comme `annotations.js`
les compte dans le DOM : nœuds de texte seuls, `<br>` et `<hr>` à largeur
nulle, frontières de blocs à zéro, entités décodées (`&nbsp;` devient U+00A0,
**un** caractère).

### `npm run parity` — la portabilité des annotations

Le contrôle qui compte. Il monte la page du spike B dans un DOM (jsdom), lui
applique le vrai `content-html.js`, puis compare au parseur natif : texte rendu
caractère pour caractère, et position de chaque `<mark>` peint par le vrai
`paintHighlights`.

**Résultat : 764 caractères des deux côtés, décalages identiques.** Une
annotation posée par la voie native se dessine au bon endroit sur le bureau.
Le système de coordonnées n'est donc *pas* le problème.

## Ce que le spike a déjà corrigé

Le pronostic de départ disait que les vers, en deux colonnes, sortiraient du
flux de texte et casseraient tout surlignage traversant la césure.

`views.css:2011` dit autre chose :

```css
.reader__page .verse { text-align: center; font-style: italic; }
```

Le lecteur **centre** les vers. Aucun bloc dans le flux, donc
`textAlign: 'center'` suffit en natif, et `hl-across` reste d'un seul tenant —
vérifié par `check.mjs`. De même, `tools/shamela/text.py` n'émet jamais
`ul`/`ol`/`li`/`div` : le mélange bloc/inline, redouté, n'existe pas dans le
corpus.

## Relevés sur appareil

### A · `<Text>` imbriqués — mesuré

| Critère | Résultat |
| --- | --- |
| Décalages d'une sélection utilisateur | **non** |
| Toucher un surlignage | **oui** |
| Surlignage traversant la césure d'un vers | **oui** |

Conforme au pronostic. [RN #23147](https://github.com/facebook/react-native/issues/23147)
tient : `<Text>` laisse sélectionner et copier, mais ne rend jamais les bornes.
Et la correction sur les vers est vérifiée sur écran réel — le vers centré
garde le flux, la bande rouge reste d'un seul tenant.

Donc la voie native sait **dessiner et manipuler** des annotations. Elle ne
sait pas les **créer**.

### A bis · `<TextInput>` figé — mesuré

| Critère | Résultat |
| --- | --- |
| Décalages d'une sélection utilisateur | **oui** |
| Toucher un surlignage imbriqué | **non** |

Le critère du toucher était laissé ouvert exprès. L'appareil ne dément pas
#23147 : il le confirme.

Détail qui compte si cette voie est un jour retenue : c'est le réglage **« sans
clavier »** (`editable`, `showSoftInputOnFocus={false}`, `caretHidden`) qui
marche, pas `editable={false}`.

### B · WebView — mesuré

Tout passe : la page se monte et se peint, la sélection rend ses décalages avec
son contexte, le toucher d'un surlignage ouvre sa note.

Le code exécuté est celui du projet, sans une ligne de changement.

**Premier rendu : 296 ms.** Ce temps couvre le démarrage de la WebView, pas
seulement le dessin de la page — il se paie une fois à l'ouverture du lecteur,
pas à chaque page tournée. La réserve de performance qui pesait sur cette voie
tombe.

Une correction a été nécessaire en cours de route, et elle vaut d'être retenue :
la page écoutait `touchend` pour rapporter la sélection, en écartant
explicitement `selectionchange`. C'est l'inverse sur mobile — dès que les
poignées de sélection natives apparaissent, elles avalent les événements
tactiles, et `touchend` ne remonte jamais au document. Le premier relevé
concluait donc à tort que la WebView ne savait pas lire une sélection.

## Verdict

| | A · `<Text>` | A bis · `<TextInput>` | B · WebView |
| --- | --- | --- | --- |
| Poser une annotation | ✗ | ✓ | ✓ |
| Toucher un surlignage | ✓ | ✗ | ✓ |
| Traverser la césure d'un vers | ✓ | — | ✓ |

L'étau de [RN #23147](https://github.com/facebook/react-native/issues/23147) est
confirmé **sur appareil**, pas seulement dans un fil GitHub : chacune des deux
voies natives donne exactement la moitié de ce que le lecteur exige, et jamais
la même moitié.

Deux résultats méritent d'être retenus au-delà de ce verdict, parce qu'ils
contredisent le pronostic de départ :

- le **repère de décalages est portable** (`npm run parity`, 764 caractères
  identiques des deux côtés). Une annotation posée en natif se dessinerait au
  bon endroit sur le bureau. Ce n'était pas acquis, et ce n'est pas ce qui
  bloque ;
- la **mise en page ne bloque pas** non plus. Les vers sont centrés, pas en
  colonnes, et le corpus réel n'émet aucune balise de bloc en ligne.

Ce qui bloque est étroit et précis : React Native ne sait pas rendre les bornes
d'une sélection **et** laisser toucher le texte sélectionné. Rien d'autre.

Conséquence pour l'architecture : si le lecteur doit être une WebView, un shell
Expo autour d'une page web est ce que Capacitor fait déjà — en gardant les
~10 000 lignes de rendu et les ~5 600 lignes de CSS qu'un portage React Native
jetterait.

## Ce que le spike ne couvre pas, volontairement

Ni SQLite, ni téléchargement, ni zstd, ni polices embarquées. Ces trois-là ont
des réponses connues (`expo-sqlite` avec FTS5 et répertoire arbitraire,
`expo-file-system` en session d'arrière-plan, `expo-font`) et aucune ne décide
de l'architecture. Le lecteur, si.
