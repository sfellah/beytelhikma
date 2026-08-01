# -*- coding: utf-8 -*-
"""Ordre de lecture, volumes, sommaire, catalogue et parité de schéma."""

import json
import os
import re
import shutil
import sqlite3
import tempfile
import unittest

from _common import BOOK_SCHEMA, CATALOG_SCHEMA

from shamela.bookdb import BookBuildError, build_book, finalize, plan_toc, plan_volumes
from shamela.cli import main
from shamela.meta import betaka_field, clean_death, gregorian_year, load_categories
from shamela.validate import check_database, check_source
from shamela.tests.fixtures import make_book, make_meta

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
SAMPLE = os.path.join(REPO, "beytelhikma-electron", "assets", "sample")


class PlanVolumesTest(unittest.TestCase):
    def test_ordre_de_lecture_est_page_id(self):
        # entrées volontairement désordonnées
        headers = [(30, "2", 5, 3), (10, "1", 1, 1), (20, "1", 2, 2)]
        _volumes, _vol_of, seq_of, _n = plan_volumes(headers)
        self.assertEqual([seq_of[10], seq_of[20], seq_of[30]], [1, 2, 3])

    def test_part_numerique_alimente_part_number(self):
        volumes, vol_of, _seq, non_numeric = plan_volumes(
            [(1, "6", 1, 1), (2, "6", 2, 2), (3, "7", 3, 3)]
        )
        self.assertEqual([v["part_number"] for v in volumes], [6, 7])
        self.assertEqual([v["volume_id"] for v in volumes], [1, 2])
        self.assertEqual([v["label_ar"] for v in volumes], ["الجزء 6", "الجزء 7"])
        self.assertEqual(vol_of[3], 2)
        self.assertEqual(non_numeric, 0)

    def test_part_non_numerique_bascule_tout_le_livre_sur_l_ordinal(self):
        # « مقدمة » puis « 1 » : garder le numéro imprimé pour la seconde
        # donnerait deux volumes numérotés 1. La cohérence dans le livre prime.
        volumes, _vol_of, _seq, non_numeric = plan_volumes(
            [(1, "مقدمة", 1, 1), (2, "1", 2, 2)]
        )
        self.assertEqual([v["part_number"] for v in volumes], [1, 2])
        self.assertEqual(volumes[0]["label_ar"], "مقدمة", "la part EST déjà un libellé")
        self.assertEqual(volumes[1]["label_ar"], "الجزء 1")
        self.assertEqual(non_numeric, 1)

    def test_part_number_est_unique_dans_un_livre(self):
        for parts in (["مقدمة", "1", "2"], ["1", "2", "3"], ["6", "7"], [None, None]):
            with self.subTest(parts=parts):
                volumes, _v, _s, _n = plan_volumes(
                    [(i, p, i, i) for i, p in enumerate(parts, start=1)]
                )
                numbers = [v["part_number"] for v in volumes]
                self.assertEqual(len(numbers), len(set(numbers)), numbers)

    def test_part_absente_donne_un_volume_unique_sans_libelle(self):
        volumes, _vol_of, _seq, _n = plan_volumes([(1, None, 1, 1), (2, None, 2, 2)])
        self.assertEqual(len(volumes), 1)
        self.assertEqual(volumes[0]["part_number"], 1)
        self.assertIsNone(volumes[0]["label_ar"])


class PlanTocTest(unittest.TestCase):
    def entries(self, parents):
        return [
            {"title_id": 10 + i, "parent_id": parents[i], "page_id": 1,
             "shamela_title_id": i + 1, "title_text": f"t{i}"}
            for i in range(len(parents))
        ]

    def test_niveau_suit_la_profondeur(self):
        rows = plan_toc(self.entries([None, 10, 11]), {1})
        self.assertEqual([r["level"] for r in rows], [1, 2, 3])
        self.assertEqual([r["sequence_num"] for r in rows], [1, 2, 3])

    def test_cycle_detecte(self):
        entries = self.entries([11, 10])
        with self.assertRaises(BookBuildError) as ctx:
            plan_toc(entries, {1})
        self.assertEqual(ctx.exception.stage, "toc")

    def test_page_absente_rejetee(self):
        with self.assertRaises(BookBuildError):
            plan_toc(self.entries([None]), set())

    def test_parent_inexistant_remonte_a_la_racine(self):
        rows = plan_toc(self.entries([None, 999]), {1})
        self.assertIsNone(rows[1]["parent_toc_id"])
        self.assertEqual(rows[1]["level"], 1)


