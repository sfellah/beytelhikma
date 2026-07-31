import json
import os
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from publish_minio import object_key, publish


class FakeS3:
    """Client S3 minimal : mémorise les objets et les appels."""

    def __init__(self):
        self.objects = {}
        self.puts = []

    def head_object(self, Bucket, Key):
        if Key not in self.objects:
            raise FileNotFoundError(Key)
        return {"ContentLength": len(self.objects[Key])}

    def put_object(self, Bucket, Key, Body, **kwargs):
        self.objects[Key] = Body
        self.puts.append(Key)


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
        " content_version INTEGER, download_url TEXT, compressed_size INTEGER, is_active INTEGER)"
    )
    con.execute(
        "INSERT INTO book_releases VALUES ('rel-a', 'ed-a', 1, 'local://books/ed-a.sqlite', 0, 1)"
    )
    con.commit()
    con.close()
    return root


class PublishTest(unittest.TestCase):
    def test_upload_puis_reecriture_de_download_url(self):
        with tempfile.TemporaryDirectory() as root:
            build_src(root)
            client = FakeS3()
            report = publish(
                client,
                src=root,
                bucket="beytelhikma",
                public_base="http://127.0.0.1:9000/beytelhikma",
            )

            self.assertEqual(report["uploaded"], 2)  # le livre et son manifest
            self.assertEqual(report["updated"], 1)
            key = object_key("ed-a", 1)
            self.assertIn(key, client.objects)

            con = sqlite3.connect(os.path.join(root, "catalog.sqlite"))
            url, size = con.execute(
                "SELECT download_url, compressed_size FROM book_releases WHERE release_id='rel-a'"
            ).fetchone()
            con.close()
            self.assertEqual(url, f"http://127.0.0.1:9000/beytelhikma/{key}")
            self.assertEqual(size, 16)

    def test_second_passage_ne_reenvoie_rien(self):
        with tempfile.TemporaryDirectory() as root:
            build_src(root)
            client = FakeS3()
            publish(client, src=root, bucket="b", public_base="http://x/b")
            client.puts.clear()
            report = publish(client, src=root, bucket="b", public_base="http://x/b")
            self.assertEqual(client.puts, [])
            self.assertEqual(report["uploaded"], 0)
            self.assertEqual(report["skipped"], 2)

    def test_dry_run_n_ecrit_rien(self):
        with tempfile.TemporaryDirectory() as root:
            build_src(root)
            client = FakeS3()
            publish(client, src=root, bucket="b", public_base="http://x/b", dry_run=True)
            self.assertEqual(client.puts, [])
            con = sqlite3.connect(os.path.join(root, "catalog.sqlite"))
            (url,) = con.execute(
                "SELECT download_url FROM book_releases WHERE release_id='rel-a'"
            ).fetchone()
            con.close()
            self.assertEqual(url, "local://books/ed-a.sqlite")

    def test_livre_sans_archive_est_signale(self):
        with tempfile.TemporaryDirectory() as root:
            build_src(root)
            os.remove(os.path.join(root, "books", "ed-a.sqlite.zst"))
            client = FakeS3()
            report = publish(client, src=root, bucket="b", public_base="http://x/b")
            self.assertEqual(report["missing"], ["ed-a"])
            self.assertEqual(client.puts, [])


if __name__ == "__main__":
    unittest.main()
