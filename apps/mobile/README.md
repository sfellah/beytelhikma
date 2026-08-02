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
