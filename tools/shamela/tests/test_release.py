import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from release_library import version_suivante

SHA = "a" * 64
AUTRE = "b" * 64


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


if __name__ == "__main__":
    unittest.main()
