# Exemple Capacitor : ouvrir un vrai livre

*2 août 2026*

## Pourquoi

Le spike `spikes/expo-reader/` a mesuré, sur appareil, que le lecteur ne peut pas
être porté en React Native natif : `<Text>` laisse toucher un surlignage mais ne
rend jamais les bornes d'une sélection, `<TextInput>` rend les bornes mais ne
laisse plus toucher. Le lecteur exige les deux. Une WebView fait les deux, en
exécutant `content-html.js` et `annotations.js` sans une ligne de changement.

Si le lecteur doit être une WebView, Capacitor est la voie courte : il garde le
rendu existant au lieu de le réécrire. Reste à vérifier ce que le spike
précédent ne pouvait pas voir — que le rendu réel démarre sous Capacitor, que
SQLite natif tient le catalogue réel, et que **FTS5 fonctionne**.

Ce dernier point est le gain principal du portage : le build `sql.js` embarqué
dans Electron ne contient pas FTS5, donc `catalog_fts` et `pages_fts` sont
produites par le pipeline mais illisibles par l'application, qui se rabat sur des
`LIKE`.

**Réponse acquise pendant la mise en place, par inspection binaire** — la même
méthode qui avait établi l'absence de FTS5 dans `sql-wasm.wasm`. Le plugin
Capacitor n'utilise pas le SQLite d'Android : il embarque SQLCipher 4.10.0
(`net.zetetic:sqlcipher-android`), livré en `libsqlcipher.so` pour les quatre
architectures.

| Chaîne | `libsqlcipher.so` | `sql-wasm.wasm` |
| --- | --- | --- |
| `fts5` | 30 | **0** |
| `bm25` | 1 | **0** |
| `fts4` | 4 | 4 |
| `fts3` | 8 | 7 |

Le témoin négatif compte autant que le résultat : sans lui, un `grep` qui trouve
`fts5` des deux côtés ne prouverait rien.

Vérifié aussi sur les fichiers réellement poussés, avec le SQLite de Node 24 :
`pages_fts MATCH 'الله'` rend 118 lignes, `catalog_fts MATCH 'تفسير'` en rend
191. Les index ne sont donc pas seulement présents au schéma, ils sont peuplés.

Reste à mesurer à l'exécution, et c'est plus étroit : la **couche JavaScript** du
plugin laisse-t-elle passer une requête `MATCH` ? Le moteur, lui, sait la faire.

## Périmètre

Une tranche verticale : accueil → fiche livre → lecteur, sur le vrai catalogue
(8 568 éditions) et un vrai livre.

**Hors périmètre, explicitement** : décompression zstd sur l'appareil,
téléchargement depuis le bucket, écritures dans `user.sqlite`, et les 52 méthodes
du repository que la tranche n'emprunte pas.

## Le seul point de couture

`src/renderer/js/repository.js` est le **seul** fichier du rendu qui touche le
pont — lignes 5 et 12, `window.beytelhikma`. Toutes les vues importent depuis
lui. Et le rendu n'a pas de bundler : `<script type="module">` et des `<link>`
en clair, que Capacitor sert tels quels.

Un portage Capacitor est donc : garder `src/renderer/` mot pour mot, et
réécrire un fichier.

## Architecture

```
spikes/capacitor-reader/
  capacitor.config.json      webDir: "www"
  scripts/prepare-www.mjs    src/renderer/ -> www/, puis remplace repository.js
  scripts/fetch-real-data.mjs  bucket -> .sqlite -> adb push
  scripts/verify.mjs         parité des 67 noms
  src/repository.capacitor.js  le shim
  src/probe.js               le panneau de mesures
  www/                       artefact, ignoré par git
  android/                   artefact, ignoré par git
```

### `prepare-www.mjs` — pas un miroir, un artefact

Copie `apps/desktop/src/renderer/` vers `www/`, puis remplace
`js/repository.js` par le shim. `www/` est ignoré par git et régénéré avant
chaque `cap sync`.

La distinction compte. Le projet a payé trois fois le prix d'une copie
entretenue à la main : le thème `sepia` que les réglages proposaient sans qu'une
règle CSS le lise, la liste des polices déclarée trois d'un côté et deux de
l'autre, et `MIRROR_DIRS`. Une copie régénérée par script ne dérive pas.

### `repository.capacitor.js` — la même surface, une fraction du contenu

Expose **les 67 noms** de `METHODS` (`src/preload/preload.cjs`).

Implémentées contre SQLite natif :

