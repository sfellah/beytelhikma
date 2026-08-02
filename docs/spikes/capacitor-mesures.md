# Portage Capacitor — ce qui a été mesuré, et les pièges rencontrés

*Relevé fin juillet 2026 sur émulateur Android 16 depuis un appareil vierge, et
sur un Xiaomi sous Android 16. Ce document garde ce qui est **daté** : des temps,
une démonstration, et trois pièges qu'on ne retrouve qu'en les heurtant. Le mode
d'emploi de l'application, lui, vit dans [`apps/mobile/README.md`](../../apps/mobile/README.md).*

Suite du spike [`react-native-contre-webview.md`](react-native-contre-webview.md),
qui avait établi que le lecteur ne peut pas être porté en React Native natif et
doit être une WebView.

## Les temps relevés

| Mesure | Temps | Détail |
| --- | --- | --- |
| `catalogue:ouverture` | 131 ms | 28,8 Mo, 8 568 éditions |
| `fts5:catalog_fts` | 58 ms | `MATCH` ok |
| `accueil:premiere-requete` | 721 ms | 6 disciplines sur 40 |
| `livre:ouverture` | 50 ms | `sh-7745`, 230 pages |
| `fts5:pages_fts` | 76 ms | `MATCH` ok |
| `livre:page` | 37 ms | 20 pages |
| `recherche:livre` | 16 ms | **fts5**, 28 pages trouvées |

Téléchargement complet, mesuré : `sh-5706` — 48 سؤالا في الصيام, 40 pages, tiré du
bucket en **2 589 ms** (`queued → downloading → verifying → installed`), puis
40 pages lisibles, 49 entrées de sommaire, recherche interne à 15 pages. Dans une
WebView, sans un seul module natif : `fetch` sous CSP, en-tête `Range`,
décompression zstd en WebAssembly, SHA-256 par WebCrypto, écriture par tranches
de 384 Kio, renommage atomique en dernier geste.

## FTS5 fonctionne — la question centrale

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

**À l'exécution**, à travers la couche JavaScript du greffon, sur les deux tables.
`searchInBook` rend de vrais résultats — chapitre, page, et l'extrait avec son
contexte avant/après, exactement la forme que le lecteur attend. Une recherche
plein texte sur un livre de 230 pages en **16 ms**, là où l'application de bureau
balaie en `LIKE` faute de FTS5 dans `sql.js`.

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
`globalThis.Capacitor.Plugins`, c'est-à-dire la couche **brute** du greffon, sans
l'enveloppe `SQLiteConnection` du paquet npm.

### Gradle est épinglé sur un JDK 17, globalement

Le `~/.gradle/gradle.properties` de la machine porte `org.gradle.java.home`. Dans
Gradle, le fichier utilisateur l'emporte à la fois sur `JAVA_HOME` et sur le
`gradle.properties` du projet — aucun des deux ne peut le contredire. Capacitor 8
veut une toolchain 21, d'où `invalid source release: 21`.

Le contournement est en ligne de commande, dans le script npm, et ne touche pas
au réglage global : `-Dorg.gradle.java.home=<JBR d'Android Studio>`.

## Ce que le portage a révélé de l'interface

Cinq causes distinctes, trouvées par la mesure et corrigées **dans le rendu
réel** — ce sont de vrais défauts, qui frappent aussi une fenêtre Electron
étroite. Voir le commit `fix(ui): rendre l'interface tenable au doigt`.

La plus instructive : **`min-width: auto` sur les enfants de flex et de grille**,
le défaut structurel de cette feuille de style. Quatre écrans touchés. Une bande
faite pour défiler poussait au lieu de défiler — 1 008 px dans une fenêtre de
411 — et la fiche d'un livre s'affichait entièrement blanche.

La plus coûteuse à diagnostiquer : la balise `viewport` absente, qu'Electron n'a
jamais réclamée. Sans elle le WebView rend en 1028 px CSS, ce qui rallume les
points de rupture *bureau*. Et son dézoom automatique **masquait** le vrai
débordement : `minimum-scale=1` a été nécessaire pour rendre le défaut visible,
donc réparable.

