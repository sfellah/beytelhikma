import io
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from stats import (  # noqa: E402
    parse_log_line,
    platform_of,
    print_access,
    summarize_access,
    summarize_releases,
)

# Une ligne réelle de journal d'accès S3, champs et guillemets compris.
POINTEUR = (
    "79a5 beytelhima-library [04/Aug/2026:10:00:38 +0000] 203.0.113.7 - "
    "3E57427F3EXAMPLE REST.GET.OBJECT catalog/latest.json "
    '"GET /catalog/latest.json HTTP/1.1" 200 - 412 412 12 11 "-" '
    '"beytelhikma/0.5.2" - abc SigV4 ECDHE-RSA-AES128-GCM-SHA256 AuthHeader '
    "s3.eu-west-1.amazonaws.com TLSv1.2 -"
)

LIVRE = (
    "79a5 beytelhima-library [04/Aug/2026:11:02:00 +0000] 198.51.100.4 - "
    "4E57427F3EXAMPLE REST.GET.OBJECT books/sh-1234/1/book.sqlite.zst "
    '"GET /books/sh-1234/1/book.sqlite.zst HTTP/1.1" 200 - 3145728 3145728 90 80 "-" '
    '"beytelhikma/0.5.2" - def SigV4 - AuthHeader s3.eu-west-1.amazonaws.com TLSv1.2 -'
)

ABSENT = (
    "79a5 beytelhima-library [04/Aug/2026:11:03:00 +0000] 198.51.100.4 - "
    "5E57427F3EXAMPLE REST.GET.OBJECT books/sh-9999/1/book.sqlite.zst "
    '"GET /books/sh-9999/1/book.sqlite.zst HTTP/1.1" 404 NoSuchKey 0 - 8 - "-" '
    '"beytelhikma/0.5.2" - ghi SigV4 - AuthHeader s3.eu-west-1.amazonaws.com TLSv1.2 -'
)


class ParseLogLineTest(unittest.TestCase):
    def test_les_champs_entre_crochets_et_guillemets_restent_entiers(self):
        """Un découpage sur l'espace couperait la date et la requête en deux, et
        tout ce qui suit se lirait dans la mauvaise colonne."""
        entry = parse_log_line(POINTEUR)
        self.assertEqual(entry["day"], "04/Aug/2026")
        self.assertEqual(entry["operation"], "REST.GET.OBJECT")
        self.assertEqual(entry["key"], "catalog/latest.json")
        self.assertEqual(entry["status"], 200)
        self.assertEqual(entry["bytes"], 412)

    def test_aucune_adresse_ne_sort_de_la_lecture(self):
        """L'adresse IP est écartée au seul endroit qui la voit : aucune
        fonction en aval ne peut donc en afficher une, même par erreur."""
        entry = parse_log_line(POINTEUR)
        self.assertNotIn("203.0.113.7", str(entry))
        self.assertEqual(set(entry), {"day", "operation", "key", "status", "bytes"})

    def test_une_ligne_illisible_est_sautee_pas_levee(self):
        """Un journal a des millions de lignes ; l'une d'elles ne doit pas faire
        tomber le décompte."""
        self.assertIsNone(parse_log_line(""))
        self.assertIsNone(parse_log_line("bruit sans structure"))
        self.assertIsNone(parse_log_line(POINTEUR.replace(" 200 ", " deux-cents ")))

    def test_un_champ_vide_ne_decale_rien(self):
        """Un `""` sauté au lieu d'être posé décalerait tous les champs
        suivants d'un cran, et le statut se lirait à côté."""
        entry = parse_log_line(POINTEUR.replace('"GET /catalog/latest.json HTTP/1.1"', '""'))
        self.assertEqual(entry["status"], 200)

    def test_octets_absents_valent_zero(self):
        entry = parse_log_line(POINTEUR.replace(" 200 - 412 412 ", " 200 - - - "))
        self.assertEqual(entry["bytes"], 0)