class MetaTest(unittest.TestCase):
    BETAKA = "الكتاب: أصل\rالناشر: دار النشر\rالطبعة: الأولى، ١٤٣٩ هـ - ٢٠١٨ م"

    def test_extraction_des_champs(self):
        self.assertEqual(betaka_field(self.BETAKA, "الناشر"), "دار النشر")
        self.assertIsNone(betaka_field(self.BETAKA, "المحقق"))

    def test_annee_gregorienne_seulement(self):
        self.assertEqual(gregorian_year(self.BETAKA), 2018)
        self.assertIsNone(gregorian_year("الطبعة: الأولى، ١٤٣٩ هـ"),
                          "une année hégirienne ne doit pas passer")

    def test_sentinelle_de_deces(self):
        self.assertIsNone(clean_death(99999))
        self.assertIsNone(clean_death(0))
        self.assertEqual(clean_death(646), 646)


class SchemaParityTest(unittest.TestCase):
    """Garde principale : la sortie doit être schéma-identique à l'échantillon."""

    @staticmethod
    def schema_of(path: str) -> list[tuple]:
        con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        try:
            rows = con.execute(
                "SELECT type, name, sql FROM sqlite_master "
                "WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name"
            ).fetchall()
        finally:
            con.close()
        return [(t, n, re.sub(r"\s+", " ", s).strip() if s else None) for t, n, s in rows]

    @staticmethod
    def schema_of_ddl(ddl: str) -> list[tuple]:
        con = sqlite3.connect(":memory:")
        con.executescript(ddl)
        rows = con.execute(
            "SELECT type, name, sql FROM sqlite_master "
            "WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name"
        ).fetchall()
        con.close()
        return [(t, n, re.sub(r"\s+", " ", s).strip() if s else None) for t, n, s in rows]

    def test_le_livre_importe_a_le_schema_de_l_echantillon(self):
        sample = os.path.join(SAMPLE, "books", "ed-bukhari-01.sqlite")
        if not os.path.exists(sample):
            self.skipTest("échantillon absent : lancer tools/gen_sample_data.py")
        self.assertEqual(self.schema_of_ddl(BOOK_SCHEMA), self.schema_of(sample))

    def test_le_catalogue_a_le_schema_de_l_echantillon(self):
        sample = os.path.join(SAMPLE, "catalog.sqlite")
        if not os.path.exists(sample):
            self.skipTest("échantillon absent : lancer tools/gen_sample_data.py")
        self.assertEqual(self.schema_of_ddl(CATALOG_SCHEMA), self.schema_of(sample))


class EndToEndTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="shamela_test_")
        self.src = os.path.join(self.tmp, "src")
        self.out = os.path.join(self.tmp, "out")
        os.makedirs(self.src)
        make_meta(self.src)
        make_book(self.src, 11, parts=["1", "1", "2"])
        make_book(self.src, 12, parts=["مقدمة", "1", "1"], title="كتاب ثان")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_un_livre_de_bout_en_bout(self):
        book_dir = os.path.join(self.src, "01__categorie", "11__livre")
        out = os.path.join(self.out, "books", "sh-11.sqlite")
        stats = build_book(book_dir, out, edition_id="sh-11")
        check_source(book_dir, stats)
        finalize(out)
        check_database(out, stats)

        con = sqlite3.connect(out)
        self.assertEqual(con.execute("SELECT COUNT(*) FROM pages").fetchone()[0], 3)
        self.assertEqual(
            [r[0] for r in con.execute("SELECT sequence_num FROM pages ORDER BY sequence_num")],
            [1, 2, 3],
        )
        # `page_id` reste l'identifiant source, il n'est pas renuméroté en 1..N
        self.assertEqual(
            [r[0] for r in con.execute("SELECT page_id FROM pages ORDER BY page_id")],
            [900000, 900003, 900006],
        )
        self.assertEqual(con.execute("SELECT COUNT(*) FROM volumes").fetchone()[0], 2)
        self.assertEqual(
            con.execute("SELECT level FROM toc ORDER BY sequence_num").fetchall(), [(1,), (2,)]
        )
        # les notes gardent leurs paragraphes
        notes = con.execute(
            "SELECT footnotes FROM pages WHERE sequence_num = 1").fetchone()[0]
        self.assertEqual(notes, "١ - حاشية أولى\n٢ - حاشية ثانية")
        # le rowid FTS ramène bien une page
        hit = con.execute(
            "SELECT rowid FROM pages_fts WHERE pages_fts MATCH ? LIMIT 1", ("عنوان",)
        ).fetchone()
        self.assertIsNotNone(hit)
        self.assertIsNotNone(
            con.execute("SELECT 1 FROM pages WHERE page_id = ?", (hit[0],)).fetchone())
        con.close()

    def test_source_corrompue_detectee(self):
        book_dir = os.path.join(self.src, "01__categorie", "11__livre")
        with open(os.path.join(book_dir, "pages.jsonl"), "ab") as fh:
            fh.write(b"\n")  # octet en trop -> sha256 et taille faux
        out = os.path.join(self.out, "books", "sh-11.sqlite")
        stats = build_book(book_dir, out, edition_id="sh-11")
        with self.assertRaises(Exception):
            check_source(book_dir, stats)

    def test_run_complet_produit_catalogue_et_rapport(self):
        code = main(["--src", self.src, "--out", self.out, "--all", "--jobs", "1"])
        self.assertEqual(code, 0)

        catalog = os.path.join(self.out, "catalog.sqlite")
        self.assertTrue(os.path.exists(catalog))
        con = sqlite3.connect(catalog)
        self.assertEqual(con.execute("SELECT COUNT(*) FROM editions").fetchone()[0], 2)
        # la catégorie factice `#` (id 42) ne doit pas entrer
        self.assertEqual(
            con.execute("SELECT category_id FROM categories").fetchall(), [(1,)])
        # 99999 -> NULL
        self.assertEqual(
            con.execute("SELECT death_year_hijri FROM authors").fetchone()[0], None)
        # métadonnées extraites de betaka_text
        row = con.execute(
            "SELECT publisher_ar, publication_year, subtitle_ar, volume_count "
            "FROM editions WHERE edition_id = 'sh-11'").fetchone()
        self.assertEqual(row[0], "دار التجربة")
        self.assertEqual(row[1], 2018)
        self.assertTrue(row[2].startswith("كتاب التجربة وشرحه"))
        self.assertEqual(row[3], 2, "volume_count vient des volumes réels")
        # l'app joint sur role='author' : la ligne doit exister
        self.assertEqual(
            con.execute("SELECT COUNT(*) FROM edition_authors WHERE role='author'").fetchone()[0], 2)
        con.close()

        for name in ("import-report.json", "import-report.csv"):
            self.assertTrue(os.path.exists(os.path.join(self.out, name)), name)
        self.assertTrue(os.path.exists(os.path.join(self.out, "books", "sh-11.manifest.json")))

    def test_un_livre_monte_puis_efface_reste_au_catalogue(self):
        """Publier par tranches : le `.sqlite` part une fois monté, seul le
        manifest reste. Exiger le fichier faisait tomber le livre du catalogue
        que `build_catalog` réécrit — effacer une tranche la dépubliait."""
        self.assertEqual(main(["--src", self.src, "--out", self.out, "--all", "--jobs", "1"]), 0)

        livres = os.path.join(self.out, "books")
        manifeste = os.path.join(livres, "sh-11.manifest.json")
        with open(manifeste, encoding="utf-8") as fh:
            contenu = json.load(fh)
        contenu["object_key"] = "books/sh-11/1/book.sqlite.zst"
        contenu["compressed_size"] = 4242
        with open(manifeste, "w", encoding="utf-8") as fh:
            json.dump(contenu, fh, ensure_ascii=False)
        os.remove(os.path.join(livres, "sh-11.sqlite"))

        code = main(["--src", self.src, "--out", self.out, "--all", "--jobs", "1", "--resume"])
        self.assertEqual(code, 0)

        con = sqlite3.connect(os.path.join(self.out, "catalog.sqlite"))
        cle, taille = con.execute(
            "SELECT object_key, compressed_size FROM book_releases WHERE edition_id = 'sh-11'"
        ).fetchone()
        editions = con.execute("SELECT COUNT(*) FROM editions").fetchone()[0]
        con.close()

        self.assertEqual(editions, 2, "le livre effacé reste au catalogue")
        self.assertEqual(cle, "books/sh-11/1/book.sqlite.zst", "la clé du bucket est reprise")
        self.assertEqual(taille, 4242)

    def test_un_manifest_sans_taille_ni_fichier_fait_reimporter(self):
        """Le catalogue annonce le poids du livre. Sans taille au manifest ni
        fichier à mesurer, il vaut mieux refaire l'import que d'inventer."""
        self.assertEqual(main(["--src", self.src, "--out", self.out, "--all", "--jobs", "1"]), 0)

        livres = os.path.join(self.out, "books")
        manifeste = os.path.join(livres, "sh-11.manifest.json")
        with open(manifeste, encoding="utf-8") as fh:
            contenu = json.load(fh)
        contenu.pop("size", None)
        with open(manifeste, "w", encoding="utf-8") as fh:
            json.dump(contenu, fh, ensure_ascii=False)
        os.remove(os.path.join(livres, "sh-11.sqlite"))

        self.assertEqual(
            main(["--src", self.src, "--out", self.out, "--all", "--jobs", "1", "--resume"]), 0)
        self.assertTrue(os.path.exists(os.path.join(livres, "sh-11.sqlite")), "réimporté")


if __name__ == "__main__":
    unittest.main()
