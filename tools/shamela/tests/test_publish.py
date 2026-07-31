import json
import os
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

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


class FakeS3:
    """Client S3 minimal : mémorise les objets, les buckets et les appels."""

    def __init__(self, buckets=()):
        self.objects = {}
        self.puts = []
        self.put_kwargs = {}
        self.buckets = set(buckets)
        self.policies = {}
        self.settings = {}
        self.create_kwargs = {}

    def head_object(self, Bucket, Key):
        if Key not in self.objects:
            raise FileNotFoundError(Key)
        return {"ContentLength": len(self.objects[Key])}

    def put_object(self, Bucket, Key, Body, **kwargs):
        self.objects[Key] = Body
        self.puts.append(Key)
        self.put_kwargs[Key] = kwargs

    def head_bucket(self, Bucket):
        if Bucket not in self.buckets:
            raise FileNotFoundError(Bucket)
        return {}

    def create_bucket(self, Bucket, **kwargs):
        self.buckets.add(Bucket)
        self.create_kwargs = kwargs

    def put_bucket_policy(self, Bucket, Policy):
        self.policies[Bucket] = Policy

    def put_bucket_ownership_controls(self, Bucket, OwnershipControls):
        self.settings["ownership"] = OwnershipControls

    def put_public_access_block(self, Bucket, PublicAccessBlockConfiguration):
        self.settings["access_block"] = PublicAccessBlockConfiguration

    def put_bucket_encryption(self, Bucket, ServerSideEncryptionConfiguration):
        self.settings["encryption"] = ServerSideEncryptionConfiguration

    def put_bucket_cors(self, Bucket, CORSConfiguration):
        self.settings["cors"] = CORSConfiguration

    def put_bucket_lifecycle_configuration(self, Bucket, LifecycleConfiguration):
        self.settings["lifecycle"] = LifecycleConfiguration


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

    def test_second_passage_ne_reenvoie_rien(self):
        with tempfile.TemporaryDirectory() as root:
            build_src(root)
            client = FakeS3()
            publish(client, src=root, bucket="b")
            client.puts.clear()
            report = publish(client, src=root, bucket="b")
            self.assertEqual(client.puts, [])
            self.assertEqual(report["uploaded"], 0)
            self.assertEqual(report["skipped"], 2)

    def test_dry_run_n_ecrit_rien(self):
        with tempfile.TemporaryDirectory() as root:
            build_src(root)
            client = FakeS3()
            report = publish(client, src=root, bucket="b", dry_run=True)
            self.assertEqual(client.puts, [])
            self.assertEqual(report["uploaded"], 0)
            # Un essai à blanc doit dire ce qui partirait, pas se taire.
            self.assertEqual(report["planned"], 2)
            con = sqlite3.connect(os.path.join(root, "catalog.sqlite"))
            (url,) = con.execute(
                "SELECT object_key FROM book_releases WHERE release_id='rel-a'"
            ).fetchone()
            con.close()
            self.assertEqual(url, "asset://books/ed-a.sqlite")

    def test_dry_run_ne_compresse_rien(self):
        """Compresser pendant un essai à blanc écrirait des dizaines de mégaoctets
        et durerait des minutes, pour ne rien envoyer ensuite."""
        with tempfile.TemporaryDirectory() as root:
            build_src(root)
            os.remove(os.path.join(root, "books", "ed-a.sqlite.zst"))
            with open(os.path.join(root, "books", "ed-a.sqlite"), "wb") as fh:
                fh.write(b"SQLite format 3\0" * 500)

            client = FakeS3()
            report = publish(client, src=root, bucket="b", dry_run=True)

            self.assertEqual(report["would_compress"], 1)
            self.assertEqual(report["compressed"], 0)
            self.assertEqual(report["planned"], 2)
            self.assertFalse(
                os.path.exists(os.path.join(root, "books", "ed-a.sqlite.zst")),
                "aucune archive ne doit être écrite",
            )

    def test_livre_sans_archive_ni_source_est_signale(self):
        with tempfile.TemporaryDirectory() as root:
            build_src(root)
            os.remove(os.path.join(root, "books", "ed-a.sqlite.zst"))
            client = FakeS3()
            report = publish(client, src=root, bucket="b")
            self.assertEqual(report["missing"], ["ed-a"])
            self.assertEqual(client.puts, [])

    def test_archive_produite_a_la_volee_depuis_le_sqlite(self):
        """L'import n'ayant pas toujours tourné avec --compress, et la reprise
        sautant la compression, l'outil doit savoir compresser lui-même."""
        with tempfile.TemporaryDirectory() as root:
            build_src(root)
            os.remove(os.path.join(root, "books", "ed-a.sqlite.zst"))
            plain = os.path.join(root, "books", "ed-a.sqlite")
            with open(plain, "wb") as fh:
                fh.write(b"SQLite format 3\0" * 500)

            client = FakeS3()
            report = publish(client, src=root, bucket="b")

            self.assertEqual(report["missing"], [])
            self.assertEqual(report["compressed"], 1)
            self.assertIn(object_key("ed-a", 1), client.objects)
            # L'archive est gardée : le passage suivant n'a plus à compresser.
            self.assertTrue(os.path.exists(os.path.join(root, "books", "ed-a.sqlite.zst")))

    def test_le_bucket_est_cree_s_il_manque(self):
        client = FakeS3()
        self.assertTrue(ensure_bucket(client, "beytelhikma"), "créé au premier appel")
        self.assertIn("beytelhikma", client.buckets)
        self.assertFalse(ensure_bucket(client, "beytelhikma"), "déjà là au second")

    def test_objet_marque_immutable(self):
        """Le chemin porte la `content_version` : le contenu ne change jamais
        sous une clé donnée, donc le client peut le garder sans revalider."""
        with tempfile.TemporaryDirectory() as root:
            build_src(root)
            client = FakeS3()
            publish(client, src=root, bucket="b")
            kwargs = client.put_kwargs[object_key("ed-a", 1)]
            self.assertEqual(kwargs["CacheControl"], CACHE_CONTROL)


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

    def test_le_pointeur_repart_meme_a_taille_egale(self):
        """Son contenu change sans que sa taille bouge : le raccourci « même
        taille = déjà là » le figerait sur la première version publiée."""
        with tempfile.TemporaryDirectory() as root:
            build_src(root)
            build_catalog_info(root)
            client = FakeS3()

            publish_catalog(client, src=root, bucket="b")
            client.puts.clear()
            publish_catalog(client, src=root, bucket="b")

            self.assertIn(POINTER_KEY, client.puts)
            self.assertNotIn(catalog_key(2), client.puts, "le catalogue, lui, est sauté")

    def test_essai_a_blanc_ne_monte_rien(self):
        with tempfile.TemporaryDirectory() as root:
            build_src(root)
            build_catalog_info(root)
            client = FakeS3()

            report = publish_catalog(client, src=root, bucket="b", dry_run=True)

            self.assertEqual(client.puts, [])
            self.assertEqual(report["catalog_version"], 2)
            self.assertEqual(report["planned"], 2)


