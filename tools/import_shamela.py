#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Importe le corpus Shamela 4 vers les bases SQLite de l'application.

    python tools/import_shamela.py                        # 3 livres par catégorie
    python tools/import_shamela.py --all --jobs 8         # les 8 589 livres
    python tools/import_shamela.py --book-ids 5925        # un livre précis
    python tools/import_shamela.py --dry-run              # afficher la sélection

Sortie (par défaut `dist/shamela/`) :

    catalog.sqlite
    books/sh-<book_id>.sqlite
    books/sh-<book_id>.manifest.json
    import-report.json + .csv

Le schéma produit est celui de `tools/_common.py`, identique à celui du
générateur d'exemple : les clients Flutter et Electron lisent la sortie sans
aucune modification.

Voir `tools/notebooks/01_un_livre_vers_sqlite.ipynb` pour la transformation
d'un seul livre, commentée étape par étape.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from shamela.cli import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