class SummarizeAccessTest(unittest.TestCase):
    def test_les_demarrages_se_comptent_sur_le_pointeur(self):
        """Chaque lancement d'application lit `catalog/latest.json`. C'est la
        seule mesure d'usage réel, et elle ne coûte aucun identifiant."""
        summary = summarize_access([POINTEUR, POINTEUR, LIVRE])
        jour = summary["days"]["04/Aug/2026"]
        self.assertEqual(jour["pointeurs"], 2)
        self.assertEqual(jour["livres"], 1)
        self.assertEqual(summary["books"]["sh-1234"], 1)

    def test_une_erreur_ne_compte_pas_comme_un_telechargement(self):
        """Un 404 sur un livre est un défaut à voir, pas une lecture."""
        summary = summarize_access([ABSENT])
        jour = summary["days"]["04/Aug/2026"]
        self.assertEqual(jour["erreurs"], 1)
        self.assertEqual(jour["livres"], 0)
        self.assertEqual(jour["octets"], 0)

    def test_les_ecritures_ne_sont_pas_du_trafic_de_lecture(self):
        """Une publication écrit dans le même bucket : la compter ferait passer
        notre propre `publish_minio.py` pour des lecteurs."""
        ecriture = POINTEUR.replace("REST.GET.OBJECT", "REST.PUT.OBJECT")
        self.assertEqual(summarize_access([ecriture])["days"], {})

    def test_le_rapport_n_affiche_aucune_adresse(self):
        sortie = io.StringIO()
        print_access(summarize_access([POINTEUR, LIVRE]), out=sortie)
        texte = sortie.getvalue()
        self.assertNotIn("203.0.113", texte)
        self.assertIn("sh-1234", texte)


class SummarizeReleasesTest(unittest.TestCase):
    def relea(self, **kwargs):
        base = {"tag_name": "v1", "published_at": "2026-08-01T00:00:00Z", "assets": []}
        base.update(kwargs)
        return base

    def test_les_fichiers_du_mecanisme_de_mise_a_jour_sont_ecartes(self):
        """Personne ne télécharge `latest.yml` à la main : le compter ferait
        passer le trafic de mise à jour pour une adoption."""
        summary = summarize_releases([
            self.relea(assets=[
                {"name": "Beyt-0.5.2-setup.exe", "download_count": 10},
                {"name": "latest.yml", "download_count": 900},
                {"name": "Beyt-0.5.2-setup.exe.blockmap", "download_count": 800},
            ])
        ])
        self.assertEqual(summary["total"], 10)
        self.assertEqual(summary["platforms"], {"windows": 10})

    def test_un_brouillon_ne_compte_pas(self):
        summary = summarize_releases([
            self.relea(draft=True, assets=[{"name": "a.exe", "download_count": 5}])
        ])
        self.assertEqual(summary["total"], 0)
        self.assertIsNone(summary["latest"])

    def test_la_part_se_mesure_sur_la_derniere_stable(self):
        """C'est la version que le site met en avant ; une préversion en tête
        comparerait le total à un lien que personne ne voit."""
        summary = summarize_releases([
            self.relea(tag_name="v0.6.0-rc1", prerelease=True,
                       assets=[{"name": "a.exe", "download_count": 2}]),
            self.relea(tag_name="v0.5.2", assets=[{"name": "b.exe", "download_count": 6}]),
            self.relea(tag_name="v0.5.1", assets=[{"name": "c.exe", "download_count": 2}]),
        ])
        self.assertEqual(summary["latest"]["tag"], "v0.5.2")
        self.assertEqual(summary["latest_share"], 0.6)

    def test_la_plateforme_se_lit_dans_l_extension(self):
        self.assertEqual(platform_of("Beyt-0.5.2-setup.exe"), "windows")
        self.assertEqual(platform_of("Beyt-0.5.2.AppImage"), "linux")
        self.assertEqual(platform_of("beyt.apk"), "android")
        self.assertEqual(platform_of("notes.txt"), "autre")


if __name__ == "__main__":
    unittest.main()
