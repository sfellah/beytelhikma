# CLAUDE.md

Guidance pour Claude Code sur ce projet.

## Projet

**Beyt El Hikma** — bibliothèque numérique et lecteur de livres, en arabe (RTL) et en anglais (LTR). Deux applications, un seul rendu :

| Dossier | Ce que c'est |
| --- | --- |
| `apps/desktop/` | l'application Electron — processus principal, préchargement, rendu. Voir son `README.md`. |
| `apps/mobile/` | l'application Android (Capacitor) — **le même rendu**, régénéré depuis `apps/desktop/src/renderer/` par `prepare-www.mjs`, sur SQLite natif. Un seul fichier diffère : celui qui touche le pont. |
| `site/` | le site de téléchargement, généré sans dépendance. |
| `tools/` | la chaîne de données Python. |
| `docs/` | modèle de données, système visuel, maquettes, specs, spikes. |

Ce qui est **différé et daté** vit dans `docs/TODO.md` : chaque entrée dit à quel déclencheur s'y mettre. Une dette qu'on ne date pas se relit tous les six mois sans jamais se payer.

Un client Flutter a existé (`beytelhikma/`, retiré de l'arbre) ; le portage Electron est devenu l'implémentation unique, et le mobile en dérive au lieu de le dupliquer.

## Commandes

```bash
# application de bureau (depuis apps/desktop/)
npm install           # dépendances
npm start             # lancer l'app
npm test              # suite de tests (node --test)
npm run seed          # récupère la graine de catalogue depuis le bucket
npm run release:win   # tests + graine + installeur NSIS et portable

# application Android (depuis apps/mobile/)
npm run verify        # parité des 69 méthodes du pont + écran de démarrage, hors appareil
npm run prepare:android  # pose l'écran de démarrage dans le projet natif engendré
npm run seed          # graine de catalogue -> data/, embarquée dans l'APK par prepare-www
npm run data          # bucket -> .sqlite -> adb push (~30 Mo)
npm run android       # prepare:www + cap sync + build + lancement
npm run android:release  # graine + sans la sonde, aligné et signé

python tools/gen_sample_data.py   # (depuis la racine) régénère les bases d'exemple -> apps/desktop/assets/sample/
python tools/gen_brand_assets.py  # (depuis la racine) régénère les assets de marque depuis logo.png et icon.svg

# import du corpus Shamela 4 (depuis la racine)
python tools/import_shamela.py                    # 3 livres par catégorie -> dist/shamela/
python tools/import_shamela.py --all --jobs 8     # les 8 589 livres (~60 Go)
python tools/import_shamela.py --dry-run          # afficher la sélection
cd tools && python -m unittest discover -s shamela/tests -t .   # tests de l'importeur

# chaîne bibliothèque : importe, publie, vérifie, nettoie (depuis la racine)
python tools/release_library.py --dry-run     # dit ce qui serait publié
python tools/release_library.py               # 10 livres/catégorie, par tranches de 100
python tools/release_library.py --all         # les 8 589 livres, ~40 min
python tools/release_library.py --skip-import # republier sans réimporter
python tools/release_library.py --all --batch-size 0   # d'un seul tenant : ~55 Go de disque

# publication des livres vers S3 — MinIO ou AWS (depuis la racine)
export MINIO_ACCESS_KEY=… MINIO_SECRET_KEY=…          # ou AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
python tools/publish_minio.py --bucket beytelhikma --set-anonymous-policy   # une seule fois
python tools/publish_minio.py --bucket beytelhikma --dry-run
python tools/publish_minio.py --bucket beytelhikma

# AWS S3 : `--endpoint aws` (ou vide) au lieu de l'URL MinIO ; région dans AWS_REGION
python tools/publish_minio.py --endpoint aws --region eu-west-1 --bucket <bucket> --set-anonymous-policy

# publier le catalogue seul (rapide : ne recompresse pas les livres)
python tools/publish_minio.py --endpoint aws --bucket <bucket> --catalog-only

# journaliser les accès vers un second bucket, privé (une seule fois)
python tools/publish_minio.py --endpoint aws --bucket beytelhima-library \
    --access-logs beytelhima-library-logs --set-anonymous-policy

# les indicateurs (depuis la racine) — voir docs/KPI.md
python tools/stats.py releases            # téléchargements, API GitHub
python tools/stats.py bucket --days 30    # usage réel, journaux du bucket
```

## Architecture (règles à respecter)

**Local-first, pas d'API.** La source de vérité est SQLite, conformément à `docs/DATAMODEL.md` :

| Base                       | Rôle                                      | Accès          |
| -------------------------- | ----------------------------------------- | -------------- |
| `catalog.sqlite`           | catalogue (œuvres, éditions, auteurs)     | lecture seule  |
| `books/<edition_id>.sqlite` | contenu d'un livre (pages, volumes, toc)  | lecture seule  |
| `user.sqlite`              | bibliothèque, progression, réglages       | lecture/écriture |

**Structure du code Electron** (`apps/desktop/src/`) :

- `main/` — processus principal : `app-database.js` (ouverture des trois bases, sql.js), `book-repository.js` (toutes les lectures/écritures exposées au rendu), `download-manager.js`, `catalog-updater.js`, `main.js` (fenêtre + IPC).
- `preload/preload.cjs` — pont IPC, liste blanche `METHODS`.
- `renderer/` — UI (vues dans `js/views/`, composants, `styles/tokens.css`).
- `shared/` — modules purs utilisés des deux côtés : `arabic.js`, `book-cover.js`, `distribution.js`, `theme.js`. Certains sont des miroirs de `tools/` (voir plus bas) : ne jamais les dupliquer ailleurs.

**Le catalogue est local, les livres se téléchargent.** `catalog.sqlite` est copié depuis la bibliothèque source au premier accès : l'exploration marche donc hors ligne. Les fichiers de livres, eux, ne sont plus copiés automatiquement — `AppDatabase.book()` exige un fichier installé et lève `BookNotInstalledError` sinon. C'est `src/main/download-manager.js` qui les installe depuis le bucket : `GET` HTTP anonyme reprenable par en-tête `Range`, décompression zstd en flux, SHA-256 vérifié, `rename` atomique. Voir `docs/superpowers/specs/2026-07-31-minio-book-lifecycle-design.md`.

**Le catalogue ne porte aucun hôte.** `book_releases.object_key` (schéma **2**, ex-`download_url`) contient une clé relative — `books/<edition_id>/<content_version>/book.sqlite.zst` — que le client colle derrière le réglage `distribution.base_url`. La règle tient en une ligne : **la présence de `://` marque un absolu**. C'est elle qui garde `asset://` (dans `assets/sample`) et `local://` (dans `dist/shamela`) utilisables hors ligne, et qui fait qu'un catalogue publié à l'ancienne, avec des URL complètes, continue de fonctionner.

La résolution vit dans `src/shared/distribution.js`, et nulle part ailleurs. Le réglage précédent, `minio.base_url`, ne remplaçait que l'origine en gardant le chemin stocké : il cassait entre un bucket virtual-hosted (`/books/…`) et un path-style (`/bucket/books/…`), précisément le cas qu'il prétendait couvrir.

`tools/publish_minio.py` est le **seul** composant à connaître la disposition du bucket. Il construit les clés, les écrit dans le catalogue, puis publie `catalog/<catalog_version>/catalog.sqlite.zst` et un pointeur `catalog/latest.json`. Changer la hiérarchie plus tard ne casse donc aucune application déjà installée.

**Le bucket de distribution : public par politique, jamais par ACL.** `configure_bucket` pose la configuration complète en une fois — ACL désactivées (`BucketOwnerEnforced`), blocage d'accès public levé pour les *politiques* seulement (`BlockPublicAcls` et `IgnorePublicAcls` restent vrais), `s3:GetObject` sur `books/*` et `catalog/*` **et rien d'autre**, chiffrement SSE-S3, CORS `GET`/`HEAD` exposant `Content-Range` et `Accept-Ranges`, purge des multipart abandonnés à 7 jours. Ouvrir le bucket entier autoriserait le listing anonyme, qui doit répondre 403.

Les objets partent en `Cache-Control: public, max-age=31536000, immutable` : la version étant dans le chemin, aucune clé ne change jamais de contenu. **Sauf le pointeur, qui part en `no-cache`** — c'est le seul objet du bucket qui change sous une clé fixe, et le mettre en cache un an tuerait la mise à jour en silence : tout marcherait le premier jour, plus rien ensuite. `test_le_pointeur_n_est_jamais_mis_en_cache` existe pour ça. Un réglage que le serveur n'implémente pas (MinIO ne couvre pas toute l'API S3) est signalé et sauté, sans empêcher la politique de lecture publique d'être posée.

**La mise à jour du catalogue se propose, ne s'impose pas.** `src/main/catalog-updater.js` lit le pointeur et compare. Cinq branches de décision sur six sont **silencieuses** : hors ligne, pointeur illisible, `schema_version` trop récent, déjà à jour, version refusée. Une application hors ligne a déjà tout ce qu'il lui faut pour explorer — lui afficher une alerte serait du bruit. `fetchPointer` ne lève donc jamais : il rend `null`, et `decideUpdate` en tire une décision. Toute branche silencieuse rend `pointer: null`, pour qu'aucun appelant ne puisse installer ce qu'on vient de refuser. Un refus est retenu **par version** (`distribution.declined_catalog_version`) : refuser la 2 ne fait pas taire la 3.

L'installation vérifie le SHA-256 **avant** le `rename`, qui est le dernier geste : une coupure à n'importe quel point laisse l'ancien catalogue intact et lisible.

L'empreinte est **exigée**, pas seulement comparée quand elle est là. `if (pointer.sha256 && …)` laissait installer sans contrôle tout pointeur qui n'en portait pas — or c'est le catalogue qui devient ensuite la source de vérité. Le refus est prononcé deux fois : `decideUpdate` ne propose même pas, et `installCatalog` s'arrête **avant** la requête, pour ne pas tirer quarante mégaoctets qu'on refusera.

**Un refus tait une proposition, jamais une question posée.** `checkCatalogUpdate({ ignoreDeclined: true })` est ce que passe le bouton de `/settings`, et `installCatalogUpdate` avec lui — le clic *est* l'acceptation. Sans cette option, l'écran répondait « catalogue à jour » sur une version explicitement refusée, et plus rien ne permettait de l'installer.

**Le verdict porte sa raison, et les raisons ne se valent pas.** Un `if (action !== 'offer')` nu annonçait « à jour » à une application hors ligne — c'est-à-dire une vérification qui n'a jamais eu lieu. `VERDICT_MESSAGES` (dans `views/settings.js`) distingue `upToDate` de `noPointer`, `malformed` et `schemaTooNew`. Le silence reste la règle pour une vérification *automatique* ; il ne l'est plus pour une question posée à la main.

**La proposition est câblée au démarrage, dans le rendu partagé.** `src/renderer/js/catalog-update.js` appelle `checkCatalogUpdate()` après le premier rendu — jamais avant, son échec se tait, et **sans** `ignoreDeclined` : une vérification automatique respecte un refus passé. Seule une offre réelle s'affiche, en bande écartable (`.update-banner`, jamais une boîte modale) ; l'écarter appelle `declineCatalogUpdate(version)` — le refus par version a son appelant — et accepter passe par `installCatalogUpdate` puis `remount()`, parce que les écrans lisent le catalogue au montage. Le mobile régénère ce rendu : les deux applications ont la même bannière, le shim portant les trois méthodes contre SQLite natif. `test/catalog-update-startup.test.js` tient chacune de ces règles.

**La bibliothèque source se cherche en remontant, elle ne se compte pas en `..`.** `resolveLibrarySource` essaie `dist/shamela` sur quatre ancêtres. Le chemin écrit en dur a désigné `apps/dist/shamela` le jour où l'application est passée de `beytelhikma-electron/` à `apps/desktop/` — et rien n'a cassé : on retombe sur les cinq livres d'exemple, en croyant lire le corpus.

**Le routeur démonte avant de monter, et une vue dépassée ne s'inscrit jamais.** `resolve()` est `async` : deux navigations rapprochées se chevauchent, et la seconde passait son `dispose` sur un `current` encore nul. La première vue n'était alors jamais démontée — le lecteur, qui écoute les flèches et `Ctrl+F` sur `document`, continuait de les avaler sur l'écran suivant. Un numéro de génération tranche : la vue qui arrive en retard est démontée au lieu d'être inscrite. Symétriquement, `Reader.start()` relit `#disposed` après chaque attente, sinon elle posait ses écouteurs après coup. `test/router.test.js` tient la règle avec trois vues bouchonnées.

**La publication se fait par tranches, et le manifeste est ce qui survit.** `release_library.py --batch-size N` (100 par défaut) importe une tranche, la monte, efface ses `.sqlite` et `.sqlite.zst`, puis recommence : le corpus complet pèse ~55 Go convertis, le pic disque tombe à ~1,3 Go. Trois règles le rendent possible :

- `publish_minio` écrit `object_key` **dans le manifeste avant de l'envoyer**. Le compléter après ferait diverger la copie locale de celle du bucket, et le passage suivant renverrait les 8 589 manifestes pour cette seule différence — `test_second_passage_ne_reenvoie_rien` le tient.
- La reprise de l'importeur n'exige plus le `.sqlite`, seulement le manifeste. `build_catalog` réécrit le catalogue à partir des seuls livres retrouvés : exiger le fichier faisait qu'effacer une tranche publiée la dépubliait au tour suivant. Un livre dont le fichier a disparu mais dont le manifeste porte la clé est compté `already`, jamais `missing`, et sa clé repart au catalogue.
- Les tranches sont distribuées **en escalier** (`[i::n]` après tri décroissant), pas découpées dans la liste triée : en tronçons, la première aurait avalé les cent plus gros livres, 4,5 Go de source d'un coup. Le pic doit être la moyenne.

Le catalogue et le pointeur ne partent **pas** d'une tranche — `build_catalog` ne connaît que la tranche courante, et publier ce catalogue-là annoncerait cent livres. Ils partent à la fin, une fois le catalogue complet reconstruit depuis les manifestes.

L'importeur rend **1 dès qu'un livre est sauté** et 2 pour une erreur bloquante ; `lance()` tolère le 1. Sur le corpus réel, quelques sources sont défectueuses — un sommaire qui pointe une page absente — et les écarter est le contrat de l'importeur, pas un échec. Les tranches concernées sont listées en fin de course.

Le nettoyage attrape aussi `-journal`, `-wal`, `-shm`, `.part` et `.tmp` : ces restes d'imports interrompus commencent par un identifiant d'édition valide et échappaient donc à la règle « fichier hors catalogue ».

**Une mise à jour de catalogue ne supprime jamais un fichier de livre.** `#syncInstalledLibrary` purgeait `books/` dès que la source changeait ; avec un catalogue qui se met à jour seul, ce serait tout retélécharger. La réconciliation se fait par édition, à la lecture : `downloaded_books.release_id` comparé au `release_id` actif donne `hasNewerRelease`. Une édition disparue du catalogue n'est pas dessinable (ni titre ni auteur) mais son fichier reste ; `getLibrary` en rend le compte dans `orphans` plutôt que de la faire disparaître en silence. Les ancres de surlignage sont posées sur le texte rendu : une réédition peut les déplacer, ce doit donc rester un choix de l'utilisateur.

Voir `docs/superpowers/specs/2026-07-31-source-distribution-configurable-design.md`.

**Le jeu d'exemple** (5 livres, 3 à 5 pages) vit dans `apps/desktop/assets/sample` et est produit par `tools/gen_sample_data.py` : ne jamais l'éditer à la main, modifier le générateur. `MIRROR_DIRS` (vide aujourd'hui) reste dans le générateur : quand une seconde copie existait, la recopie manuelle avait dérivé et la suite de tests échouait loin de sa cause.

**Le DDL vit dans `tools/_common.py`** (`BOOK_SCHEMA`, `CATALOG_SCHEMA`), importé à la fois par `gen_sample_data.py` et par l'importeur Shamela : une seule source de vérité, donc aucune dérive possible entre les données d'exemple et les données réelles. `tools/shamela/tests/test_pipeline.py::SchemaParityTest` échoue si ce n'est plus le cas.

`tools/import_shamela.py` transforme le corpus Shamela 4 (`C:\shamela-data`, 8 589 livres) vers `dist/shamela/` (non versionné), au même schéma. L'app le consomme via `new AppDatabase({ librarySource: '.../dist/shamela' })`. Voir `tools/notebooks/01_un_livre_vers_sqlite.ipynb` pour la transformation d'un livre commentée étape par étape.

**Ce qui vient du rendu ne touche pas le disque sans être validé.** Trois règles, chacune dans un module unique et testée :

- **`edition_id`** (`src/main/edition-id.js`) — il arrive du rendu, donc d'un fragment d'URL, et il désigne un **nom de fichier**. `assertEditionId` est appelée à chaque frontière avec le disque : `AppDatabase.book()`, `deleteBook` (trois `rmSync … force: true` à la suite), `getStorageUsage`, `DownloadQueue.enqueue`. Le point est exclu du motif, parce que l'admettre laisserait passer `..`.
- **`distribution.base_url`** (`assertBaseUrl` de `src/shared/distribution.js`) — ce réglage décide d'où viennent le catalogue **et** tous les livres. `https` exigé, sauf vers la boucle locale, qui est le MinIO de développement. Le champ des réglages n'est pas dans un `<form>` : son `type="url"` ne valide rien.
- **La fenêtre ne quitte jamais sa page** (`src/main/navigation.js`) — le preload s'attache à *toute* navigation du `webContents` : une page distante hériterait du pont vers les trois bases. `will-navigate` compare le document (fragment et requête ignorés, c'est par eux que le routeur travaille), `will-attach-webview` refuse tout, et le lien externe compare le **protocole** — `startsWith('http')` acceptait aussi `httpfoo://`, que `openExternal` aurait passé au gestionnaire de protocole du système.

La CSP porte `font-src 'self' userfont:`. Sans ce mot, `font-installer.js` écrivait des règles que le navigateur refusait en silence : toute la fonctionnalité était morte sans qu'aucun test ne le dise. `test/navigation.test.js` la relit et vérifie que `userfont:` n'apparaît dans aucune autre directive.

`user.sqlite` s'écrit **de côté puis se renomme**, comme le catalogue : c'est la seule base qu'on ne puisse pas retélécharger, et un téléchargement en cours la réécrit toutes les 500 ms.

**Séparation stricte** : l'UI (renderer) ne touche jamais une base — toute donnée passe par le pont IPC vers `BookRepository`, et les erreurs remontent typées (`RepositoryError`, `BookNotInstalledError`, `DownloadError`). Chaque vue gère explicitement 4 états : `loading / success / empty / error`.

## Écrans

Accueil, bibliothèque, fiche livre, lecteur, auteurs, **exploration** (`/explore`), **téléchargements** (`/downloads`, file + table paginée de tout le catalogue avec taille, pages, statut, suppression par lot), **collections** (`/collection/:id`), **recherche générale** (`/search`), **mes notes** (`/notes`), **réglages** (`/settings`).

**La recherche générale montre cinq sections, en deux vagues.** Auteurs, cursus et livres viennent du catalogue ; passages et notes viennent du texte des livres installés. Les trois premières requêtes reviennent en quelques millisecondes, le balayage plein texte ouvre chaque livre l'un après l'autre : les attendre ensemble laisserait l'écran vide pour des réponses déjà prêtes. Deux vagues, un seul `#token`, et **un état vide par vague** — « rien dans le catalogue » et « rien dans vos livres installés » sont deux réponses différentes qu'un état vide unique confondrait.

Les cursus s'y filtrent **côté vue** : leurs noms vivent dans `locales/*.js`, le processus principal ne les a pas. La comparaison passe par `normalizeArabic`, la même normalisation que les colonnes du catalogue.

Dans la barre haute, `Entrée` mène à `/search` et `Ctrl+Entrée` à `/explore` : le défaut ne peut pas être l'écran de facettes quand l'écran général existe.

**`Ctrl+F` se dispute par convention, pas par liste d'écrans.** La coquille l'écoute sur `window` pour viser le champ de la barre haute, le lecteur sur `document` pour chercher dans le livre ouvert ; `document` bulle avant `window`, donc le premier à répondre appelle `preventDefault()` et le second sort sur `defaultPrevented`. Une liste d'écrans exemptés devrait être tenue à jour au prochain écran — pas la convention. `test/shortcuts.test.js` la tient aux deux bouts.

Maquettes HTML de référence dans `docs/maquettes/` (`home.html`, `mylibrary.html`, `book-info.html`, `reader.html`) — s'en inspirer pour le design.

**Annotations.** `user.sqlite` porte les trois tables de `docs/DATAMODEL.md` — `bookmarks`, `highlights`, `notes` — depuis la version de schéma **2**. La migration est additive et rejouée à l'ouverture (`AppDatabase.#migrateUser`) : tout client qui partagerait une racine de bibliothèque doit lire le même `user_version`. Un surlignage s'ancre sur des décalages du texte rendu **et** sur le passage avec son contexte : les décalages seuls ne survivraient pas à une réédition (voir `src/renderer/js/annotations.js`).

Les quatre teintes de surlignage sortent des jetons du projet (`HIGHLIGHTS` dans `views/reader.js`) et se posent à opacité variable selon l'ambiance (`--highlight-strength`, déclarée dans `tokens.css` et abaissée par le thème nuit) : une pastille claire sur fond de nuit mangerait l'encre. Le fond de recherche porte la classe `reader__match` et **jamais** le sélecteur `.reader__page mark` — celui-ci l'emportait par spécificité sur `.reader__highlight` et repeignait en jaune toutes les couleurs choisies.

**Deux façons de lire, et le fil est le défaut.** `page` — **horizontal** : une page par écran, et l'on tourne au clic, au clavier ou au doigt. `scroll` — **vertical** : les pages s'enchaînent dans une seule colonne, séparées par un filet, et l'on passe de l'une à l'autre **en défilant, et par ce geste seul** — sur le fil, les trois tiers et le glissement ne tournent plus rien. Les clés disent ce que le code fait, les libellés disent l'axe qu'on voit bouger. La liste vit dans `src/shared/reading-modes.js`, **seule** : deux écrans la montrent, le lecteur et `/settings`, et c'est la configuration qui avait produit la police orpheline et l'ambiance morte. Une annotation s'ancre toujours sur la page qui porte la sélection ; `page_id`, `saveProgress`, `?page=` et les sauts depuis le sommaire ou la recherche n'ont pas bougé.

**Le fil monte une fenêtre, jamais le livre entier.** `windowAround` rend les rangs à monter autour de celui qu'on lit, `outOfWindow` dit ce qu'on démonte. Les plus gros livres du corpus passent le millier de pages et les deux clients chargent une base de livre entièrement en mémoire : le livre entier monté d'un coup est précisément la version qui avait été mesurée puis abandonnée, la première fois. Trois règles tiennent le fil :

- Un bloc s'insère **avant** le premier rang supérieur, jamais en queue — ajouté à la fin, la page précédente s'afficherait sous la suivante. Et monter une page en amont **rend sa hauteur au défilement**, sinon le texte partirait sous les yeux du lecteur.
- La page courante se **déduit** de ce qu'on a sous les yeux (`#followScroll`), au tiers haut de la fenêtre et non au bord de l'écran, qui appartient encore à la page d'avant pendant tout un écran. Aucun remontage : confondre ce chemin avec `#show` ferait sauter la colonne à chaque pixel défilé.
- Tourner la page **n'y remonte rien** : la voisine est déjà là, on y va. La remonter perdrait ce qui est au-dessus, c'est-à-dire ce que le fil promet de garder.

L'ancre de reprise se compte alors **dans la page** et non dans la colonne : la colonne porte une fenêtre glissante, sa hauteur change à chaque montage, et une ancre posée dessus désignerait un autre endroit au tour suivant. L'animation de feuilletage, elle, ne joue que sur la feuille.

**Un gros livre le dit avant de faire attendre.** Mesuré sur l'appareil, sur un index de 124 569 pages : cent secondes entre la tape et la première ligne, le temps que ses ~96 000 entrées de sommaire traversent le pont natif. Rien n'est cassé, mais un écran qui tourne une minute et demie sans un mot se lit comme une panne. `shared/large-book.js` porte les deux seuils — mille pages **ou** cent mégaoctets décompressés, l'un suffit — et le lecteur pose une ligne discrète sous le rouet, **avant** les lectures qu'elle annonce. Une mesure absente ne vaut pas « petit » : `Number(null)` est zéro, et ce piège-là ferait taire l'avertissement précisément sur les livres dont le catalogue ignore la taille.

**Le sommaire arrive après la première page, et il ne retient plus rien.** Il était dans le `Promise.all` d'ouverture : les cent secondes se passaient donc **avant** la première ligne, devant un rouet, et le lecteur qui renonçait et faisait le geste retour n'avait encore rien à quitter — aucune couche posée, l'écran toujours celui du chargement, l'application pour bloquée. `#loadToc` est lancé et **jamais attendu**, une fois le livre lisible. Rien de ce qui s'affiche d'abord n'en a besoin : le titre du chapitre et ce qu'il reste avant sa fin se peignent dans `#paintChapter`, **seul** endroit qui les écrit, que `#refreshChapters` rejoue quand le sommaire arrive ; le panneau se remplit par `tocReady`. Trois réponses et non deux dans ce panneau — « rien qui corresponde », « pas de sommaire », « il arrive » : sans la troisième, un livre dont le sommaire est en route s'annonce comme un livre qui n'en a pas. Et `#disposed` est relu **après** l'attente, comme partout ici : un sommaire qui arrive après le départ du lecteur ne touche rien.

**Le ruban reste en bas, toujours**, avec ses deux chevrons, sa fraction et sa jauge. Un réglage l'a dressé contre le bord un temps — `reader.pager`, « أفقي / عمودي » — et il s'est retrouvé à une ligne des mots de la façon de lire dans `/settings` : on croyait choisir sa lecture et l'on déplaçait la barre. Le réglage a disparu, son module, ses icônes et son bloc CSS avec. `test/reader-shell.test.js` tient les deux bouts — le fil existe, la pagination reste entière dessous, et rien ne déplace plus le ruban.

**Le rail possède son geste.** `touch-action: none` sur `.reader__rail`, et ce n'est pas une précaution : mesuré sur l'appareil, le navigateur revendique la glissade horizontale pour un défilement, annule le pointeur, et `change` n'arrive **jamais** — la jauge suivait le doigt, la pastille annonçait la destination, et le livre ne bougeait pas d'une page. Le défaut n'existait pas tant qu'`input` tournait la page à chaque cran : c'est en cessant de le faire, pour ne plus charger vingt pages par glissade, qu'on est devenu dépendant du relâchement. Même médecine que `pan-y` sur `.reader__scroll`, et elle ne se voit qu'au doigt sur du verre.

Ce qui **reste** malgré tout : le défilement **dans** une page — une feuille imprimée dépasse souvent la hauteur de l'écran — et le masquage des barres qui l'accompagne. `#onScroll` a été allégé, pas jeté.

**Tourner la page : trois zones et un glissement, tous deux logiques.** Le tiers de la colonne où la ligne **commence** ramène en arrière, celui où elle **finit** avance, le tiers du milieu garde son geste (escamoter les barres, ou refermer un panneau ouvert). Au doigt, on chasse la page dans le sens où le texte s'écoule : vers la gauche en anglais, vers la droite en arabe.

Les deux règles sont des **fonctions pures** dans `src/shared/page-turn.js` — `turnZone(fraction, rtl)` et `swipeTurn(dx, dy, rtl)` — et nulle part ailleurs. C'est la seule façon de les éprouver dans les **deux** directions sans un DOM : enfermées dans un gestionnaire d'évènements, un `left` écrit en dur aurait passé la moitié des cas, comme les flèches figées d'avant. Le lecteur ne fait que leur donner une mesure physique et leur demander le sens.

Quatre refus avant qu'un geste tourne quoi que ce soit, chacun tenu par un test :

- Ce qui a déjà son geste — bouton, lien, `mark` de surlignage (qui ouvre sa note), feuille des couleurs.
- **Le clic résiduel d'un glissement.** Un glissement au doigt laisse souvent un `click` derrière lui : sans `#swiped`, la page tournerait deux fois pour un seul geste.
- **Une tape qui vient de défaire une sélection.** L'état se relève au `pointerdown`, seul moment où la sélection est encore lisible — le navigateur la défait entre `mousedown` et `mouseup`, c'est mesuré plus bas. Une garde posée au `click` lirait toujours du vide.
- **Un panneau ouvert** se referme, où qu'on touche, et s'arrête là.

Le glissement, lui, est **au doigt et au stylet seulement** (`pointerType !== 'mouse'`) : à la souris un déplacement horizontal sur du texte *est* une sélection, et y tourner la page rendrait le texte insélectionnable — la souris a déjà les trois zones, les deux chevrons et les flèches. Il est abandonné s'il naît sur une sélection vivante (les poignées natives avalent les évènements tactiles, mesuré dans `docs/spikes/react-native-contre-webview.md`) et s'il est plus vertical qu'horizontal : c'est alors un défilement dans la page. `pointer*` et non `touch*` — le même rendu tourne sous Capacitor.

**`.reader__scroll` porte `touch-action: pan-y`, et ce n'est pas un détail.** Sans elle, sur un vrai doigt, le glissement ne tournait aucune page — pas même de travers. La colonne défile verticalement (une feuille imprimée dépasse souvent l'écran) et le doigt veut tourner la page horizontalement : deux gestes sur une seule surface, que le navigateur arbitre lui-même. `touch-action: auto` le laisse trancher en sa faveur — il revendique le geste pour un défilement dès le seuil de tolérance franchi, **quelle que soit sa direction**, et annule le pointeur (`pointercancel`) avant que `#onPointerUp`, seul endroit où `swipeTurn` est consulté, n'ait pu tourner. La colonne n'ayant pas de largeur en trop, rien ne défile pour autant. Aucun test de geste ne l'avait vue : à la souris le chemin est mort, et c'est le doigt sur du verre qui déclenche l'arbitrage. `pan-y` ne concède que l'axe dont la page a besoin. C'est la **seule** façon de refuser l'autre : `preventDefault()` sur un évènement de pointeur n'annule pas un défilement, et un `touchmove` non passif trancherait l'axe au même instant, sur les mêmes pixels — il n'y a pas de seconde couche à ajouter.

**Le pincement agrandit le texte, pas la page.** `pan-y` interdit au navigateur de zoomer lui-même : le geste reste donc au lecteur, qui **recompose** le texte — les lignes se replient, la colonne ne déborde jamais de l'écran, et le réglage qu'on voit bouger sous les doigts est celui de `/settings`. Trois règles, chacune tenue par un test :

- Le geste se mesure en **rapport** d'écartements et contre la taille de **départ**, jamais contre le pas précédent : cumuler les pas ferait dériver la lettre sans qu'aucun doigt ne bouge, chaque arrondi s'ajoutant au suivant. `pinchSize` est pure, dans `src/shared/reader-size.js`, qui porte aussi les bornes — elles vivaient en double, une copie par écran, avec la taille de départ écrite en clair à trois endroits.
- La taille se **pose** sans s'écrire (`#applySize`), et s'écrit une seule fois quand les doigts se lèvent (`#endPinch`) : un pincement en produit une par image, et `user.sqlite` est le seul fichier qu'on ne puisse pas retélécharger.
- Un doigt levé **hors** de la colonne n'y laisse pas de `pointerup`. Le premier doigt du geste suivant (`isPrimary`) est le seul instant sûr pour oublier les traînards et écrire ce que le pincement précédent avait posé — sans quoi deux gestes de suite en feraient un troisième, fantôme.

**Les côtés qui tournent la page s'éteignent** (`reader.tapZones`, dans `/settings`). C'est le seul geste du lecteur qu'on déclenche sans le vouloir : la main qui tient l'appareil touche le bord. Le refus est posé **dans** `#zoneOf` et non dans le clic — les trois tiers redeviennent un seul, et toucher le bord escamote les barres au lieu de ne rien faire du tout ; une zone morte se touche deux fois avant qu'on la croie voulue, comme un bouton grisé. Le glissement, les deux chevrons et les flèches tournent toujours. La liste vit dans `shared/page-turn.js`, avec la règle qu'elle éteint.

**Le ruban de pagination est en pied d'écran, et il y reste.** Il a su se dresser contre le bord — 44 px de large, chevrons empilés, fraction verticale — et c'était une belle mécanique : `writing-mode` pour le rail, `direction: ltr` pour que la page 1 se lise en haut dans les deux langues, `min-height: 0` sans quoi un `input` dressé dépassait l'écran par les deux bouts. Elle a été retirée pour une raison qui n'est pas technique : son réglage disait « أفقي / عمودي » à une ligne de la façon de lire, qui dit la même chose d'autre chose. Le commit vit dans l'historique.

```
mousedown   sélection vide = false   « ومعاني القرآ »
mouseup     sélection vide = true    « »
click       sélection vide = true    « »
```

Deux conséquences, chacune un défaut vécu :

- `selectionchange` est le **seul** évènement qui arrive pendant qu'une sélection existe. `mouseup` est de l'ère souris : il convient au cliquer-glisser, où la sélection survit au relâchement, et pas au doigt, où l'appui long est piloté par la couche native du WebView. Le spike mobile l'avait mesuré au premier jour ; tant que la correction n'a pas été reportée dans le lecteur, la feuille des couleurs ne s'ouvrait pas au doigt. Antirebond de 250 ms, sinon elle saute à chaque caractère.
- Une garde posée au `click` (`if (!selection.isCollapsed) return`) ne peut **jamais** protéger la tape qui vient de défaire une sélection : elle lit toujours du vide. L'état se relève donc au `pointerdown`, seul moment où il est encore vrai, et une tape qui défait une sélection ne fait que cela — elle ne rappelle pas les barres. Sans quoi la moindre touche sur le texte fait ressortir les outils, et l'on ne peut plus rien sélectionner du tout.

**Un voile posé sur le texte ne doit pas capter le doigt.** Le ruban dressé couvrait le bord où *commence* chaque ligne en RTL : il avalait le geste qui aurait démarré une sélection. La règle survit à son cas — `pointer-events: none` sur un voile, `auto` sur les seuls objets qu'on manœuvre — et vaut pour les pastilles du fil, posées elles aussi sur la page.

**Un clic sur le texte referme le panneau ouvert**, et s'arrête là : la croix est à l'autre bout de l'écran, revenir au livre est de toute façon le geste suivant, et escamoter les barres dans la foulée ferait deux choses pour un seul geste.

**Le geste retour d'Android ferme une couche à la fois, et c'est la cascade d'`Escape`.** Sans écouteur, il retombe sur le défaut de la WebView — `history.back()` — et emporte l'écran entier alors qu'un panneau est ouvert par-dessus : on ouvre le sommaire, on fait le geste pour le refermer, on se retrouve sur la fiche du livre. La cascade vit dans `#closeTopLayer` **seule** — note, sélection, panneau, plein écran — et `Escape` comme le geste y passent ; elle ne quitte jamais le livre, `back()` reste le seul propriétaire de la sortie. Le rendu ne connaît que `js/back-intent.js`, une pile de gestionnaires ; le mobile émet `beyt:back` sur `document` depuis `repo/retour.js`, et lit le refus dans ce que rend `dispatchEvent` — la convention de `Ctrl+F`. Aucun côté n'importe l'autre : `repo/` et le rendu vivent dans deux arbres, et aucun chemin relatif n'est juste dans les deux. `npm run verify` tient la parité du littéral.

**La progression retient la page ; l'ancre retient l'endroit.** Une page du corpus fait trois à six écrans sur un téléphone, et rouvrir un livre renvoyait en haut de sa page. `shared/reader-anchors.js` porte la carte — un **rapport**, jamais un pixel, la taille de la lettre se règle — bornée à 50 livres, le dernier touché en queue. Elle vit dans les **réglages** et non dans le schéma : `settings()` traverse déjà le pont des deux côtés, quand une colonne de plus ferait passer `user.sqlite` en version 4, numéro écrit en dur dans les deux clients. Elle se rend après une image (la hauteur du bloc n'existe pas au montage) et **seulement à une reprise** : un saut ouvre en haut, on y va pour voir un endroit précis, pas pour retrouver le sien.

**La jauge ne tourne les pages qu'au relâchement.** `oninput` montait une page par cran : sur mille pages, une glissade au pouce, ce sont des dizaines de `getPages` — chacun un aller-retour du pont natif — pour un seul écran regardé. `input` annonce la destination (rang et chapitre, par `#chapterEntry` sur `pageSequenceNum` : la page n'est pas chargée), `change` s'y rend. Et `#show` porte un **jeton de génération**, comme `router.js` : deux montées qui se chevauchaient se posaient dans le désordre.

**Un saut retient d'où il part.** Sommaire, recherche, annotation : sans mémoire, ouvrir un chapitre pour vérifier une référence perdait la lecture en cours, et le seul recours était la jauge. Une pastille « revenir à ص N » ramène à l'endroit exact. Une seule mémoire, jamais une pile : après deux sauts, ce qu'on veut retrouver est le dernier endroit **lu**, pas le premier chapitre traversé. Un résultat de recherche amène en outre son occurrence à l'écran, et les deux chevrons parcourent celles de la page — peintes depuis toujours, elles étaient simplement inatteignables trois écrans plus bas.

**Les appels de note se touchent, et il y a deux formes.** Le jeu d'exemple porte `<sup class="fn">` ; le corpus Shamela **non** — `tools/shamela/text.py` ne garde que `br`, `hr`, les images et les titres, et l'appel y est du texte nu, « (١) » au fil du paragraphe. Ne traiter que la première forme donnerait une fonctionnalité qui marche sur cinq livres et sur rien d'autre. `shared/footnotes.js` découpe le bloc de notes et donne le motif ; la règle qui protège la page est qu'**on ne marque un nombre que si une note lui répond** — « (3) » est aussi bien un numéro de verset. Le texte n'est jamais réinterprété : on découpe les nœuds, comme le surlignage, et les décalages des annotations ne bougent pas.

**Le sommaire s'ouvre sur le chapitre qu'on lit.** Il montrait le début du livre, comme si l'on n'avait pas commencé. La tranche de 80 se centre sur l'entrée courante et deux boutons déplient de part et d'autre — au chapitre 400 sur 3 000, monter les 399 d'avant n'est pas une option. Un filtre en cours n'est pas recentré : c'est une question posée, la recentrer effacerait sa réponse.

**Ce qui se pose une fois se règle dans `/settings`, pas dans le panneau du lecteur.** Les trois réglages de ce panneau — taille, ambiance, face — se touchent *en lisant*. La façon de lire, elle, se pose une fois et vaut pour tous les livres : elle vit dans `/settings`, et la touche `V` la bascule pour qui a un clavier. La liste est dans `src/shared/reading-modes.js`, **seule** : deux écrans la montrent, et c'est exactement la configuration qui avait produit la police orpheline et le `sepia` mort.

Les outils de la barre haute s'accrochent par `data-tool` : les infobulles portent leur raccourci et changent, l'attribut est le contrat que `src/main/capture.js` et les tests suivent. Ils sont rangés en **trois groupes, dans l'ordre où l'on s'en sert** — se repérer (sommaire, recherche), laisser une trace (signet, notes), régler l'affichage (typographie) ; ils suivaient jusque-là l'ordre où ils avaient été écrits. Leurs tracés disent ce qu'ils font : `toc` (filets et puces) et non un livre ouvert pour le sommaire, `annotate` (feuille et crayon) et non une feuille cornée — qui disait « document » — pour les annotations.

**La fiche des raccourcis a quitté la barre**, elle aussi : elle y prenait une place de doigt pour une liste de touches que le tactile ne peut pas frapper. Elle se lit depuis `/settings`, où l'on va quand on veut apprendre l'outil, et la touche `؟` continue de l'ouvrir en lecture — qui a la touche a le clavier dont elle parle. La liste vit dans `components/shortcuts.js`, seule, et la campagne de captures frappe la touche au lieu de cliquer l'outil disparu.

**Le plein écran n'est pas offert au tactile.** `src/renderer/js/platform.js` en est le seul juge, et il ne regarde **pas** la largeur : une fenêtre de bureau réduite à 400 px garde son gestionnaire de fenêtres et sa touche F11, la rabattre au régime du téléphone lui retirerait une fonction qui marche. Le signal est `(hover: none) and (pointer: coarse)` — un doigt sur du verre, et il ne change pas quand on tourne l'appareil. Là où le plein écran n'ajoute rien, l'outil est **absent** et non grisé, la fiche « ؟ » n'annonce pas la touche, et `F11` n'est pas interceptée : un bouton qui ne fait rien est pire qu'un bouton manquant, parce qu'on l'essaie deux fois avant de conclure qu'il est cassé.

**Les barres ancrées à un bord écartent le retrait du système.** Android 15 impose le bord à bord : la fenêtre occupe tout l'écran et la barre d'état se pose par-dessus — 42 px mesurés sur un Xiaomi sous Android 16, 24 px sur l'émulateur. Sans retrait, la barre haute du lecteur passait sous l'heure et le réseau. Quatre jetons dans `tokens.css` (`--safe-top`, `--safe-bottom`, `--safe-left`, `--safe-right`) portent `env(safe-area-inset-*, 0px)` : la valeur est 0 partout ailleurs — bureau, tests — donc la règle est unique et n'a pas de variante à tenir. Les latéraux sont **physiques**, jamais logiques : une encoche ne change pas de côté quand l'interface bascule en RTL.

Le voile est **rembourré, jamais décalé**. Un `top` égal au retrait aurait laissé le texte défiler à découvert dans la bande du système, et `translateY(-100%)` porte de toute façon sur la boîte rembourrée. Les réserves de `.reader__scroll` suivent la hauteur des voiles, sinon la première ligne du livre se lit sous la barre d'état. `test/reader-shell.test.js` tient les deux bouts.

**Le thème est celui de l'application, pas celui du lecteur.** Les trois ambiances — `paper`, `white`, `night` — se posent sur `<html>` par `data-theme`, et `styles/tokens.css` en tire toute la palette : `:root[data-theme='night']` échange les rôles (`--primary` prend la teinte claire, sinon l'émeraude `#003527` disparaît sur graphite) et passe les ombres au noir. `paper` **n'a pas de bloc** — c'est le `:root` de base, le parchemin est le défaut et non un cas particulier.

