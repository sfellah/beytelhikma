"""Métadonnées transverses : catégories, auteurs, et le champ `betaka_text`.

`_meta/authors.parquet` et `_meta/book_metadata.parquet` n'existent qu'en Parquet
(pas de jumeau JSONL). `_meta/categories.parquet` compte 41 lignes dont une
factice (`id = 42`, `name_ar = '#'`, aucun livre) ; l'id 41 n'existe pas.
"""

from __future__ import annotations

import os
import re

ARABIC_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")

# Shamela encode « date de décès inconnue » par 99999 (1 069 auteurs sur 3 187).
UNKNOWN_DEATH = 99999

JUNK_CATEGORY_IDS = {42}

GREGORIAN_RE = re.compile(r"\b(1[5-9]\d{2}|20\d{2})\s*م")


def _read_parquet(path: str) -> list[dict]:
    try:
        import polars as pl

        return pl.read_parquet(path).to_dicts()
    except ImportError:
        import pyarrow.parquet as pq

        return pq.read_table(path).to_pylist()


def load_categories(meta_dir: str) -> list[dict]:
    rows = _read_parquet(os.path.join(meta_dir, "categories.parquet"))
    out = []
    for row in rows:
        if row["id"] in JUNK_CATEGORY_IDS:
            continue
        out.append(
            {
                "category_id": int(row["id"]),
                "label_ar": row["name_ar"],
                "parent_id": None,  # la source ne porte aucune hiérarchie
                "sort_order": int(row.get("sort_order") or 0),
            }
        )
    out.sort(key=lambda c: (c["sort_order"], c["category_id"]))
    return out


def clean_death(value) -> int | None:
    if value is None:
        return None
    value = int(value)
    return None if value <= 0 or value == UNKNOWN_DEATH else value


def load_authors(meta_dir: str) -> dict[int, dict]:
    """Auteurs indexés par `id` interne (celui que référence `book_metadata`)."""
    rows = _read_parquet(os.path.join(meta_dir, "authors.parquet"))
    authors = {}
    for row in rows:
        biography = row.get("biography")
        authors[int(row["id"])] = {
            "source_author_id": int(row["id"]),
            "full_name_ar": row["name_ar"],
            # Pas de source pour un nom court : le fabriquer serait inventer.
            # L'app fait COALESCE(short_name_ar, full_name_ar).
            "short_name_ar": None,
            "death_year_hijri": clean_death(row.get("death_hijri")),
            "bio_ar": biography.replace("\r", "\n\n").strip() if biography else None,
        }
    return authors


def betaka_field(betaka: str | None, label: str) -> str | None:
    """Valeur de la ligne `<label>: ...`, les lignes étant séparées par `\\r`."""
    if not betaka:
        return None
    for line in betaka.split("\r"):
        line = line.strip()
        if line.startswith(label):
            value = line[len(label):].lstrip(": ؛\t").strip()
            if value:
                return value
    return None


def gregorian_year(betaka: str | None) -> int | None:
    """Millésime grégorien seulement.

    Les années de `betaka_text` sont majoritairement hégiriennes ; on n'alimente
    `publication_year` que si un millésime est explicitement suivi de `م`.
    """
    parts = [betaka_field(betaka, "الطبعة"), betaka_field(betaka, "عام النشر")]
    haystack = " ".join(p for p in parts if p).translate(ARABIC_DIGITS)
    m = GREGORIAN_RE.search(haystack)
    return int(m.group(1)) if m else None


def subtitle(betaka: str | None, title_ar: str) -> str | None:
    """Le titre développé de la notice, s'il apporte davantage que `title_ar`."""
    value = betaka_field(betaka, "الكتاب")
    if value and value != title_ar and len(value) > len(title_ar):
        return value
    return None


def bibliography(betaka: str | None) -> str | None:
    return betaka.replace("\r", "\n").strip() if betaka else None
