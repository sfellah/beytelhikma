# Source de distribution configurable

**Date** : 2026-07-31
**État** : design validé

## Problème

Le catalogue publié contient des URL absolues. `publish_minio.py` écrit
`https://beytelhima-library.s3.eu-west-1.amazonaws.com/books/sh-8/1/book.sqlite.zst`
dans `book_releases.download_url`, et l'application les suit telles quelles. Trois
conséquences :

- **Le catalogue est lié à l'hébergeur qui l'a publié.** Servir les mêmes livres
  depuis un MinIO local, un CDN ou un autre bucket demande de republier le
  catalogue entier.
- **Le réglage `minio.base_url` ne suffit pas.** Il remplace le protocole et
  l'hôte (`download-manager.js`) mais garde le chemin stocké. Or le chemin diffère
  selon le style d'adressage : `/books/sh-8/1/…` en virtual-hosted AWS,
  `/beytelhikma/books/sh-8/1/…` en path-style MinIO. Changer d'hébergeur casse.
- **Le catalogue ne se met jamais à jour.** Il est copié depuis un dossier source
  local, ce qui marche en développement et nulle part ailleurs. `catalog_info`
  porte pourtant déjà `catalog_version` — personne ne la lit.

## Objectif

L'application embarque son catalogue, fonctionne hors ligne dès l'installation, et
ne connaît de sa source de distribution qu'**une seule valeur** : une URL de base.
Elle vérifie au démarrage s'il existe un catalogue plus récent et propose la mise à
jour sans jamais l'imposer.

Contrainte de dimensionnement : le catalogue du corpus entier (8 589 livres) pèse
~43 Mo, ~8 Mo compressé en zstd. Mesuré sur le catalogue de 397 livres (2,0 Mo →
0,36 Mo, ratio 5,5×). Assez petit pour être embarqué dans le build.

## Modèle de données

### Catalogue

`book_releases.download_url` est renommée **`object_key`** et ne contient plus
d'URL absolue par défaut. Une colonne nommée « url » qui contient
`books/sh-8/1/book.sqlite.zst` mentirait à tous ceux qui la liraient ensuite.

```
object_key = "books/sh-8/1/book.sqlite.zst"    -> relatif à la base configurée
object_key = "asset://books/x.sqlite"          -> absolu, pris tel quel
object_key = "local://books/x.sqlite"          -> absolu, pris tel quel
object_key = "https://autre-hote/x.zst"        -> absolu, pris tel quel
```

**Règle unique : la présence de `://` marque un absolu.** Tout le reste est relatif
à la base configurée. Cette règle garde les jeux hors ligne (`assets/sample`,
`dist/shamela`) intacts et rend la migration douce.

`schema_version` du catalogue passe à **2**. Le DDL vit dans `tools/_common.py`
(`CATALOG_SCHEMA`), source de vérité unique ; `SchemaParityTest` échouera tant que
les deux clients ne sont pas alignés, ce qui est exactement son rôle.

`catalog_info` est inchangée : `catalog_version`, `schema_version`, `generated_at`,
`edition_count` suffisent.

### Réglages

Une clé dans `app_settings` :

```
distribution.base_url = "https://beytelhima-library.s3.eu-west-1.amazonaws.com"
```

Valeur par défaut compilée dans l'application. La vider revient au défaut.
`minio.base_url` est supprimé : son remplacement d'hôte ne survit pas au changement
de disposition, et deux réglages désignant la même chose finissent par diverger.

Une seconde clé retient un refus :

```
distribution.declined_catalog_version = 2
```

### `user.sqlite`

**Aucun changement.** `downloaded_books.release_id` vaut déjà `sh-8-v1` — édition et
version de contenu dans une seule valeur. La détection de réédition s'y lit
directement.

## Composants

### `src/shared/distribution.js`

Fonction pure, sans réseau ni disque. Seul endroit du code qui sait qu'une base et
une clé se collent.

```
resolve(baseUrl, objectKey) -> { kind: 'http', url }        si la cible est http(s)
                            -> { kind: 'library', path }    si asset:// ou local://
```

