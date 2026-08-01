# Deux chaînes de build : bibliothèque et application

**Date** : 2026-07-31
**État** : design validé

## Problème

Aucune des deux chaînes n'existe.

- **Pas de CI** (`.github/workflows` absent).
- **Pas d'empaquetage.** `npm start` lance `electron .`. Il n'y a ni
  `electron-builder`, ni cible de distribution, ni installeur. Version `0.1.0`.
- **La chaîne bibliothèque est une suite de commandes manuelles** :
  `import_shamela.py` puis `publish_minio.py`, dans cet ordre, sans rien qui
  l'impose.
- **`catalog_version` vaut 1 en dur** (`--catalog-version`, défaut 1). Personne ne
  l'incrémente. Le mécanisme de mise à jour du catalogue ne se déclencherait donc
  jamais chez aucun client.

## Objectif

Deux chaînes, deux cadences, deux artefacts, un point de couplage explicite.

| Chaîne | Produit | Cadence | Où |
| --- | --- | --- | --- |
| Bibliothèque | objets S3 + `catalog/latest.json` | à chaque évolution du corpus | local (le corpus source fait ~60 Go, aucune CI ne l'aura) |
| Application | installeur Windows | à chaque version applicative | local |

Le couplage : l'application embarque une graine de catalogue **téléchargée depuis
le bucket au moment du build**. Elle est donc par construction celle qui est en
ligne.

## Étendue publiée

397 éditions (`--books-per-category 10`), 182 805 pages, ~337 Mo sur S3, graine de
0,4 Mo compressée. Le passage au corpus entier (8 589 livres, ~25 Go, graine de
~8 Mo) devient un changement de paramètre sur une chaîne déjà éprouvée.

## Chaîne 1 — bibliothèque

`tools/release_library.py`, point d'entrée unique.

```
1. import       import_shamela --books-per-category 10 --resume --compress
2. empreinte    sha256 du catalog.sqlite produit
3. comparaison  GET catalog/latest.json -> version en ligne + son sha256
                   identique -> arrêt, rien n'est republié
                   différent -> catalog_version = en ligne + 1
4. réécriture   catalog_info.catalog_version dans le catalogue local
5. publication  livres d'abord, catalogue ensuite, pointeur en dernier
6. vérification GET anonyme du pointeur et d'un livre
7. nettoyage    archives montées, fichiers d'éditions hors catalogue
```

### L'empreinte décide, pas l'horloge

Republier deux fois le même corpus ne doit déclencher aucune mise à jour chez
personne. Une version qui s'incrémente à chaque exécution ferait retélécharger la
graine à tous les clients pour un catalogue identique.

Le calcul est une fonction pure, testable sans réseau :

```python
def version_suivante(pointeur_en_ligne, sha_local) -> int | None
```

Rend `None` quand le catalogue produit est identique à celui en ligne — le signal
« ne rien publier ». Rend `1` quand aucun pointeur n'est lisible : un bucket vide
ou un pointeur cassé se traite comme une première publication.

### Le pointeur part en dernier

Il est le seul point de bascule visible d'un client. Tant qu'il n'a pas bougé,
personne ne peut découvrir un catalogue dont les livres ne sont pas encore montés.
Une publication interrompue laisse donc les clients sur l'ancien catalogue, entier
et cohérent.

### La vérification anonyme est dans la chaîne

Elle relit le pointeur et un livre **sans identifiants**. C'est la seule façon de
savoir que ce qu'on vient de publier est lisible par un utilisateur. Une
publication qui réussit derrière des clés et échoue sans elles est un échec qui ne
se voit qu'en production.

### Changement induit

`catalog_version` cesse d'être une constante passée en option. `--catalog-version`
survit pour forcer une valeur, mais la valeur normale est calculée.

## Chaîne 2 — application

```
npm run release:win
  1. npm test                     rien ne s'empaquette sur une suite rouge
  2. node scripts/fetch-seed.mjs  GET catalog/latest.json
                                  GET catalog/<v>/catalog.sqlite.zst
                                  SHA-256 vérifié
                                  -> assets/catalog.sqlite.zst
                                  -> assets/catalog-seed.json
  3. electron-builder --win       NSIS + portable
```

### La graine est un artefact, pas une source

`assets/catalog.sqlite.zst` va dans `.gitignore`, comme `dist/`. Le dépôt garde le
jeu d'exemple (5 livres, versionné, nécessaire aux tests) ; la graine réelle se
récupère. C'est ce qui évite ~8 Mo de binaire par publication dans l'historique
git le jour où le corpus entier sera publié.

`assets/catalog-seed.json` retient ce qui a été embarqué — version, empreinte,
date, nombre d'éditions. Il sert à deux choses : l'écran « à propos » peut dire de
quel catalogue l'application est partie, et l'étape 2 devient idempotente (graine
déjà à jour, aucun téléchargement).

### Le build refuse une graine qu'il ne saura pas lire

Si le `schema_version` du pointeur dépasse `SUPPORTED_SCHEMA_VERSION`,
`fetch-seed` s'arrête. Empaqueter une application dont le catalogue embarqué est
illisible produirait un installeur qui échoue au premier lancement, chez
l'utilisateur, sans aucun signal avant.

### Ce que la graine remplace

`resolveLibrarySource` cherche aujourd'hui `dist/shamela` puis `assets/sample` —
deux dossiers de développement. Dans une application empaquetée, ni l'un ni l'autre
n'existe.

Au premier lancement, la graine est décompressée dans la racine de bibliothèque et
devient le catalogue ; `librarySource` reste nul, donc **aucun livre ne peut venir
d'ailleurs que du bucket**. C'est ce qu'on veut en production, et c'est aussi ce
qui rend `asset://` et `local://` inoffensifs : ces clés ne se rencontrent que dans
les jeux de développement.

La décompression n'a lieu **que si `catalog.sqlite` est absent**. Une mise à jour
d'application ne doit jamais écraser un catalogue plus récent que sa graine —
installer la 0.3 ferait sinon régresser le catalogue de v7 à v4.

### Version applicative

`package.json` passe à `0.2.0` et devient la source unique : `electron-builder` en
tire le nom des artefacts, `getAbout` l'affiche.

## Invariants

1. La version du catalogue ne descend jamais et ne bouge que si le contenu bouge.
   Vérifié contre le pointeur **en ligne**, pas contre un état local.
2. Le pointeur est publié en dernier.
3. La graine correspond à ce qui est en ligne, par construction.
4. Aucune chaîne ne produit d'artefact sur un échec partiel.

## Erreurs

| Situation | Réponse |
| --- | --- |
| Corpus source absent (`C:\shamela-data`) | Arrêt avant tout envoi |
| Pointeur illisible à la publication | Traité comme « aucun catalogue en ligne », version 1 |
| Publication interrompue en cours d'envoi | Pointeur inchangé ; relancer reprend, objets déjà montés sautés |
| Vérification anonyme en échec | Échec bruyant : publié mais illisible, le pire des cas |
| `fetch-seed` hors ligne | Arrêt net. Pas de repli sur une graine périmée : un installeur silencieusement obsolète est pire qu'un build raté |
| `schema_version` de la graine trop récent | Arrêt net |
| Tests rouges | Pas d'empaquetage |

## Tests

**`version_suivante`** — fonction pure, table de cas :

- aucun pointeur lisible → `1`
- pointeur v3, sha identique → `None`
- pointeur v3, sha différent → `4`
- pointeur malformé (version non entière, sha absent) → `1`

**`fetch-seed`** — serveur HTTP jetable, comme `catalog-updater.test.js` :

- graine déjà à jour (`catalog-seed.json` concordant) → aucun téléchargement
- SHA-256 faux → rien n'est écrit, sortie non nulle
- `schema_version` trop récent → arrêt, rien n'est écrit
- pointeur injoignable → arrêt, rien n'est écrit

**Premier lancement** — la graine est décompressée si `catalog.sqlite` est absent,
et **ne l'est pas** s'il est présent.

**Non testé, vérifié à la main** : que l'installeur produit s'installe et démarre.
Ce sera dit, pas supposé.

## Hors périmètre

- macOS et Linux. Windows d'abord ; les autres cibles s'ajoutent sans rien casser.
- La signature de code. Un installeur non signé déclenche SmartScreen ; c'est un
  sujet à part, avec un certificat à acheter.
- La CI. Les deux chaînes tournent en local ; la bibliothèque y restera de toute
  façon, le corpus source étant sur la machine.
- La mise à jour automatique de l'application (`electron-updater`). Le catalogue se
  met à jour tout seul, l'application non.
