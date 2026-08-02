# Distribution MinIO et cycle de vie des livres (Electron)

Date : 2026-07-31
Portée : `apps/desktop/` et `tools/`. Le client Flutter n'est pas modifié.

> **Partiellement remplacé.** `book_releases.download_url` s'appelle désormais
> `object_key` et porte une clé **relative**, pas une URL absolue ; le réglage
> `minio.base_url` est remplacé par `distribution.base_url`, qui préfixe cette
> clé au lieu d'en remplacer l'origine. Voir
> `2026-07-31-source-distribution-configurable-design.md`. Tout le reste de ce
> document — reprise par `Range`, zstd en flux, SHA-256, `rename` atomique —
> reste exact.

## 1. Objectif

Aujourd'hui le portage Electron lit un dossier de bibliothèque local (`dist/shamela/`
ou `assets/sample/`) et considère l'intégralité du catalogue comme installée :
`BookRepository.warmUp()` insère une ligne `downloaded_books` en statut `installed`
pour chaque édition visible, et `AppDatabase.book()` copie le fichier depuis la
source à la première ouverture.

Ce document décrit le passage à une distribution réelle :

- le catalogue reste local, l'exploration fonctionne hors ligne ;
- les fichiers de livres vivent sur un serveur MinIO exposé en HTTP ;
- l'utilisateur télécharge, annule, réessaie et supprime les livres depuis l'app ;
- la bibliothèque ne contient que ce qui est réellement installé.

Le schéma anticipait déjà ce besoin : `book_releases` porte `download_url`,
`sha256`, `compressed_size` et `uncompressed_size`, et `downloaded_books` porte la
machine à états `queued / downloading / verifying / installed / failed`. Rien de
tout cela n'était branché.

## 2. Décisions

| Sujet | Décision | Motif |
| --- | --- | --- |
| Périmètre distant | Livres seuls ; `catalog.sqlite` reste local | L'exploration marche sans réseau ni premier fetch |
| Accès aux objets | `GET` HTTP anonyme sur bucket public | Aucun secret sur le poste client, aucune dépendance SDK |
| Compression | zstd (`.sqlite.zst`) | `import_shamela.py --compress` le produit déjà ; `zlib.createZstdDecompress` est natif dans Electron 38.8.6 / Node 22.22.0 (vérifié) |
| File | Séquentielle, reprise par `Range` | Un livre peut peser des centaines de mégaoctets |
| Suppression | L'utilisateur choisit : garder la progression ou tout effacer | Les deux usages sont légitimes, aucun défaut ne convient à tous |
| Publication | Nouvel outil `tools/publish_minio.py` | Sépare transformation et distribution ; l'import reste hors réseau |
| Commandes UI | Fiche livre + écran `/downloads` dédié | Vue d'ensemble de la file et point de réessai |

Écartés : catalogue distant (impose un fetch avant toute exploration), lecture
directe des objets sans cache (impossible avec sql.js, qui charge le fichier
entier en mémoire), URLs présignées (imposent d'écrire et d'héberger un service).

## 3. Disposition MinIO

Bucket `beytelhikma`, policy de lecture anonyme sur le préfixe `books/*`.

```
beytelhikma/
  books/<edition_id>/<content_version>/book.sqlite.zst
  books/<edition_id>/<content_version>/manifest.json
```

Les chemins sont immutables : un nouveau `content_version` crée un nouvel objet,
jamais un écrasement. `book_releases.download_url` contient l'URL publique
complète.

## 4. Publication — `tools/publish_minio.py`

Entrée : `dist/shamela/` produit par `import_shamela.py --compress`. L'outil
échoue avec un message explicite si les `.sqlite.zst` sont absents.

Pour chaque livre :

1. `head_object` sur la clé cible ; si l'objet existe avec la même taille, on
   passe (idempotent). `--force` réécrit malgré tout.
2. `put_object` avec `ContentType: application/zstd` et les métadonnées `sha256`
   (celui du **SQLite décompressé**, tel que stocké dans le manifest) et
   `uncompressed-size`.
3. Upload du `manifest.json` à côté.

Puis, une fois tous les livres montés :

```sql
UPDATE book_releases
   SET download_url = ?, compressed_size = ?
 WHERE release_id = ?
```

dans `dist/shamela/catalog.sqlite`.

Options : `--endpoint --bucket --public-base --src --jobs --dry-run --force
--set-anonymous-policy`. Les identifiants viennent de `MINIO_ACCESS_KEY` et
`MINIO_SECRET_KEY` — jamais du dépôt, jamais d'un fichier versionné.

`--set-anonymous-policy` pose la policy de lecture publique sur `books/*` et
n'est à lancer qu'une fois, à l'initialisation du bucket.

## 5. Processus principal

### 5.1 `AppDatabase`

- `book(editionId)` ne matérialise plus rien : il lit
  `<userData>/library/books/<eid>.sqlite` et lève `BookNotInstalledError` si le
  fichier est absent. La copie silencieuse depuis la source disparaît.
- Ajout de `closeBook(editionId)` : `close()` sur la base et retrait de l'entrée
  du cache `Map`. Indispensable avant suppression — sans cela, sql.js garde le
  contenu en mémoire et le livre effacé reste lisible.
