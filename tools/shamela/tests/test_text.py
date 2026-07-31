# -*- coding: utf-8 -*-
"""Pipeline de texte : balises, guillemets, notes."""

import unittest

from shamela.images import ImageCollector
from shamela.text import clean_footnotes, convert_body, to_plain, to_search

PNG_1PX = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAY27m"
    "/MAAAAASUVORK5CYII="
)


def convert(body: str) -> str:
    return convert_body(body, ImageCollector())[0]


class TitleSpanTest(unittest.TestCase):
    def test_titre_seul_dans_son_segment_devient_h2(self):
        html = convert("<span data-type='title' id=toc-3>باب الإيمان</span>")
        self.assertEqual(html, '<h2 class="title" id="toc-3">باب الإيمان</h2>')

    def test_titre_en_milieu_de_phrase_reste_un_span(self):
        html = convert("قال <span data-type='title'>المؤلف</span> رحمه الله")
        self.assertEqual(html, '<p>قال <span class="title">المؤلف</span> رحمه الله</p>')

    def test_guillemets_doubles_simples_et_absents(self):
        for attrs in (
            "data-type='title' id=toc-9",
            'data-type="title" id="toc-9"',
            'data-type=title id=toc-9',
        ):
            with self.subTest(attrs=attrs):
                self.assertEqual(
                    convert(f"<span {attrs}>عنوان</span>"),
                    '<h2 class="title" id="toc-9">عنوان</h2>',
                )

    def test_titre_sans_id_ne_produit_pas_d_ancre(self):
        self.assertEqual(convert("<span data-type='title'>عنوان</span>"),
                         '<h2 class="title">عنوان</h2>')


class MarkupTest(unittest.TestCase):
    def test_br_et_hr_sont_conserves(self):
        self.assertEqual(convert("أ<br/>ب<hr>ج"), "<p>أ<br>ب<hr>ج</p>")

    def test_balise_inconnue_perd_sa_balise_garde_son_texte(self):
        self.assertEqual(convert("<i>نص</i> عادي"), "<p>نص عادي</p>")

    def test_lien_inr_est_deballe(self):
        html, stats = convert_body('روى <a href="inr://man-3654">الأعمش</a> عنه', ImageCollector())
        self.assertEqual(html, "<p>روى الأعمش عنه</p>")
        self.assertEqual(stats["links_unwrapped"], 1)

    def test_les_retours_chariot_separent_les_paragraphes(self):
        self.assertEqual(convert("أول\rثاني"), "<p>أول</p><p>ثاني</p>")

    def test_les_retours_chariot_consecutifs_ne_creent_pas_de_vide(self):
        self.assertEqual(convert("أول\r\r\rثاني"), "<p>أول</p><p>ثاني</p>")

    def test_chevron_du_texte_source_est_echappe(self):
        self.assertEqual(convert("a < b"), "<p>a &lt; b</p>")
        self.assertEqual(to_plain(convert("a < b")), "a < b")


class TableTest(unittest.TestCase):
    def test_table_devient_un_paragraphe_par_ligne(self):
        html, stats = convert_body(
            "<table dir=rtl><tr><td>الخزانة</td><td>خزانة الأدب</td></tr>"
            "<tr><td>سيبويه</td><td>كتاب سيبويه</td></tr></table>",
            ImageCollector(),
        )
        self.assertEqual(
            html,
            "<p>الخزانة ǀ خزانة الأدب</p><p>سيبويه ǀ كتاب سيبويه</p>",
        )
        self.assertEqual(stats["tables_flattened"], 1)

    def test_table_sans_balise_fermante(self):
        # La fermeture n'est pas garantie dans le corpus.
        html = convert("<table><tr><td>أ</td><td>ب</td></tr>")
        self.assertEqual(html, "<p>أ ǀ ب</p>")


class ImageTest(unittest.TestCase):
    def test_image_extraite_et_dedupliquee(self):
        images = ImageCollector()
        html, stats = convert_body(
            f"قبل\r<img src='data:image/png;base64,{PNG_1PX}'>\r"
            f'<img src="data:image/png;base64,{PNG_1PX}">\rبعد',
            images,
        )
        self.assertNotIn("data:image", html)
        self.assertIn('class="figure"', html)
        self.assertEqual(stats["images_stripped"], 2)
        self.assertEqual(len(images.assets), 1, "même sha256 -> un seul asset")
        self.assertEqual(images.assets[0]["mime_type"], "image/png")

    def test_jpg_est_normalise_en_jpeg(self):
        images = ImageCollector()
        convert_body(f"<img src='data:image/jpg;base64,{PNG_1PX}'>", images)
        self.assertEqual(images.assets[0]["mime_type"], "image/jpeg")


class FootnotesTest(unittest.TestCase):
    def test_les_retours_chariot_separent_les_notes(self):
        # Piège : `strip_html` supprime les \r, il faut convertir avant.
        self.assertEqual(clean_footnotes("١ - أول\r٢ - ثان\r٣ - ثالث"),
                         "١ - أول\n٢ - ثان\n٣ - ثالث")

    def test_les_notes_ne_contiennent_jamais_de_html(self):
        self.assertEqual(clean_footnotes("<span>١</span> شرح"), "١ شرح")

    def test_note_vide_devient_none(self):
        for value in (None, "", "   "):
            self.assertIsNone(clean_footnotes(value))


class SearchTest(unittest.TestCase):
    def test_normalisation_replie_les_variantes(self):
        self.assertEqual(to_search("الإسلام"), to_search("الاسلام"))
        self.assertEqual(to_search("عيسى"), "عيسي")
        self.assertEqual(to_search("الصــلاة"), "الصلاه")

    def test_aucune_balise_dans_l_index(self):
        html = convert("<span data-type='title'>عنوان</span>")
        self.assertNotIn("h2", to_search(to_plain(html)))


if __name__ == "__main__":
    unittest.main()
