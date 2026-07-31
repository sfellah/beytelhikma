# Source de distribution configurable — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sortir l'hôte du catalogue — l'application ne connaît qu'une URL de base, vérifie la version du catalogue au démarrage et propose la mise à jour.

**Architecture:** Le catalogue stocke une clé d'objet relative (`books/sh-8/1/book.sqlite.zst`) au lieu d'une URL absolue. Un module partagé pur (`src/shared/distribution.js`) colle base et clé ; c'est le seul endroit du code qui connaît cette règle. `publish_minio.py` devient le seul composant à connaître la disposition du bucket : il construit les clés, publie le catalogue compressé sous un chemin versionné, et un pointeur `catalog/latest.json` en `no-cache`. Au démarrage, `catalog-updater.js` lit le pointeur, compare, et propose.

**Tech Stack:** Node 20+ (ESM, `node:test`), sql.js, Python 3.11+ (`unittest`, boto3, zstandard).

## Global Constraints

- Schéma de catalogue : `schema_version` passe de **1** à **2**. Le DDL vit dans `tools/_common.py` (`CATALOG_SCHEMA`) — source de vérité unique importée par `gen_sample_data.py` et l'importeur Shamela.
- Règle de résolution, valable partout : **la présence de `://` dans une clé marque un absolu**. Tout le reste est relatif à la base configurée.
- URL de base par défaut : `https://beytelhima-library.s3.eu-west-1.amazonaws.com`
- Aucune mise à jour de catalogue ne supprime un fichier de livre. Jamais.
- Tests Electron : `npm test` depuis `beytelhikma-electron/` (`node --test "test/**/*.test.js"`).
- Tests Python : `cd tools && python -m unittest discover -s shamela/tests -t .`
- Les commentaires de code sont en français, comme le reste du dépôt.

---

## Structure des fichiers

| Fichier | Responsabilité |
| --- | --- |
| `beytelhikma-electron/src/shared/distribution.js` *(créé)* | Fonction pure : `(base, clé) -> cible`. Aucun réseau, aucun disque. |
| `beytelhikma-electron/test/distribution.test.js` *(créé)* | Table de cas de la résolution. |
| `beytelhikma-electron/src/main/catalog-updater.js` *(créé)* | Pointeur, comparaison, téléchargement, échange atomique. |
| `beytelhikma-electron/test/catalog-updater.test.js` *(créé)* | Serveur HTTP jetable, cas de décision et d'installation. |
| `tools/_common.py` | DDL : `download_url` → `object_key`, `SCHEMA_VERSION` → 2. |
| `tools/shamela/catalogdb.py` | Écrit la clé relative à l'import. |
| `tools/gen_sample_data.py` | Idem pour le jeu d'exemple (`asset://`, inchangé sur le fond). |
| `tools/publish_minio.py` | Construit les clés, publie catalogue + pointeur, policy `catalog/*`. |
| `beytelhikma-electron/src/main/book-repository.js` | Lit `object_key`, réglage `distribution.base_url`. |
| `beytelhikma-electron/src/main/download-manager.js` | Résout par `distribution.js`, `#applyBaseUrl` supprimé. |
| `beytelhikma-electron/src/main/app-database.js` | `#syncInstalledLibrary` → réconciliation par édition. |
| `beytelhikma-electron/src/renderer/js/views/settings.js` | Section « source de distribution ». |

---

### Task 1 : le module de résolution

**Files:**
- Create: `beytelhikma-electron/src/shared/distribution.js`
- Test: `beytelhikma-electron/test/distribution.test.js`

**Interfaces:**
- Consumes: rien.
- Produces:
  - `DEFAULT_BASE_URL: string`
  - `resolveObject(baseUrl: string | null, objectKey: string) -> { kind: 'http', url: string } | { kind: 'library', url: string }`
  - `isAbsoluteKey(objectKey: string) -> boolean`

- [ ] **Step 1: Write the failing test**

Créer `beytelhikma-electron/test/distribution.test.js` :

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_BASE_URL, isAbsoluteKey, resolveObject } from '../src/shared/distribution.js';

const AWS = 'https://beytelhima-library.s3.eu-west-1.amazonaws.com';
const MINIO = 'http://127.0.0.1:9000/beytelhikma';

test('une clé relative se colle derrière la base', () => {
  assert.deepEqual(resolveObject(AWS, 'books/sh-8/1/book.sqlite.zst'), {
    kind: 'http',
    url: `${AWS}/books/sh-8/1/book.sqlite.zst`,
  });
});

test('le préfixe de bucket de la base survit', () => {
  // C'est tout l'intérêt du chemin relatif : en path-style, le nom du bucket
  // fait partie de la base et ne doit pas être perdu.
  assert.deepEqual(resolveObject(MINIO, 'books/sh-8/1/book.sqlite.zst'), {
    kind: 'http',
    url: 'http://127.0.0.1:9000/beytelhikma/books/sh-8/1/book.sqlite.zst',
  });
});

test('ni double barre ni barre manquante à la jointure', () => {
  const attendu = `${AWS}/books/x.zst`;
  assert.equal(resolveObject(`${AWS}/`, 'books/x.zst').url, attendu);
  assert.equal(resolveObject(AWS, '/books/x.zst').url, attendu);
  assert.equal(resolveObject(`${AWS}/`, '/books/x.zst').url, attendu);
});

test('une clé http absolue ignore la base', () => {
  assert.deepEqual(resolveObject(AWS, 'https://autre-hote/x.zst'), {
    kind: 'http',
    url: 'https://autre-hote/x.zst',
  });
});

test('asset:// et local:// désignent la bibliothèque source', () => {
  // Les jeux hors ligne doivent survivre au changement de format : les tests
  // du dépôt tournent sans réseau grâce à eux.
  assert.deepEqual(resolveObject(AWS, 'asset://books/x.sqlite'), {
    kind: 'library',
    url: 'asset://books/x.sqlite',
  });
  assert.deepEqual(resolveObject(AWS, 'local://books/x.sqlite'), {
    kind: 'library',
    url: 'local://books/x.sqlite',
  });
});

test('une base vide retombe sur le défaut compilé', () => {
  assert.equal(resolveObject(null, 'books/x.zst').url, `${DEFAULT_BASE_URL}/books/x.zst`);
  assert.equal(resolveObject('', 'books/x.zst').url, `${DEFAULT_BASE_URL}/books/x.zst`);
  assert.equal(resolveObject('   ', 'books/x.zst').url, `${DEFAULT_BASE_URL}/books/x.zst`);
});