La liste vit dans `src/shared/theme.js`, seule ; `src/renderer/js/theme.js` porte la peinture et la persistance, `components/theme-choices.js` le seul rendu des pastilles. Un thème choisi depuis le lecteur ou depuis `/settings` est le même. C'est de deux copies de la liste qu'était née la panne précédente : les réglages proposaient un `sepia` qu'aucune règle CSS ne lisait plus. `test/theme.test.js` interdit qu'une vue redéclare `THEMES`, vérifie que chaque clé a son bloc de jetons, et que les pastilles annoncent la vraie valeur de `--surface`.

Source de vérité : `app.theme` dans `user.sqlite`, avec repli une fois sur l'ancienne `reader.theme`. Un miroir `localStorage` est lu **en synchrone** au démarrage (`theme.js` est chargé avant `app.js`) : `user.sqlite` arrive par IPC après le premier rendu, et sans lui ouvrir l'application en nuit donnerait un éclair blanc. Le miroir n'est jamais interrogé comme vérité — `syncTheme()` réconcilie. Pas de script inline : le CSP est `script-src 'self'`.

Le lecteur ne porte plus d'ambiance : ses variables `--reader-*` dérivent des jetons et suivent seules. Seules `--highlight-strength`, `--quote-strength` et `--mark-strength` restent dictées par le thème, et la campagne de captures pose la nuit par les pastilles réelles (`shootNightTheme`) avant de revenir au parchemin — une ambiance qu'aucune image ne montre est une ambiance qui dérive.

