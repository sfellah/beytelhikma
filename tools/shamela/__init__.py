"""Importeur du corpus Shamela 4 vers les bases SQLite de l'application.

Voir `tools/notebooks/01_un_livre_vers_sqlite.ipynb` pour la version commentée
pas à pas de la transformation d'un seul livre.
"""

PIPELINE_VERSION = 1
CONTENT_VERSION = 1
FTS_VERSION = 1
NORMALIZATION = "large-v1"
SOURCE_NAME = "shamela4"
MIN_APP_VERSION = "1.0.0"
