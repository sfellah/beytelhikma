#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Socle partagé entre le générateur d'exemple et l'importeur Shamela.

Ce module est la **source de vérité unique** pour :

- le DDL SQLite (`BOOK_SCHEMA`, `CATALOG_SCHEMA`) ;
- la normalisation du texte arabe (`normalize_ar`) ;
- le nettoyage HTML (`strip_html`, `decode_entities`) ;
- les empreintes (`sha256_text`, `sha256_file`).

Tout ce qui produit une base lue par l'application doit importer d'ici, jamais
redéfinir. C'est ce qui rend une dérive de schéma impossible entre
`gen_sample_data.py` (5 livres factices) et `import_shamela.py` (corpus réel).

Voir DATAMODEL.md pour la description des tables.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata

# 2 : `book_releases.download_url` devient `object_key` et porte une clé
# relative. Un client de schéma 1 ne sait pas lire un catalogue de schéma 2.
SCHEMA_VERSION = 2

# ---------------------------------------------------------------- normalisation

HARAKAT = re.compile(r"[ؐ-ًؚ-ٰٟۖ-ۭ]")
TATWEEL = "ـ"


def normalize_ar(text: str) -> str:
    """Texte arabe normalisé pour la recherche souple (voir DATAMODEL.md §3).

    Mode « large » : harakāt, tatweel, variantes de alif, `ى→ي` et `ة→ه`.
    Le schéma n'a qu'une seule colonne de recherche, donc on privilégie le
    rappel. Le contrat est versionné par `book_releases.fts_version`.
    """
    text = unicodedata.normalize("NFC", text)
    text = HARAKAT.sub("", text)
    text = text.replace(TATWEEL, "")
    text = re.sub(r"[أإآٱ]", "ا", text)
    text = text.replace("ى", "ي")
    text = text.replace("ة", "ه")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


BLOCK_TAGS = r"p|div|h[1-6]|li|blockquote"