**Pagination : un écran ne montre jamais tout, et ne prétend jamais le contraire.** Le corpus fait 8 589 livres et plusieurs milliers d'auteurs. Toute lecture qui peut en ramener plus d'un écran renvoie `{ rows, total }` — `getAuthors`, `getBooksIn`, `getLibrary`, `getCollectionBooks`, `getAnnotations`, `getManagedBooks`, `exploreBooks`. La règle qui compte : **un décompte affiché vient de SQL, jamais de `rows.length`.** Un `limit` sans `total` faisait dire à l'écran des auteurs « ٢٠٠ مؤلفًا » quand il y en a 113 — ou 8 000. `getAuthorStats` et `getEras` existent pour cette raison.

Deux conséquences de forme :

- `getLibrary` filtre les lignes de `downloaded_books` qui ne sont plus au catalogue. `saveProgress` accepte n'importe quel `edition_id` et pose une ligne « installée » : sans ce filtre, le total promettrait des pages que la jointure ne saurait pas remplir.
- Le tri par titre ne peut pas se faire en SQL : le titre vit dans `catalog.sqlite`, l'installation dans `user.sqlite`, deux instances sql.js qu'aucun `ORDER BY` ne traverse. L'ordre est donc lu une fois côté catalogue (`#titleOrder`, gardé pour la session) et l'on y pioche ce qui est installé — un `IN (?,?,…)` de plusieurs milliers de paramètres, SQLite le refuserait.

