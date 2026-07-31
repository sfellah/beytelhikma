"""Construction de `catalog.sqlite` à partir des livres effectivement importés.

Écrit par le processus parent, en mono-thread, une fois les workers terminés :
seuls les livres validés entrent au catalogue, pour qu'il n'annonce jamais un
fichier absent.
"""

from __future__ import annotations

import os
import sqlite3

from _common import CATALOG_SCHEMA, SCHEMA_VERSION, normalize_ar

from . import CONTENT_VERSION, FTS_VERSION, MIN_APP_VERSION, SOURCE_NAME
from .meta import bibliography, betaka_field, gregorian_year, subtitle

# Un groupe très large produirait un nombre quadratique de relations.
MAX_GROUP_FANOUT = 20


def edition_id(book_id: int) -> str:
    return f"sh-{book_id}"


def work_id(book_id: int) -> str:
    return f"sh-wk-{book_id}"


def author_id(source_author_id: int) -> str:
    return f"sh-au-{source_author_id}"


def release_id(book_id: int) -> str:
    return f"sh-{book_id}-v1"


def build_catalog(
    path: str,
    *,
    results: list[dict],
    metadata: dict[int, dict],
    categories: list[dict],
    authors: dict[int, dict],
    catalog_version: int,
    generated_at: str,
) -> dict:
    """Écrit le catalogue. `results` ne contient que des livres au statut `ok`."""
    if os.path.exists(path):
        os.remove(path)
    os.makedirs(os.path.dirname(path), exist_ok=True)

    con = sqlite3.connect(path)
    stats = {"editions": 0, "authors": 0, "relations": 0, "missing_authors": 0}
    try:
        con.execute("PRAGMA page_size = 4096")
        con.execute("PRAGMA journal_mode = OFF")
        con.execute("PRAGMA synchronous = OFF")
        con.executescript(CATALOG_SCHEMA)
        con.execute("BEGIN")

        con.execute(
            "INSERT INTO catalog_info VALUES (?,?,?,?)",
            (catalog_version, SCHEMA_VERSION, generated_at, len(results)),
        )

        # Les 40 catégories réelles, même vides : l'app fait un LEFT JOIN et
        # affichera simplement un compte de 0.
        con.executemany(
            "INSERT INTO categories (category_id, label_ar, parent_id, sort_order) VALUES (?,?,?,?)",
            [(c["category_id"], c["label_ar"], c["parent_id"], c["sort_order"]) for c in categories],
        )

        # --- auteurs : uniquement ceux qui sont référencés ------------------
        referenced: set[int] = set()
        for result in results:
            meta = metadata[result["book_id"]]
            for entry in meta.get("authors") or ():
                if entry.get("author_id") is not None:
                    referenced.add(int(entry["author_id"]))
            if meta.get("main_author_id") is not None:
                referenced.add(int(meta["main_author_id"]))

        author_rows = []
        for source_id in sorted(referenced):
            author = authors.get(source_id)
            if author is None:
                stats["missing_authors"] += 1
                continue
            author_rows.append(
                (
                    author_id(source_id),
                    author["full_name_ar"],
                    author["short_name_ar"],
                    author["death_year_hijri"],
                    author["bio_ar"],
                    None,
                )
            )
        con.executemany(
            """INSERT INTO authors (author_id, full_name_ar, short_name_ar,
                                    death_year_hijri, bio_ar, portrait_url)
               VALUES (?,?,?,?,?,?)""",
            author_rows,
        )
        stats["authors"] = len(author_rows)
        known_authors = {row[0] for row in author_rows}

        # --- œuvres, éditions, auteurs d'édition, releases, index -----------
        imported = {result["book_id"] for result in results}

        for result in results:
            book_id = result["book_id"]
            meta = metadata[book_id]
            betaka = meta.get("betaka_text")
            eid = edition_id(book_id)

            con.execute(
                "INSERT INTO works (work_id, title_ar, category_id) VALUES (?,?,?)",
                (work_id(book_id), meta["title_ar"], meta["category_id"]),
            )

            con.execute(
                """INSERT INTO editions (edition_id, work_id, source, source_book_id, shamela_id,
                                         title_ar, subtitle_ar, category_id, book_type,
                                         book_type_label, bibliography_text, publisher_ar,
                                         edition_label_ar, publication_year, printed, is_hidden,
                                         volume_count, has_multi_part, language, cover_url)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    eid,
                    work_id(book_id),
                    SOURCE_NAME,
                    book_id,
                    meta.get("shamela_id"),
                    meta["title_ar"],
                    subtitle(betaka, meta["title_ar"]),
                    meta["category_id"],
                    meta.get("book_type"),
                    meta.get("book_type_label"),
                    bibliography(betaka),
                    betaka_field(betaka, "الناشر"),
                    betaka_field(betaka, "الطبعة"),
                    gregorian_year(betaka),
                    1 if meta.get("printed") else 0,
                    1 if meta.get("is_hidden") else 0,
                    # volumes réellement écrits — `volume_count_observed` vaut 0
                    # pour les mono-volumes et afficherait « 0 tome »
                    result["volumes"],
                    1 if result["volumes"] > 1 else 0,
                    "ar",
                    None,
                ),
            )

            roles = []
            for position, entry in enumerate(meta.get("authors") or ()):
                source_id = entry.get("author_id")
                if source_id is None or author_id(int(source_id)) not in known_authors:
                    continue
                roles.append((eid, author_id(int(source_id)), entry.get("role") or "author", position))
            # L'app joint sur `role = 'author'` : sans une telle ligne, la fiche
            # livre n'affiche aucun auteur.
            if not any(r[2] == "author" for r in roles) and meta.get("main_author_id") is not None:
                candidate = author_id(int(meta["main_author_id"]))
                if candidate in known_authors:
                    roles.append((eid, candidate, "author", 0))
            con.executemany(
                "INSERT OR IGNORE INTO edition_authors (edition_id, author_id, role, position) "
                "VALUES (?,?,?,?)",
                roles,
            )

            con.execute(
                """INSERT INTO book_releases (release_id, edition_id, schema_version, content_version,
                                              source_version, object_key, compressed_size,
                                              uncompressed_size, sha256, page_count, toc_count,
                                              fts_version, min_app_version, published_at, is_active)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    release_id(book_id),
                    eid,
                    SCHEMA_VERSION,
                    CONTENT_VERSION,
                    result.get("snapshot_id"),
                    f"local://books/{eid}.sqlite",
                    result.get("compressed_bytes") or result["output_bytes"],
                    result["output_bytes"],
                    result["sha256"],
                    result["pages"],
                    result["toc"],
                    FTS_VERSION,
                    MIN_APP_VERSION,
                    result.get("published_at") or generated_at,
                    1,
                ),
            )

            names = [a["full_name_ar"] for a in
                     (authors.get(int(e["author_id"])) for e in (meta.get("authors") or ())
                      if e.get("author_id") is not None)
                     if a]
            con.execute(
                """INSERT INTO catalog_fts (edition_id, title_ar, title_normalized,
                                            author_names, bibliography_text)
                   VALUES (?,?,?,?,?)""",
                (
                    eid,
                    meta["title_ar"],
                    normalize_ar(meta["title_ar"]),
                    normalize_ar(" ".join(names)) if names else "",
                    normalize_ar((betaka or "").replace("\r", " ")),
                ),
            )
            stats["editions"] += 1

        # --- relations entre éditions ---------------------------------------
        relations: set[tuple[str, str, str]] = set()
        groups: dict[int, list[int]] = {}
        for book_id in imported:
            meta = metadata[book_id]
            parent = meta.get("parent_id")
            if parent is not None and int(parent) in imported and int(parent) != book_id:
                relations.add((edition_id(book_id), edition_id(int(parent)), "part_of"))
            group = meta.get("group_id")
            if group is not None:
                groups.setdefault(int(group), []).append(book_id)

        for members in groups.values():
            if len(members) < 2 or len(members) > MAX_GROUP_FANOUT:
                continue
            for a in members:
                for b in members:
                    if a != b:
                        relations.add((edition_id(a), edition_id(b), "same_group"))

        con.executemany("INSERT OR IGNORE INTO edition_relations VALUES (?,?,?)", sorted(relations))
        stats["relations"] = len(relations)

        con.commit()
        con.execute("INSERT INTO catalog_fts(catalog_fts) VALUES('optimize')")
        con.commit()
        con.execute("PRAGMA journal_mode = DELETE")
        con.execute("PRAGMA optimize")
        con.execute("VACUUM")
        integrity = con.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            raise RuntimeError(f"catalogue corrompu : {integrity}")
    finally:
        con.close()

    stats["bytes"] = os.path.getsize(path)
    return stats
