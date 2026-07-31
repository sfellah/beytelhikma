"""Ligne de commande et orchestration de l'import."""

from __future__ import annotations

import argparse
import datetime as _dt
import io
import json
import os
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed

from . import NORMALIZATION, PIPELINE_VERSION
from .catalogdb import build_catalog, edition_id
from .discovery import DEFAULT_MAX_BYTES, DEFAULT_MIN_BYTES, scan_corpus, select
from .meta import load_authors, load_categories
from .report import summarize, write as write_report
from .source import read_json
from .worker import build_one

DEFAULT_SRC = r"C:\shamela-data"
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEFAULT_OUT = os.path.join(REPO_ROOT, "dist", "shamela")


def _parse_ids(raw: str | None) -> set[int] | None:
    """Accepte `1,2,25-30`."""
    if not raw:
        return None
    out: set[int] = set()
    for chunk in raw.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        if "-" in chunk:
            low, high = chunk.split("-", 1)
            out.update(range(int(low), int(high) + 1))
        else:
            out.add(int(chunk))
    return out


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="import_shamela",
        description="Transforme le corpus Shamela 4 en bases SQLite pour Beyt El Hikma.",
    )
    p.add_argument("--src", default=DEFAULT_SRC, help="racine du corpus")
    p.add_argument("--out", default=DEFAULT_OUT, help="dossier de sortie")

    scope = p.add_mutually_exclusive_group()
    scope.add_argument("--books-per-category", type=int, default=3, metavar="N",
                       help="nombre de livres par catégorie (défaut : 3)")
    scope.add_argument("--all", action="store_true", help="tout le corpus (8 589 livres)")

    p.add_argument("--categories", help="restreindre à des catégories : 1,2,25-30")
    p.add_argument("--book-ids", help="livres explicites, court-circuite la sélection")
    p.add_argument("--select", choices=("stratified", "hash", "smallest", "largest"),
                   default="stratified")
    p.add_argument("--min-source-bytes", type=int, default=DEFAULT_MIN_BYTES)
    p.add_argument("--max-source-bytes", type=int, default=DEFAULT_MAX_BYTES)
    p.add_argument("--seed", default="beytelhikma-v1", help="graine de --select hash")

    p.add_argument("--limit-pages", type=int, default=0, metavar="N",
                   help="ne garder que les N premières pages (test de bout en bout rapide)")
    p.add_argument("--jobs", type=int, default=0, help="processus parallèles (0 = auto)")
    p.add_argument("--resume", action="store_true",
                   help="sauter les livres déjà produits et inchangés")
    p.add_argument("--strict", action="store_true",
                   help="arrêter au premier livre en échec au lieu de le sauter")
    p.add_argument("--extract-images", action="store_true",
                   help="écrire les images décodées dans <out>/assets/")
    p.add_argument("--inline-images", type=int, default=0, metavar="OCTETS",
                   help="conserver les data URI sous ce seuil au lieu de les extraire")
    p.add_argument("--compress", action="store_true", help="produire aussi des .sqlite.zst")
    p.add_argument("--catalog-version", type=int, default=1)
    p.add_argument("--report", help="chemin du rapport JSON (défaut : <out>/import-report.json)")
    p.add_argument("--dry-run", action="store_true", help="afficher la sélection et s'arrêter")
    return p


def _resolve_jobs(requested: int) -> int:
    if requested > 0:
        return requested
    return max(1, min(8, (os.cpu_count() or 2) - 2))


def _compress(path: str) -> int | None:
    try:
        import zstandard
    except ImportError:
        return None
    target = path + ".zst"
    compressor = zstandard.ZstdCompressor(level=10)
    with open(path, "rb") as src, open(target, "wb") as dst:
        compressor.copy_stream(src, dst)
    return os.path.getsize(target)