Le dossier `src/shared/` accueille déjà `arabic.js` et `book-cover.js` ; il existe
pour ce genre de contrat partagé. Un miroir Dart suivra avec l'alignement du client
Flutter.

### `src/main/catalog-updater.js`

Récupère le pointeur, compare, télécharge, échange. Réutilise la mécanique de
`download-manager.js` telle quelle : `Range` reprenable, décompression zstd en flux,
SHA-256 vérifié, `rename` atomique.

### `tools/publish_minio.py`

Devient le **seul** composant à connaître la disposition du bucket. Il construit
`books/<edition_id>/<content_version>/book.sqlite.zst`, l'écrit dans le catalogue,
puis publie le catalogue et son pointeur. Le client ne fait que concaténer :
changer la hiérarchie plus tard ne casse aucune application déjà installée.

## Disposition du bucket

```
catalog/latest.json                             <- pointeur, Cache-Control: no-cache
catalog/<catalog_version>/catalog.sqlite.zst    <- immutable
books/<edition_id>/<content_version>/book.sqlite.zst
books/<edition_id>/<content_version>/manifest.json
```

Le pointeur :

```json
{
  "catalog_version": 2,
  "schema_version": 2,
  "generated_at": "2026-07-31T14:37:43Z",
  "edition_count": 397,
  "object_key": "catalog/2/catalog.sqlite.zst",
  "sha256": "…",
  "compressed_size": 8380000,
  "uncompressed_size": 45000000
}
```

Trois points de vigilance :

**`latest.json` ne doit pas hériter du cache immutable.** `_upload` pose aujourd'hui
`Cache-Control: public, max-age=31536000, immutable` sur tout ce qu'il monte.
Correct pour `catalog/<version>/…`, dont le chemin est versionné. Mortel pour le
pointeur : mis en cache un an, il ne désignerait jamais rien de nouveau et la
fonctionnalité serait morte sans qu'aucun test n'échoue. `_upload` doit accepter un
`cache_control` par appel.

**Le pointeur porte `schema_version`.** Une application trop ancienne pour lire un
catalogue de schéma supérieur doit refuser de l'installer, avant téléchargement.

**La policy s'élargit à `catalog/*`.** Elle n'ouvre aujourd'hui que `books/*`
(vérifié : `catalog.sqlite` à la racine répond 403). Deux préfixes explicites,
jamais le bucket entier — le listing anonyme doit continuer de répondre 403.

```json
"Resource": [
  "arn:aws:s3:::<bucket>/books/*",
  "arn:aws:s3:::<bucket>/catalog/*"
]
```

Le catalogue ne contient que des métadonnées de livres déjà publics : l'ouvrir ne
concède rien.

## Flux

### Premier lancement

L'application embarque `assets/catalog.sqlite.zst`. Au premier démarrage :
décompression dans la racine de bibliothèque, `distribution.base_url` initialisé au
défaut compilé. L'exploration marche immédiatement, hors ligne, sans une seule
requête.

### Vérification de version

Au démarrage, en tâche de fond, jamais bloquant :

```
GET <base>/catalog/latest.json
  échec réseau                    -> silence, on reste sur le catalogue local
  pointeur illisible              -> silence, trace en console
  schema_version > supporté       -> silence
  catalog_version <= local        -> silence
  catalog_version == refusé       -> silence
  sinon                           -> bannière non bloquante
```

Le silence est le comportement de cinq branches sur six. Une application hors ligne
ne doit rien afficher d'anxiogène : elle a tout ce qu'il lui faut pour explorer.

La bannière annonce la taille compressée et offre deux actions : mettre à jour, ou
plus tard. « Plus tard » écrit `distribution.declined_catalog_version` ; refuser la
version 2 ne fait pas taire la 3. La vérification reste relançable depuis les
réglages.

### Installation du catalogue

```
téléchargement          -> .part (reprise par Range si présent)
vérification SHA-256    <- avant toute décompression
décompression           -> catalog.sqlite.new
fermeture du handle sql.js
rename atomique         .new -> catalog.sqlite
réouverture, invalidation des caches mémoire
```

