"""Traitement d'un livre, exécutable dans un processus séparé.

Windows utilise `spawn` : la fonction doit vivre au niveau du module et les
tâches doivent être picklables (d'où des dictionnaires simples).
"""

from __future__ import annotations

import os
import sys
import time
import traceback

from _common import sha256_file

from . import CONTENT_VERSION, FTS_VERSION, MIN_APP_VERSION, NORMALIZATION
from .bookdb import BookBuildError, build_book, finalize
from .validate import ValidationError, check_database, check_source


def _drop(path: str) -> None:
    for candidate in (path, path + "-wal", path + "-shm"):
        try:
            os.remove(candidate)
        except OSError:
            pass


def build_one(job: dict) -> dict:
    """Importe un livre. Ne lève jamais : renvoie toujours un compte rendu."""
    # Chaque processus enfant a sa propre console : sans ça, le premier titre
    # arabe journalisé lève UnicodeEncodeError sur Windows.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):  # pragma: no cover
        pass

    started = time.monotonic()
    out_path = job["out_path"]
    result = {
        "book_id": job["book_id"],
        "edition_id": job["edition_id"],
        "category_id": job["category_id"],
        "source_bytes": job.get("source_bytes", 0),
    }

    try:
        stats = build_book(
            job["book_dir"],
            out_path,
            edition_id=job["edition_id"],
            limit_pages=job.get("limit_pages", 0),
            extract_dir=job.get("extract_dir"),
            inline_images=job.get("inline_images", 0),
        )
        check_source(job["book_dir"], stats)
        finalize(out_path)
        check_database(out_path, stats)
    except (BookBuildError, ValidationError) as exc:
        _drop(out_path)
        result.update(status="skipped", stage=exc.stage, reason=str(exc))
        result["duration_s"] = round(time.monotonic() - started, 3)
        return result
    except Exception as exc:  # noqa: BLE001 - un livre ne doit pas tuer le run
        _drop(out_path)
        result.update(
            status="skipped",
            stage="unexpected",
            reason=f"{type(exc).__name__}: {exc}",
            traceback=traceback.format_exc(limit=4),
        )
        result["duration_s"] = round(time.monotonic() - started, 3)
        return result

    meta = stats["meta"]
    manifest = stats["manifest"]
    result.update(
        status="ok",
        title_ar=meta["title_ar"],
        pages=stats["pages"],
        toc=stats["toc"],
        volumes=stats["volumes"],
        assets=stats["assets"],
        truncated=stats["truncated"],
        warnings={k: v for k, v in stats["warnings"].items() if v},
        output_bytes=os.path.getsize(out_path),
        sha256=sha256_file(out_path),
        content_hash=stats["content_hash"],
        source_sha256=stats["pages_sha256"],
        snapshot_id=manifest.get("snapshot_id"),
        published_at=manifest.get("extracted_at"),
        duration_s=round(time.monotonic() - started, 3),
    )

    result["manifest"] = {
        "edition_id": job["edition_id"],
        "title_ar": meta["title_ar"],
        "source": "shamela4",
        "source_book_id": meta["book_id"],
        "schema_version": stats["manifest"].get("schema_version", 1),
        "content_version": CONTENT_VERSION,
        "fts_version": FTS_VERSION,
        "normalization": NORMALIZATION,
        "page_count": stats["pages"],
        "toc_count": stats["toc"],
        "content_hash": stats["content_hash"],
        "source_sha256": stats["pages_sha256"],
        "snapshot_id": manifest.get("snapshot_id"),
        "truncated": stats["truncated"],
        "sha256": result["sha256"],
        "size": result["output_bytes"],
        "min_app_version": MIN_APP_VERSION,
        "created_at": manifest.get("extracted_at"),
    }
    return result