- Ajout de `installedBooks()` : liste des `edition_id` dont le fichier existe.
- `catalog()` et `#syncInstalledLibrary()` sont inchangés.
- Repli hors ligne : si `download_url` commence par `local://`, le gestionnaire
  copie depuis `librarySource` au lieu d'émettre une requête. `dist/shamela`
  reste utilisable sans MinIO et les tests tournent sans réseau.

### 5.2 `src/main/download-manager.js` (nouveau)

Responsabilité unique : mener un `edition_id` de `queued` à `installed`, écrire
l'état dans `user.sqlite`, émettre la progression.

Disposition sur disque :

```
<userData>/library/
  books/<eid>.sqlite          installé
  downloads/<eid>.zst.part    octets compressés en cours, repris par Range
  downloads/<eid>.sqlite.tmp  décompression en cours
```

Étapes d'un travail :

1. Lecture de la release active dans le catalogue : `download_url`, `sha256`,
   `compressed_size`, `uncompressed_size`.
2. `GET` avec `Range: bytes=<taille du .part>-` si un `.part` existe. Une réponse
   `200` au lieu de `206` signale un serveur sans support Range : le `.part` est
   tronqué et le téléchargement repart de zéro.
3. Écriture en streaming. La progression n'est écrite dans `user.sqlite` qu'une
   fois par 500 ms au plus : sql.js réexporte le fichier entier à chaque write.
4. Statut `verifying` : `zlib.createZstdDecompress` du `.part` vers
   `<eid>.sqlite.tmp`, SHA-256 calculé dans le même passage, comparé à
   `book_releases.sha256`.
5. `rename` atomique vers `books/<eid>.sqlite`, suppression du `.part`, statut
   `installed`, mise à jour de `local_path`, `downloaded_at`, `total_bytes`.
6. En cas d'échec, statut `failed` et `.part` conservé pour permettre la reprise
   — sauf échec de hash, où le `.part` est supprimé car corrompu.

La file est séquentielle : un seul travail actif, les autres en `queued`.
L'annulation passe par un `AbortController`.

**Aucune migration de schéma.** Le message d'erreur reste en mémoire ; il est
perdu au redémarrage, où l'échec redevient simplement « à retélécharger ». Cela
évite de toucher `user.sqlite`, partagé avec le client Flutter. Le seul ajout est
la valeur `removed` dans `download_status`, colonne TEXT sans contrainte.

### 5.3 `reconcileLibrary()` remplace `warmUp()`

`warmUp()` est supprimé. Au démarrage, `reconcileLibrary()` confronte les
fichiers présents aux lignes de `downloaded_books` :

- fichier présent sans ligne → ligne créée en `installed` ;
- ligne `installed` sans fichier → statut `removed` ;
- lignes restées en `downloading` ou `verifying` → repassées en `queued`, et la
  file redémarre seule.

L'état devient robuste aux suppressions manuelles dans le dossier de données.

### 5.4 Suppression

`deleteBook(editionId, { keepProgress })`. Le drapeau vient de l'utilisateur.

La suppression est refusée si un téléchargement est en cours pour cet
`edition_id` ; l'appelant doit annuler d'abord.

Dans les deux cas : `closeBook(editionId)`, puis `fs.rm` du `.sqlite` et des
résidus `.part` / `.tmp`.

| `keepProgress` | Effet sur `user.sqlite` |
| --- | --- |
| `true` | `download_status='removed'`, `downloaded_bytes=0`, `local_path=NULL`. `current_page_id`, `current_sequence_num`, `progress_percent`, `last_opened_at` conservés. Liens `collection_books` intacts. |
| `false` | `DELETE FROM downloaded_books` et `DELETE FROM collection_books` pour cet `edition_id`. Rien ne survit. |

Retélécharger après `keepProgress: true` relit `current_page_id` : le lecteur
rouvre à la page exacte. Après `false`, le livre repart page 1.

### 5.5 Réglage `minio.base_url`

Clé optionnelle dans `app_settings`. Si elle est définie, son origine remplace
celle de `download_url` au moment de la requête. Permet de pointer un autre
MinIO — poste de développement, miroir local — sans régénérer le catalogue.

## 6. Surface IPC

Ajouts à `REPOSITORY_METHODS`, répercutés à l'identique dans
`src/preload/preload.cjs` :

```
downloadBook(editionId)                    met en file, renvoie le job
cancelDownload(editionId)                  abandonne, .part supprimé
retryDownload(editionId)                   repasse un failed en queued
deleteBook(editionId, { keepProgress })    voir 5.4
getDownloads()                             jobs actifs, en attente, échoués
getStorageUsage()                          { bookCount, bytes }
```

Un seul canal poussé s'ajoute à l'existant : `downloads:changed`, envoyé par
`webContents.send`, throttlé à 500 ms. Charge utile compacte :

```js
[{ editionId, status, receivedBytes, totalBytes, percent, error }]
```

Le préchargement expose `onDownloadsChanged(cb)` qui renvoie une fonction de
désabonnement.

