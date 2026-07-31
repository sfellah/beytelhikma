"""Parcours du corpus et sélection des livres à importer.

Le corpus contient 68 749 fichiers, dont 34 376 fichiers fantômes `.metadata`
sous `.cache/huggingface/` qui recopient l'arborescence. La règle « ignorer toute
entrée dont le nom commence par `.` ou `_` » les exclut, exclut aussi `_meta/`,
et ne descend jamais dedans. Un parcours à chaud coûte alors 0,4 s.
"""

from __future__ import annotations

import hashlib
import os

# Bande de tailles pour la sélection stratifiée : au-dessous ce sont des
# fragments, au-dessus des livres dont l'import domine le temps total.
DEFAULT_MIN_BYTES = 20 * 1024
DEFAULT_MAX_BYTES = 8 * 1024 * 1024


class Book:
    __slots__ = ("book_id", "category_id", "category_dir", "path", "size")

    def __init__(self, book_id: int, category_id: int, category_dir: str, path: str, size: int):
        self.book_id = book_id
        self.category_id = category_id
        self.category_dir = category_dir
        self.path = path
        self.size = size

    def __repr__(self) -> str:  # pragma: no cover - confort de débogage
        return f"<Book {self.book_id} cat={self.category_id} {self.size / 1024:.0f}ko>"


def _leading_int(name: str) -> int | None:
    head = name.split("__", 1)[0]
    return int(head) if head.isdigit() else None


def scan_corpus(src: str) -> list[Book]:
    """Index de tous les livres : `(book_id, category_id, chemin, taille)`."""
    books: list[Book] = []
    for category in os.scandir(src):
        if not category.is_dir() or category.name[0] in "._":
            continue
        category_id = _leading_int(category.name)
        if category_id is None:
            continue
        for entry in os.scandir(category.path):
            if not entry.is_dir() or entry.name[0] in "._":
                continue
            book_id = _leading_int(entry.name)
            if book_id is None:
                continue
            pages = os.path.join(entry.path, "pages.jsonl")
            try:
                size = os.path.getsize(pages)
            except OSError:
                continue  # livre incomplet : ignoré ici, signalé à la validation
            books.append(Book(book_id, category_id, category.name, entry.path, size))
    books.sort(key=lambda b: (b.category_id, b.size, b.book_id))
    return books


def select(
    books: list[Book],
    per_category: int | None,
    strategy: str = "stratified",
    min_bytes: int = DEFAULT_MIN_BYTES,
    max_bytes: int = DEFAULT_MAX_BYTES,
    seed: str = "beytelhikma-v1",
) -> list[Book]:
    """Sous-ensemble reproductible du corpus.

    `per_category = None` renvoie tout. Sinon, par catégorie :

    - `stratified` (défaut) : on borne les tailles puis on prend les rangs aux
      quantiles `(i + 0,5) / N`. Pour N=3 : p17, p50, p83 — un petit, un médian,
      un gros plafonné. Maximise la couverture des cas limites plutôt que de
      ramener trois livres quasi identiques.
    - `hash` : ordre pseudo-aléatoire déterministe pour un `seed` donné.
    - `smallest` / `largest` : les N extrêmes, pour les tests de charge.

    Le tirage ne dépend que de `(catégorie, taille, book_id)` : deux exécutions
    sur le même corpus donnent exactement la même liste.
    """
    if per_category is None:
        return list(books)

    by_category: dict[int, list[Book]] = {}
    for book in books:
        by_category.setdefault(book.category_id, []).append(book)

    chosen: list[Book] = []
    for category_id in sorted(by_category):
        pool = by_category[category_id]
        banded = [b for b in pool if min_bytes <= b.size <= max_bytes] or pool

        if strategy == "smallest":
            picks = banded[:per_category]
        elif strategy == "largest":
            picks = banded[-per_category:]
        elif strategy == "hash":
            ordered = sorted(
                banded,
                key=lambda b: hashlib.sha256(f"{seed}:{b.book_id}".encode()).hexdigest(),
            )
            picks = ordered[:per_category]
        else:  # stratified
            n = min(per_category, len(banded))
            picks = [banded[min(len(banded) - 1, int((i + 0.5) / n * len(banded)))] for i in range(n)]
            # int() peut produire deux fois le même rang sur un petit pool
            picks = list(dict.fromkeys(picks))
            for candidate in banded:
                if len(picks) >= n:
                    break
                if candidate not in picks:
                    picks.append(candidate)

        chosen.extend(sorted(picks, key=lambda b: b.book_id))
    return chosen