def _resume_skip(job: dict) -> dict | None:
    """Compte rendu déjà produit, si le manifest correspond toujours à la source.

    **Le manifest suffit, le `.sqlite` est facultatif.** Un livre déjà monté au
    bucket peut avoir vu son fichier effacé pour rendre la place : c'est ce qui
    permet d'importer par tranches sans jamais tenir tout le corpus sur le
    disque. Le manifest porte alors `object_key`, et le catalogue se reconstruit
    complet sans qu'aucun fichier ne soit là.

    Exiger le fichier faisait tomber le livre de `results`, donc du catalogue
    que `build_catalog` réécrit à chaque exécution : effacer une tranche publiée
    revenait à la dépublier au tour suivant.
    """
    manifest_path = os.path.splitext(job["out_path"])[0] + ".manifest.json"
    if not os.path.exists(manifest_path):
        return None
    try:
        manifest = read_json(manifest_path)
    except (OSError, ValueError):
        return None
    if manifest.get("normalization") != NORMALIZATION:
        return None

    # Sans taille au manifest ni fichier à mesurer, le catalogue ne saurait pas
    # annoncer le poids du livre : mieux vaut le réimporter que de mentir.
    size = manifest.get("size")
    if size is None:
        if not os.path.exists(job["out_path"]):
            return None
        size = os.path.getsize(job["out_path"])

    return {
        "book_id": job["book_id"],
        "edition_id": job["edition_id"],
        "category_id": job["category_id"],
        "status": "ok",
        "title_ar": manifest.get("title_ar"),
        "pages": manifest.get("page_count", 0),
        "toc": manifest.get("toc_count", 0),
        "volumes": manifest.get("volume_count", 1),
        "assets": manifest.get("asset_count", 0),
        "warnings": {},
        "truncated": manifest.get("truncated", False),
        "output_bytes": size,
        "sha256": manifest.get("sha256"),
        "content_hash": manifest.get("content_hash"),
        "source_sha256": manifest.get("source_sha256"),
        "snapshot_id": manifest.get("snapshot_id"),
        "published_at": manifest.get("created_at"),
        "source_bytes": job.get("source_bytes", 0),
        "duration_s": 0.0,
        "resumed": True,
        # Écrits au manifest par `publish_minio` une fois le livre monté : c'est
        # par eux que le catalogue retrouve la clé d'un fichier effacé.
        "object_key": manifest.get("object_key"),
        "compressed_bytes": manifest.get("compressed_size"),
        "manifest": manifest,
    }


