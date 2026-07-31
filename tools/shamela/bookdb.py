"""Construction d'un fichier `books/<edition_id>.sqlite`.

Deux passes en flux sur `pages.jsonl` :

1. n'extraire que `(page_id, part, page_num, shamela_page_id)` et le SHA-256 —
   de quoi décider de l'ordre de lecture et du découpage en volumes ;
2. relire, transformer, écrire par lots.

Deux passes coûtent moins cher que garder les pages transformées en mémoire :
le plus gros livre du corpus fait 251 Mo pour 124 569 pages.
"""

from __future__ import annotations

import hashlib
import os
import sqlite3

from _common import BOOK_SCHEMA, SCHEMA_VERSION, normalize_ar, sha256_text

from . import CONTENT_VERSION
from .images import ImageCollector
from .source import book_paths, iter_jsonl, read_json, scan_pages
from .text import clean_footnotes, convert_body, to_plain, to_search

# Vidage des lots : 500 lignes OU 16 Mo de texte accumulé. Le second critère est
# obligatoire — sans lui, un livre à très longues pages ferait exploser la RSS.
BATCH_ROWS = 500
BATCH_BYTES = 16 * 1024 * 1024

BUILD_PRAGMAS = (
    "PRAGMA page_size = 4096",       # doit précéder le premier CREATE TABLE
    "PRAGMA journal_mode = OFF",     # fichier neuf et jetable
    "PRAGMA synchronous = OFF",
    "PRAGMA temp_store = MEMORY",
    "PRAGMA cache_size = -65536",
    "PRAGMA foreign_keys = ON",      # valide pages.volume_id et toc.page_id
)

PAGE_INSERT = """
INSERT INTO pages (page_id, shamela_page_id, volume_id, printed_page_num,
                   sequence_num, body_html, body_plain, body_search,
                   footnotes, hints, content_hash)
VALUES (?,?,?,?,?,?,?,?,?,?,?)
"""

# `rowid` explicite : une table FTS5 contentless ne restitue aucune colonne, pas
# même celles marquées UNINDEXED. Le rowid est le seul lien vers `pages`.
FTS_INSERT = """
INSERT INTO pages_fts (rowid, page_id, body_search, footnotes_search)
VALUES (?,?,?,?)
"""

TOC_INSERT = """
INSERT INTO toc (toc_id, parent_toc_id, page_id, title_text,
                 title_normalized, level, sequence_num, shamela_title_id)
VALUES (?,?,?,?,?,?,?,?)
"""


class BookBuildError(RuntimeError):
    """Erreur portant l'étape à laquelle le livre a échoué."""

    def __init__(self, stage: str, message: str):
        super().__init__(message)
        self.stage = stage


def plan_volumes(headers: list[tuple]) -> tuple[list[dict], dict[int, int], dict[int, int], int]:
    """Ordre de lecture, volumes, et rangs denses.

    L'ordre de lecture est `page_id` croissant : sur 150 livres testés,
    `sequence_num` comporte des doublons dans 25 d'entre eux et le tri
    `(part, sequence_num)` produit 2 417 inversions de pagination contre 276.

    Une fois trié par `page_id`, `part` forme des blocs contigus (150/150) :
    chaque changement ouvre un volume.
    """
    ordered = sorted(headers, key=lambda h: h[0])

    # `part_number` doit rester unique dans un livre, sinon l'interface affiche
    # deux « tome 1 ». Un livre mêlant « مقدمة » et « 1 » produirait exactement
    # cette collision si on repliait au cas par cas : on tranche donc pour tout
    # le livre. Numéros imprimés seulement s'ils le sont tous.
    raw_parts = {(part or "").strip() for _pid, part, _n, _s in ordered}
    use_printed = all(raw.isdigit() for raw in raw_parts if raw) and any(raw_parts - {""})

    volumes: list[dict] = []
    volume_of_page: dict[int, int] = {}
    sequence_of_page: dict[int, int] = {}
    non_numeric_parts = 0
    seen_parts: dict[str, int] = {}
    previous = object()

    for rank, (page_id, part, _page_num, _shamela) in enumerate(ordered, start=1):
        if part != previous:
            raw = (part or "").strip()
            if raw in seen_parts:
                # Une part qui réapparaît après une autre casserait la contiguïté.
                # Jamais observé sur 150 livres, mais on rattache plutôt que de
                # créer un volume en double.
                volume_id = seen_parts[raw]
            else:
                ordinal = len(volumes) + 1
                numeric = raw.isdigit()
                if raw and not numeric:
                    non_numeric_parts += 1
                volumes.append(
                    {
                        "volume_id": ordinal,
                        "sequence_num": ordinal,
                        # `part_number` est INTEGER NOT NULL. Numéro imprimé quand
                        # tout le livre est numéroté — il diffère souvent de la
                        # position (volumes numérotés 6 à 10, par exemple) —,
                        # sinon la position, pour garantir l'unicité.
                        "part_number": int(raw) if use_printed else ordinal,
                        # une part non numérique EST déjà un bon libellé (مقدمة) ;
                        # une part absente ne mérite aucun libellé
                        "label_ar": None if not raw else (f"الجزء {raw}" if numeric else raw),
                    }
                )
                volume_id = ordinal
                seen_parts[raw] = ordinal
            previous = part
        volume_of_page[page_id] = volume_id
        sequence_of_page[page_id] = rank

    return volumes, volume_of_page, sequence_of_page, non_numeric_parts


