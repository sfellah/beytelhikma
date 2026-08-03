# Beyt El Hikma — Android

L'application Android : **le rendu de `apps/desktop`, sans une ligne modifiée**,
sous Capacitor, sur SQLite natif.

```bash
npm install
npm run verify     # parité des 67 méthodes du pont, hors appareil
npm run seed       # graine de catalogue -> data/  (embarquée dans l'APK)
npm run data       # bucket -> .sqlite -> adb push  (~30 Mo)
npm run android    # prepare:www + cap sync + build + lancement
npm run android:release   # graine + sans la sonde, aligné et signé
```

Prérequis : un SDK Android (`ANDROID_HOME`), un appareil ou un émulateur, et le
JDK 21 que réclame Capacitor 8 — le script passe `-Dorg.gradle.java.home` en
ligne de commande plutôt que de toucher au réglage global de la machine.

## Lancer sur un téléphone ou sur l'émulateur

**Trois choses manquent sur une machine neuve**, et aucune n'est une erreur :
`node_modules/`, la graine de catalogue et le projet natif. Les trois sont des
artefacts — `android/` est engendré par Capacitor et ignoré par git, au même
titre que `www/` et `data/`.

```bash
npm install                 # sinon `npx cap` répond « could not determine executable to run »
npm run seed                # sinon prepare-www refuse de produire un www/ sans graine
npx cap add android         # une seule fois par clone : engendre android/
```

Ensuite, à chaque changement du rendu :

```bash
npm run sync                # prepare-www + cap sync android
```

**Le build passe par `gradlew`, pas par `npx cap run android`.** Deux raisons,
toutes deux rencontrées sous Windows : `cap run` invoque `gradlew` sans son
extension et cmd ne le trouve pas, et Gradle cherche un **JDK 21** que le Java
du système (24) ne satisfait pas — la panne se lit
« Cannot find a Java installation … matching: {languageVersion=21} ». Le JBR
livré avec Android Studio est un 21 : on le désigne pour ce build seulement,
sans toucher au `JAVA_HOME` de la machine.

```bash
JBR="C:/Program Files/Android/Android Studio/jbr"
cd android
JAVA_HOME="$JBR" ./gradlew.bat assembleDebug --console=plain \
  "-Dorg.gradle.java.home=$JBR" "-Porg.gradle.java.installations.paths=$JBR"
```

`-Dorg.gradle.java.home` fait tourner Gradle sous le 21 ; `-Porg.gradle.java.installations.paths`
lui dit **où chercher** la chaîne d'outils que réclament les greffons Capacitor.
Le second sans le premier ne suffit pas.

Puis l'installation et le lancement, qui ne demandent ni Gradle ni Capacitor :

```bash
adb devices                                   # relève le numéro de série
adb -s <série> install -r android/app/build/outputs/apk/debug/app-debug.apk
adb -s <série> shell monkey -p org.beytelhikma.app -c android.intent.category.LAUNCHER 1
```

`-s <série>` n'est pas une précaution de style : dès qu'un émulateur tourne à
côté d'un téléphone branché, `adb` refuse d'agir sans savoir lequel des deux
vous visez. `install -r` **garde les données** — `user.sqlite`, la progression,
les annotations — là où une désinstallation les emporte ; il exige en revanche
la même signature, et la clé de débogage d'Android est celle de la machine qui
a produit l'installation précédente.

Sur l'**émulateur**, rien ne change après le démarrage de la machine virtuelle :

```bash
emulator -list-avds
emulator -avd <nom> &          # puis les mêmes trois commandes adb
```

Ce qui se lit ensuite : `adb -s <série> logcat -d | grep Capacitor/Console`
porte les messages du rendu — c'est là que sortent les erreurs JavaScript, la
sonde n'étant plus qu'un complément.

## Ce qui est partagé, et ce qui ne l'est pas

`www/` est un **artefact**. `scripts/prepare-www.mjs` l'efface et le refait
entièrement depuis `apps/desktop/src/renderer/` et `apps/desktop/src/shared/` :
deux exécutions donnent le même arbre, et modifier `www/` à la main n'a aucun
effet durable. C'est voulu — le projet a déjà payé trois fois le prix d'une copie
tenue à la main (le thème `sepia` mort, la liste des polices déclarée deux fois,
`MIRROR_DIRS`).

`src/renderer/js/repository.js` est le **seul** fichier du rendu qui touche le
pont. Le portage tient donc en un fichier remplacé.