| Écran | Méthodes |
| --- | --- |
| Accueil | `getTopCategories`, `getRecentBooks`, `getCategories`, `getFeaturedAuthor` |
| Liste | `getBooks`, `getBooksByCategory` |
| Fiche | `getBookDetail`, `getRelatedBooks` |
| Lecteur | `getToc`, `getPageCount`, `getPages`, `getPageById` |
| Recherche | `searchInBook` — **le test FTS5** |
| Réglages | `getSettings`, `saveSetting` (en mémoire, pas `user.sqlite`) |

Le SQL est **repris de `book-repository.js` sans le réécrire** : c'est du SQL, il
ne change pas de moteur.

Les autres lèvent `RepositoryError('not-ported')`. Les vues gèrent déjà quatre
états dont `error` : ce qui n'est pas porté se **voit à l'écran** au lieu de
produire un écran blanc. `onDownloadsChanged` rend une fonction de
désabonnement inerte.

### Ouverture des bases : méthodes NC

`@capacitor-community/sqlite` impose un dossier fixe
(`data/data/<paquet>/databases`) et réécrit le nom en `<nom>SQLite.db`. Les
fichiers du projet s'appellent `<edition_id>.sqlite` et vivent où on les met.

La famille **NC** (*non-conformed*) — `getNCDatabasePath`, `createNCConnection`,
`isNCDatabase` — accepte un chemin absolu. C'est la seule qui convienne, et le
shim ne passe que par elle.

### `fetch-real-data.mjs`

1. lit `catalog/latest.json` sur `https://beytelhima-library.s3.eu-west-1.amazonaws.com` ;
2. tire `catalog.sqlite.zst`, vérifie le **SHA-256 avant** d'écrire, décompresse
   avec `zlib.createZstdDecompress` de Node 24 — le même appel que
   `download-manager.js` ;
3. choisit une édition dans le catalogue obtenu, tire son livre de la même façon ;
4. `adb push` les deux fichiers.

Le zstd est résolu sur la machine de développement, jamais sur l'appareil : c'est
ce qui garde le maillon hors périmètre sans l'escamoter.

## Ce que l'exemple mesure

Un panneau affiche des chiffres relevés, pas des affirmations :

- ouverture de `catalog.sqlite` — 28,8 Mo, 8 568 éditions ;
- première requête d'accueil (`getTopCategories`) ;
- **FTS5 : `catalog_fts` et `pages_fts` sont-elles interrogeables ?** ;
- ouverture d'un livre et rendu d'une page.

Une réponse négative sur FTS5 est un résultat, pas un échec : elle retirerait
l'argument principal en faveur du portage, et il vaut mieux le savoir maintenant.

## Erreurs

`RepositoryError` typée, comme le projet. Trois codes : `not-ported`,
`db-missing` (le fichier n'a pas été poussé), `query-failed`.

## Contrôle

`scripts/verify.mjs` lit `METHODS` dans `src/preload/preload.cjs` et vérifie que
le shim expose **exactement** ces noms — ni moins, ni plus. C'est le test de
parité que le projet a déjà (`test/repository.test.js`) ; sans lui, une méthode
oubliée ne se découvre qu'au premier clic.

## Écueils rencontrés

### Gradle est épinglé sur un JDK 17, globalement

Le `~/.gradle/gradle.properties` de la machine porte
`org.gradle.java.home=…/eclipse_adoptium-17…`. Dans Gradle, le fichier
utilisateur l'emporte à la fois sur `JAVA_HOME` et sur le `gradle.properties` du
projet : aucun des deux ne peut le contredire. Capacitor 8 exige une toolchain
21, d'où `invalid source release: 21`.

Le contournement ne touche pas au réglage global, qui sert sans doute ailleurs :
`-Dorg.gradle.java.home=<JBR d'Android Studio>` en ligne de commande, câblé dans
le script npm. Pas dans `android/gradle.properties`, que `cap add android`
régénère et que git ignore.

### Le rendu n'est pas autonome

Ses vues importent `../../shared/digits.js` et `../../../shared/arabic.js`, hors
de `src/renderer/`. Sous Capacitor la racine servie est `www/`, et un navigateur
**écrête** les `..` qui remontent au-dessus de la racine : les deux formes
retombent donc sur `/shared/…`. `prepare-www.mjs` copie aussi
`apps/desktop/src/shared/` vers `www/shared/`, et tous les imports
marchent sans être réécrits — précisément la propriété que ce portage achète.

### Aucun spécificateur nu dans le shim

Le rendu n'a pas de bundler et `cap sync` ne copie que `www/` : un navigateur ne
résout pas `import … from '@capacitor-community/sqlite'`. Une `importmap` en
ligne n'est pas une issue non plus, le CSP étant `script-src 'self'`.

Le shim passe donc par les globales que le pont installe —
`globalThis.Capacitor.Plugins` — c'est-à-dire la couche **brute** du plugin, sans
l'enveloppe `SQLiteConnection` du paquet npm.
