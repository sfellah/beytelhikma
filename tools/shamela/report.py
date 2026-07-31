"""Compte rendu d'exécution : un JSON complet et un CSV triable.

Après un import de 8 589 livres, la question posée est toujours « lesquels ont
échoué et pourquoi » — d'où une ligne par livre, et un CSV ouvrable dans un tableur.
"""

from __future__ import annotations

import csv
import io
import json
import os

CSV_COLUMNS = [
    "book_id", "edition_id", "category_id", "status", "stage", "reason",
    "title_ar", "pages", "toc", "volumes", "assets",
    "source_bytes", "output_bytes", "duration_s",
]


def write(path: str, payload: dict) -> tuple[str, str]:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with io.open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)

    csv_path = os.path.splitext(path)[0] + ".csv"
    with io.open(csv_path, "w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=CSV_COLUMNS, extrasaction="ignore")
        writer.writeheader()
        for book in payload["books"]:
            writer.writerow({column: book.get(column, "") for column in CSV_COLUMNS})
    return path, csv_path


def summarize(results: list[dict]) -> dict:
    ok = [r for r in results if r["status"] == "ok"]
    skipped = [r for r in results if r["status"] != "ok"]

    warnings: dict[str, int] = {}
    for result in ok:
        for key, value in (result.get("warnings") or {}).items():
            warnings[key] = warnings.get(key, 0) + value

    return {
        "selected": len(results),
        "imported": len(ok),
        "skipped": len(skipped),
        "pages": sum(r["pages"] for r in ok),
        "toc_entries": sum(r["toc"] for r in ok),
        "volumes": sum(r["volumes"] for r in ok),
        "assets": sum(r["assets"] for r in ok),
        "source_bytes": sum(r.get("source_bytes", 0) for r in results),
        "output_bytes": sum(r["output_bytes"] for r in ok),
        "warnings": warnings,
    }
