"""Contrôles par livre (docs/decisions-modele-donnees.md §40).

Sur 8 589 livres, un livre malformé ne doit jamais coûter les 8 588 autres :
l'appelant journalise l'échec, supprime le fichier partiel et continue. Un livre
recalé est aussi retiré du catalogue, pour que celui-ci n'annonce jamais un
fichier absent.
"""

from __future__ import annotations

import os
import sqlite3

from .source import manifest_entry


class ValidationError(RuntimeError):
    def __init__(self, message: str):
        super().__init__(message)
        self.stage = "validate"


def check_source(book_dir: str, stats: dict) -> None:
    """Intégrité de la source, avant de faire confiance à ce qu'on vient d'écrire.

    Le SHA-256 de `pages.jsonl` a été calculé pendant la première passe : le
    comparer ne coûte rien de plus.
    """
    manifest = stats["manifest"]

    entry = manifest_entry(manifest, "pages.jsonl")
    if entry:
        if entry.get("sha256") and entry["sha256"] != stats["pages_sha256"]:
            raise ValidationError("sha256 de pages.jsonl différent du manifest")
        if entry.get("rows") is not None and entry["rows"] != stats["pages_lines"]:
            raise ValidationError(
                f"pages.jsonl : {stats['pages_lines']} lignes, manifest en annonce {entry['rows']}"
            )
        expected_bytes = entry.get("bytes")
        actual_bytes = os.path.getsize(os.path.join(book_dir, "pages.jsonl"))
        if expected_bytes is not None and expected_bytes != actual_bytes:
            raise ValidationError(f"pages.jsonl : {actual_bytes} octets, manifest {expected_bytes}")

    if not stats["truncated"]:
        if manifest.get("page_count") not in (None, stats["pages"]):
            raise ValidationError(
                f"{stats['pages']} pages importées, manifest en annonce {manifest['page_count']}"
            )
        if manifest.get("toc_count") not in (None, stats["toc"]):
            raise ValidationError(
                f"{stats['toc']} entrées de sommaire, manifest en annonce {manifest['toc_count']}"
            )

    meta = stats["meta"]
    if not meta.get("title_ar"):
        raise ValidationError("titre absent")
    if meta.get("category_id") is None:
        raise ValidationError("catégorie absente")


def _searchable_token(con: sqlite3.Connection) -> str | None:
    """Un mot que le tokenizer `unicode61` indexe réellement.

    Renvoie `None` si les premières pages ne contiennent que des symboles — ce
    n'est pas une anomalie, seulement un livre sur lequel le test ne dit rien.
    """
    rows = con.execute(
        "SELECT body_search FROM pages ORDER BY sequence_num LIMIT 5"
    ).fetchall()
    for (body,) in rows:
        for token in (body or "").split():
            if len(token) >= 2 and any(ch.isalnum() for ch in token):
                return token
    return None


def check_database(path: str, stats: dict) -> None:
    """Contrôles sur le fichier produit, une fois fermé et compacté."""
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        n_pages = con.execute("SELECT COUNT(*) FROM pages").fetchone()[0]
        if n_pages != stats["pages"]:
            raise ValidationError(f"{n_pages} pages en base, {stats['pages']} annoncées")

        n_toc = con.execute("SELECT COUNT(*) FROM toc").fetchone()[0]
        if n_toc != stats["toc"]:
            raise ValidationError(f"{n_toc} entrées de sommaire, {stats['toc']} annoncées")

        n_fts = con.execute("SELECT COUNT(*) FROM pages_fts").fetchone()[0]
        if n_fts != n_pages:
            raise ValidationError(f"index FTS désynchronisé : {n_fts} lignes pour {n_pages} pages")

        seq_min, seq_max, seq_distinct = con.execute(
            "SELECT MIN(sequence_num), MAX(sequence_num), COUNT(DISTINCT sequence_num) FROM pages"
        ).fetchone()
        if (seq_min, seq_max, seq_distinct) != (1, n_pages, n_pages):
            raise ValidationError(
                f"sequence_num non dense : min={seq_min} max={seq_max} distincts={seq_distinct}"
            )

        if con.execute("SELECT COUNT(*) FROM pages WHERE volume_id IS NULL").fetchone()[0]:
            raise ValidationError("des pages n'ont pas de volume")

        empty = con.execute(
            "SELECT COUNT(*) FROM volumes v WHERE NOT EXISTS "
            "(SELECT 1 FROM pages p WHERE p.volume_id = v.volume_id)"
        ).fetchone()[0]
        if empty:
            raise ValidationError(f"{empty} volume(s) sans page")

        if con.execute("PRAGMA foreign_key_check").fetchall():
            raise ValidationError("violation de clé étrangère")

        if con.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValidationError("integrity_check a échoué")

        # Fumigation FTS : le rowid doit ramener une page réelle.
        #
        # Le terme d'essai doit être indexable par `unicode61`, qui écarte les
        # symboles. Beaucoup de livres commencent par la basmala ligaturée `﷽`
        # (U+FDFD) : un seul codepoint, catégorie Unicode « symbole », donc
        # absent de l'index à juste titre. Chercher un mot alphanumérique.
        token = _searchable_token(con)
        if token:
            hit = con.execute(
                "SELECT rowid FROM pages_fts WHERE pages_fts MATCH ? LIMIT 1", (f'"{token}"',)
            ).fetchone()
            if hit is None:
                raise ValidationError(f"l'index FTS ne retrouve pas le terme « {token} »")
            if not con.execute("SELECT 1 FROM pages WHERE page_id = ?", (hit[0],)).fetchone():
                raise ValidationError("le rowid FTS ne correspond à aucune page")
    finally:
        con.close()

    for suffix in ("-wal", "-shm"):
        if os.path.exists(path + suffix):
            raise ValidationError(f"fichier {suffix} résiduel")