Le `rename` en dernier : une coupure à n'importe quel point laisse l'ancien
catalogue intact et lisible. Jamais de catalogue à moitié écrit.

### Réconciliation de la bibliothèque installée

`#syncInstalledLibrary` disparaît sous sa forme actuelle. Sa purge totale sur
changement de source était correcte quand la source était un dossier de
développement ; avec un catalogue qui se met à jour seul, elle ferait retélécharger
toute la bibliothèque à chaque rafraîchissement.

Elle est remplacée par une comparaison **par édition**, après le `rename` :

```
release_id installé == release_id actif   -> rien
release_id installé != release_id actif   -> badge « réédition disponible »
édition absente du nouveau catalogue      -> livre gardé, lisible, hors exploration
```

**Aucune suppression de fichier n'est déclenchée par une mise à jour de catalogue.**
Les ancres de surlignage sont posées sur le texte rendu ; une réédition peut les
déplacer. Ce doit être un choix de l'utilisateur, jamais un effet de bord.

### Changement de bucket

Changer `distribution.base_url` ne touche à rien sur le disque. Les livres installés
le restent, le catalogue aussi. Seules les prochaines résolutions de clé changent
d'origine — c'est l'intérêt d'avoir sorti l'hôte des données.

## Erreurs

Principe : **une source de distribution injoignable ne dégrade jamais la lecture.**

| Situation | Réponse |
| --- | --- |
| Pointeur injoignable, hors ligne | Silence total |
| Pointeur illisible ou incomplet | Silence, trace en console |
| `schema_version` trop récent | Silence |
| SHA-256 du catalogue faux | Échec net, `.part` supprimé, message explicite |
| Téléchargement coupé | `.part` gardé, reprise par `Range` |
| `base_url` invalide | Refus à la saisie dans les réglages |
| Clé absente du bucket (404) | Le livre passe « indisponible », les autres continuent |

Un cas mérite d'être nommé : **une base pointant vers un bucket dont le catalogue ne
vient pas**. Rien ne l'interdit et rien ne le détecte — les clés existeront ou pas.
La réponse est le 404 par livre. Valider ça demanderait un contrôle croisé que le
format ne porte pas ; un échec par livre, lisible, vaut mieux qu'une validation qui
donne une fausse assurance.

## Tests

**`distribution.js`** — fonction pure, donc table de cas :

- clé relative + base http → URL jointe, sans double barre ni barre manquante
- clé relative + base avec chemin (`http://127.0.0.1:9000/beytelhikma`) → le préfixe
  du bucket survit
- clé à schéma (`https://`, `asset://`, `local://`) → rendue telle quelle, base
  ignorée
- base vide → repli sur le défaut compilé

**`catalog-updater`** — pointeur servi par un serveur HTTP local jetable, comme les
tests de téléchargement existants :

- version distante inférieure ou égale → aucune bannière
- version refusée → aucune bannière ; version suivante → bannière
- `schema_version` trop récent → aucune installation
- SHA-256 faux → rien n'est installé, l'ancien catalogue reste ouvrable
- coupure au milieu → le catalogue précédent reste valide

**Réédition** — catalogue de test où une édition passe de `-v1` à `-v2` : le livre
installé reste lisible, il est marqué, aucun fichier n'est supprimé.

**Parité de schéma** — `SchemaParityTest` échoue tant que `download_url` →
`object_key` n'est pas propagé aux deux DDL.

**Cache du pointeur** — un test sur `publish_minio` vérifie que
`catalog/latest.json` part en `no-cache` et `catalog/<version>/…` en `immutable`.
Sans lui la régression est invisible : tout marche le premier jour, plus rien ne se
met à jour ensuite.

## Hors périmètre

- Le miroir Dart de `distribution.js` et l'alignement du client Flutter — le
  portage Electron est en avance, l'alignement est déjà un chantier identifié.
- La mise à jour incrémentale du catalogue (delta plutôt que remplacement complet).
  8 Mo compressés ne le justifient pas.
- La signature cryptographique du pointeur. Le SHA-256 protège de la corruption, pas
  d'un bucket compromis ; le jour où ça compte, ce sera une décision à part.
