# Restructuration du dépôt : deux applications, un site, une chaîne de données

*2026-08-02*

## Le problème

Le dépôt porte la trace de son histoire plutôt que sa forme actuelle. Trois
symptômes, un seul défaut :

- `beytelhikma-electron/` se nomme d'après sa technologie, à l'époque où il
  fallait la distinguer du client Flutter. Le client Flutter a disparu ; le nom
  ne distingue plus rien.
- Le portage mobile vit sous `spikes/capacitor-reader/`. Il porte pourtant les
  **67 méthodes** du pont, treize écrans montés sur de vraies données, et un
  build release signé. Un dossier `spikes/` annonce du jetable ; celui-là ne
  l'est plus.
- Le second spike, `spikes/expo-reader/`, a rendu son verdict — le lecteur ne
  peut pas être natif, il doit être une WebView — et ce verdict est consigné
  ailleurs. Son code ne sert plus à rien.

À quoi s'ajoutent six documents à la racine, dont un dont le nom porte une
faute (`DATA_MODEL_DESCISION.md`), et huit maquettes dont deux portent des
espaces et une coquille (`honme v2.html`, `reader V2.html`).

## La forme cible

```
beytelhikma/
├─ apps/
│  ├─ desktop/          ← beytelhikma-electron/
│  └─ mobile/           ← spikes/capacitor-reader/
├─ site/
├─ tools/
├─ docs/
│  ├─ DATAMODEL.md
│  ├─ DESIGN.md
│  ├─ decisions-modele-donnees.md      ← DATA_MODEL_DESCISION.md
│  ├─ maquettes/                       ← ui-examples/, en kebab-case
│  ├─ spikes/
│  │  ├─ react-native-contre-webview.md   ← README d'expo-reader
│  │  └─ capacitor-mesures.md             ← mesures et pièges du spike Capacitor
│  └─ superpowers/{specs,plans}/
├─ .github/workflows/
└─ README.md  CHANGELOG.{ar,en,fr}.md  CLAUDE.md  LICENSE  logo.png  .env.example
```

`apps/` ne contient que ce qui s'installe sur une machine d'utilisateur. Le
site n'en est pas : il se déploie sur des pages statiques, il a sa propre
cadence, et il ne partage avec les applications que deux modules de `shared/`.
Le ranger dans `apps/` ferait croire à une troisième cible d'installation.

`logo.png` reste à la racine : c'est la **source** de `tools/gen_brand_assets.py`,
pas un artefact. `CHANGELOG.fr.md` reste aussi — le site est trilingue et
`site/lib/changelog.mjs` lit les trois.

`CLAUDE.md` reste à la racine parce que c'est là que l'agent le lit. Le
descendre dans `docs/` le rendrait invisible à l'outil qui en est le seul
lecteur.

## Ce que la profondeur change, et ce qu'elle ne change pas

`spikes/capacitor-reader` → `apps/mobile` **garde sa profondeur**. Le calcul
`repoRoot = spikeDir/../..` de `prepare-www.mjs` et de `verify.mjs` reste juste
sans y toucher ; seule la chaîne `'beytelhikma-electron'` change de valeur.

`beytelhikma-electron` → `apps/desktop` **descend d'un cran**. Trente et un
fichiers citent l'ancien nom : workflows, `.gitignore`, imports du site,
scripts du mobile, constantes de chemin des outils Python, prose des README et
des specs. Tous sont réécrits, y compris les specs archivées de
`docs/superpowers/` : une spec qui cite un chemin mort est une spec qu'on
n'ose plus suivre.

Les dossiers non suivis par git — `node_modules/`, `android/`, `www/`,
`data/` — partent avec leur application. Le déplacement se fait donc au niveau
du **dossier entier**, pas fichier par fichier : `git mv` ne connaît que le
suivi, et `apps/mobile` arriverait sans son projet Android.

## Le mobile cesse d'être un exemple

`package.json` prend le nom `beytelhikma-mobile`. `capacitor.config.json` perd
son `appId` de spike (`org.beytelhikma.spike` → `org.beytelhikma.app`) et son
`appName` (`Beyt El Hikma — spike` → `Beyt El Hikma`).

Le README est scindé selon ce qu'il sert :

- **Ce qui reste dans `apps/mobile/README.md`** : comment installer, comment
  construire, ce que le portage couvre, et les limites qui gouvernent encore
  les décisions — le CSP figé au chargement du document, l'écart structurel
  entre FTS5 et le repli `LIKE`, le pic mémoire d'un téléchargement.
- **Ce qui part dans `docs/spikes/capacitor-mesures.md`** : les temps relevés
  sur l'émulateur, la démonstration en deux voies de la présence de FTS5, et
  les trois pièges rencontrés (un dossier créé par adb est un mur, aucun
  spécificateur nu, Gradle épinglé sur un JDK 17). C'est du savoir daté, vrai
  au jour de la mesure ; il documente une enquête, pas un mode d'emploi.

`probe.js` et le drapeau `--sans-sonde` restent. La sonde est un instrument, et
elle est déjà absente des builds release — la retirer ne nettoierait rien et
coûterait la mesure.

## La CI gagne un troisième job

`npm run verify` du mobile vérifie la parité des 67 méthodes entre le pont
Electron (`preload.cjs`, `repository.js`) et le shim Capacitor. Il tourne sans
appareil ni émulateur, en quelques secondes.

Il devient un job de `ci.yml`, parallèle et indépendant des deux autres. Une
méthode ajoutée au repository sans son pendant mobile casse alors la barrière
au lieu de se découvrir sur un téléphone.

## Ce qui disparaît

`spikes/expo-reader/` : huit fichiers source, six images, 240 Ko de
`package-lock.json`. Son README — la comparaison mesurée entre React Native
natif et WebView, qui est la raison d'être du portage Capacitor — devient
`docs/spikes/react-native-contre-webview.md`. Le code reste dans l'historique
(`901c448`).

Aucune autre suppression n'est décidée d'avance. Les fichiers qu'aucun code ni
aucune doc ne référence sont **inventoriés et présentés** ; un `.env.example`
ou un `site/assets/redirect.js` a l'air orphelin sans l'être.

## Vérification

La restructuration ne change aucun comportement. Elle est donc entièrement
vérifiable par ce qui existe déjà :

| Commande | Répertoire |
| --- | --- |
| `npm test` | `apps/desktop` |
| `node --test "test/**/*.test.js"` | `site` |
| `npm run verify` | `apps/mobile` |
| `python -m unittest discover -s shamela/tests -t .` | `tools` |

Plus deux recherches qui doivent ne rien rendre : `git grep beytelhikma-electron`
et `git grep ui-examples`. Un chemin mort qui survit dans un commentaire est un
piège posé pour la prochaine lecture.