def plan_toc(entries: list[dict], page_ids: set[int]) -> list[dict]:
    """Profondeur et ordre d'affichage du sommaire.

    `shamela_title_id` donne l'ordre (vérifié sur 120 livres : un parent précède
    toujours ses enfants). La profondeur se calcule en remontant `parent_id`,
    avec garde anti-cycle — sinon un `parent_id` circulaire bouclerait à l'infini.
    """
    entries = sorted(entries, key=lambda t: t["shamela_title_id"])
    parent_of = {t["title_id"]: t["parent_id"] for t in entries}

    planned = []
    for rank, entry in enumerate(entries, start=1):
        if entry["page_id"] not in page_ids:
            raise BookBuildError("toc", f"entrée {entry['title_id']} pointe une page absente")

        parent = entry["parent_id"]
        if parent is not None and parent not in parent_of:
            parent = None  # parent absent : on remonte l'entrée à la racine

        level, seen, current = 1, {entry["title_id"]}, parent
        while current is not None:
            if current in seen:
                raise BookBuildError("toc", f"cycle sur title_id={entry['title_id']}")
            seen.add(current)
            level += 1
            current = parent_of.get(current)

        planned.append(
            {
                "toc_id": entry["title_id"],
                "parent_toc_id": parent,
                "page_id": entry["page_id"],
                "title_text": entry["title_text"],
                "level": level,
                "sequence_num": rank,
                "shamela_title_id": entry["shamela_title_id"],
            }
        )
    return planned