def main(argv: list[str] | None = None) -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):  # pragma: no cover
        pass

    args = build_parser().parse_args(argv)
    started = time.monotonic()
    generated_at = _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    # --- contrôles bloquants (code 2 : rien n'est écrit) --------------------
    meta_dir = os.path.join(args.src, "_meta")
    if not os.path.isdir(args.src):
        print(f"erreur : corpus introuvable : {args.src}", file=sys.stderr)
        return 2
    if not os.path.isdir(meta_dir):
        print(f"erreur : dossier _meta introuvable : {meta_dir}", file=sys.stderr)
        return 2

    books_dir = os.path.join(args.out, "books")
    try:
        os.makedirs(books_dir, exist_ok=True)
    except OSError as exc:
        print(f"erreur : sortie non inscriptible : {exc}", file=sys.stderr)
        return 2

    try:
        categories = load_categories(meta_dir)
        authors = load_authors(meta_dir)
    except Exception as exc:  # noqa: BLE001
        print(f"erreur : lecture de _meta impossible : {exc}", file=sys.stderr)
        return 2

    # --- sélection ----------------------------------------------------------
    corpus = scan_corpus(args.src)
    explicit = _parse_ids(args.book_ids)
    wanted_categories = _parse_ids(args.categories)

    if wanted_categories:
        corpus = [b for b in corpus if b.category_id in wanted_categories]

    if explicit:
        chosen = [b for b in corpus if b.book_id in explicit]
        missing = explicit - {b.book_id for b in chosen}
        if missing:
            print(f"attention : livres introuvables : {sorted(missing)}", file=sys.stderr)
    else:
        chosen = select(
            corpus,
            None if args.all else args.books_per_category,
            strategy=args.select,
            min_bytes=args.min_source_bytes,
            max_bytes=args.max_source_bytes,
            seed=args.seed,
        )

    if not chosen:
        print("erreur : aucun livre sélectionné", file=sys.stderr)
        return 2

    total_source = sum(b.size for b in chosen)
    print(f"corpus : {len(corpus)} livres | sélection : {len(chosen)} "
          f"({total_source / 1024 / 1024:.1f} Mo de source)")

    if args.dry_run:
        by_category: dict[int, list] = {}
        for book in chosen:
            by_category.setdefault(book.category_id, []).append(book)
        for category_id in sorted(by_category):
            picks = by_category[category_id]
            sizes = ", ".join(f"{b.book_id} ({b.size // 1024} ko)" for b in picks)
            print(f"  cat {category_id:>2} : {sizes}")
        return 0

    # --- tâches, les plus lourdes en premier --------------------------------
    extract_dir = os.path.join(args.out, "assets") if args.extract_images else None
    jobs = [
        {
            "book_id": b.book_id,
            "category_id": b.category_id,
            "edition_id": edition_id(b.book_id),
            "book_dir": b.path,
            "out_path": os.path.join(books_dir, f"{edition_id(b.book_id)}.sqlite"),
            "source_bytes": b.size,
            "limit_pages": args.limit_pages,
            "extract_dir": extract_dir,
            "inline_images": args.inline_images,
        }
        for b in sorted(chosen, key=lambda b: -b.size)
    ]

    results: list[dict] = []
    pending = jobs
    if args.resume:
        pending = []
        for job in jobs:
            cached = _resume_skip(job)
            if cached is None:
                pending.append(job)
            else:
                results.append(cached)
        if results:
            print(f"reprise : {len(results)} livre(s) déjà produits")

    workers = _resolve_jobs(args.jobs)
    done = 0

    def announce(result: dict) -> None:
        nonlocal done
        done += 1
        if result["status"] == "ok":
            flag = " (tronqué)" if result.get("truncated") else ""
            print(f"[{done}/{len(pending)}] ok      {result['edition_id']:<12} "
                  f"{result['pages']:>6} p  {result['duration_s']:>6.2f}s{flag}")
        else:
            print(f"[{done}/{len(pending)}] SAUTÉ   {result['edition_id']:<12} "
                  f"{result['stage']} : {result['reason']}")

    if workers == 1 or len(pending) == 1:
        for job in pending:
            result = build_one(job)
            announce(result)
            results.append(result)
            if args.strict and result["status"] != "ok":
                print("arrêt demandé par --strict", file=sys.stderr)
                return 1
    else:
        with ProcessPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(build_one, job): job for job in pending}
            for future in as_completed(futures):
                result = future.result()
                announce(result)
                results.append(result)
                if args.strict and result["status"] != "ok":
                    for other in futures:
                        other.cancel()
                    print("arrêt demandé par --strict", file=sys.stderr)
                    return 1

    results.sort(key=lambda r: r["book_id"])
    imported = [r for r in results if r["status"] == "ok"]

    # --- compression puis manifests ----------------------------------------
    for result in imported:
        path = os.path.join(books_dir, f"{result['edition_id']}.sqlite")
        if args.compress and not result.get("resumed"):
            size = _compress(path)
            if size is None:
                print("attention : zstandard absent, --compress ignoré", file=sys.stderr)
                args.compress = False
            else:
                result["compressed_bytes"] = size
                result["manifest"]["compressed_size"] = size
        manifest = result.get("manifest")
        if manifest and not result.get("resumed"):
            manifest["volume_count"] = result["volumes"]
            manifest["asset_count"] = result["assets"]
            with io.open(os.path.splitext(path)[0] + ".manifest.json", "w", encoding="utf-8") as fh:
                json.dump(manifest, fh, ensure_ascii=False, indent=2)

    # --- catalogue ----------------------------------------------------------
    catalog_stats = {}
    if imported:
        metadata = {
            r["book_id"]: read_json(os.path.join(
                next(j["book_dir"] for j in jobs if j["book_id"] == r["book_id"]),
                "book_metadata.json"))
            for r in imported
        }
        catalog_stats = build_catalog(
            os.path.join(args.out, "catalog.sqlite"),
            results=imported,
            metadata=metadata,
            categories=categories,
            authors=authors,
            catalog_version=args.catalog_version,
            generated_at=generated_at,
        )
        print(f"catalogue : {catalog_stats['editions']} éditions, "
              f"{catalog_stats['authors']} auteurs, {catalog_stats['relations']} relations "
              f"({catalog_stats['bytes'] / 1024 / 1024:.1f} Mo)")

    # --- rapport ------------------------------------------------------------
    payload = {
        "pipeline_version": PIPELINE_VERSION,
        "normalization": NORMALIZATION,
        "started_at": generated_at,
        "duration_s": round(time.monotonic() - started, 2),
        "args": {k: v for k, v in vars(args).items()},
        "source": {"root": args.src,
                   "snapshot_id": next((r.get("snapshot_id") for r in imported), None)},
        "totals": {**summarize(results), "categories": len(categories), **({"catalog": catalog_stats} if catalog_stats else {})},
        "books": [{k: v for k, v in r.items() if k != "manifest"} for r in results],
    }
    report_path = args.report or os.path.join(args.out, "import-report.json")
    json_path, csv_path = write_report(report_path, payload)

    totals = payload["totals"]
    print(f"\n{totals['imported']}/{totals['selected']} livres, {totals['pages']:,} pages, "
          f"{totals['output_bytes'] / 1024 / 1024:.1f} Mo en {payload['duration_s']}s")
    if totals["warnings"]:
        print("avertissements :", ", ".join(f"{k}={v}" for k, v in sorted(totals["warnings"].items())))
    print(f"rapport : {json_path}\n          {csv_path}")

    return 1 if totals["skipped"] else 0
