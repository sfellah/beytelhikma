#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Inventaire du corpus en CSV : la source brute et le catalogue, côte à côte.

    python tools/export_corpus_csv.py                    # les deux fichiers
    python tools/export_corpus_csv.py --what authors
    python tools/export_corpus_csv.py --sep ";"          # Excel francophone

Sortie (par défaut `dist/`) :

    corpus-inventory.csv    une ligne par livre   (8 589)
    authors-inventory.csv   une ligne par auteur  (3 187)

Chaque ligne porte trois blocs préfixés — `raw_` (ce que Shamela fournit),
`imp_` (ce que l'import en a fait) et `cat_` (ce qui est arrivé au catalogue) —
parce que le seul intérêt du fichier est de voir l'écart. Un livre rejeté à
l'import y figure avec `in_catalog = 0` et sa raison : l'omettre ferait mentir
l'inventaire sur exactement les cas qui intéressent.

Lecture seule sur les deux sources ; seuls les CSV sont écrits.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from shamela.catalogdb import edition_id  # noqa: E402
from shamela.cli import DEFAULT_OUT, DEFAULT_SRC  # noqa: E402
from shamela.meta import UNKNOWN_DEATH, _read_parquet, clean_death  # noqa: E402

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_DEST = os.path.join(REPO_ROOT, "dist")

JOIN = " | "

# Les nisba-s d'école ne sont pas un champ de la source : elles se lisent dans le
# nom ou la biographie. Rendu comme tel, jamais comme une donnée d'origine.
MADHAHIB = {
    "hanafi": "الحنفي",
    "maliki": "المالكي",
    "shafii": "الشافعي",
    "hanbali": "الحنبلي",
    "zahiri": "الظاهري",
}


def flat(value) -> str:
    """Texte sur une seule ligne physique.

    `betaka_text` porte jusqu'à dix `\\r` : correctement cité, le CSV reste
    valide mais devient illisible dans un tableur, une notice occupant alors dix
    lignes dont neuf sans identifiant.
    """
    if value is None:
        return ""
    text = str(value)
    for char in ("\r\n", "\r", "\n"):
        text = text.replace(char, " / ")
    return " ".join(text.split())


def scalar(value) -> str:
    """Nombre ou booléen -> texte stable. `True` s'écrit `1`, pas `True`."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def load_json_field(value):
    """`authors_json` est du JSON en Parquet, une liste déjà décodée en JSON."""
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        return list(value)
    try:
        parsed = json.loads(value)
    except (TypeError, ValueError):
        return []
    return parsed if isinstance(parsed, list) else []


def madhhab_of(name: str, biography: str) -> tuple[str, str]:
    """(nisba trouvée, d'où elle vient). Le nom prime sur la biographie."""
    found = []
    source = []
    for key, nisba in MADHAHIB.items():
        in_name = nisba in (name or "")
        in_bio = nisba in (biography or "")
        if in_name or in_bio:
            found.append(key)
            source.append("name" if in_name else "bio")
    return JOIN.join(found), JOIN.join(source)


# ------------------------------------------------------------------ chargement


def read_import_report(path: str) -> dict[int, dict]:
    if not os.path.exists(path):
        return {}
    rows = {}
    with open(path, encoding="utf-8-sig", newline="") as fh:
        for row in csv.DictReader(fh):
            try:
                rows[int(row["book_id"])] = row
            except (KeyError, TypeError, ValueError):
                continue
    return rows


def read_catalog(path: str) -> dict:
    """Tout le catalogue en mémoire : 8 568 éditions, quelques dizaines de Mo."""
    empty = {
        "editions": {},
        "authors": {},
        "releases": {},
        "edition_authors": {},
        "author_editions": {},
        "relations": {},
        "categories": {},
        "info": None,
    }
    if not os.path.exists(path):
        return empty

    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    try:
        categories = {
            row["category_id"]: row["label_ar"]
            for row in con.execute("SELECT category_id, label_ar FROM categories")
        }
        editions = {row["edition_id"]: dict(row) for row in con.execute("SELECT * FROM editions")}
        authors = {row["author_id"]: dict(row) for row in con.execute("SELECT * FROM authors")}

        releases: dict[str, dict] = {}
        for row in con.execute("SELECT * FROM book_releases ORDER BY is_active DESC, release_id"):
            releases.setdefault(row["edition_id"], dict(row))

        edition_authors: dict[str, list[dict]] = {}
        author_editions: dict[str, list[tuple[str, str]]] = {}
        query = """SELECT ea.edition_id, ea.author_id, ea.role, ea.position,
                          a.full_name_ar, a.death_year_hijri
                     FROM edition_authors ea
                     LEFT JOIN authors a ON a.author_id = ea.author_id
                    ORDER BY ea.edition_id, ea.position"""
        for row in con.execute(query):
            edition_authors.setdefault(row["edition_id"], []).append(dict(row))
            author_editions.setdefault(row["author_id"], []).append(
                (row["edition_id"], row["role"])
            )

        relations: dict[str, dict[str, list[str]]] = {}
        for row in con.execute("SELECT * FROM edition_relations ORDER BY to_edition_id"):
            bucket = relations.setdefault(row["from_edition_id"], {})
            bucket.setdefault(row["relation_type"], []).append(row["to_edition_id"])

        info = con.execute("SELECT * FROM catalog_info").fetchone()
        return {
            "editions": editions,
            "authors": authors,
            "releases": releases,
            "edition_authors": edition_authors,
            "author_editions": author_editions,
            "relations": relations,
            "categories": categories,
            "info": dict(info) if info else None,
        }
    finally:
        con.close()


# ---------------------------------------------------------------------- livres

BOOK_COLUMNS = [
    "book_id",
    "in_raw",
    "in_catalog",
    # --- source
    "raw_shamela_id",
    "raw_title_ar",
    "raw_book_type",
    "raw_book_type_label",
    "raw_category_id",
    "raw_category_name_ar",
    "raw_main_author_id",
    "raw_main_author_name_ar",
    "raw_main_author_death_hijri",
    "raw_main_author_death_hijri_text",
    "raw_authors_text",
    "raw_author_count",
    "raw_author_names",
    "raw_author_roles",
    "raw_author_death_years",
    "raw_hijri_era",
    "raw_death_is_unknown",
    "raw_printed",
    "raw_is_hidden",
    "raw_parent_id",
    "raw_group_id",
    "raw_version_major",
    "raw_version_minor",
    "raw_volume_count_observed",
    "raw_has_multi_part",
    "raw_meta",
    "raw_betaka_text",
    "raw_authors_json",
    # --- import
    "imp_status",
    "imp_stage",
    "imp_reason",
    "imp_pages",
    "imp_toc",
    "imp_volumes",
    "imp_assets",
    "imp_source_bytes",
    "imp_output_bytes",
    "imp_duration_s",
    # --- catalogue
    "cat_edition_id",
    "cat_work_id",
    "cat_source",
    "cat_title_ar",
    "cat_subtitle_ar",
    "cat_category_id",
    "cat_category_label",
    "cat_book_type",
    "cat_book_type_label",
    "cat_publisher_ar",
    "cat_edition_label_ar",
    "cat_publication_year",
    "cat_printed",
    "cat_is_hidden",
    "cat_volume_count",
    "cat_has_multi_part",
    "cat_language",
    "cat_cover_url",
    "cat_bibliography_text",
    "cat_author_count",
    "cat_authors",
    "cat_author_ids",
    "cat_author_roles",
    "cat_same_group_count",
    "cat_same_group_ids",
    "cat_part_of_count",
    "cat_part_of_ids",
    "cat_release_id",
    "cat_content_version",
    "cat_object_key",
    "cat_sha256",
    "cat_compressed_size",
    "cat_uncompressed_size",
    "cat_page_count",
    "cat_toc_count",
    "cat_is_active",
    # --- rapprochement
    "delta_volume_count",
]


def book_row(book_id: int, meta: dict | None, report: dict | None, catalog: dict) -> dict:
    eid = edition_id(book_id)
    edition = catalog["editions"].get(eid)
    release = catalog["releases"].get(eid, {})
    links = catalog["edition_authors"].get(eid, [])
    relations = catalog["relations"].get(eid, {})
    meta = meta or {}
    report = report or {}

    entries = load_json_field(meta.get("authors_json"))
    death = meta.get("main_author_death_hijri")

    same_group = relations.get("same_group", [])
    part_of = relations.get("part_of", [])

    row = {
        "book_id": book_id,
        "in_raw": "1" if meta else "0",
        "in_catalog": "1" if edition else "0",
        "raw_shamela_id": scalar(meta.get("shamela_id")),
        "raw_title_ar": flat(meta.get("title_ar")),
        "raw_book_type": scalar(meta.get("book_type")),
        "raw_book_type_label": flat(meta.get("book_type_label")),
        "raw_category_id": scalar(meta.get("category_id")),
        "raw_category_name_ar": flat(meta.get("category_name_ar")),
        "raw_main_author_id": scalar(meta.get("main_author_id")),
        "raw_main_author_name_ar": flat(meta.get("main_author_name_ar")),
        "raw_main_author_death_hijri": scalar(death),
        "raw_main_author_death_hijri_text": flat(meta.get("main_author_death_hijri_text")),
        "raw_authors_text": flat(meta.get("authors_text")),
        "raw_author_count": scalar(len(entries)),
        "raw_author_names": JOIN.join(flat(e.get("name_ar")) for e in entries),
        "raw_author_roles": JOIN.join(flat(e.get("role")) for e in entries),
        "raw_author_death_years": JOIN.join(scalar(e.get("death_hijri")) for e in entries),
        "raw_hijri_era": scalar(meta.get("hijri_era")),
        "raw_death_is_unknown": "1" if death is not None and int(death) == UNKNOWN_DEATH else "0",
        "raw_printed": scalar(meta.get("printed")),
        "raw_is_hidden": scalar(meta.get("is_hidden")),
        "raw_parent_id": scalar(meta.get("parent_id")),
        "raw_group_id": scalar(meta.get("group_id")),
        "raw_version_major": scalar(meta.get("version_major")),
        "raw_version_minor": scalar(meta.get("version_minor")),
        "raw_volume_count_observed": scalar(meta.get("volume_count_observed")),
        "raw_has_multi_part": scalar(meta.get("has_multi_part")),
        "raw_meta": flat(meta.get("meta")),
        "raw_betaka_text": flat(meta.get("betaka_text")),
        "raw_authors_json": flat(meta.get("authors_json")),
        "imp_status": flat(report.get("status")),
        "imp_stage": flat(report.get("stage")),
        "imp_reason": flat(report.get("reason")),
        "imp_pages": flat(report.get("pages")),
        "imp_toc": flat(report.get("toc")),
        "imp_volumes": flat(report.get("volumes")),
        "imp_assets": flat(report.get("assets")),
        "imp_source_bytes": flat(report.get("source_bytes")),
        "imp_output_bytes": flat(report.get("output_bytes")),
        "imp_duration_s": flat(report.get("duration_s")),
        "cat_edition_id": edition["edition_id"] if edition else "",
        "cat_work_id": edition["work_id"] if edition else "",
        "cat_source": edition["source"] if edition else "",
        "cat_title_ar": flat(edition["title_ar"]) if edition else "",
        "cat_subtitle_ar": flat(edition["subtitle_ar"]) if edition else "",
        "cat_category_id": scalar(edition["category_id"]) if edition else "",
        "cat_category_label": (
            flat(catalog["categories"].get(edition["category_id"])) if edition else ""
        ),
        "cat_book_type": scalar(edition["book_type"]) if edition else "",
        "cat_book_type_label": flat(edition["book_type_label"]) if edition else "",
        "cat_publisher_ar": flat(edition["publisher_ar"]) if edition else "",
        "cat_edition_label_ar": flat(edition["edition_label_ar"]) if edition else "",
        "cat_publication_year": scalar(edition["publication_year"]) if edition else "",
        "cat_printed": scalar(edition["printed"]) if edition else "",
        "cat_is_hidden": scalar(edition["is_hidden"]) if edition else "",
        "cat_volume_count": scalar(edition["volume_count"]) if edition else "",
        "cat_has_multi_part": scalar(edition["has_multi_part"]) if edition else "",
        "cat_language": edition["language"] if edition else "",
        "cat_cover_url": flat(edition["cover_url"]) if edition else "",
        "cat_bibliography_text": flat(edition["bibliography_text"]) if edition else "",
        "cat_author_count": scalar(len(links)) if edition else "",
        "cat_authors": JOIN.join(flat(link.get("full_name_ar")) for link in links),
        "cat_author_ids": JOIN.join(link["author_id"] for link in links),
        "cat_author_roles": JOIN.join(link["role"] for link in links),
        "cat_same_group_count": scalar(len(same_group)) if edition else "",
        "cat_same_group_ids": JOIN.join(same_group),
        "cat_part_of_count": scalar(len(part_of)) if edition else "",
        "cat_part_of_ids": JOIN.join(part_of),
        "cat_release_id": release.get("release_id", ""),
        "cat_content_version": scalar(release.get("content_version")),
        "cat_object_key": release.get("object_key", ""),
        "cat_sha256": release.get("sha256", ""),
        "cat_compressed_size": scalar(release.get("compressed_size")),
        "cat_uncompressed_size": scalar(release.get("uncompressed_size")),
        "cat_page_count": scalar(release.get("page_count")),
        "cat_toc_count": scalar(release.get("toc_count")),
        "cat_is_active": scalar(release.get("is_active")),
        "delta_volume_count": "",
    }

    # L'écart est systématique pour les mono-volumes : la source les compte 0,
    # le catalogue écrit le nombre de tomes réellement produits.
    if edition and meta.get("volume_count_observed") is not None:
        row["delta_volume_count"] = scalar(
            int(edition["volume_count"]) - int(meta["volume_count_observed"])
        )
    return row


def export_books(*, meta_dir: str, library: str, dest: str, sep: str) -> dict:
    books = _read_parquet(os.path.join(meta_dir, "book_metadata.parquet"))
    metadata = {int(row["book_id"]): row for row in books}
    report = read_import_report(os.path.join(library, "import-report.csv"))
    catalog = read_catalog(os.path.join(library, "catalog.sqlite"))

    ids = set(metadata) | set(report)
    for eid, edition in catalog["editions"].items():
        source_book_id = edition.get("source_book_id")
        if source_book_id is not None:
            ids.add(int(source_book_id))

    write_csv(
        dest,
        BOOK_COLUMNS,
        (
            book_row(book_id, metadata.get(book_id), report.get(book_id), catalog)
            for book_id in sorted(ids)
        ),
        sep,
    )
    return {
        "rows": len(ids),
        "in_catalog": len(catalog["editions"]),
        "path": dest,
    }


# --------------------------------------------------------------------- auteurs

AUTHOR_COLUMNS = [
    "author_id",
    "in_raw",
    "in_catalog",
    "raw_shamela_id",
    "raw_name_ar",
    "raw_death_hijri",
    "raw_death_hijri_text",
    "raw_death_is_unknown",
    "raw_alpha_sort",
    "raw_has_biography",
    "raw_biography",
    "raw_madhhab_nisba",
    "raw_madhhab_source",
    "raw_book_count",
    "raw_main_author_count",
    "raw_categories",
    "cat_author_id",
    "cat_full_name_ar",
    "cat_short_name_ar",
    "cat_death_year_hijri",
    "cat_has_bio",
    "cat_edition_count",
    "cat_role_author_count",
    "cat_role_coauthor_count",
    "cat_categories",
]


def author_row(source_id: int, raw: dict | None, usage: dict, catalog: dict) -> dict:
    raw = raw or {}
    aid = f"sh-au-{source_id}"
    entry = catalog["authors"].get(aid)
    editions = catalog["author_editions"].get(aid, [])
    death = raw.get("death_hijri")
    biography = raw.get("biography") or ""
    nisba, nisba_source = madhhab_of(raw.get("name_ar") or "", biography)

    cat_categories: dict[str, int] = {}
    for eid, _role in editions:
        edition = catalog["editions"].get(eid)
        if not edition:
            continue
        label = catalog["categories"].get(edition["category_id"])
        if label:
            cat_categories[label] = cat_categories.get(label, 0) + 1

    return {
        "author_id": source_id,
        "in_raw": "1" if raw else "0",
        "in_catalog": "1" if entry else "0",
        "raw_shamela_id": scalar(raw.get("shamela_id")),
        "raw_name_ar": flat(raw.get("name_ar")),
        "raw_death_hijri": scalar(death),
        "raw_death_hijri_text": flat(raw.get("death_hijri_text")),
        "raw_death_is_unknown": "1" if death is not None and int(death) == UNKNOWN_DEATH else "0",
        "raw_alpha_sort": scalar(raw.get("alpha_sort")),
        "raw_has_biography": "1" if biography else "0",
        "raw_biography": flat(biography),
        "raw_madhhab_nisba": nisba,
        "raw_madhhab_source": nisba_source,
        "raw_book_count": scalar(usage.get("books", 0)),
        "raw_main_author_count": scalar(usage.get("main", 0)),
        "raw_categories": JOIN.join(
            f"{label} ({count})" for label, count in sorted(usage.get("categories", {}).items())
        ),
        "cat_author_id": entry["author_id"] if entry else "",
        "cat_full_name_ar": flat(entry["full_name_ar"]) if entry else "",
        "cat_short_name_ar": flat(entry["short_name_ar"]) if entry else "",
        "cat_death_year_hijri": scalar(clean_death(death)) if entry else "",
        "cat_has_bio": ("1" if entry.get("bio_ar") else "0") if entry else "",
        "cat_edition_count": scalar(len(editions)) if entry else "",
        "cat_role_author_count": (
            scalar(sum(1 for _e, role in editions if role == "author")) if entry else ""
        ),
        "cat_role_coauthor_count": (
            scalar(sum(1 for _e, role in editions if role == "coauthor")) if entry else ""
        ),
        "cat_categories": JOIN.join(
            f"{label} ({count})" for label, count in sorted(cat_categories.items())
        ),
    }


def export_authors(*, meta_dir: str, library: str, dest: str, sep: str) -> dict:
    rows = _read_parquet(os.path.join(meta_dir, "authors.parquet"))
    raw_authors = {int(row["id"]): row for row in rows}
    catalog = read_catalog(os.path.join(library, "catalog.sqlite"))

    # Usage côté source : un auteur peut être cité sans être l'auteur principal.
    usage: dict[int, dict] = {}
    for book in _read_parquet(os.path.join(meta_dir, "book_metadata.parquet")):
        label = book.get("category_name_ar")
        seen = set()
        for entry in load_json_field(book.get("authors_json")):
            if entry.get("author_id") is None:
                continue
            seen.add(int(entry["author_id"]))
        main = book.get("main_author_id")
        if main is not None:
            seen.add(int(main))
            bucket = usage.setdefault(int(main), {"books": 0, "main": 0, "categories": {}})
            bucket["main"] += 1
        for source_id in seen:
            bucket = usage.setdefault(source_id, {"books": 0, "main": 0, "categories": {}})
            bucket["books"] += 1
            if label:
                bucket["categories"][label] = bucket["categories"].get(label, 0) + 1

    ids = set(raw_authors) | set(usage)
    for aid in catalog["authors"]:
        if aid.startswith("sh-au-"):
            try:
                ids.add(int(aid[len("sh-au-"):]))
            except ValueError:
                continue

    write_csv(
        dest,
        AUTHOR_COLUMNS,
        (
            author_row(source_id, raw_authors.get(source_id), usage.get(source_id, {}), catalog)
            for source_id in sorted(ids)
        ),
        sep,
    )
    return {"rows": len(ids), "in_catalog": len(catalog["authors"]), "path": dest}


# ----------------------------------------------------------------------- sortie


def write_csv(path: str, columns: list[str], rows, sep: str) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    # `utf-8-sig` : sans la marque d'ordre, Excel lit l'arabe en mojibake.
    with open(path, "w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=columns, delimiter=sep)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="export_corpus_csv",
        description="Inventaire CSV du corpus : source brute et catalogue côte à côte.",
    )
    parser.add_argument("--src", default=DEFAULT_SRC, help="racine du corpus Shamela")
    parser.add_argument("--library", default=DEFAULT_OUT, help="dossier de la bibliothèque importée")
    parser.add_argument("--dest", default=DEFAULT_DEST, help="dossier des CSV produits")
    parser.add_argument("--books-out", help="chemin du CSV des livres")
    parser.add_argument("--authors-out", help="chemin du CSV des auteurs")
    parser.add_argument("--what", choices=("books", "authors", "both"), default="both")
    parser.add_argument("--sep", default=",", help='séparateur de colonnes (";" pour Excel FR)')
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    meta_dir = os.path.join(args.src, "_meta")
    if not os.path.isdir(meta_dir):
        print(f"corpus introuvable : {meta_dir}", file=sys.stderr)
        return 2

    catalog_path = os.path.join(args.library, "catalog.sqlite")
    if not os.path.exists(catalog_path):
        print(
            f"catalogue absent ({catalog_path}) : les colonnes cat_ resteront vides",
            file=sys.stderr,
        )

    books_out = args.books_out or os.path.join(args.dest, "corpus-inventory.csv")
    authors_out = args.authors_out or os.path.join(args.dest, "authors-inventory.csv")

    if args.what in ("books", "both"):
        stats = export_books(
            meta_dir=meta_dir, library=args.library, dest=books_out, sep=args.sep
        )
        print(f"livres  : {stats['rows']} lignes, {stats['in_catalog']} au catalogue -> {stats['path']}")

    if args.what in ("authors", "both"):
        stats = export_authors(
            meta_dir=meta_dir, library=args.library, dest=authors_out, sep=args.sep
        )
        print(f"auteurs : {stats['rows']} lignes, {stats['in_catalog']} au catalogue -> {stats['path']}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