**L'accueil va de ce qu'on a déjà ouvert vers ce qu'on n'a pas encore vu** : reprise de lecture, étagère, **cursus**, disciplines, siècles, nouveautés, auteur en vedette. Les nouveautés venaient en deuxième, avant tout ce qui est à soi. Le compte de livres installés et « toute la bibliothèque » partagent une ligne dans le héros — empilés, ils poussaient les cursus et les disciplines sous la ligne de flottaison sur un téléphone, pour deux cartes qui ne disent chacune qu'une chose.

La carte d'un cursus vit dans `components/curriculum-card.js`, **seule** : deux écrans la montrent maintenant, l'accueil en propose trois et `/curricula` les montre tous. Sur le jeu d'exemple aucun identifiant `sh-*` ne répond, la liste est donc vide et la section s'efface — c'est une réponse, pas une panne, et c'est pourquoi l'appel n'est pas rattrapé : l'accueil échoue d'un bloc pour toutes ses autres sections, et excepter celle-ci ferait disparaître un dépôt cassé en silence.

**Les ouvrages de référence se choisissent, ils ne se mesurent pas.** `src/shared/popular.js` porte vingt-trois identifiants `sh-*`, **seule** — la règle de `curricula.js`, pour la même raison : au catalogue, corriger un choix d'édition coûterait un `schema_version` et 8 589 manifestes republiés. Le choix porte sur l'**édition**, pas sur l'œuvre : le catalogue publié porte dix-neuf éditions de `صحيح مسلم` et onze de `فتح الباري`, et c'est l'édition qui se télécharge — le critère est l'impression de référence, celle dont la numérotation est citée. Rien n'est compté : `tools/stats.py` mesure des téléchargements d'installeurs et des lectures de pointeur, jamais des ouvertures de livre. Il n'existe donc ni tri « par popularité » ni compteur affiché — l'un l'affirmerait, l'autre l'inventerait — et rien n'est téléchargé d'office : les vingt-trois pèsent 272 Mo compressés. Sur le jeu d'exemple aucun `sh-*` ne répond, la bande de l'accueil s'efface : c'est une réponse, et l'appel n'est pas rattrapé pour la raison ci-dessus.