| Module | Méthodes | Ce qu'il couvre |
| --- | --- | --- |
| `src/repository.capacitor.js` | 13 | accueil, listes, fiche, sommaire, pages, recherche dans le livre |
| `src/repo/catalogue-plus.js` | 15 | auteurs, siècles, exploration, facettes, cursus, recherche transversale |
| `src/repo/utilisateur.js` | 21 | schéma et migrations de `user.sqlite`, réglages, progression, bibliothèque, collections, annotations |
| `src/repo/telechargements.js` | 15 | file séquentielle, `Range`, zstd, SHA-256, renommage, mise à jour du catalogue |
| `src/repo/polices.js` | 3 | installation depuis Google Fonts, avec les bornes du modèle |
| `src/repo/graine.js` | — | plantation de la graine de catalogue au premier lancement |

**Les 67 méthodes sont portées ; aucune ne lève `not-ported`.** `npm run verify`
compare les trois listes — `preload.cjs`, `repository.js`, le shim — et échoue si
l'une diverge. C'est ce contrôle qui tourne en CI : une méthode ajoutée d'un côté
sans son pendant de l'autre casse la barrière au lieu de se découvrir sur un
téléphone.

Les cinq modules de `src/repo/` sont des **fabriques sans aucun `import`** :
chacune reçoit ses dépendances en argument, et `repository.capacitor.js` est le
seul endroit qui connaisse l'assemblage.

## La graine de catalogue

L'APK embarque `assets/catalog.sqlite.zst` — **le `.zst` compressé (~4,9 Mo),
jamais les 28,8 Mo décompressés**. `npm run seed` remplit le cache `data/` avec
la recette du bureau **importée**, pas recopiée (`apps/desktop/scripts/fetch-seed.mjs` :
empreinte vérifiée contre le pointeur, schéma refusé s'il est trop récent,
aucun repli sur une graine périmée) ; `prepare-www.mjs` la copie dans
`www/assets/` à chaque régénération et refuse de produire un `www/` sans elle —
installée sans graine, l'application n'avait aucun catalogue et ne montrait
rien.

Au premier lancement, `src/repo/graine.js` la décompresse avec le fzstd déjà
embarqué et l'installe **seulement si `catalog.sqlite` est absent** : la graine
est figée à la date du build, le catalogue installé a pu être mis à jour depuis
le bucket, et l'écraser le ferait régresser à chaque mise à jour de
l'application. Écriture de côté puis `rename`, comme partout. `npm run verify`
éprouve le planteur avec des dépendances factices, sans appareil.

L'application explore donc hors ligne dès l'installation ; `npm run data` et
son `adb push` restent le chemin des données de développement (le vrai livre,
le catalogue décompressé). La mise à jour du catalogue se propose ensuite au
démarrage, depuis le rendu partagé (`js/catalog-update.js`) : la même bannière
que le bureau, les trois méthodes du pont étant portées ici contre SQLite
natif.

## L'icône et l'écran de démarrage

Le symbole sur fond crème — dans le lanceur, puis au démarrage, où il grandit et
paraît en 700 ms. Les deux sortent d'`icon.svg` (à la racine du dépôt) par
`python tools/gen_brand_assets.py`, en `VectorDrawable` : le système les rend à
la densité de l'appareil, et il n'y a pas cinq PNG à tenir à jour. Le fond est
le même des deux côtés (`#FBF9F4`) : l'icône est le premier écran de
l'application et le démarrage le second, deux crèmes différents à une fraction
de seconde d'intervalle se lisent comme un clignotement.

**Il se pose par script**, comme `www/`. `android/` est engendré par
`npx cap add android` et ignoré par git : une ressource déposée là à la main
disparaît au premier clone, et la panne est muette — le build réussit, avec
l'écran de démarrage par défaut de Capacitor. La source suivie est
`resources/android/res/`, et `scripts/prepare-android.mjs` l'y recopie, réécrit
le thème de lancement et efface les onze `splash.png` de Capacitor. Il tourne
depuis `npm run sync` et `npm run android:release`, et deux exécutions de suite
donnent le même arbre.

| Ce qui est vu | Où |
| --- | --- |
| le dessin, 288 dp | `resources/android/res/drawable/splash_icon.xml` (engendré) |
| l'animation, Android 12+ | `resources/android/res/drawable-v31/splash_reveal.xml` (engendré) |
| le dessin fixe, Android 7 à 11 | `resources/android/res/drawable/splash_reveal.xml` |
| les deux gestes | `resources/android/res/animator/` |
| le fond crème du démarrage | `resources/android/res/values/splash.xml` |
| le thème de lancement | le littéral `THEME_LANCEMENT` de `scripts/prepare-android.mjs` |
| l'avant-plan de l'icône, 108 dp | `resources/android/res/drawable/ic_launcher_foreground.xml` (engendré) |
| l'icône adaptative, Android 8.1+ | `resources/android/res/mipmap-anydpi-v26/` |
| les icônes héritées, Android 7–8.0 | `resources/android/res/mipmap-*dpi/` (engendrées) |
| le fond crème de l'icône | `resources/android/res/values/ic_launcher_background.xml` |