test('isAbsoluteKey ne se laisse pas prendre par un chemin qui contient deux points', () => {
  assert.equal(isAbsoluteKey('books/sh-8/1/book.sqlite.zst'), false);
  assert.equal(isAbsoluteKey('https://x/y'), true);
  assert.equal(isAbsoluteKey('asset://books/x.sqlite'), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd beytelhikma-electron && npx node --test test/distribution.test.js`
Expected: FAIL — `Cannot find module '../src/shared/distribution.js'`

- [ ] **Step 3: Write the implementation**

Créer `beytelhikma-electron/src/shared/distribution.js` :

```js
/**
 * Résolution d'une clé d'objet du catalogue vers une cible téléchargeable.
 *
 * Le catalogue ne stocke plus d'URL absolue : il porte une **clé relative**
 * (`books/sh-8/1/book.sqlite.zst`) qu'on colle derrière l'URL de base
 * configurée. C'est ce qui rend un même catalogue servable depuis AWS,
 * depuis un MinIO local ou depuis un CDN sans le republier.
 *
 * Une seule exception, et elle est explicite : **la présence de `://` marque
 * un absolu**. Elle garde les jeux hors ligne (`asset://`, `local://`)
 * utilisables et rend la migration douce — un catalogue publié à l'ancienne,
 * avec des URL complètes, continue de fonctionner.
 *
 * Module pur : ni réseau, ni disque, ni état. C'est le seul endroit du code
 * qui sait qu'une base et une clé se collent.
 */

/** Bucket de distribution par défaut, utilisé tant que rien n'est configuré. */
export const DEFAULT_BASE_URL = 'https://beytelhima-library.s3.eu-west-1.amazonaws.com';

/**
 * Un schéma d'URI, pas n'importe quel `:` — `book.sqlite.zst` en contient un
 * dans son nom sans être absolu pour autant.
 */
const SCHEME = /^([a-z][a-z0-9+.-]*):\/\//i;

export function isAbsoluteKey(objectKey) {
  return SCHEME.test(String(objectKey ?? ''));
}

/**
 * Renvoie la cible d'une clé.
 *
 *   { kind: 'http',    url }  -> à télécharger
 *   { kind: 'library', url }  -> à copier depuis la bibliothèque source
 */
export function resolveObject(baseUrl, objectKey) {
  const key = String(objectKey ?? '');
  const scheme = SCHEME.exec(key);

  if (scheme) {
    const protocol = scheme[1].toLowerCase();
    const kind = protocol === 'http' || protocol === 'https' ? 'http' : 'library';
    return { kind, url: key };
  }

  const base = String(baseUrl ?? '').trim() || DEFAULT_BASE_URL;
  return {
    kind: 'http',
    url: `${base.replace(/\/+$/, '')}/${key.replace(/^\/+/, '')}`,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd beytelhikma-electron && npx node --test test/distribution.test.js`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
git add beytelhikma-electron/src/shared/distribution.js beytelhikma-electron/test/distribution.test.js
git commit -m "feat(electron): résoudre une clé de catalogue contre une base configurable"
```

---

### Task 2 : la clé relative dans le pipeline Python

**Files:**
- Modify: `tools/_common.py` (DDL `book_releases`, `SCHEMA_VERSION`)
- Modify: `tools/shamela/catalogdb.py:174-190`
- Modify: `tools/gen_sample_data.py:614`
- Modify: `tools/publish_minio.py` (la réécriture finale)
- Test: `tools/shamela/tests/test_publish.py`, `tools/shamela/tests/test_pipeline.py`

**Interfaces:**
- Consumes: rien.
- Produces: colonne `book_releases.object_key` (remplace `download_url`) ; `tools/publish_minio.object_key(edition_id, content_version) -> str` (existe déjà, inchangée).

- [ ] **Step 1: Write the failing test**

Dans `tools/shamela/tests/test_publish.py`, remplacer `build_src` et
`test_upload_puis_reecriture_de_download_url` par leurs équivalents `object_key`,
et ajouter le test de la clé relative :

```python
def build_src(root):
    books = os.path.join(root, "books")
    os.makedirs(books)
    with open(os.path.join(books, "ed-a.sqlite.zst"), "wb") as fh:
        fh.write(b"compressed-bytes")
    with open(os.path.join(books, "ed-a.manifest.json"), "w", encoding="utf-8") as fh:
        json.dump({"sha256": "a" * 64, "size": 4096, "compressed_size": 16}, fh)

    con = sqlite3.connect(os.path.join(root, "catalog.sqlite"))
    con.execute(
        "CREATE TABLE book_releases (release_id TEXT PRIMARY KEY, edition_id TEXT,"
        " content_version INTEGER, object_key TEXT, compressed_size INTEGER, is_active INTEGER)"
    )
    con.execute(
        "INSERT INTO book_releases VALUES ('rel-a', 'ed-a', 1, 'asset://books/ed-a.sqlite', 0, 1)"
    )
    con.commit()
    con.close()
    return root


class PublishTest(unittest.TestCase):
    def test_upload_puis_reecriture_en_cle_relative(self):
        """Le catalogue publié ne doit contenir aucun hôte : c'est ce qui le
        rend servable depuis n'importe quel bucket sans le republier."""
        with tempfile.TemporaryDirectory() as root:
            build_src(root)
            client = FakeS3()
            report = publish(client, src=root, bucket="beytelhikma")

            self.assertEqual(report["uploaded"], 2)  # le livre et son manifest
            self.assertEqual(report["updated"], 1)
            key = object_key("ed-a", 1)
            self.assertIn(key, client.objects)

            con = sqlite3.connect(os.path.join(root, "catalog.sqlite"))
            stored, size = con.execute(
                "SELECT object_key, compressed_size FROM book_releases WHERE release_id='rel-a'"
            ).fetchone()
            con.close()
            self.assertEqual(stored, "books/ed-a/1/book.sqlite.zst")
            self.assertNotIn("://", stored, "aucun hôte ne doit subsister")
            self.assertEqual(size, 16)
```

Remplacer partout ailleurs dans ce fichier `public_base=…` par rien (le paramètre
disparaît), et `download_url` par `object_key` — notamment dans
`test_dry_run_n_ecrit_rien`, où l'assertion finale devient :

```python
            self.assertEqual(url, "asset://books/ed-a.sqlite")
```

Les appels `publish(client, src=root, bucket="b", public_base="http://x/b")`
deviennent `publish(client, src=root, bucket="b")`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tools && python -m unittest shamela.tests.test_publish -v`
Expected: FAIL — `TypeError: publish() missing 1 required keyword-only argument: 'public_base'`

- [ ] **Step 3: Modifier le DDL et le pipeline**

Dans `tools/_common.py`, dans `CATALOG_SCHEMA`, remplacer la ligne

```
    download_url      TEXT NOT NULL,
```

par

```
    object_key        TEXT NOT NULL,
```

et porter `SCHEMA_VERSION` à `2`.

Documenter la colonne juste au-dessus de la table :

```python
# `object_key` porte une clé **relative** à la base de distribution configurée
# côté client (`books/<edition_id>/<content_version>/book.sqlite.zst`). La
# présence de `://` marque un absolu : `asset://` et `local://` désignent la
# bibliothèque source et gardent les jeux hors ligne utilisables sans réseau.
```

Dans `tools/shamela/catalogdb.py`, l'`INSERT INTO book_releases` : remplacer
`download_url` par `object_key` dans la liste des colonnes, et la valeur
correspondante par la clé relative :

```python
                    f"books/{eid}/{CONTENT_VERSION}/book.sqlite.zst",
```

Dans `tools/gen_sample_data.py:614`, remplacer `download_url` par `object_key`
dans la liste des colonnes. La valeur `asset://books/<id>.sqlite` reste
inchangée : elle porte un schéma, donc elle est absolue, donc elle continue de
désigner les assets.

Dans `tools/publish_minio.py` : supprimer le paramètre `public_base` de
`publish()` et de `build_parser()`, et remplacer la réécriture finale.

```python
        updates.append((key, len(body), release_id))
```

```python
    if updates and not dry_run:
        con.executemany(
            "UPDATE book_releases SET object_key = ?, compressed_size = ? WHERE release_id = ?",
            updates,
        )
```

Dans `main()`, supprimer le calcul de `public_base` et son passage à `publish()`,
ainsi que l'option `--public-base`. Mettre à jour la docstring du module :

```python
"""Publie les livres importés vers un bucket S3 — MinIO ou AWS.

Entrée : la sortie de `import_shamela.py --compress` (`dist/shamela/`).
Sortie : les objets `books/<edition_id>/<content_version>/book.sqlite.zst` et
leur manifest, puis `object_key` réécrit dans `dist/shamela/catalog.sqlite`.

Le catalogue ne porte **aucun hôte** : seulement des clés relatives. C'est le
client qui les colle derrière l'URL de base qu'il a en réglage, ce qui rend le
même catalogue servable depuis AWS, un MinIO local ou un CDN.

Les chemins sont immutables : une nouvelle `content_version` crée un nouvel
objet, jamais un écrasement. C'est ce qui autorise `Cache-Control: immutable`.

Identifiants lus dans MINIO_ACCESS_KEY / MINIO_SECRET_KEY, à défaut dans les
AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY usuels. Jamais dans le dépôt.
"""
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tools && python -m unittest discover -s shamela/tests -t .`
Expected: PASS. `SchemaParityTest` doit passer — c'est lui qui garantit que
`gen_sample_data.py` et l'importeur produisent le même schéma.

- [ ] **Step 5: Régénérer le jeu d'exemple et vérifier la colonne**

```bash
python tools/gen_sample_data.py
python -c "import sqlite3; con=sqlite3.connect('beytelhikma/assets/sample/catalog.sqlite'); print([r[1] for r in con.execute('PRAGMA table_info(book_releases)')])"
```
Expected: la liste contient `object_key` et pas `download_url`.

Si le chemin des assets diffère, le lire dans `tools/gen_sample_data.py` plutôt
que de le deviner.

- [ ] **Step 6: Commit**

```bash
git add tools/ beytelhikma/assets/
git commit -m "feat(tools): le catalogue porte une clé relative, plus une URL"
```

---

### Task 3 : publier le catalogue et son pointeur

**Files:**
- Modify: `tools/publish_minio.py` (`_upload`, `publish_catalog`, `configure_bucket`, `main`)
- Test: `tools/shamela/tests/test_publish.py`

**Interfaces:**
- Consumes: `object_key()` de la tâche 2.
- Produces:
  - `catalog_key(catalog_version: int) -> str` → `catalog/<v>/catalog.sqlite.zst`
  - `POINTER_KEY = "catalog/latest.json"`
  - `publish_catalog(client, *, src, bucket, force=False, dry_run=False) -> dict`
  - `_upload(..., cache_control=CACHE_CONTROL)` — nouveau paramètre nommé

- [ ] **Step 1: Write the failing test**

Ajouter à `tools/shamela/tests/test_publish.py` :

```python
from publish_minio import (
    CACHE_CONTROL,
    POINTER_KEY,
    catalog_key,
    configure_bucket,
    ensure_bucket,
    object_key,
    publish,
    publish_catalog,
)


def build_catalog_info(root, catalog_version=2, schema_version=2, editions=397):
    con = sqlite3.connect(os.path.join(root, "catalog.sqlite"))
    con.execute(
        "CREATE TABLE catalog_info (catalog_version INTEGER, schema_version INTEGER,"
        " generated_at TEXT, edition_count INTEGER)"
    )
    con.execute(
        "INSERT INTO catalog_info VALUES (?,?,?,?)",
        (catalog_version, schema_version, "2026-07-31T14:37:43Z", editions),
    )
    con.commit()
    con.close()


class PublishCatalogTest(unittest.TestCase):
    def test_catalogue_et_pointeur_montes(self):
        with tempfile.TemporaryDirectory() as root:
            build_src(root)
            build_catalog_info(root)
            client = FakeS3()

            report = publish_catalog(client, src=root, bucket="b")

            self.assertEqual(report["catalog_version"], 2)
            self.assertIn(catalog_key(2), client.objects)
            self.assertIn(POINTER_KEY, client.objects)

            pointer = json.loads(client.objects[POINTER_KEY])
            self.assertEqual(pointer["catalog_version"], 2)
            self.assertEqual(pointer["schema_version"], 2)
            self.assertEqual(pointer["edition_count"], 397)
            self.assertEqual(pointer["object_key"], catalog_key(2))
            self.assertEqual(len(pointer["sha256"]), 64)
            self.assertGreater(pointer["compressed_size"], 0)
            self.assertGreater(pointer["uncompressed_size"], 0)

    def test_le_pointeur_n_est_jamais_mis_en_cache(self):
        """Un pointeur en `immutable` ne désignerait jamais rien de nouveau :
        la mise à jour serait morte sans qu'aucun autre test n'échoue."""
        with tempfile.TemporaryDirectory() as root:
            build_src(root)
            build_catalog_info(root)
            client = FakeS3()

            publish_catalog(client, src=root, bucket="b")

            self.assertEqual(client.put_kwargs[POINTER_KEY]["CacheControl"], "no-cache")
            self.assertEqual(client.put_kwargs[catalog_key(2)]["CacheControl"], CACHE_CONTROL)

    def test_essai_a_blanc_ne_monte_rien(self):
        with tempfile.TemporaryDirectory() as root:
            build_src(root)
            build_catalog_info(root)
            client = FakeS3()

            report = publish_catalog(client, src=root, bucket="b", dry_run=True)

            self.assertEqual(client.puts, [])
            self.assertEqual(report["catalog_version"], 2)
            self.assertEqual(report["planned"], 2)
```

Et, dans `ConfigureBucketTest`, remplacer l'assertion sur `Resource` :

```python
        self.assertEqual(
            statement["Resource"],
            ["arn:aws:s3:::b/books/*", "arn:aws:s3:::b/catalog/*"],
        )
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tools && python -m unittest shamela.tests.test_publish -v`
Expected: FAIL — `ImportError: cannot import name 'publish_catalog'`

- [ ] **Step 3: Write the implementation**

Dans `tools/publish_minio.py` :

Étendre la policy — remplacer le corps de `set_anonymous_policy` :

```python
def set_anonymous_policy(client, bucket):
    """Rend `books/*` et `catalog/*` lisibles sans authentification.

    Deux préfixes explicites, jamais le bucket entier : le listing anonyme doit
    continuer de répondre 403. Le catalogue ne porte que des métadonnées de
    livres déjà publics — l'ouvrir ne concède rien.
    """
    policy = json.loads(json.dumps(READ_ONLY_POLICY))
    policy["Statement"][0]["Resource"] = [
        f"arn:aws:s3:::{bucket}/books/*",
        f"arn:aws:s3:::{bucket}/catalog/*",
    ]
    client.put_bucket_policy(Bucket=bucket, Policy=json.dumps(policy))
```

Ajouter les clés et le cache du pointeur, près de `CACHE_CONTROL` :

```python
# Le pointeur est la seule chose du bucket qui change sous une clé fixe. Le
# mettre en cache comme le reste tuerait la mise à jour en silence.
POINTER_KEY = "catalog/latest.json"
POINTER_CACHE_CONTROL = "no-cache"


def catalog_key(catalog_version: int) -> str:
    return f"catalog/{catalog_version}/catalog.sqlite.zst"
```

Donner un cache par appel à `_upload` — signature et `put_object` :

```python
def _upload(client, bucket, key, body, content_type, metadata, force, report,
            cache_control=CACHE_CONTROL):
```

```python
    client.put_object(
        Bucket=bucket,
        Key=key,
        Body=body,
        ContentType=content_type,
        CacheControl=cache_control,
        Metadata=metadata,
    )
    report["uploaded"] += 1
```

Attention : le raccourci « même taille = déjà là » de `_upload` est faux pour le
pointeur, dont la taille ne bouge pas d'une version à l'autre. Le pointeur est
donc toujours monté en `force=True`.

Ajouter la publication du catalogue, après `publish()` :

```python
def publish_catalog(client, *, src, bucket, force=False, dry_run=False):
    """Monte le catalogue compressé sous un chemin versionné, puis son pointeur.

    Le pointeur est écrit **en dernier** : tant qu'il n'a pas bougé, aucun client
    ne peut découvrir un catalogue à moitié monté.
    """
    import hashlib

    catalog_path = os.path.join(src, "catalog.sqlite")
    if not os.path.exists(catalog_path):
        raise SystemExit(f"catalogue introuvable : {catalog_path}")

    con = sqlite3.connect(catalog_path)
    row = con.execute(
        "SELECT catalog_version, schema_version, generated_at, edition_count FROM catalog_info"
    ).fetchone()
    con.close()
    if row is None:
        raise SystemExit("catalog_info est vide : impossible de versionner le catalogue")
    catalog_version, schema_version, generated_at, edition_count = row

    report = {
        "catalog_version": catalog_version,
        "uploaded": 0,
        "skipped": 0,
        "planned": 0,
        "compressed": 0,
        "missing": [],
    }
    if dry_run:
        report["planned"] = 2  # le catalogue et son pointeur
        return report

    try:
        import zstandard
    except ImportError:
        print("erreur : zstandard est requis (pip install zstandard)", file=sys.stderr)
        raise SystemExit(2)

    with open(catalog_path, "rb") as fh:
        raw = fh.read()
    body = zstandard.ZstdCompressor(level=19).compress(raw)
    report["compressed"] += 1

    key = catalog_key(catalog_version)
    _upload(
        client,
        bucket,
        key,
        body,
        "application/zstd",
        {
            "sha256": hashlib.sha256(raw).hexdigest(),
            "uncompressed-size": str(len(raw)),
        },
        force,
        report,
    )

    pointer = {
        "catalog_version": catalog_version,
        "schema_version": schema_version,
        "generated_at": generated_at,
        "edition_count": edition_count,
        "object_key": key,
        "sha256": hashlib.sha256(raw).hexdigest(),
        "compressed_size": len(body),
        "uncompressed_size": len(raw),
    }
    _upload(
        client,
        bucket,
        POINTER_KEY,
        json.dumps(pointer, ensure_ascii=False, indent=2).encode("utf-8"),
        "application/json",
        {},
        True,  # jamais sauté : sa taille ne change pas d'une version à l'autre
        report,
        cache_control=POINTER_CACHE_CONTROL,
    )
    return report
```

Dans `build_parser()`, ajouter :

```python
    parser.add_argument("--catalog-only", action="store_true",
                        help="ne publier que le catalogue et son pointeur")
    parser.add_argument("--skip-catalog", action="store_true",
                        help="ne publier que les livres")
```

Dans `main()`, après la publication des livres :

```python
    if not args.catalog_only:
        report = publish(client, src=args.src, bucket=args.bucket,
                         force=args.force, dry_run=args.dry_run)
        if args.dry_run:
            print(
                f"essai à blanc — objets à envoyer : {report['planned']} • "
                f"à compresser : {report['would_compress']} • "
                f"livres sans fichier : {len(report['missing'])}"
            )
        else:
            print(
                f"envoyés : {report['uploaded']} • ignorés : {report['skipped']} • "
                f"compressés : {report['compressed']} • catalogue mis à jour : {report['updated']}"
            )

    if not args.skip_catalog:
        catalog_report = publish_catalog(client, src=args.src, bucket=args.bucket,
                                         force=args.force, dry_run=args.dry_run)
        verbe = "à publier" if args.dry_run else "publié"
        print(f"catalogue v{catalog_report['catalog_version']} {verbe} • pointeur {POINTER_KEY}")
    return 0
```

Le catalogue est publié **après** les livres : un pointeur qui annonce des
éditions dont les objets ne sont pas encore montés ferait échouer des
téléchargements.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tools && python -m unittest discover -s shamela/tests -t .`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tools/publish_minio.py tools/shamela/tests/test_publish.py
git commit -m "feat(tools): publier le catalogue versionné et son pointeur"
```

---

### Task 4 : le client lit une clé, plus une URL

**Files:**
- Modify: `beytelhikma-electron/src/main/book-repository.js:287-303` (`#activeRelease`), `:1877-1885` (`setDownloadBaseUrl`)
- Modify: `beytelhikma-electron/src/main/download-manager.js:51-70`, `:219-235`, `:374-382`
- Modify: `beytelhikma-electron/src/main/main.js:27`
- Test: `beytelhikma-electron/test/download-manager.test.js`

**Interfaces:**
- Consumes: `resolveObject`, `DEFAULT_BASE_URL` (tâche 1) ; colonne `object_key` (tâche 2).
- Produces: `DownloadQueue` résout par `distribution.js` ; réglage `distribution.base_url`.

- [ ] **Step 1: Write the failing test**

Ajouter à `beytelhikma-electron/test/download-manager.test.js` :

```js
test('la clé relative est résolue contre la base configurée', async (t) => {
  // Le catalogue ne porte plus d'hôte : c'est la base qui décide où chercher.
  const root = tempRoot(t);
  const bytes = Buffer.from('SQLite format 3\0'.repeat(40));
  const packed = zlib.zstdCompressSync ? zlib.zstdCompressSync(bytes) : null;
  assert.ok(packed, 'zstd doit être disponible dans ce Node');

  let demandé = null;
  handler = (request, response) => {
    demandé = request.url;
    response.writeHead(200, { 'content-length': packed.length });
    response.end(packed);
  };

  const queue = new DownloadQueue({
    storageRoot: root,
    librarySource: null,
    baseUrl: origin,
    resolveRelease: async () => ({
      releaseId: 'ed-a-v1',
      objectKey: 'books/ed-a/1/book.sqlite.zst',
      sha256: createHash('sha256').update(bytes).digest('hex'),
      compressedSize: packed.length,
      uncompressedSize: bytes.length,
    }),
    persist: async () => {},
  });

  await installOnce(queue, 'ed-a');
  assert.equal(demandé, '/books/ed-a/1/book.sqlite.zst');
});
```

Suivre les conventions du fichier existant pour `tempRoot`, `handler`, `origin` et
l'attente de fin de job : les lire en tête de fichier plutôt que d'inventer des
noms. Si aucun utilitaire `installOnce` n'existe, écrire l'attente sur l'événement
`change` comme le font les tests voisins.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd beytelhikma-electron && npx node --test test/download-manager.test.js`
Expected: FAIL — l'URL demandée est `undefined` ou l'origine n'est pas appliquée.

- [ ] **Step 3: Write the implementation**

Dans `download-manager.js`, importer le module partagé :

```js
import { resolveObject } from '../shared/distribution.js';
```

Remplacer le début d'`installRelease` :

```js
export async function installRelease({
  release,
  storageRoot,
  librarySource = null,
  baseUrl = null,
  signal,
  onProgress,
}) {
  fs.mkdirSync(path.join(storageRoot, 'books'), { recursive: true });
  fs.mkdirSync(path.join(storageRoot, 'downloads'), { recursive: true });

  const target = resolveObject(baseUrl, release.objectKey);
  if (target.kind === 'library') {
    return installFromLibrary({ release, storageRoot, librarySource, onProgress });
  }

  const part = partPath(storageRoot, release.editionId);
  await fetchToPart({ release: { ...release, url: target.url }, part, signal, onProgress });
  const installed = await unpackAndVerify({ release, part, storageRoot });
  fs.rmSync(part, { force: true });
  return installed;
}
```

Supprimer `#applyBaseUrl` et son appel : la résolution vit désormais dans
`distribution.js`. Là où `#run` appelait `installRelease`, passer `baseUrl` :

```js
      await installRelease({
        release: { ...release, editionId },
        storageRoot: this.#storageRoot,
        librarySource: this.#librarySource,
        baseUrl: this.#baseUrl,
        signal: controller.signal,
        onProgress,
      });
```

Lire le corps exact de `#run` avant d'éditer — la forme des arguments doit rester
celle du fichier.

Mettre à jour le commentaire de `setBaseUrl` :

```js
  /** Réglage `distribution.base_url` : préfixe des clés du catalogue. */
```

Dans `book-repository.js`, `#activeRelease` :

```js
  async #activeRelease(editionId) {
    const catalog = await this.#db.catalog();
    const row = first(
      catalog,
      `SELECT release_id, object_key, sha256, compressed_size, uncompressed_size
       FROM book_releases WHERE edition_id = ? AND is_active = 1 LIMIT 1`,
      [editionId],
    );
    if (!row) return null;
    return {
      releaseId: row.release_id,
      objectKey: row.object_key,
      sha256: row.sha256,
      compressedSize: row.compressed_size ?? 0,
      uncompressedSize: row.uncompressed_size ?? 0,
    };
  }
```

Et `setDownloadBaseUrl` — remplacer `'minio.base_url'` par
`'distribution.base_url'`, en gardant le reste. Mettre à jour le commentaire :

```js
  /** Applique `distribution.base_url` à la file en cours, sans redémarrage. */
```

Dans `main.js:27` :

```js
  downloads.setBaseUrl(settings['distribution.base_url'] ?? null);
```

- [ ] **Step 4: Run the full suite**

Run: `cd beytelhikma-electron && npm test`
Expected: PASS. Si `repository.test.js` échoue sur `download_url`, c'est le jeu
d'exemple qui n'a pas été régénéré à la tâche 2 — le refaire plutôt que d'adapter
le test.

- [ ] **Step 5: Commit**

```bash
git add beytelhikma-electron/src beytelhikma-electron/test
git commit -m "feat(electron): résoudre les livres par clé relative et base configurée"
```

---

### Task 5 : lire le pointeur et décider

**Files:**
- Create: `beytelhikma-electron/src/main/catalog-updater.js`
- Test: `beytelhikma-electron/test/catalog-updater.test.js`

**Interfaces:**
- Consumes: `resolveObject` (tâche 1).
- Produces:
  - `SUPPORTED_SCHEMA_VERSION = 2`
  - `decideUpdate({ pointer, localVersion, declinedVersion }) -> { action: 'none' | 'offer', reason: string, pointer }`
  - `fetchPointer(baseUrl, { signal }) -> object | null`

- [ ] **Step 1: Write the failing test**

Créer `beytelhikma-electron/test/catalog-updater.test.js` :

```js
import assert from 'node:assert/strict';
import http from 'node:http';
import test, { after, before } from 'node:test';

import {
  SUPPORTED_SCHEMA_VERSION,
  decideUpdate,
  fetchPointer,
} from '../src/main/catalog-updater.js';

let server;
let origin;
let handler;

before(async () => {
  server = http.createServer((request, response) => handler(request, response));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function pointeur(patch = {}) {
  return {
    catalog_version: 3,
    schema_version: SUPPORTED_SCHEMA_VERSION,
    generated_at: '2026-08-01T10:00:00Z',
    edition_count: 500,
    object_key: 'catalog/3/catalog.sqlite.zst',
    sha256: 'b'.repeat(64),
    compressed_size: 8_380_000,
    uncompressed_size: 45_000_000,
    ...patch,
  };
}

test('une version plus récente est proposée', () => {
  const verdict = decideUpdate({ pointer: pointeur(), localVersion: 2, declinedVersion: null });
  assert.equal(verdict.action, 'offer');
  assert.equal(verdict.pointer.catalog_version, 3);
});

test('une version identique ou plus ancienne ne dit rien', () => {
  for (const locale of [3, 4]) {
    const verdict = decideUpdate({ pointer: pointeur(), localVersion: locale, declinedVersion: null });
    assert.equal(verdict.action, 'none', `locale ${locale}`);
  }
});

test('une version refusée se tait, la suivante non', () => {
  // Refuser la 3 ne doit pas faire taire la 4 : sinon un seul « plus tard »
  // condamne l'application à ne plus jamais se mettre à jour.
  const refusée = decideUpdate({ pointer: pointeur(), localVersion: 2, declinedVersion: 3 });
  assert.equal(refusée.action, 'none');

  const suivante = decideUpdate({
    pointer: pointeur({ catalog_version: 4 }),
    localVersion: 2,
    declinedVersion: 3,
  });
  assert.equal(suivante.action, 'offer');
});

test('un schéma trop récent ne propose rien', () => {
  // L'application ne saurait pas lire ce catalogue : le proposer mènerait à une
  // installation qui casse tout.
  const verdict = decideUpdate({
    pointer: pointeur({ schema_version: SUPPORTED_SCHEMA_VERSION + 1 }),
    localVersion: 2,
    declinedVersion: null,
  });
  assert.equal(verdict.action, 'none');
  assert.equal(verdict.reason, 'schemaTooNew');
});

test('un pointeur incomplet ne propose rien', () => {
  for (const cassé of [null, {}, { catalog_version: 'trois' }, pointeur({ object_key: '' })]) {
    const verdict = decideUpdate({ pointer: cassé, localVersion: 1, declinedVersion: null });
    assert.equal(verdict.action, 'none');
  }
});

test('un serveur injoignable rend null, sans lever', async () => {
  const pointeurNul = await fetchPointer('http://127.0.0.1:1/', { timeoutMs: 200 });
  assert.equal(pointeurNul, null);
});

test('un pointeur non JSON rend null', async () => {
  handler = (request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('<html>pas du json</html>');
  };
  assert.equal(await fetchPointer(origin, {}), null);
});

test('un 404 rend null', async () => {
  handler = (request, response) => {
    response.writeHead(404);
    response.end();
  };
  assert.equal(await fetchPointer(origin, {}), null);
});

test('le pointeur est lu sous catalog/latest.json', async () => {
  let demandé = null;
  handler = (request, response) => {
    demandé = request.url;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(pointeur()));
  };

  const lu = await fetchPointer(origin, {});
  assert.equal(demandé, '/catalog/latest.json');
  assert.equal(lu.catalog_version, 3);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd beytelhikma-electron && npx node --test test/catalog-updater.test.js`
Expected: FAIL — `Cannot find module '../src/main/catalog-updater.js'`

- [ ] **Step 3: Write the implementation**

Créer `beytelhikma-electron/src/main/catalog-updater.js` :

```js
/**
 * Mise à jour du catalogue depuis la source de distribution.
 *
 * Principe directeur : **une source injoignable ne dégrade jamais la lecture.**
 * L'application embarque son catalogue et fonctionne hors ligne ; le pointeur
 * n'est qu'une occasion de faire mieux. Cinq branches de décision sur six sont
 * donc silencieuses — une application hors ligne ne doit rien afficher
 * d'anxiogène, elle a déjà tout ce qu'il lui faut pour explorer.
 */

import { resolveObject } from '../shared/distribution.js';

/** Version de schéma de catalogue que ce client sait lire. */
export const SUPPORTED_SCHEMA_VERSION = 2;

/** Clé du pointeur, seul objet du bucket qui change sous une clé fixe. */
export const POINTER_KEY = 'catalog/latest.json';

const POINTER_TIMEOUT_MS = 8000;

/**
 * Lit le pointeur. Renvoie `null` pour **toute** anomalie — réseau, HTTP, JSON.
 * Aucune levée : l'appelant est un démarrage d'application, pas une requête
 * utilisateur, et il n'a rien à rattraper.
 */
export async function fetchPointer(baseUrl, { signal = null, timeoutMs = POINTER_TIMEOUT_MS } = {}) {
  const { url } = resolveObject(baseUrl, POINTER_KEY);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return null;
    return JSON.parse(await response.text());
  } catch {
    return null; // hors ligne, DNS mort, JSON cassé : silence
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

function estEntierPositif(valeur) {
  return Number.isInteger(valeur) && valeur > 0;
}

/**
 * Décide s'il y a lieu de proposer une mise à jour. Fonction pure : c'est elle
 * qu'on teste, pas le réseau.
 */
export function decideUpdate({ pointer, localVersion, declinedVersion }) {
  if (!pointer || typeof pointer !== 'object') {
    return { action: 'none', reason: 'noPointer', pointer: null };
  }
  if (!estEntierPositif(pointer.catalog_version) || !pointer.object_key) {
    return { action: 'none', reason: 'malformed', pointer: null };
  }
  if (!estEntierPositif(pointer.schema_version) || pointer.schema_version > SUPPORTED_SCHEMA_VERSION) {
    // L'application est trop ancienne pour ce catalogue. Le dire n'aiderait
    // pas : elle ne peut rien en faire.
    return { action: 'none', reason: 'schemaTooNew', pointer: null };
  }
  if (pointer.catalog_version <= (localVersion ?? 0)) {
    return { action: 'none', reason: 'upToDate', pointer: null };
  }
  if (pointer.catalog_version === declinedVersion) {
    return { action: 'none', reason: 'declined', pointer: null };
  }
  return { action: 'offer', reason: 'newer', pointer };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd beytelhikma-electron && npx node --test test/catalog-updater.test.js`
Expected: PASS, 9 tests

- [ ] **Step 5: Commit**

```bash
git add beytelhikma-electron/src/main/catalog-updater.js beytelhikma-electron/test/catalog-updater.test.js
git commit -m "feat(electron): lire le pointeur de catalogue et décider sans bruit"
```

---

### Task 6 : installer le catalogue par échange atomique

**Files:**
- Modify: `beytelhikma-electron/src/main/catalog-updater.js`
- Modify: `beytelhikma-electron/src/main/app-database.js` (fermeture/réouverture du catalogue)
- Test: `beytelhikma-electron/test/catalog-updater.test.js`

**Interfaces:**
- Consumes: `fetchPointer`, `decideUpdate` (tâche 5) ; `installRelease` de `download-manager.js`.
- Produces: `installCatalog({ pointer, baseUrl, storageRoot, signal, onProgress }) -> string` (chemin installé) ; `AppDatabase.reloadCatalog() -> Promise<void>`.

- [ ] **Step 1: Write the failing test**

Ajouter à `beytelhikma-electron/test/catalog-updater.test.js` :

```js
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

import { installCatalog } from '../src/main/catalog-updater.js';

function racineJetable(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beyt-catalog-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('le catalogue est installé et vérifié', async (t) => {
  const root = racineJetable(t);
  const bytes = Buffer.from('SQLite format 3\0'.repeat(64));
  const packed = zlib.zstdCompressSync(bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  handler = (request, response) => {
    response.writeHead(200, { 'content-length': packed.length });
    response.end(packed);
  };

  const installé = await installCatalog({
    pointer: pointeur({ sha256, compressed_size: packed.length, uncompressed_size: bytes.length }),
    baseUrl: origin,
    storageRoot: root,
  });

  assert.equal(installé, path.join(root, 'catalog.sqlite'));
  assert.deepEqual(fs.readFileSync(installé), bytes);
});

test('un SHA-256 faux laisse l’ancien catalogue en place', async (t) => {
  // C'est la propriété qui compte : un catalogue corrompu ne remplace jamais
  // un catalogue valide.
  const root = racineJetable(t);
  const ancien = path.join(root, 'catalog.sqlite');
  fs.writeFileSync(ancien, Buffer.from('ancien catalogue'));

  const bytes = Buffer.from('SQLite format 3\0'.repeat(64));
  const packed = zlib.zstdCompressSync(bytes);
  handler = (request, response) => {
    response.writeHead(200, { 'content-length': packed.length });
    response.end(packed);
  };

  await assert.rejects(
    installCatalog({
      pointer: pointeur({ sha256: 'c'.repeat(64), compressed_size: packed.length }),
      baseUrl: origin,
      storageRoot: root,
    }),
  );

  assert.deepEqual(fs.readFileSync(ancien), Buffer.from('ancien catalogue'));
  assert.equal(fs.existsSync(`${ancien}.new`), false, 'aucun reste à moitié écrit');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd beytelhikma-electron && npx node --test test/catalog-updater.test.js`
Expected: FAIL — `installCatalog is not a function`

- [ ] **Step 3: Write the implementation**

Ajouter à `catalog-updater.js` :

```js
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import zlib from 'node:zlib';

/**
 * Télécharge, vérifie et installe le catalogue désigné par [pointer].
 *
 * L'ordre est la garantie : on ne renomme qu'après avoir vérifié. Une coupure à
 * n'importe quel point laisse l'ancien catalogue intact et lisible — jamais de
 * catalogue à moitié écrit.
 */
export async function installCatalog({ pointer, baseUrl, storageRoot, signal = null, onProgress }) {
  const target = resolveObject(baseUrl, pointer.object_key);
  if (target.kind !== 'http') {
    throw new Error(`clé de catalogue non téléchargeable : ${pointer.object_key}`);
  }

  const destination = path.join(storageRoot, 'catalog.sqlite');
  const part = `${destination}.part`;
  const staged = `${destination}.new`;
  fs.mkdirSync(storageRoot, { recursive: true });

  const response = await fetch(target.url, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error(`catalogue introuvable (HTTP ${response.status})`);

  const total = pointer.compressed_size || Number(response.headers.get('content-length')) || 0;
  let reçus = 0;
  const compteur = new TransformStream === undefined ? null : null; // non utilisé

  try {
    const digest = createHash('sha256');
    const sortie = fs.createWriteStream(staged);
    const décompresseur = zlib.createZstdDecompress();
    décompresseur.on('data', (chunk) => digest.update(chunk));

    await pipeline(
      async function* () {
        for await (const chunk of response.body) {
          reçus += chunk.length;
          onProgress?.({ receivedBytes: reçus, totalBytes: total });
          yield chunk;
        }
      },
      décompresseur,
      sortie,
    );

    const obtenu = digest.digest('hex');
    if (pointer.sha256 && obtenu !== pointer.sha256) {
      throw new Error(`empreinte du catalogue invalide : ${obtenu} au lieu de ${pointer.sha256}`);
    }

    fs.renameSync(staged, destination); // atomique : le dernier geste
    return destination;
  } catch (error) {
    fs.rmSync(staged, { force: true });
    fs.rmSync(part, { force: true });
    throw error;
  }
}
```

Supprimer la ligne `const compteur = …` : elle ne sert à rien, elle est là par
inadvertance. (Si elle apparaît dans le fichier, la retirer avant de commiter.)

Dans `app-database.js`, ajouter la réouverture après échange, à côté de
`catalog()` :

```js
  /**
   * Referme le catalogue en mémoire et le rouvre depuis le disque.
   *
   * sql.js charge le fichier entier en mémoire : sans cette fermeture, l'ancien
   * catalogue resterait servi jusqu'au redémarrage, et l'échange n'aurait
   * visiblement aucun effet.
   */
  async reloadCatalog() {
    this.#catalog?.close();
    this.#catalog = null;
    await this.catalog();
  }
```

Vérifier avant d'écrire que `#catalog` et `catalog()` portent bien ces noms
(`app-database.js:178`, `:267`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd beytelhikma-electron && npx node --test test/catalog-updater.test.js`
Expected: PASS

Si `zlib.createZstdDecompress` n'existe pas dans le Node utilisé, reprendre la
décompression exactement comme `download-manager.js` la fait (`unpackAndVerify`)
plutôt que d'introduire une seconde façon de décompresser.

- [ ] **Step 5: Commit**

```bash
git add beytelhikma-electron/src/main beytelhikma-electron/test/catalog-updater.test.js
git commit -m "feat(electron): installer le catalogue par échange atomique"
```

---

### Task 7 : réconcilier la bibliothèque installée

**Files:**
- Modify: `beytelhikma-electron/src/main/app-database.js:202-230` (`#syncInstalledLibrary`)
- Modify: `beytelhikma-electron/src/main/book-repository.js` (`getLibrary`, exposition du drapeau)
- Test: `beytelhikma-electron/test/library.test.js`

**Interfaces:**
- Consumes: `downloaded_books.release_id`, `book_releases.release_id` (existants).
- Produces: chaque ligne de `getLibrary()` porte `hasNewerRelease: boolean` et `inCatalog: boolean`.

- [ ] **Step 1: Write the failing test**

Ajouter à `beytelhikma-electron/test/library.test.js` :

```js
test('une réédition est signalée, jamais appliquée', async (t) => {
  // Les ancres de surlignage sont posées sur le texte rendu : une réédition
  // peut les déplacer. Ce doit être un choix, jamais un effet de bord.
  const { repository, catalog, storageRoot } = await bibliothèqueDeTest(t);

  await repository.saveProgress('ed-a', { pageId: 1, sequenceNum: 1, percent: 10 });
  catalog.run("UPDATE book_releases SET release_id = 'ed-a-v2', content_version = 2 WHERE edition_id = 'ed-a'");

  const { rows } = await repository.getLibrary({ limit: 10, offset: 0 });
  const ligne = rows.find((row) => row.editionId === 'ed-a');

  assert.equal(ligne.hasNewerRelease, true);
  assert.equal(fs.existsSync(path.join(storageRoot, 'books', 'ed-a.sqlite')), true,
    'aucun fichier ne doit être supprimé');
});
```

Utiliser les utilitaires de montage déjà présents en tête de `library.test.js`
(nom, signature et forme de retour) plutôt que d'inventer `bibliothèqueDeTest` :
lire le fichier d'abord et adapter ce test à ses conventions.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd beytelhikma-electron && npx node --test test/library.test.js`
Expected: FAIL — `hasNewerRelease` vaut `undefined`

- [ ] **Step 3: Write the implementation**

Dans `app-database.js`, remplacer `#syncInstalledLibrary` :

```js
  /**
   * Marque la bibliothèque installée quand la source change.
   *
   * L'ancienne version purgeait tous les livres dès que la source changeait.
   * C'était correct quand la source était un dossier de développement ; avec un
   * catalogue qui se met à jour tout seul, ce serait retélécharger la
   * bibliothèque entière à chaque rafraîchissement.
   *
   * La réconciliation se fait désormais **par édition**, à la lecture, en
   * comparant `downloaded_books.release_id` au `release_id` actif du catalogue.
   * Aucun fichier n'est supprimé ici. Jamais.
   */
  #syncInstalledLibrary() {
    const marker = path.join(this.#root, 'library.json');
    const current = { source: path.resolve(this.#source) };

    let previous = null;
    try {
      previous = JSON.parse(fs.readFileSync(marker, 'utf8'));
    } catch {
      previous = null;
    }

    if (previous?.source !== current.source) {
      fs.writeFileSync(
        marker,
        JSON.stringify({ ...current, installedAt: new Date().toISOString() }, null, 2),
      );
    }
  }
```

Dans `book-repository.js`, la requête de `getLibrary` : ajouter au `SELECT` du
catalogue le `release_id` actif, et comparer avec celui installé. Lire la méthode
avant d'éditer — elle joint deux instances sql.js et l'ordre de titre vient d'un
cache (`#titleOrder`). Le calcul à ajouter, sur chaque ligne produite :

```js
      hasNewerRelease: Boolean(
        installed.release_id && active?.release_id && installed.release_id !== active.release_id,
      ),
      inCatalog: Boolean(active),
```

`getLibrary` filtre déjà les lignes absentes du catalogue ; ce filtre doit être
**remplacé** par le drapeau `inCatalog` afin qu'un livre retiré du catalogue reste
lisible. Mettre à jour le commentaire correspondant dans `CLAUDE.md` à la tâche 9.

- [ ] **Step 4: Run the full suite**

Run: `cd beytelhikma-electron && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add beytelhikma-electron/src beytelhikma-electron/test
git commit -m "feat(electron): signaler les rééditions au lieu de purger la bibliothèque"
```

---

### Task 8 : la bannière et le réglage

**Files:**
- Modify: `beytelhikma-electron/src/main/book-repository.js` (méthodes exposées)
- Modify: `beytelhikma-electron/src/preload/preload.cjs` (`METHODS`)
- Modify: `beytelhikma-electron/src/renderer/js/views/settings.js:180-215`
- Test: `beytelhikma-electron/test/repository.test.js` (parité des listes)

**Interfaces:**
- Consumes: `fetchPointer`, `decideUpdate`, `installCatalog` (tâches 5-6).
- Produces: `checkCatalogUpdate() -> { action, pointer }`, `installCatalogUpdate() -> { catalogVersion }`, `declineCatalogUpdate(version) -> void`.

- [ ] **Step 1: Write the failing test**

Le test de parité existe déjà dans `repository.test.js` : il compare `METHODS` de
`preload.cjs` et `REPOSITORY_METHODS` de `book-repository.js`. Ajouter d'abord les
trois noms dans **une seule** des deux listes, lancer le test, et vérifier qu'il
échoue — c'est la preuve que le garde-fou fonctionne.

Run: `cd beytelhikma-electron && npx node --test test/repository.test.js`
Expected: FAIL, avec les trois noms manquants nommés.

- [ ] **Step 2: Implémenter les trois méthodes**

Dans `book-repository.js`, à côté de `setDownloadBaseUrl` :

```js
  /** Vérifie s'il existe un catalogue plus récent. Silencieux en cas d'échec. */
  async checkCatalogUpdate() {
    const settings = await this.getSettings();
    const pointer = await fetchPointer(settings['distribution.base_url'] ?? null, {});
    const catalog = await this.#db.catalog();
    const info = first(catalog, 'SELECT catalog_version FROM catalog_info LIMIT 1');
    const declined = Number(settings['distribution.declined_catalog_version'] ?? 0) || null;

    return decideUpdate({
      pointer,
      localVersion: info?.catalog_version ?? 0,
      declinedVersion: declined,
    });
  }

  /** Installe le catalogue proposé, puis rouvre celui que sql.js sert. */
  async installCatalogUpdate() {
    const verdict = await this.checkCatalogUpdate();
    if (verdict.action !== 'offer') return { catalogVersion: null };

    const settings = await this.getSettings();
    await installCatalog({
      pointer: verdict.pointer,
      baseUrl: settings['distribution.base_url'] ?? null,
      storageRoot: this.#db.root,
    });
    await this.#db.reloadCatalog();
    return { catalogVersion: verdict.pointer.catalog_version };
  }

  /** Note un refus. Refuser la version N ne fait pas taire la N+1. */
  async declineCatalogUpdate(version) {
    await this.saveSetting('distribution.declined_catalog_version', String(version ?? ''));
  }
```

Importer en tête de `book-repository.js` :

```js
import { decideUpdate, fetchPointer, installCatalog } from './catalog-updater.js';
```

Vérifier le nom réel de l'accesseur de racine sur `AppDatabase` (`this.#db.root`
ci-dessus) : lire `app-database.js` et utiliser celui qui existe.

Ajouter les trois noms **aux deux** listes, `REPOSITORY_METHODS` et `METHODS`.

- [ ] **Step 3: Run the parity test**

Run: `cd beytelhikma-electron && npx node --test test/repository.test.js`
Expected: PASS

- [ ] **Step 4: La section de réglages**

Dans `settings.js`, remplacer `serverSection` :

```js
/**
 * `distribution.base_url` préfixe les clés du catalogue. Le catalogue ne porte
 * plus d'hôte : changer cette valeur suffit à servir la même bibliothèque
 * depuis un autre bucket, sans rien retélécharger de ce qui est installé.
 */
function serverSection(prefs, refresh) {
  const field = h('input', {
    type: 'url',
    class: 'settings__field',
    value: prefs['distribution.base_url'] ?? '',
    placeholder: 'https://beytelhima-library.s3.eu-west-1.amazonaws.com',
  });

  return group(
    'مصدر التنزيل',
    'اتركه فارغًا لاستخدام المصدر الافتراضي.',
    row(
      'عنوان المصدر',
      h(
        'div',
        { class: 'settings__inline' },
        field,
        h(
          'button',
          {
            class: 'button button--filled',
            onclick: async () => {
              await repository.setDownloadBaseUrl(field.value);
              toast('حُفظ عنوان المصدر');
              refresh();
            },
          },
          'حفظ',
        ),
      ),
      'يُطبَّق فورًا على التنزيلات التالية',
    ),
    row(
      'الفهرس',
      h(
        'button',
        {
          class: 'button',
          onclick: async () => {
            const verdict = await repository.checkCatalogUpdate();
            if (verdict.action !== 'offer') {
              toast('الفهرس محدَّث');
              return;
            }
            const { catalogVersion } = await repository.installCatalogUpdate();
            toast(`حُدِّث الفهرس إلى الإصدار ${catalogVersion}`);
            refresh();
          },
        },
        'التحقّق من التحديثات',
      ),
      'يُنزَّل الفهرس كاملًا ويُستبدل دفعة واحدة',
    ),
  );
}
```

Adapter `group`, `row`, `h`, `toast` aux signatures réelles du fichier — les lire
avant d'écrire.

- [ ] **Step 5: Run the full suite**

Run: `cd beytelhikma-electron && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add beytelhikma-electron/src beytelhikma-electron/test
git commit -m "feat(electron): proposer la mise à jour du catalogue depuis les réglages"
```

---

### Task 9 : republier et documenter

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-07-31-minio-book-lifecycle-design.md` (note de renvoi)

- [ ] **Step 1: Republier le corpus avec le nouveau format**

```bash
python tools/import_shamela.py --books-per-category 10 --resume --compress --jobs 8
set -a; . ./.env; set +a
MINIO_ACCESS_KEY="$AWS_ACCESS_KEY_ID" MINIO_SECRET_KEY="$AWS_SECRET_ACCESS_KEY" \
  python tools/publish_minio.py --endpoint aws --region "$AWS_REGION" \
  --bucket "$BUCKET_NAME" --set-anonymous-policy --dry-run
```

Expected: la policy annonce deux préfixes, l'essai à blanc annonce les objets et
le catalogue.

Puis sans `--dry-run`.

- [ ] **Step 2: Vérifier l'accès anonyme au pointeur**

```bash
curl -sS -D - -o /dev/null "https://$BUCKET_NAME.s3.$AWS_REGION.amazonaws.com/catalog/latest.json" | grep -iE "^HTTP|cache-control"
curl -sS -o /dev/null -w "%{http_code}\n" "https://$BUCKET_NAME.s3.$AWS_REGION.amazonaws.com/?list-type=2"
```

Expected: `200` et `Cache-Control: no-cache` pour le pointeur ; `403` pour le
listing.

- [ ] **Step 3: Mettre à jour CLAUDE.md**

Dans la section « Architecture », après le paragraphe « Le catalogue est local, les
livres se téléchargent », ajouter :

```markdown
**Le catalogue ne porte aucun hôte.** `book_releases.object_key` contient une clé
relative (`books/<edition_id>/<content_version>/book.sqlite.zst`) que le client
colle derrière `distribution.base_url`. La règle tient en une ligne : **la
présence de `://` marque un absolu** — c'est ce qui garde `asset://` et `local://`
utilisables hors ligne et fait qu'un catalogue publié à l'ancienne continue de
fonctionner. La résolution vit dans `src/shared/distribution.js`, et nulle part
ailleurs.

`tools/publish_minio.py` est le **seul** composant à connaître la disposition du
bucket : il construit les clés, publie `catalog/<version>/catalog.sqlite.zst` et
un pointeur `catalog/latest.json`. Le pointeur part en `no-cache` — en
`immutable` comme le reste, il ne désignerait jamais rien de nouveau et la mise à
jour serait morte sans qu'aucun test n'échoue.

Au démarrage, `src/main/catalog-updater.js` lit le pointeur et compare. Cinq
branches de décision sur six sont silencieuses : hors ligne, pointeur illisible,
schéma trop récent, déjà à jour, version refusée. Une application hors ligne a
déjà tout ce qu'il lui faut pour explorer.

**Une mise à jour de catalogue ne supprime jamais un fichier de livre.** Une
édition dont la `release_id` a changé est marquée `hasNewerRelease` ; une édition
disparue du catalogue reste lisible, marquée `inCatalog: false`. Les ancres de
surlignage sont posées sur le texte rendu : une réédition peut les déplacer, ce
doit donc être un choix de l'utilisateur.
```

Corriger aussi la ligne existante sur `download_url` (section « Le catalogue est
local ») pour parler d'`object_key`.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/
git commit -m "docs: le catalogue configurable, et ce qui casse si on l'oublie"
```

---

## Auto-relecture

**Couverture de la spec :**

| Exigence de la spec | Tâche |
| --- | --- |
| `download_url` → `object_key`, règle `://` | 2 |
| `schema_version` → 2 | 2 |
| `distribution.base_url`, suppression de `minio.base_url` | 4, 8 |
| `distribution.declined_catalog_version` | 5, 8 |
| `src/shared/distribution.js` | 1 |
| `src/main/catalog-updater.js` | 5, 6 |
| Disposition du bucket, pointeur, `no-cache` | 3 |
| Policy `catalog/*` | 3 |
| Vérification au démarrage, six branches | 5 |
| Échange atomique, SHA-256 avant décompression | 6 |
| Réconciliation par édition, aucune suppression | 7 |
| Bannière et réglages | 8 |
| Tests de parité de schéma | 2 |

**Écart assumé :** la spec décrit une bannière au démarrage (§ Flux). La tâche 8
livre le chemin manuel depuis les réglages et les trois méthodes qui le
soutiennent ; l'accrochage de la bannière au démarrage du rendu est le dernier
geste, à faire dans la même tâche une fois les méthodes vérifiées. Le catalogue
embarqué dans le build (`assets/catalog.sqlite.zst`) relève de l'empaquetage et
sort du périmètre de ce plan — il est nommé dans la spec comme dépendance du
premier lancement, pas comme travail de cette itération.

**Cohérence des types :** `objectKey` (camelCase) côté JavaScript, `object_key`
(snake_case) côté SQL et JSON du pointeur. `resolveObject` rend toujours
`{ kind, url }`. `decideUpdate` rend toujours `{ action, reason, pointer }` avec
`pointer: null` sur toute branche `none`.