Le filtre est une **case**, jamais une facette. Une facette porte des valeurs et leurs comptes ; celle-ci est un booléen, donc elle n'entre pas dans `FACET_VALUE` et `buildFacetQuery` ne la retire **jamais** — la retirer ferait annoncer aux facettes des livres que la liste exclut. Sur `/search` elle ne porte que la **première** vague : un passage n'est pas populaire ou non, et restreindre le balayage ferait mentir l'annonce « n livres parcourus ». `countActive` compte un booléen sur sa **valeur** et non sur sa présence — « ni nul ni vide » comptait `popular: false` comme un filtre posé, et le déclencheur annonçait un filtre de plus dès l'ouverture de l'écran.

**Une bande qui défile vit dans `components/scroller.js`, seule.** Deux sections de l'accueil en portent une — les nouveautés et les ouvrages de référence — et le sens du défilement se déduit de `localeDir(currentLocale())`. Écrit en dur pour l'arabe, « suivant » ne bougeait pas d'un pixel sous interface anglaise ; `test/direction.test.js` interdit `left: step()` dans les deux fichiers et vérifie que l'accueil ne pilote plus `scrollBy` lui-même. `data-reveal` est un **délai** et non une clé : deux sections au même rang montent ensemble, et `test/popular.test.js` interdit le doublon.