def build_book(
    book_dir: str,
    out_path: str,
    *,
    edition_id: str,
    limit_pages: int = 0,
    extract_dir: str | None = None,
    inline_images: int = 0,
) -> dict:
    """Écrit `out_path` et renvoie les statistiques du livre."""
    paths = book_paths(book_dir)
    for key, path in paths.items():
        if not os.path.exists(path):
            raise BookBuildError("source", f"fichier manquant : {key}")

    manifest = read_json(paths["manifest"])
    meta = read_json(paths["metadata"])

    # --- passe 1 : ordre, volumes, intégrité ------------------------------
    headers, pages_sha, page_lines = scan_pages(paths["pages"])
    if not headers:
        raise BookBuildError("source", "aucune page")

    volumes, volume_of_page, sequence_of_page, non_numeric = plan_volumes(headers)

    keep: set[int] | None = None
    if limit_pages:
        keep = {pid for pid, seq in sequence_of_page.items() if seq <= limit_pages}

    # --- sommaire ----------------------------------------------------------
    toc_entries = list(iter_jsonl(paths["toc"]))
    page_ids = set(volume_of_page)
    toc_rows = plan_toc(toc_entries, page_ids)
    if keep is not None:
        toc_rows = [t for t in toc_rows if t["page_id"] in keep]

    # --- écriture ----------------------------------------------------------
    if os.path.exists(out_path):
        os.remove(out_path)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)

    images = ImageCollector(extract_dir=extract_dir, inline_limit=inline_images)
    warnings = {"tables_flattened": 0, "links_unwrapped": 0, "images_stripped": 0,
                "non_numeric_parts": non_numeric}
    hasher = hashlib.sha256()
    written = 0

    con = sqlite3.connect(out_path)
    try:
        for pragma in BUILD_PRAGMAS:
            con.execute(pragma)
        con.executescript(BOOK_SCHEMA)
        con.execute("BEGIN")

        used_volumes = volumes
        if keep is not None:
            live = {volume_of_page[pid] for pid in keep}
            used_volumes = [v for v in volumes if v["volume_id"] in live]
        con.executemany(
            "INSERT INTO volumes (volume_id, part_number, label_ar, sequence_num) VALUES (?,?,?,?)",
            [(v["volume_id"], v["part_number"], v["label_ar"], v["sequence_num"]) for v in used_volumes],
        )

        # --- passe 2 : transformation en flux, par lots --------------------
        page_batch: list[tuple] = []
        fts_batch: list[tuple] = []
        batch_bytes = 0

        def flush() -> None:
            nonlocal batch_bytes
            if page_batch:
                con.executemany(PAGE_INSERT, page_batch)
                con.executemany(FTS_INSERT, fts_batch)
                page_batch.clear()
                fts_batch.clear()
                batch_bytes = 0

        # Les pages sont écrites dans l'ordre du fichier, pas dans l'ordre de
        # lecture : `INTEGER PRIMARY KEY` l'accepte et le VACUUM final réordonne.
        for record in iter_jsonl(paths["pages"]):
            page_id = record["page_id"]
            if keep is not None and page_id not in keep:
                continue

            html, stats = convert_body(record.get("body") or "", images)
            for key, value in stats.items():
                warnings[key] += value
            plain = to_plain(html)
            search = to_search(plain)
            notes = clean_footnotes(record.get("footnotes"))
            hasher.update(html.encode("utf-8"))

            page_batch.append(
                (
                    page_id,
                    record.get("shamela_page_id"),
                    volume_of_page[page_id],
                    record.get("page_num"),
                    sequence_of_page[page_id],
                    html,
                    plain,
                    search,
                    notes,
                    None,  # `hints` est nul sur les 7 611 186 pages du corpus
                    sha256_text(html),
                )
            )
            fts_batch.append((page_id, page_id, search, normalize_ar(notes) if notes else ""))
            written += 1
            batch_bytes += len(html) + len(plain) + len(search)
            if len(page_batch) >= BATCH_ROWS or batch_bytes >= BATCH_BYTES:
                flush()
        flush()

        if keep is not None:
            # Les rangs doivent rester denses après troncature.
            con.execute(
                "UPDATE pages SET sequence_num = (SELECT COUNT(*) FROM pages p2 "
                "WHERE p2.page_id <= pages.page_id)"
            )

        con.execute(
            """UPDATE volumes SET
                   first_page_id = (SELECT MIN(page_id) FROM pages WHERE volume_id = volumes.volume_id),
                   last_page_id  = (SELECT MAX(page_id) FROM pages WHERE volume_id = volumes.volume_id)"""
        )

        con.executemany(
            TOC_INSERT,
            [
                (t["toc_id"], t["parent_toc_id"], t["page_id"], t["title_text"],
                 normalize_ar(t["title_text"]), t["level"], t["sequence_num"],
                 t["shamela_title_id"])
                for t in toc_rows
            ],
        )

        con.executemany(
            "INSERT INTO assets (asset_id, file_path, mime_type, sha256, width, height) "
            "VALUES (?,?,?,?,?,?)",
            images.rows(),
        )

        content_hash = hasher.hexdigest()
        con.execute(
            """INSERT INTO book_info (edition_id, source_book_id, shamela_id, title_ar,
                                      schema_version, content_version, page_count, toc_count,
                                      created_at, content_hash)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (
                edition_id,
                meta["book_id"],
                meta.get("shamela_id"),
                meta["title_ar"],
                SCHEMA_VERSION,
                CONTENT_VERSION,
                written,
                len(toc_rows),
                # date de la source, pas `now()` : deux imports du même corpus
                # produisent alors des fichiers identiques
                manifest.get("extracted_at") or "1970-01-01T00:00:00Z",
                content_hash,
            ),
        )
        con.commit()
        con.execute("INSERT INTO pages_fts(pages_fts) VALUES('optimize')")
        con.commit()
    except sqlite3.Error as exc:
        con.close()
        raise BookBuildError("sqlite", str(exc)) from exc
    finally:
        try:
            con.close()
        except sqlite3.Error:
            pass

    return {
        "manifest": manifest,
        "meta": meta,
        "volumes": len(used_volumes),
        "pages": written,
        "toc": len(toc_rows),
        "assets": len(images.assets),
        "content_hash": content_hash,
        "pages_sha256": pages_sha,
        "pages_lines": page_lines,
        "truncated": keep is not None,
        "warnings": warnings,
    }


def finalize(path: str) -> None:
    """Prépare le fichier pour la distribution (DATA_MODEL_DESCISION §41)."""
    con = sqlite3.connect(path)
    try:
        con.execute("PRAGMA journal_mode = DELETE")
        con.execute("PRAGMA optimize")
        con.execute("VACUUM")
    finally:
        con.close()