La plus utile à l'usage : **la jauge de lecture faisait 4 px de haut**. C'est le
seul moyen de se déplacer vite dans un livre de mille pages, et il était
insaisissable au doigt. À la souris on vise, au doigt on couvre — le défaut ne
pouvait pas se voir sur bureau.

Les facettes d'`/explore` sont devenues un panneau dépliable : avant, zéro livre
visible sans défiler ; après, deux.

Mesuré aussi : la barre d'état d'Android 15+ se pose **par-dessus** la fenêtre —
42 px sur le Xiaomi, 24 px sur l'émulateur. D'où les quatre jetons `--safe-*` de
`tokens.css`.

## Les treize écrans

Tous se montent avec de vraies données, **sans un pixel de débordement
horizontal** : `#/home`, `#/library`, `#/explore` (٨٥٦٨ نتيجة), `#/authors`
(٣١٨٣ مؤلفًا), `#/downloads`, `#/search`, `#/notes`, `#/settings`, `#/book/:id`,
`#/reader/:id`, `#/collection/:id`, `#/curriculum/:id`.

Les écritures sont vérifiées sur appareil : réglage relu après redémarrage,
progression, collection créée puis peuplée, surlignage, signet.

L'installation d'une police Google aussi, de bout en bout : feuille récupérée,
quatre graisses, écritures `arab` et `latn` détectées, `woff2` déposés et servis
en `https://localhost/_capacitor_file_/…` — donc `font-src 'self'` sans un mot de
plus. Vérifié jusqu'au rendu : le texte mesure 202 px en Cairo contre 177 en
serif, et `@font-face` dans une `CSSStyleSheet` **construite** est bien appliqué.

`checkCatalogUpdate` atteint le bucket et conclut `upToDate` — la logique de
`catalog-updater` traverse le portage sans retouche.

## Ce qui restait douteux à la fin du portage

**Le repli `LIKE` n'est pas neutre.** Mesuré sur le vrai catalogue :

| terme | fts5 | repli |
| --- | --- | --- |
| الأصول | 85 | 98 |
| **نحو** | **7** | **94** |
| الشافعي | 44 | 64 |

FTS5 indexe des jetons, `LIKE` cherche des sous-chaînes. L'écart n'est pas
marginal, il est structurel — d'où le choix de la **phrase préfixée** (`"terme"*`),
qui approche la sous-chaîne sans quitter l'index. Adopter FTS5 **changerait les
résultats de recherche**, pas seulement leur vitesse. C'est un arbitrage produit,
à trancher avant d'aligner les deux applications.

Corollaire : `searchLibrary` (FTS5) et `searchInBook` (phrase exacte) ne comptent
pas pareil. Un livre annoncé à 38 occurrences peut n'en montrer que 13 une fois
ouvert. À aligner.

**`pages_fts` indexe aussi `footnotes_search`.** Un `MATCH` nu ramenait cinq pages
sans le terme dans le corps, dont l'extrait retombait sur les 120 premiers
caractères sans rien de surligné. Filtré sur `{body_search}`.

**L'accueil est passé de 721 ms à 1 926 ms à froid** — logiquement : il appelle
désormais les vraies `getContinueReading`, `getLibrary`, `getEras`,
`getUndatedCount`, `getBooksByAuthor` au lieu des versions inertes. Lent, pas
cassé, et c'est le premier écran à optimiser.

**Le repli sans FTS5 lie jusqu'à 8 487 paramètres.** `exploreBooks({text})` sans
index produit un `IN (?,?,…)` que `getFacets` refait six fois, chaque valeur
traversant le pont natif en JSON. C'est ce que la voie FTS5 évite, et ce qui
casserait en premier si le verdict devenait négatif sur un autre appareil.

**Le pic mémoire d'un téléchargement** est compressé + décompressé simultanément
(~50 Mo pour les plus gros livres du corpus), le hachage se faisant sur le tampon
clair avant écriture. Non mesuré sur les gros livres.

**Les migrations `user.sqlite`** posent `PRAGMA user_version` en dernier : une
migration coupée se rejoue entièrement. Le chemin n'a pas été éprouvé par une
coupure réelle.