Une teinte de la palette ne se cite pas en dur sur un fond qui, lui, suit le thème : `.stat-card__note` portait `--primary-fixed-dim` sur un fond `--primary`, et en nuit les deux valaient **exactement** `rgb(149 211 186)` — la note était écrite à l'encre invisible. Elle dérive maintenant de `--on-primary`, l'encre de la carte.

**L'accueil échantillonne, et le dit.** `getTopCategories` rend six disciplines sur les quarante peuplées, avec le vrai `total` : c'est lui qu'annonce le lien de repli, jamais `rows.length`. Sa teinte vient de `coverFamily()` puis de `COVER_FAMILIES` — la bulle d'une discipline porte la couleur des couvertures de cette discipline, et il n'existe pas de seconde palette à tenir à jour.

La frise des siècles comble son axe côté vue (`getEras` ne rend que les siècles peuplés ; un siècle vide doit se voir comme vide, pas disparaître) et met les barres en **racine** du rapport au maximum — en rapport brut, un siècle à un livre tombait sous son plancher de pixels et cessait de porter une valeur. Elle se termine par `غير مؤرّخ`, portée `undated` de `BOOK_SCOPES` : 29 % des éditions n'ont aucun auteur daté, et une section qui se donne pour une vue d'ensemble ne peut pas les taire. Voir `docs/superpowers/specs/2026-07-31-accueil-disciplines-et-siecles-design.md`.