Méthodes existantes enrichies sans changer leur forme :

- `getBookDetail` gagne `download: { status, percent, compressedSize, releaseId }` ;
- les listes (`getBooks`, `getRecentBooks`, `getBooksByCategory`,
  `getBooksByAuthor`, `getBooksByCentury`) passent par un `#withDownloadStatus()`
  qui joint le statut en mémoire sur les `edition_id` de la page — une requête
  `user.sqlite` par appel, pas par livre ;
- `getLibrary()` filtre `download_status = 'installed'`.

## 7. Interface

### 7.1 Fiche livre `/book/:id`

Bloc action unique, six états :

| Statut | Rendu |
| --- | --- |
| absent ou `removed` | `تحميل (12,4 م.ب)` |
| `queued` | `في الانتظار` + `إلغاء` |
| `downloading` | barre de progression + pourcentage + `إلغاء` |
| `verifying` | `جارٍ التحقق`, indéterminé, non annulable |
| `installed` | `قراءة` + `حذف` |
| `failed` | message d'erreur + `إعادة المحاولة` |

Un livre en `removed` qui conserve une progression affiche `تحميل` accompagné de
la mention `تتابع من الصفحة N`.

### 7.2 Modale de suppression

Déclenchée par `حذف`, rendue en HTML dans le processus de rendu — pas
`dialog.showMessageBox`, afin de garder la typographie arabe et le RTL de
l'application.

```
حذف «<titre>»؟
  [ حذف مع الاحتفاظ بموضع القراءة ]   action par défaut, focus initial
  [ حذف نهائي ]                        ton destructif
  [ إلغاء ]
```

Si `current_page_id IS NULL`, la modale n'affiche qu'un bouton `حذف` : pas de
choix à trancher quand il n'y a rien à conserver.

### 7.3 Écran `/downloads`

Nouvelle route. Le placeholder `/explore` reste réservé à la recherche.

Trois sections : `قيد التنزيل`, `في الانتظار`, `فشل`. En tête, l'espace occupé
renvoyé par `getStorageUsage()`. Actions : annuler, réessayer, `مسح الإخفاقات`.
Entrée de navigation dans la coque, avec pastille du nombre de travaux actifs.

### 7.4 Ailleurs

- `bookCard` : badge discret en coin, `✓` installé ou `↓` en cours. Rien de plus,
  les grilles arabes doivent rester lisibles.
- `/reader/:id` : redirection vers la fiche si le livre n'est pas installé, et à
  la prochaine navigation de page s'il est supprimé pendant la lecture.
- Les vues concernées s'abonnent à `onDownloadsChanged` et se rafraîchissent sans
  rechargement.

## 8. Erreurs

| Cas | Traitement |
| --- | --- |
| Réseau injoignable | `failed`, `.part` gardé, `تعذّر الاتصال بالخادم` |
| 404 / objet absent | `failed`, `.part` supprimé, `الملف غير متوفر على الخادم` |
| SHA-256 non conforme | `failed`, `.part` supprimé — cache corrompu, reprise inutile |
| `ENOSPC` | `failed`, `لا توجد مساحة كافية` |
| Serveur sans support Range | reprise abandonnée, téléchargement complet |
| Suppression pendant téléchargement | refusée ; l'interface propose d'annuler d'abord |
| Livre au-delà de 128 Mo | l'avertissement `BOOK_SIZE_WARNING` existant reste inchangé |

## 9. Tests

`apps/desktop/test/download-manager.test.js` — serveur `node:http` local
servant un `.zst` fabriqué à la volée :

- nominal → `installed`, fichier présent, SHA-256 correct ;
- SHA-256 faux → `failed`, aucun fichier installé, `.part` supprimé ;
- coupure à mi-parcours puis relance → en-tête `Range` émis, fichier final
  identique au nominal ;
- serveur répondant `200` à une requête `Range` → repart de zéro, résultat
  correct ;
- annulation → `.part` supprimé, statut `removed` ;
- 404 → `failed` avec message.

`apps/desktop/test/repository.test.js` :

- `deleteBook` avec `keepProgress: true` → fichier absent, `current_page_id`
  intact ;
- `deleteBook` avec `keepProgress: false` → ligne `downloaded_books` et liens
  `collection_books` disparus ;
- `getLibrary` n'expose que les `installed` ;
- `reconcileLibrary` corrige fichier-sans-ligne et ligne-sans-fichier.

`tools/shamela/tests/test_publish.py`, avec un client S3 factice (pas de MinIO
requis) :

- upload idempotent — le deuxième passage n'émet aucun `put_object` ;
- `download_url` réécrit avec l'URL publique attendue ;
- `--dry-run` n'écrit ni objet ni ligne de catalogue.

## 10. Hors périmètre

- Client Flutter : il continue de lire une bibliothèque locale. L'alignement sur
  MinIO fera l'objet d'un travail distinct.
- Catalogue distant et mise à jour de catalogue.
- Recherche FTS5, toujours indexée mais non exposée.
- Téléchargements parallèles, packs de contenu annexes (Quran, Hadith), reprise
  différentielle entre deux `content_version`.
