# -*- coding: utf-8 -*-
"""Fabrique de livres source factices.

Écrits à la main pour que les tests n'aient besoin d'aucun accès à
`C:\\shamela-data`.
"""

import hashlib
import io
import json
import os


def _write_jsonl(path: str, records: list[dict]) -> tuple[str, int, int]:
    payload = "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in records)
    raw = payload.encode("utf-8")
    with open(path, "wb") as fh:
        fh.write(raw)
    return hashlib.sha256(raw).hexdigest(), len(raw), len(records)


def make_book(
    root: str,
    book_id: int,
    *,
    category_id: int = 1,
    parts: list[str | None] | None = None,
    title: str = "كتاب التجربة",
) -> str:
    """Crée `<root>/<cat>__c/<book_id>__b/` et renvoie le dossier du livre.

    `parts` donne une valeur de `part` par page ; `None` produit un livre
    mono-volume.
    """
    parts = parts if parts is not None else ["1", "1", "2"]
    book_dir = os.path.join(root, f"{category_id:02d}__categorie", f"{book_id}__livre")
    os.makedirs(book_dir, exist_ok=True)

    pages = []
    # `page_id` volontairement non contigus et écrits dans le désordre :
    # le corpus réel n'est ni trié ni dense.
    base = 900_000
    for index, part in enumerate(parts):
        pages.append(
            {
                "page_id": base + index * 3,
                "book_id": book_id,
                "shamela_page_id": index + 1,
                "part": part,
                "page_num": 100 + index,
                # `sequence_num` source volontairement dupliqué : inutilisable.
                "sequence_num": 1,
                "body": (
                    f"<span data-type='title' id=toc-{index + 1}>عنوان {index + 1}</span>"
                    f"\rنص الصفحة {index + 1}"
                ),
                "footnotes": ("١ - حاشية أولى\r٢ - حاشية ثانية" if index == 0 else None),
                "hints": None,
                "services_raw": None,
            }
        )
    pages.reverse()  # ordre fichier != ordre de lecture

    toc = [
        {"title_id": 500, "book_id": book_id, "page_id": base,
         "parent_id": None, "shamela_title_id": 1, "title_text": "الباب الأول"},
        {"title_id": 501, "book_id": book_id, "page_id": base + 3,
         "parent_id": 500, "shamela_title_id": 2, "title_text": "فصل"},
    ]

    pages_sha, pages_bytes, pages_rows = _write_jsonl(
        os.path.join(book_dir, "pages.jsonl"), pages)
    toc_sha, toc_bytes, toc_rows = _write_jsonl(
        os.path.join(book_dir, "toc.jsonl"), toc)

    metadata = {
        "book_id": book_id,
        "shamela_id": book_id + 1000,
        "title_ar": title,
        "book_type": 1,
        "book_type_label": "كتاب",
        "category_id": category_id,
        "category_name_ar": "العقيدة",
        "main_author_id": 7,
        "main_author_name_ar": "مؤلف التجربة",
        "main_author_death_hijri": 99999,  # sentinelle « inconnu »
        "authors": [{"author_id": 7, "role": "author",
                     "name_ar": "مؤلف التجربة", "death_hijri": 99999}],
        "printed": True,
        "is_hidden": False,
        "parent_id": None,
        "group_id": None,
        "volume_count_observed": 0,
        "has_multi_part": len({p for p in parts if p}) > 1,
        "betaka_text": (
            f"الكتاب: {title} وشرحه\rالمؤلف: مؤلف التجربة\r"
            "الناشر: دار التجربة\rالطبعة: الأولى، ١٤٣٩ هـ - ٢٠١٨ م\r"
            "عدد الصفحات: ٣"
        ),
        "meta": None,
    }
    with io.open(os.path.join(book_dir, "book_metadata.json"), "w", encoding="utf-8") as fh:
        json.dump(metadata, fh, ensure_ascii=False)
    meta_sha = hashlib.sha256(
        io.open(os.path.join(book_dir, "book_metadata.json"), "rb").read()).hexdigest()

    manifest = {
        "book_id": book_id,
        "shamela_id": metadata["shamela_id"],
        "title_ar": title,
        "page_count": pages_rows,
        "toc_count": toc_rows,
        "files": [
            {"path": "pages.jsonl", "sha256": pages_sha, "bytes": pages_bytes, "rows": pages_rows},
            {"path": "toc.jsonl", "sha256": toc_sha, "bytes": toc_bytes, "rows": toc_rows},
            {"path": "book_metadata.json", "sha256": meta_sha, "bytes": 0, "rows": 1},
        ],
        "extracted_at": "2026-04-26T20:41:36.113769Z",
        "extractor_version": "0.3.0",
        "snapshot_id": "fixture",
        "rejects": [],
    }
    # `bytes` de book_metadata.json : renseigné après coup pour rester exact
    manifest["files"][2]["bytes"] = os.path.getsize(
        os.path.join(book_dir, "book_metadata.json"))
    with io.open(os.path.join(book_dir, "manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False)

    return book_dir


def make_meta(root: str) -> str:
    """`_meta/` minimal, en Parquet (polars requis, comme en production)."""
    import polars as pl

    meta_dir = os.path.join(root, "_meta")
    os.makedirs(meta_dir, exist_ok=True)
    pl.DataFrame(
        {"id": [1, 42], "name_ar": ["العقيدة", "#"], "sort_order": [1, 0]}
    ).write_parquet(os.path.join(meta_dir, "categories.parquet"))
    pl.DataFrame(
        {
            "id": [7],
            "shamela_id": [7],
            "name_ar": ["مؤلف التجربة"],
            "death_hijri": [99999],
            "biography": ["ترجمة\rمختصرة"],
        }
    ).write_parquet(os.path.join(meta_dir, "authors.parquet"))
    return meta_dir