Quatre pièges, tous tenus par `npm run verify` ou par `prepare-android.mjs` :

- **La ligne de garde est un disque, et elle n'est pas la même des deux
  côtés.** `core-splashscreen` pose l'icône de démarrage sur 288 dp et masque
  tout ce qui sort d'un disque de 192 ; le lanceur, lui, ne garantit que 66 dp
  sur 108. Calé sur la boîte du dessin, le mihrab perdait sa pointe. Le
  générateur cherche le cercle minimal et cale dessus, avec la garde de chaque
  destination.
- **Un dossier qualifié l'emporte sur le dossier nu.** Capacitor range son
  avant-plan dans `drawable-v24/`, qui gagne dès l'API 24 — c'est-à-dire
  toujours, `minSdkVersion` valant 24. Le nôtre, posé dans `drawable/`, n'était
  lu par personne : l'icône montrait le petit robot d'Android sur notre fond
  crème, et **rien n'échouait**. `prepare-android.mjs` efface la variante et
  refuse désormais de finir si une autre en masque une des nôtres.
- **L'animation ne joue pas avant Android 12.** En deçà, l'icône est un *fond
  de fenêtre*, que personne n'anime : d'où l'alias fixe dans `drawable/` et
  l'`animated-vector` dans `drawable-v31/`, sous le même nom.
- **`--` casse AAPT** dans un commentaire XML. Citer un jeton CSS suffit, et le
  message d'erreur nomme la copie de `android/`, que personne n'édite.

## Deux choses que la plateforme impose

**FTS5 existe ici.** Le greffon embarque SQLCipher, pas le SQLite d'Android :
`catalog_fts` et `pages_fts` sont interrogeables, là où `sql.js` sur le bureau ne
sait pas les lire et retombe sur `LIKE`. Les deux ne comptent pas pareil — voir
la table de comparaison dans
[`docs/spikes/capacitor-mesures.md`](../../docs/spikes/capacitor-mesures.md).

**zstd est embarqué, pas résolu.** `fzstd` livre un ESM d'un seul tenant sans
import interne ; `prepare-www.mjs` le recopie dans `www/js/vendor/`. C'est le
pendant navigateur du `zlib.createZstdDecompress` que le processus principal
obtient de Node, et ce qui évite un module natif.

## CSP : une seule directive ajoutée

```
connect-src 'self' https://beytelhima-library.s3.eu-west-1.amazonaws.com
            https://fonts.googleapis.com https://fonts.gstatic.com;
```

`default-src 'none'` couvre `connect-src` : sans elle, aucun `fetch` ne part.
`script-src`, `style-src` et `img-src` **ne bougent pas**.

`font-src` n'a besoin d'aucun mot de plus : `convertFileSrc` rend
`https://localhost/_capacitor_file_/…`, la même origine que le document, donc
`'self'` couvre déjà les polices déposées. Seul `userfont:` est retiré — ce
protocole n'existe que dans Electron.

## La sonde

`src/probe.js` affiche les temps relevés sur l'appareil. C'est un **instrument**,
pas une fonctionnalité : `npm run android:release` passe `--sans-sonde`, et `www/`
étant refait à chaque exécution, ne pas la copier suffit — aucun reste d'un
passage précédent ne survit.

## Ce qui reste à faire

- **Le CSP est figé au chargement du document.** Changer `distribution.base_url`
  vers un autre hôte depuis les réglages **ne marchera pas**. Il faudra soit
  énumérer les hôtes permis, soit passer les téléchargements côté natif, où le CSP
  de la page ne s'applique pas.
- **Aligner les deux recherches.** `searchLibrary` (FTS5 ici) et `searchInBook`
  (phrase exacte) ne comptent pas pareil : un livre annoncé à 38 occurrences peut
  n'en montrer que 13 une fois ouvert.
- **L'accueil met 1,9 s à froid.** Lent, pas cassé — le premier écran à optimiser.
- **`android/` est engendré** par `npx cap add android` et ignoré par git. Toute
  recette qui doit survivre à une régénération vit dans `scripts/`, pas dans
  `app/build.gradle` — c'est la raison d'être de `release-android.mjs`.
- **La clé de signature est celle de débogage d'Android.** Elle signe déjà
  l'installation présente sur l'appareil ; changer de signataire obligerait à
  désinstaller, donc à effacer les livres téléchargés et les annotations. Pour une
  publication, `--ks` accepte n'importe quelle autre clé.

Les mesures d'appareil, la démonstration de FTS5 et les trois pièges rencontrés
pendant le portage sont dans
[`docs/spikes/capacitor-mesures.md`](../../docs/spikes/capacitor-mesures.md).
