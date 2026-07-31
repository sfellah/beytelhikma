"""Publie les livres importés vers un bucket MinIO compatible S3.

Entrée : la sortie de `import_shamela.py --compress` (`dist/shamela/`).
Sortie : les objets `books/<edition_id>/<content_version>/book.sqlite.zst` et
leur manifest, puis `download_url` réécrit dans `dist/shamela/catalog.sqlite`.

Les chemins sont immutables : une nouvelle `content_version` crée un nouvel
objet, jamais un écrasement.

Identifiants lus dans MINIO_ACCESS_KEY / MINIO_SECRET_KEY. Jamais dans le dépôt.
"""

import argparse
import json
import os
import sqlite3
import sys

READ_ONLY_POLICY = {
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Principal": {"AWS": ["*"]},
            "Action": ["s3:GetObject"],
            "Resource": [],  # complété par set_anonymous_policy
        }
    ],
}


def object_key(edition_id: str, content_version: int) -> str:
    return f"books/{edition_id}/{content_version}/book.sqlite.zst"


def manifest_key(edition_id: str, content_version: int) -> str:
    return f"books/{edition_id}/{content_version}/manifest.json"


def _upload(client, bucket, key, body, content_type, metadata, force, dry_run, report):
    """Envoie [body] sous [key], sauf si un objet de même taille est déjà là."""
    if not force:
        try:
            head = client.head_object(Bucket=bucket, Key=key)
            if head.get("ContentLength") == len(body):
                report["skipped"] += 1
                return
        except Exception:
            pass  # absent ou illisible : on envoie
    if dry_run:
        return
    client.put_object(
        Bucket=bucket,
        Key=key,
        Body=body,
        ContentType=content_type,
        Metadata=metadata,
    )
    report["uploaded"] += 1


def publish(client, *, src, bucket, public_base, force=False, dry_run=False):
    """Monte les livres puis réécrit `download_url`. Renvoie un compte rendu."""
    report = {"uploaded": 0, "skipped": 0, "updated": 0, "missing": []}
    catalog_path = os.path.join(src, "catalog.sqlite")
    if not os.path.exists(catalog_path):
        raise SystemExit(f"catalogue introuvable : {catalog_path}")

    con = sqlite3.connect(catalog_path)
    releases = con.execute(
        "SELECT release_id, edition_id, content_version FROM book_releases WHERE is_active = 1"
    ).fetchall()

    updates = []
    for release_id, edition_id, content_version in releases:
        packed = os.path.join(src, "books", f"{edition_id}.sqlite.zst")
        manifest_path = os.path.join(src, "books", f"{edition_id}.manifest.json")
        if not os.path.exists(packed):
            report["missing"].append(edition_id)
            continue

        with open(packed, "rb") as fh:
            body = fh.read()
        manifest = {}
        if os.path.exists(manifest_path):
            with open(manifest_path, encoding="utf-8") as fh:
                manifest = json.load(fh)

        key = object_key(edition_id, content_version)
        _upload(
            client,
            bucket,
            key,
            body,
            "application/zstd",
            {
                "sha256": str(manifest.get("sha256", "")),
                "uncompressed-size": str(manifest.get("size", 0)),
            },
            force,
            dry_run,
            report,
        )
        _upload(
            client,
            bucket,
            manifest_key(edition_id, content_version),
            json.dumps(manifest, ensure_ascii=False).encode("utf-8"),
            "application/json",
            {},
            force,
            dry_run,
            report,
        )
        updates.append((f"{public_base.rstrip('/')}/{key}", len(body), release_id))

    if not dry_run and updates:
        con.executemany(
            "UPDATE book_releases SET download_url = ?, compressed_size = ? WHERE release_id = ?",
            updates,
        )
        con.commit()
        report["updated"] = len(updates)
    con.close()

    if report["missing"]:
        print(
            f"attention : {len(report['missing'])} livre(s) sans .sqlite.zst — "
            "relancer import_shamela.py --compress",
            file=sys.stderr,
        )
    return report


def set_anonymous_policy(client, bucket):
    """Rend `books/*` lisible sans authentification. À lancer une seule fois."""
    policy = json.loads(json.dumps(READ_ONLY_POLICY))
    policy["Statement"][0]["Resource"] = [f"arn:aws:s3:::{bucket}/books/*"]
    client.put_bucket_policy(Bucket=bucket, Policy=json.dumps(policy))


def build_parser():
    parser = argparse.ArgumentParser(description="Publie dist/shamela vers MinIO")
    parser.add_argument("--src", default="dist/shamela")
    parser.add_argument("--endpoint", default="http://127.0.0.1:9000")
    parser.add_argument("--bucket", default="beytelhikma")
    parser.add_argument(
        "--public-base",
        default=None,
        help="préfixe des URL publiques ; par défaut <endpoint>/<bucket>",
    )
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--set-anonymous-policy", action="store_true")
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        import boto3
    except ImportError:
        print("erreur : boto3 est requis (pip install boto3)", file=sys.stderr)
        return 2

    access = os.environ.get("MINIO_ACCESS_KEY")
    secret = os.environ.get("MINIO_SECRET_KEY")
    if not access or not secret:
        print("erreur : définir MINIO_ACCESS_KEY et MINIO_SECRET_KEY", file=sys.stderr)
        return 2

    client = boto3.client(
        "s3",
        endpoint_url=args.endpoint,
        aws_access_key_id=access,
        aws_secret_access_key=secret,
        region_name="us-east-1",
    )

    if args.set_anonymous_policy:
        set_anonymous_policy(client, args.bucket)
        print(f"policy de lecture publique posée sur {args.bucket}/books/*")

    public_base = args.public_base or f"{args.endpoint.rstrip('/')}/{args.bucket}"
    report = publish(
        client,
        src=args.src,
        bucket=args.bucket,
        public_base=public_base,
        force=args.force,
        dry_run=args.dry_run,
    )
    print(
        f"envoyés : {report['uploaded']} • ignorés : {report['skipped']} • "
        f"catalogue mis à jour : {report['updated']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