Les listes longues sans pagination possible (sommaire d'un livre) se **fenêtrent** côté vue : `TOC_WINDOW` entrées montées, le reste à la demande, plus un champ qui filtre sur le titre normalisé. Le lecteur garde le sommaire entier en mémoire — il lui sert à nommer le chapitre de chaque page — mais n'en dessine qu'une tranche.

**Les méthodes exposées au rendu vivent dans deux listes** — `METHODS` de `src/preload/preload.cjs` et `REPOSITORY_METHODS` de `book-repository.js`. Une méthode ajoutée d'un seul côté ne casse rien au démarrage : elle échoue au premier clic. `test/repository.test.js` porte le test de parité.

**Attention : le build sql.js embarqué ne contient pas FTS5**, seulement FTS4 (la chaîne `fts5` est absente de `sql-wasm.wasm`). `catalog_fts` et `pages_fts` sont donc illisibles depuis Electron — le pipeline continue de les produire (elles restent au schéma, un futur client pourrait les lire), mais l'application ne les interroge jamais. La recherche s'appuie à la place sur :

- les colonnes normalisées déjà présentes au schéma, `pages.body_search` et `toc.title_normalized`, interrogées en `LIKE` ;
- un index mémoire des titres, auteurs et éditeurs, normalisé par `src/shared/arabic.js`.

`src/shared/arabic.js` est le **reflet exact** de `normalize_ar` de `tools/_common.py` : c'est ce contrat qui a produit les colonnes normalisées. `test/arabic.test.js` porte une table de parité — sans elle, les deux implémentations divergeraient en silence et la recherche se dégraderait sans qu'aucun test n'échoue.

**Couvertures.** Aucun livre n'a d'image : `editions.cover_url` est nulle partout et les deux générateurs l'écrivent ainsi. La couverture est composée à l'affichage, sur trois canaux que le catalogue fournit déjà :

- la **forme** de l'objet donne la mise en page parmi cinq — `treatise` (≤ 120 p.), `book`, `tome` (> 400 p.), `compendium` (multi-tomes), `document` (tout `book_type_label` autre que `كتاب`). Données présentes à 100 %, et c'est le canal le plus visible parce que c'est ce qu'on veut savoir avant d'ouvrir ;
- la **famille** de la catégorie donne la teinte et le motif parmi neuf, indexée par `categoryLabel` normalisé et non par `category_id`, qui ne concorde pas entre `assets/sample` et `dist/shamela` ;
- le **siècle** de l'auteur donne la patine, en variable **continue** : plus c'est ancien, plus la teinte fonce et plus la dorure monte. C'est ce qui permet aux 29 % d'éditions sans `death_year_hijri` de prendre une patine médiane au lieu d'un style à part qui signifierait « on ne sait pas ».

Les tables vivent dans `src/shared/book-cover.js`, seul (le miroir Dart a disparu avec le client Flutter). Attention : `/explore` passe par `catalog-query.js`, projection distincte de `SUMMARY_SELECT` ; les deux doivent porter `book_type_label` et `death_year_hijri`, sinon l'écran entier tombe sur les replis. Voir `docs/superpowers/specs/2026-07-31-couvertures-composees-design.md`.

La recherche transversale (`BookRepository.searchLibrary`) balaie les livres installés un par un et referme ceux qu'elle a ouverts : sql.js charge chaque livre entièrement en mémoire, un balayage qui laisserait tout ouvert ferait enfler le processus. Le balayage est borné par `maxBooks` et l'écran annonce ce qu'il n'a pas parcouru.

**Le jeu publié actuellement** : 8 568 éditions sur `beytelhima-library` en `eu-west-1`, `catalog_version` **2**, `schema_version` 2 — valeurs relues depuis `catalog/latest.json`, que `assets/catalog-seed.json` reflète.

## Deux chaînes de build

Elles ont deux cadences, deux artefacts, et un seul point de couplage. Voir `docs/superpowers/specs/2026-07-31-chaines-de-build-design.md`.

**Bibliothèque** — `tools/release_library.py`, en local : le corpus source fait ~60 Go sur la machine, aucune CI ne l'aura. Importe, publie, vérifie, nettoie, dans cet ordre.

**La `catalog_version` ne se donne pas à la main.** Elle se déduit de ce qui est en ligne : le pointeur dit la version publiée et son empreinte ; même empreinte, rien n'est republié. `version_suivante()` est une fonction pure, testée sans réseau. Une version qui s'incrémenterait à chaque exécution ferait retélécharger la graine à tous les clients pour un catalogue identique.

**La vérification anonyme est dans la chaîne, pas à côté.** Elle relit le pointeur et un livre *sans identifiants*. Une publication qui réussit derrière des clés et échoue sans elles est un échec qui ne se voit qu'en production.

**Application** — `npm run release:win` : tests, puis `scripts/fetch-seed.mjs`, puis `electron-builder`. Rien ne s'empaquette sur une suite rouge.

La graine (`assets/catalog.sqlite.zst`) est **téléchargée depuis le bucket au moment du build**, jamais copiée de `dist/` : elle est donc par construction celle qui est en ligne, et un installeur ne peut pas promettre des livres que le bucket n'a pas. C'est un artefact, pas une source — ignorée par git, sinon plusieurs Mo de binaire entreraient dans l'historique à chaque publication. `assets/catalog-seed.json` dit ce qui a été embarqué et rend l'étape idempotente.

`fetch-seed` s'arrête sans rien écrire si la source est injoignable ou si le `schema_version` du pointeur dépasse `SUPPORTED_SCHEMA_VERSION`. **Pas de repli sur une graine périmée** : un installeur silencieusement obsolète est pire qu'un build raté, parce que l'erreur se découvre alors chez l'utilisateur.

**Au premier lancement**, `AppDatabase.#plantSeed` décompresse la graine — **seulement si `catalog.sqlite` est absent**. Une mise à jour d'application embarque une graine plus ancienne que le catalogue déjà téléchargé ; l'écraser ferait régresser le catalogue de l'utilisateur à chaque nouvelle version. Dans une application empaquetée, `librarySource` est nul : **aucun livre ne peut venir d'ailleurs que du bucket**, et `asset://` / `local://` ne s'y rencontrent jamais.

`apps/desktop/build/` est le `buildResources` d'electron-builder, pas un dossier de sortie : il porte `icon.ico`, dérivé de `app-icon.png` par `tools/gen_brand_assets.py`. Il n'est donc pas ignorable en bloc — git ne réinclut rien sous un dossier exclu. Ce qui est artefact y est nommé un par un (`build/screenshots/`), et les artefacts d'empaquetage sortent dans `release/`.

Reste à faire : le catalogue embarqué dans le build (`assets/catalog.sqlite.zst`, ~8 Mo pour le corpus entier) — le chemin de mise à jour depuis le bucket est en place et testé, mais le premier lancement en développement copie toujours le catalogue depuis le dossier source local.

## Le site et sa mesure

**Le site vit sur `https://beytelhikma.com`**, servi par GitHub Pages derrière le proxy Cloudflare. `site/config.mjs` est le seul module qui connaisse l'hôte : `BASE_PATH` vaut `/` et `SITE_ORIGIN` porte le domaine. Le build écrit `dist/CNAME`, **dérivé de `SITE_ORIGIN`** — `deploy-pages` publie ce qu'on lui donne, et un artefact sans `CNAME` peut faire retomber le site sur `github.io` sans qu'aucun voyant ne rougisse.

Le `BASE_PATH` à `/` rend trivialement vrai le test « aucun lien interne n'oublie le préfixe ». Il est donc doublé d'un test qui interdit le `//` initial : `//assets/x` est une URL protocol-relative, que le navigateur lit comme un hôte distant nommé `assets`.

**Rien ne mesure depuis la page.** `test/build.test.js` interdit toute ressource tierce, et un script d'analytics le casserait — outre le bandeau de consentement qu'il faudrait pour une donnée qu'on a déjà autrement. Trois sources, aucun identifiant posé chez personne :

- **Cloudflare**, en proxy, mesure la fréquentation à l'edge. L'ordre d'allumage n'est pas indifférent : nuage **gris** jusqu'à ce que GitHub ait émis son certificat (le défi passe par HTTP et le proxy l'intercepterait), puis nuage orange et SSL **Full (strict)** — jamais *Flexible*, qui boucle avec « Enforce HTTPS ».
- **L'API GitHub Releases** porte `download_count` par artefact. `site/lib/releases.mjs` le jette ; `tools/stats.py releases` le lit.
- **Les journaux d'accès S3** disent l'usage réel : chaque démarrage lit `catalog/latest.json`. `publish_minio.py --access-logs` les active vers un second bucket, le seul du projet dont les quatre verrous d'accès public restent fermés — il porte des adresses IP, quand celui de distribution est public par politique. Sa politique est cadrée par `aws:SourceArn` **et** `aws:SourceAccount`, sans quoi le service de journalisation d'un autre compte peut y écrire ; son cycle de vie expire à 30 jours.

`parse_log_line` écarte l'adresse IP au seul endroit qui la voit : aucune fonction en aval ne peut en afficher une. Elle rend `None` sur une ligne illisible, et pose ses champs entre guillemets **même vides** — un `""` sauté décalerait tout ce qui suit d'un cran.

Les compteurs ne sont **pas** affichés sur le site : un chiffre bas dessert un projet jeune, et le site ne se reconstruit qu'aux publications, donc un compteur affiché serait faux la plupart du temps.

Indicateurs et leurs limites : `docs/KPI.md`. Design : `docs/superpowers/specs/2026-08-04-domaine-et-mesure-design.md`.

## i18n / RTL (critique)

Deux locales : **`ar` et `en`**. Le français est écarté ; rien dans le code ne le prépare, et l'ajouter ne coûtera qu'un fichier de chaînes de plus.

La locale décide de **trois choses et de rien d'autre** : les mots, la direction de *l'interface*, et la forme des chiffres. Elle ne décide pas de la direction du **contenu** : le corpus est arabe, une page de livre reste RTL sous une interface anglaise, et porte donc son `dir` explicitement — une direction implicite casse à la première bascule, et la coïncidence en mode `ar` masquerait le défaut jusque-là.

**Il n'y a pas de réglage de chiffres.** Les chiffres arabes-indiens sont une propriété de la langue arabe, pas un goût séparé : un réglage distinct aurait produit quatre combinaisons dont deux n'ont aucun sens. `shared/digits.js` porte une table de dix caractères — pas `Intl.NumberFormat`, dont l'`ar` ajoute un séparateur de milliers (`٬`) et un signe décimal (`٫`) que rien n'attend, et dont le résultat suit la version d'ICU embarquée dans Electron.

Ce qui est converti : tout ce qui se lit. Ce qui ne l'est **jamais** : ce qui se rapporte ou se copie — chemins, URL, sha256, `schema_version`. Ces valeurs partent dans un rapport de bug ; les écrire en `٢` les rendrait inutilisables.

`t()` est synchrone et le catalogue importé statiquement : la CSP est `default-src 'none'` et les vues se montent sans `await`. `translate` convertit lui-même les nombres qu'on lui passe — c'est ce qui empêche une vue d'oublier la conversion.

Comme le thème, la locale et la police d'interface se posent depuis un **miroir `localStorage` lu en synchrone** avant le premier rendu : `user.sqlite` arrive par IPC après, et sans miroir une interface anglaise s'ouvrirait en RTL arabe puis basculerait à chaque lancement.

**Une clé que plus personne n'appelle est un reste.** `test/i18n.test.js` échoue sur toute clé du catalogue qu'aucune source ne cite. Deux familles sont bâties à l'exécution (`format.ordinal.*`, `curriculum.*`) et exemptées — mais **l'exemption est adossée à son gabarit** : le test vérifie que le fichier qui la bâtit contient encore le littéral. Une liste d'exceptions nue survivrait au code qu'elle excuse. Ce sont deux listes de polices mortes (`reader.font.*`, `settings.font.*`) qui ont motivé ce contrôle : elles ont vécu des mois après que `shared/fonts.js` soit devenu la seule source de vérité.

**Le sens de lecture décide du signe, jamais une constante.** La bande des nouveautés de l'accueil défilait de `+step` en dur : correct en RTL, inerte en anglais, où « suivant » ne bougeait pas d'un pixel. `test/direction.test.js` interdit `left: step()` et `left: -step()` dans l'accueil.

`test/no-hardcoded-strings.test.js` interdit tout nouveau littéral arabe dans le rendu. Trois exceptions, justifiées dans le test : `locales/ar.js` est le catalogue, la table de `icons.js` est indexée par libellé de catégorie du catalogue (clés de données), et le `؟` du lecteur est une touche du clavier. Sans ce test, la prochaine vue en réintroduirait et le défaut ne se verrait qu'en changeant de langue — c'est-à-dire jamais pendant le développement.