def strip_html(html: str) -> str:
    """HTML de rendu -> texte lisible (sélection, copie, citation)."""
    text = re.sub(r"<br\s*/?>", "\n", html)
    text = re.sub(rf"</?(?:{BLOCK_TAGS})\b[^>]*>", "\n", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = text.replace("&nbsp;", " ")
    text = text.replace("\r", "")
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


# Miroir de `_entities` dans beytelhikma/lib/utils/arabic_html_parser.dart :
# le texte brut stocké en base doit correspondre à ce que les deux clients
# affichent une fois le HTML décodé.
ENTITIES = {
    "&nbsp;": " ",
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&apos;": "'",
    "&#39;": "'",
}

_NUMERIC_ENTITY = re.compile(r"&#(x[0-9a-fA-F]+|[0-9]+);")


def decode_entities(text: str) -> str:
    """Décode les entités HTML rencontrées dans le corpus Shamela.

    Rares mais présentes : `&amp;` (251 occurrences sur 60 livres échantillonnés),
    `&lt;`, `&gt;`. Appliqué à `body_plain`, jamais à `body_html`.
    """
    for entity, char in ENTITIES.items():
        text = text.replace(entity, char)

    def _num(match: re.Match[str]) -> str:
        raw = match.group(1)
        try:
            code = int(raw[1:], 16) if raw[0] in "xX" else int(raw)
        except ValueError:
            return match.group(0)
        return chr(code) if 0 < code < 0x110000 else match.group(0)

    return _NUMERIC_ENTITY.sub(_num, text)


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


# ---------------------------------------------------------------- book.sqlite

BOOK_SCHEMA = """
CREATE TABLE book_info (
    edition_id      TEXT PRIMARY KEY,
    source_book_id  INTEGER,
    shamela_id      INTEGER,
    title_ar        TEXT NOT NULL,
    schema_version  INTEGER NOT NULL,
    content_version INTEGER NOT NULL,
    page_count      INTEGER NOT NULL,
    toc_count       INTEGER NOT NULL,
    created_at      TEXT NOT NULL,
    content_hash    TEXT NOT NULL
);

CREATE TABLE volumes (
    volume_id     INTEGER PRIMARY KEY,
    part_number   INTEGER NOT NULL,
    label_ar      TEXT,
    sequence_num  INTEGER NOT NULL,
    first_page_id INTEGER,
    last_page_id  INTEGER
);

CREATE TABLE pages (
    page_id          INTEGER PRIMARY KEY,
    shamela_page_id  INTEGER,
    volume_id        INTEGER REFERENCES volumes(volume_id),
    printed_page_num INTEGER,
    sequence_num     INTEGER NOT NULL,
    body_html        TEXT NOT NULL,
    body_plain       TEXT NOT NULL,
    body_search      TEXT NOT NULL,
    footnotes        TEXT,
    hints            TEXT,
    content_hash     TEXT NOT NULL
);
CREATE INDEX idx_pages_sequence ON pages(sequence_num);
CREATE INDEX idx_pages_volume ON pages(volume_id, sequence_num);

CREATE TABLE toc (
    toc_id           INTEGER PRIMARY KEY,
    parent_toc_id    INTEGER REFERENCES toc(toc_id),
    page_id          INTEGER NOT NULL REFERENCES pages(page_id),
    title_text       TEXT NOT NULL,
    title_normalized TEXT NOT NULL,
    level            INTEGER NOT NULL,
    sequence_num     INTEGER NOT NULL,
    shamela_title_id INTEGER
);
CREATE INDEX idx_toc_parent ON toc(parent_toc_id, sequence_num);

CREATE TABLE assets (
    asset_id  INTEGER PRIMARY KEY,
    file_path TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    sha256    TEXT NOT NULL,
    width     INTEGER,
    height    INTEGER
);

CREATE VIRTUAL TABLE pages_fts USING fts5(
    page_id UNINDEXED,
    body_search,
    footnotes_search,
    content=''
);
"""


# ---------------------------------------------------------------- catalog.sqlite

CATALOG_SCHEMA = """
CREATE TABLE catalog_info (
    catalog_version INTEGER NOT NULL,
    schema_version  INTEGER NOT NULL,
    generated_at    TEXT NOT NULL,
    edition_count   INTEGER NOT NULL
);

CREATE TABLE categories (
    category_id INTEGER PRIMARY KEY,
    label_ar    TEXT NOT NULL,
    parent_id   INTEGER REFERENCES categories(category_id),
    sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE authors (
    author_id        TEXT PRIMARY KEY,
    full_name_ar     TEXT NOT NULL,
    short_name_ar    TEXT,
    death_year_hijri INTEGER,
    bio_ar           TEXT,
    portrait_url     TEXT
);

CREATE TABLE works (
    work_id     TEXT PRIMARY KEY,
    title_ar    TEXT NOT NULL,
    category_id INTEGER REFERENCES categories(category_id)
);

CREATE TABLE editions (
    edition_id        TEXT PRIMARY KEY,
    work_id           TEXT NOT NULL REFERENCES works(work_id),
    source            TEXT NOT NULL,
    source_book_id    INTEGER,
    shamela_id        INTEGER,
    title_ar          TEXT NOT NULL,
    subtitle_ar       TEXT,
    category_id       INTEGER REFERENCES categories(category_id),
    book_type         INTEGER,
    book_type_label   TEXT,
    bibliography_text TEXT,
    publisher_ar      TEXT,
    edition_label_ar  TEXT,
    publication_year  INTEGER,
    printed           INTEGER NOT NULL DEFAULT 1,
    is_hidden         INTEGER NOT NULL DEFAULT 0,
    volume_count      INTEGER NOT NULL DEFAULT 1,
    has_multi_part    INTEGER NOT NULL DEFAULT 0,
    language          TEXT NOT NULL DEFAULT 'ar',
    cover_url         TEXT
);
CREATE INDEX idx_editions_category ON editions(category_id);

CREATE TABLE edition_authors (
    edition_id TEXT NOT NULL REFERENCES editions(edition_id),
    author_id  TEXT NOT NULL REFERENCES authors(author_id),
    role       TEXT NOT NULL,
    position   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (edition_id, author_id, role)
);

CREATE TABLE book_releases (
    release_id        TEXT PRIMARY KEY,
    edition_id        TEXT NOT NULL REFERENCES editions(edition_id),
    schema_version    INTEGER NOT NULL,
    content_version   INTEGER NOT NULL,
    source_version    TEXT,
    -- Clé **relative** à la base de distribution configurée côté client
    -- (`books/<edition_id>/<content_version>/book.sqlite.zst`), écrite par
    -- `publish_minio.py`. La présence de `://` marque un absolu : `asset://` et
    -- `local://` désignent la bibliothèque source et gardent les jeux hors
    -- ligne utilisables sans réseau ni publication.
    object_key        TEXT NOT NULL,
    compressed_size   INTEGER,
    uncompressed_size INTEGER,
    sha256            TEXT NOT NULL,
    page_count        INTEGER NOT NULL,
    toc_count         INTEGER NOT NULL,
    fts_version       INTEGER NOT NULL DEFAULT 1,
    min_app_version   TEXT,
    published_at      TEXT NOT NULL,
    is_active         INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_releases_edition ON book_releases(edition_id, is_active);

CREATE TABLE edition_relations (
    from_edition_id TEXT NOT NULL REFERENCES editions(edition_id),
    to_edition_id   TEXT NOT NULL REFERENCES editions(edition_id),
    relation_type   TEXT NOT NULL,
    PRIMARY KEY (from_edition_id, to_edition_id, relation_type)
);

CREATE VIRTUAL TABLE catalog_fts USING fts5(
    edition_id UNINDEXED,
    title_ar,
    title_normalized,
    author_names,
    bibliography_text
);
"""
