import json
import os
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from release_library import nettoie, tranches, version_suivante

SHA = "a" * 64
AUTRE = "b" * 64


class FauxLivre:
    def __init__(self, book_id, size):
        self.book_id = book_id
        self.size = size


class VersionSuivanteTest(unittest.TestCase):
    def test_aucun_pointeur_lisible_est_une_premiere_publication(self):
        """Bucket vide, pointeur illisible, réseau muet : même réponse. Il n'y a
        rien en ligne à ne pas écraser."""
        for pointeur in (None, {}, {"catalog_version": "trois"}, {"sha256": SHA}):
            self.assertEqual(version_suivante(pointeur, SHA), 1, repr(pointeur))

    def test_contenu_identique_ne_republie_pas(self):
        """Republier deux fois le même corpus ferait retélécharger la graine à
        tous les clients pour rien."""
        pointeur = {"catalog_version": 3, "sha256": SHA}
        self.assertIsNone(version_suivante(pointeur, SHA))

    def test_contenu_different_incremente(self):
        pointeur = {"catalog_version": 3, "sha256": SHA}
        self.assertEqual(version_suivante(pointeur, AUTRE), 4)

    def test_la_version_ne_descend_jamais(self):
        """Un pointeur sans empreinte ne permet pas de conclure à l'identité :
        on publie, mais au-dessus de ce qui est en ligne."""
        pointeur = {"catalog_version": 9}
        self.assertEqual(version_suivante(pointeur, SHA), 10)


class TranchesTest(unittest.TestCase):
    def test_toute_la_selection_est_couverte_une_fois(self):
        """Un livre oublié entre deux tranches serait au catalogue final sans
        jamais avoir été monté : le client tomberait sur un 404."""
        livres = [FauxLivre(i, i * 10) for i in range(1, 26)]
        lots = tranches(livres, 10)
        self.assertEqual(len(lots), 3)
        vus = [b.book_id for lot in lots for b in lot]
        self.assertEqual(sorted(vus), [b.book_id for b in livres])
        self.assertEqual(len(vus), len(set(vus)))
        self.assertLessEqual(max(len(lot) for lot in lots) - min(len(lot) for lot in lots), 1)

    def test_les_tranches_pesent_a_peu_pres_pareil(self):
        """Couper la liste triée mettrait les cent plus gros livres ensemble :
        4,5 Go de source pour la première tranche, ~45 Go en sortie. Le pic
        disque doit être la moyenne, pas le sommet."""
        livres = [FauxLivre(i, i) for i in range(1, 101)]  # 5050 au total
        poids = [sum(b.size for b in lot) for lot in tranches(livres, 10)]
        self.assertEqual(sum(poids), 5050)
        # Coupé en tronçons, le plus lourd vaudrait 955 contre 55 au plus léger,
        # soit un facteur 17. En escalier, l'écart reste sous le quart.
        self.assertLess(max(poids), min(poids) * 1.25, poids)
        self.assertLess(max(poids), 700, "un découpage en tronçons donnerait 955")

    def test_aucun_livre_ne_donne_aucune_tranche(self):
        self.assertEqual(tranches([], 10), [])


def _catalogue(racine, editions):
    con = sqlite3.connect(os.path.join(racine, "catalog.sqlite"))
    con.execute("CREATE TABLE book_releases (edition_id TEXT, is_active INTEGER)")
    con.executemany(
        "INSERT INTO book_releases VALUES (?, 1)", [(e,) for e in editions]
    )
    con.commit()
    con.close()


class NettoieTest(unittest.TestCase):
    def _prepare(self, racine):
        livres = os.path.join(racine, "books")
        os.makedirs(livres)
        for nom in (
            "sh-1.sqlite", "sh-1.sqlite.zst", "sh-1.manifest.json",
            "sh-1.sqlite-journal", "sh-1.sqlite.part", "sh-2.sqlite",
            "sh-2.manifest.json", "sh-9.sqlite", "sh-9.manifest.json",
        ):
            with open(os.path.join(livres, nom), "w", encoding="utf-8") as fh:
                fh.write("{}" if nom.endswith(".json") else "x")
        # sh-1 est monté, sh-2 ne l'est pas, sh-9 n'est plus au catalogue.
        with open(os.path.join(livres, "sh-1.manifest.json"), "w", encoding="utf-8") as fh:
            json.dump({"object_key": "books/sh-1/1/book.sqlite.zst"}, fh)
        _catalogue(racine, ["sh-1", "sh-2"])
        return livres

    def test_les_restes_temporaires_partent(self):
        """`-journal` et `.part` survivent à un import tué et commencent par un
        identifiant valide : la règle « édition hors catalogue » les gardait."""
        with tempfile.TemporaryDirectory() as racine:
            livres = self._prepare(racine)
            nettoie(racine)
            restants = set(os.listdir(livres))
            self.assertNotIn("sh-1.sqlite-journal", restants)
            self.assertNotIn("sh-1.sqlite.part", restants)
            self.assertNotIn("sh-1.sqlite.zst", restants)
            self.assertNotIn("sh-9.sqlite", restants, "édition hors catalogue")
            self.assertIn("sh-1.sqlite", restants, "sans le drapeau, on garde le livre")

    def test_les_editions_montees_perdent_leur_sqlite_mais_gardent_leur_manifest(self):
        """Le manifest pèse quelques kilo-octets et porte la clé : c'est lui qui
        permet de reconstruire le catalogue une fois le fichier effacé."""
        with tempfile.TemporaryDirectory() as racine:
            livres = self._prepare(racine)
            nettoie(racine, editions_montees=True)
            restants = set(os.listdir(livres))
            self.assertNotIn("sh-1.sqlite", restants)
            self.assertIn("sh-1.manifest.json", restants)
            self.assertIn("sh-2.sqlite", restants, "jamais monté : on ne l'efface pas")


if __name__ == "__main__":
    unittest.main()