Ne jamais coder en dur des alignements gauche/droite : propriétés CSS logiques (`margin-inline-start`, `text-align: start`, `inset-inline-end`…). Les **flèches de sens de lecture** passent par `arrowForward` / `arrowBackward` de `icons.js` : figées, elles désignent l'inverse de ce qu'elles font dès que l'interface bascule.

## Polices

Six familles, dans `src/shared/fonts.js` et **nulle part ailleurs**. Trois arabes — Amiri (naskh de bibliothèque), Noto Naskh Arabic, IBM Plex Sans Arabic — et trois latines : Literata, EB Garamond, Source Serif 4. Toutes embarquées par `tools/fetch_fonts.py`, jamais servies depuis le réseau.

C'est d'une liste recopiée qu'était née la panne précédente : `views/reader.js` en déclarait trois, `views/settings.js` deux, et Noto Naskh Arabic était accessible depuis le lecteur et invisible depuis les réglages — la panne du thème `sepia`, rejouée. `test/fonts.test.js` vérifie la parité table ↔ `views.css` dans les deux sens.

**Deux réglages, deux domaines.** `app.font.<script>` peint l'interface, `reader.font` le texte du livre. La liste d'interface suit la locale ; celle de lecture ne propose que des faces arabes, le corpus l'est. Le défaut d'interface **n'est pas** celui du lecteur : Amiri est une face de livre, posée sur les menus elle change l'aspect de toute l'application. Le repli est passé par l'appelant, `resolveFont` n'en choisit pas à sa place.

Le `specimen` d'une famille est son nom **dans son écriture**, et ne se traduit pas : une face arabe présentée par son nom latin ne montre rien, les trois se ressemblant dans leur sous-ensemble latin.

**Ajouter une police Google, c'est l'installer, pas la lier.** `src/main/font-installer.js` lit la feuille une fois, dépose les `woff2` dans `userData/fonts/` et n'y revient jamais. Ouvrir `style-src`/`font-src` vers Google ferait appeler un tiers à chaque démarrage et ferait perdre ses polices à un lecteur hors ligne, alors que tout le reste fonctionne sans réseau.

Les bornes, chacune avec son test : hôtes en liste close (`fonts.googleapis.com` pour la feuille, `fonts.gstatic.com` pour les fichiers), `https` seul, aucune redirection suivie vers un autre hôte, tailles plafonnées, `woff2` seul écrit, nom de fichier **construit** et jamais repris de l'URL distante. Le nom de famille vient d'un tiers : il est réduit aux lettres, chiffres, espaces et traits d'union avant d'être cité.

Les fichiers sont servis par le schéma `userfont:`, qui ne sort jamais de `userData/fonts/`. La CSP ne gagne qu'un mot — `font-src 'self' userfont:` — `script-src` et `style-src` ne bougent pas, donc une police ajoutée ne peut rien exécuter. Les règles sont posées dans une `CSSStyleSheet` **construite** : une balise `<style>` injectée est du style en ligne, que `style-src 'self'` refuse.

`user.sqlite` est en version de schéma **3** depuis la table `user_fonts` (migration additive).

## L'application Android

`apps/mobile/` est le **même rendu**, pas une seconde interface. `scripts/prepare-www.mjs` efface `www/` et le refait entièrement depuis `apps/desktop/src/renderer/` et `apps/desktop/src/shared/` : une copie régénérée ne peut pas dériver, et c'est la seule façon de ne pas rejouer `MIRROR_DIRS`, le `sepia` mort et la liste de polices déclarée deux fois.

Un seul fichier diffère : `src/renderer/js/repository.js`, remplacé par `src/repository.capacitor.js` et ses cinq modules `src/repo/*` — **69 méthodes, aucune `not-ported`**. Les modules sont des fabriques sans aucun `import` : chacune reçoit ses dépendances en argument.

**L'APK embarque la graine de catalogue.** `scripts/fetch-seed.mjs` (mobile) importe `fetchSeed` du bureau — la recette, pas une copie — et remplit le cache `data/` (ignoré par git) ; `prepare-www.mjs`, qui efface `www/` à chaque exécution, copie `catalog.sqlite.zst` (~4,9 Mo compressés, jamais les 28,8 Mo décompressés) dans `www/assets/` et **refuse de produire un `www/` sans graine** — installée sans elle, l'application n'aurait aucun catalogue et ne montrerait rien. Au premier lancement, `src/repo/graine.js` la décompresse (le fzstd déjà embarqué) et l'installe **seulement si `catalog.sqlite` est absent**, la règle d'`AppDatabase.#plantSeed` : la graine est figée à la date du build, le catalogue installé a pu être mis à jour depuis le bucket, et l'écraser le ferait régresser à chaque mise à jour de l'application. Écriture de côté puis `rename`, comme partout ; `npm run verify` éprouve le planteur avec des dépendances factices.

`npm run verify` compare `preload.cjs`, `repository.js` et le shim, et tourne en CI **sans appareil ni `npm ci`** : les trois modules Capacitor sont bouchonnés. Il vérifie aussi que les deux applications posent le **même `user_version`** — le numéro est écrit en dur des deux côtés, faute d'un module que le mobile puisse partager avec le processus principal d'Electron, et deux clients sur une même racine se marcheraient dessus.

**L'icône et l'écran de démarrage se posent par script, parce que `android/` est engendré.** Le projet natif est ignoré par git — `npx cap add android` le refait — donc une ressource déposée dans `android/app/src/main/res/` disparaît au premier clone, et la panne est silencieuse : le build réussit, avec l'écran de démarrage par défaut de Capacitor. La source suivie vit dans `apps/mobile/resources/android/res/`, et `scripts/prepare-android.mjs` l'y recopie depuis `npm run sync` et `npm run android:release`. C'est la règle de `prepare-www.mjs`, à l'identique : la source est suivie, la cible est refaite, et deux exécutions donnent le même arbre.

Le dessin sort de `icon.svg` (le symbole seul, à la racine) par `tools/gen_brand_assets.py`, en **`VectorDrawable`** et non en PNG : le système le rend à la densité de l'appareil, là où cinq exports rateraient le sixième écran. Trois règles, chacune tenue par `npm run verify` :

- **La ligne de garde est un disque, pas un carré — et elle change de destination.** `core-splashscreen` pose l'icône de démarrage sur 288 dp et la masque à 192 — 410 dp de diamètre moins deux anneaux de 109 —, quand le lanceur ne garantit que **66 dp sur 108**. Calé sur la boîte, le dessin passait la pointe du mihrab et les angles du livre sous le masque. Le générateur cherche donc le **cercle minimal** (Bădoiu-Clarkson, cent tours, sans hasard) et cale dessus, avec la garde propre à chaque sortie.
- **Un dossier qualifié l'emporte sur le dossier nu, et rien ne le signale.** Capacitor range son avant-plan d'icône dans `drawable-v24/`, qui gagne dès l'API 24 — c'est-à-dire toujours, `minSdkVersion` valant 24. Le nôtre, posé dans `drawable/`, n'était lu par aucun appareil : le build passait, et l'icône montrait le petit robot d'Android sur notre fond crème, ce qui se lit comme une icône à moitié appliquée plutôt que comme une ressource masquée. `prepare-android.mjs` efface la variante **et** refuse de finir si une autre en masque une des nôtres.
- **L'animation ne joue qu'à partir d'Android 12.** Elle vit dans `drawable-v31/`, sous le même nom que l'alias fixe de `drawable/` : le thème n'en désigne qu'un, le système tranche. En deçà, `core-splashscreen` pose l'icône en **fond de fenêtre**, que personne n'anime — un `animated-vector` y serait un pari sur l'image qu'il donne à l'arrêt.
- **`--` est interdit dans un commentaire XML.** AAPT refuse la séquence, et son message nomme la copie posée dans `android/`, que personne n'édite. Citer un jeton CSS dans un commentaire suffit à casser le build ; le contrôle le dit sur la source.

Ce que la plateforme change, et qui reste à trancher : **FTS5 existe sur Android** (le greffon embarque SQLCipher) et pas sous `sql.js`. Les résultats ne sont donc pas les mêmes des deux côtés — `نحو` rend 7 occurrences en FTS5 contre 94 en `LIKE`. C'est un arbitrage produit, pas une optimisation. Mesures et pièges : `docs/spikes/capacitor-mesures.md`.

## Conventions

- Pas de contenu statique dans l'UI : toute donnée passe par le repository.
- Composants partagés réutilisables dans `src/renderer/js/components/`.
- Avant de conclure une tâche : `npm test` depuis `apps/desktop/`, `npm run verify` depuis `apps/mobile/`, `node --test "test/**/*.test.js"` depuis `site/`, et `python -m unittest discover -s shamela/tests -t .` depuis `tools/`.
- Une valeur qui vient du corpus et repart dans un attribut HTML passe par `escape_attr` (`tools/shamela/text.py`), jamais par `escape` seul : un `"` dans un `id` refermait l'attribut et le reste passait pour du balisage.
