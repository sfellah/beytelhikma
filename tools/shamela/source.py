"""Lecture en flux des fichiers source d'un livre.

Les `pages.jsonl` vont jusqu'à 251 Mo et 124 569 lignes : on ne charge jamais un
fichier entier. La première passe ne retient que quelques entiers par page et
calcule au passage le SHA-256 attendu par `manifest.json`, ce qui rend le
contrôle d'intégrité gratuit.
"""

from __future__ import annotations

import hashlib
import io
import json
import os

try:  # optionnel, environ 2x plus rapide au parsing
    import orjson

    def _loads(raw: bytes):
        return orjson.loads(raw)
except ImportError:  # pragma: no cover - dépend de l'environnement
    def _loads(raw: bytes):
        return json.loads(raw)


PAGES = "pages.jsonl"
TOC = "toc.jsonl"
METADATA = "book_metadata.json"
MANIFEST = "manifest.json"


def read_json(path: str) -> dict:
    with io.open(path, encoding="utf-8") as fh:
        return json.load(fh)


def iter_jsonl(path: str):
    """Itère les enregistrements d'un `.jsonl`, ligne par ligne."""
    with open(path, "rb") as fh:
        for raw in fh:
            if raw.strip():
                yield _loads(raw)


def scan_pages(path: str) -> tuple[list[tuple], str, int]:
    """Première passe.

    Renvoie `(entêtes, sha256, nombre_de_lignes)` où chaque entête est le tuple
    `(page_id, part, page_num, shamela_page_id)` — cinq entiers par page suffisent
    à décider de l'ordre et du découpage en volumes.
    """
    hasher = hashlib.sha256()
    headers: list[tuple] = []
    lines = 0
    with open(path, "rb") as fh:
        for raw in fh:
            hasher.update(raw)  # avant strip : le hash porte sur tous les octets
            if not raw.strip():
                continue
            lines += 1
            record = _loads(raw)
            headers.append(
                (
                    record["page_id"],
                    record.get("part"),
                    record.get("page_num"),
                    record.get("shamela_page_id"),
                )
            )
    return headers, hasher.hexdigest(), lines


def sha256_file(path: str) -> str:
    hasher = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def manifest_entry(manifest: dict, filename: str) -> dict | None:
    for entry in manifest.get("files", ()):
        if entry.get("path") == filename:
            return entry
    return None


def book_paths(book_dir: str) -> dict[str, str]:
    return {
        "pages": os.path.join(book_dir, PAGES),
        "toc": os.path.join(book_dir, TOC),
        "metadata": os.path.join(book_dir, METADATA),
        "manifest": os.path.join(book_dir, MANIFEST),
    }
