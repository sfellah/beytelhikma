# Exemple Capacitor — le lecteur sur SQLite natif

Le rendu réel de Beyt El Hikma, **sans une ligne modifiée**, tournant sous
Capacitor sur le vrai catalogue (8 568 éditions) et un vrai livre, en SQLite
natif.

Suite du spike `../expo-reader/`, qui avait établi que le lecteur ne peut pas
être porté en React Native natif et doit être une WebView.

```bash
npm install
npm run verify     # parité des 67 méthodes, hors appareil
npm run data       # bucket -> .sqlite -> adb push  (~30 Mo)
npm run android    # prepare:www + cap sync + build + lancement
```

## Ce qui a été mesuré

Sur émulateur Android 16, depuis un appareil vierge :

| Mesure | Temps | Détail |
| --- | --- | --- |
| `catalogue:ouverture` | 131 ms | 28,8 Mo, 8 568 éditions |
| `fts5:catalog_fts` | 58 ms | `MATCH` ok |
| `accueil:premiere-requete` | 721 ms | 6 disciplines sur 40 |
| `livre:ouverture` | 50 ms | `sh-7745`, 230 pages |
| `fts5:pages_fts` | 76 ms | `MATCH` ok |
| `livre:page` | 37 ms | 20 pages |
| `recherche:livre` | 16 ms | **fts5**, 28 pages trouvées |

### FTS5 fonctionne — la question centrale du spike

Établi deux fois, par deux voies indépendantes.

**Statiquement**, par la méthode qui avait servi à prouver son absence de
`sql-wasm.wasm`. Le plugin n'utilise pas le SQLite d'Android : il embarque
SQLCipher 4.10.0.

| Chaîne | `libsqlcipher.so` | `sql-wasm.wasm` |
| --- | --- | --- |
| `fts5` | 30 | **0** |
| `bm25` | 1 | **0** |
| `fts4` | 4 | 4 |
| `fts3` | 8 | 7 |

Le témoin négatif compte autant que le résultat : sans lui, un `grep` qui trouve
`fts5` des deux côtés ne prouverait rien.

**À l'exécution**, à travers la couche JavaScript du greffon, sur les deux
tables. `searchInBook` rend de vrais résultats — chapitre, page, et l'extrait
avec son contexte avant/après, exactement la forme que le lecteur attend.

Une recherche plein texte sur un livre de 230 pages en **16 ms**, là où
l'application balaie aujourd'hui en `LIKE` faute de FTS5 dans `sql.js`.

## Ce que ça confirme du portage

`src/renderer/js/repository.js` est le **seul** fichier du rendu qui touche le
pont. Le portage tient donc en un fichier remplacé : `src/repository.capacitor.js`
expose les 67 mêmes noms, dont 15 implémentés contre SQLite natif avec le SQL de
`book-repository.js` repris tel quel.

Le reste — routeur, vues, couvertures composées, thèmes, RTL, chiffres
arabes-indiens, sommaire, annotations — fonctionne sans y toucher.

## Trois pièges, chacun trouvé en le heurtant

### Un dossier créé par adb est un mur

Sous le stockage cloisonné d'Android, un dossier appartient à qui l'a créé.
`adb shell mkdir` — et `adb push`, qui crée ses parents pareillement — le posent
au nom du shell, et l'application ne peut plus le **traverser**.

Un *fichier* déposé par adb reste pourtant lisible. D'où un défaut qui ne
ressemble pas à un problème de droits : le catalogue, posé à plat, s'ouvrait
parfaitement ; le livre, en sous-dossier, était déclaré absent, et la fiche
affichait un `null` sans rien expliquer.

Le seul créateur légitime est l'application. `fetch-real-data.mjs` la démarre
avant de pousser, le shim pose les mêmes dossiers avant toute lecture, et un
dernier filet relit les droits après le push.

### Aucun spécificateur nu

Le rendu n'a pas de bundler et `cap sync` ne copie que `www/`. Un navigateur ne
résout pas `import … from '@capacitor-community/sqlite'`, et une `importmap` en
ligne est fermée par le CSP `script-src 'self'`. Le shim passe donc par
`globalThis.Capacitor.Plugins`, c'est-à-dire la couche **brute** du greffon,
sans l'enveloppe `SQLiteConnection` du paquet npm.

### Gradle est épinglé sur un JDK 17, globalement

Le `~/.gradle/gradle.properties` de la machine porte `org.gradle.java.home`.
Dans Gradle, le fichier utilisateur l'emporte à la fois sur `JAVA_HOME` et sur
le `gradle.properties` du projet — aucun des deux ne peut le contredire.
Capacitor 8 veut une toolchain 21, d'où `invalid source release: 21`.

Le contournement est en ligne de commande, dans le script npm, et ne touche pas
au réglage global : `-Dorg.gradle.java.home=<JBR d'Android Studio>`.

## Périmètre

**Porté** — 15 méthodes : accueil, listes, fiche, sommaire, pages, recherche
dans le livre, réglages en mémoire.

**Traversé sans lever** — 7 méthodes rendent la forme *vide* au lieu de lever.
`views/home.js:22` et `views/reader.js:183` font des `Promise.all` sans `catch` :
une seule méthode qui lève emporte l'écran entier. Sans cet écart, l'exemple ne
pouvait ni afficher l'accueil ni ouvrir un livre, donc ne mesurait rien.

**Non porté** — 45 méthodes lèvent `RepositoryError('not-ported')`, que les vues
affichent dans leur état d'erreur.

**Hors périmètre** — zstd sur l'appareil, téléchargement depuis le bucket,
écritures dans `user.sqlite`.

## Ce qui reste douteux

- **Le repli `LIKE` n'est pas neutre.** Sur un même terme, FTS5 et `LIKE` ne
  rendent pas le même nombre de pages : FTS5 indexe des jetons, `LIKE` cherche
  des sous-chaînes. Passer à FTS5 **changerait les résultats**, pas seulement
  leur vitesse. À trancher avant tout portage réel.
- **721 ms pour la première requête d'accueil**, contre 131 ms pour ouvrir un
  catalogue de 28,8 Mo. C'est `getTopCategories` qui coûte, pas l'ouverture.
- Le liage des paramètres n'est éprouvé que sur les requêtes de cette tranche.
  Le SQL est plein de `LIMIT ?` : c'est le premier endroit à regarder si une
  requête ajoutée échoue.