class ConfigureBucketTest(unittest.TestCase):
    def test_region_passee_a_la_creation(self):
        """Hors us-east-1, AWS refuse un create_bucket sans LocationConstraint."""
        client = FakeS3()
        configure_bucket(client, "b", "eu-west-1")
        self.assertEqual(
            client.create_kwargs.get("CreateBucketConfiguration"),
            {"LocationConstraint": "eu-west-1"},
        )

    def test_us_east_1_sans_location_constraint(self):
        client = FakeS3()
        configure_bucket(client, "b", "us-east-1")
        self.assertNotIn("CreateBucketConfiguration", client.create_kwargs)

    def test_public_par_politique_jamais_par_acl(self):
        client = FakeS3()
        result = configure_bucket(client, "b", "eu-west-1")

        self.assertEqual(result["skipped"], [])
        block = client.settings["access_block"]
        # Les politiques passent — c'est par là que books/* devient lisible.
        self.assertFalse(block["BlockPublicPolicy"])
        self.assertFalse(block["RestrictPublicBuckets"])
        # Les ACL, elles, restent bloquées *et* ignorées : une ACL publique
        # posée par erreur sur un objet ne rendrait rien lisible.
        self.assertTrue(block["BlockPublicAcls"])
        self.assertTrue(block["IgnorePublicAcls"])

        policy = json.loads(client.policies["b"])
        statement = policy["Statement"][0]
        self.assertEqual(statement["Action"], ["s3:GetObject"])
        # Les préfixes comptent : ouvrir le bucket entier autoriserait le
        # listing anonyme, qui doit rester fermé.
        self.assertEqual(
            statement["Resource"],
            ["arn:aws:s3:::b/books/*", "arn:aws:s3:::b/catalog/*"],
        )

    def test_reglage_absent_est_signale_pas_fatal(self):
        """MinIO n'implémente pas toute l'API S3 : un réglage refusé ne doit
        pas empêcher la politique de lecture publique d'être posée."""

        class Partiel(FakeS3):
            def put_bucket_ownership_controls(self, **kwargs):
                raise NotImplementedError("non supporté")

        client = Partiel()
        result = configure_bucket(client, "b", "eu-west-1")

        self.assertEqual(len(result["skipped"]), 1)
        self.assertIn("ownership", result["skipped"][0])
        self.assertIn("b", client.policies, "la politique est posée quand même")


if __name__ == "__main__":
    unittest.main()
