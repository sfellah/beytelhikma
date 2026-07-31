"""Publie les livres importés vers un bucket S3 — MinIO ou AWS.

Entrée : la sortie de `import_shamela.py --compress` (`dist/shamela/`).
Sortie : les objets `books/<edition_id>/<content_version>/book.sqlite.zst` et
leur manifest, puis `object_key` réécrit dans `dist/shamela/catalog.sqlite`.

Le catalogue publié ne porte **aucun hôte** : seulement des clés relatives. Le
client les colle derrière l'URL de base qu'il a en réglage, ce qui rend le même
catalogue servable depuis AWS, un MinIO local ou un CDN sans le republier.

Les chemins sont immutables : une nouvelle `content_version` crée un nouvel
objet, jamais un écrasement. C'est ce qui autorise `Cache-Control: immutable`.

Identifiants lus dans MINIO_ACCESS_KEY / MINIO_SECRET_KEY, à défaut dans les
AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY usuels. Jamais dans le dépôt.
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

# Les objets sont immutables par construction (la version est dans le chemin) :
# un client peut donc les garder un an sans jamais revalider.
CACHE_CONTROL = "public, max-age=31536000, immutable"

# Le téléchargeur reprend par en-tête `Range` ; un navigateur ne verra les
# en-têtes de reprise que s'ils sont explicitement exposés.
CORS_RULES = [
    {
        "AllowedMethods": ["GET", "HEAD"],
        "AllowedOrigins": ["*"],
        "AllowedHeaders": ["Range", "If-Match", "If-None-Match"],
        "ExposeHeaders": [
            "Content-Range",
            "Content-Length",
            "Accept-Ranges",
            "ETag",
            "x-amz-meta-sha256",
            "x-amz-meta-uncompressed-size",
        ],
        "MaxAgeSeconds": 86400,
    }
]


def object_key(edition_id: str, content_version: int) -> str:
    return f"books/{edition_id}/{content_version}/book.sqlite.zst"


def ensure_bucket(client, bucket: str, region: str | None = None) -> bool:
    """Crée le bucket s'il manque. Renvoie True s'il vient d'être créé.

    Hors `us-east-1`, AWS refuse un `create_bucket` sans `LocationConstraint` :
    un bucket créé dans la mauvaise région servirait les livres depuis l'autre
    bout du monde, à supposer qu'il soit créé du tout.
    """
    try:
        client.head_bucket(Bucket=bucket)
        return False
    except Exception:
        kwargs = {"Bucket": bucket}
        if region and region != "us-east-1":
            kwargs["CreateBucketConfiguration"] = {"LocationConstraint": region}
        client.create_bucket(**kwargs)
        return True


def _archive(books_dir: str, edition_id: str, report: dict) -> str | None:
    """Chemin de l'archive du livre, compressée à la volée si nécessaire.

    L'import ne produit les `.zst` qu'avec `--compress`, et sa reprise saute la
    compression des livres déjà bâtis : sans ce repli, un `dist/` importé sans
    l'option serait impubliable sans tout refaire.

    Jamais appelée en essai à blanc : compresser coûte des minutes et des
    dizaines de mégaoctets, ce qu'un `--dry-run` ne doit pas faire.
    """
    packed = os.path.join(books_dir, f"{edition_id}.sqlite.zst")
    if os.path.exists(packed):
        return packed

    plain = os.path.join(books_dir, f"{edition_id}.sqlite")
    if not os.path.exists(plain):
        return None

    try:
        import zstandard
    except ImportError:
        print(
            f"erreur : {edition_id}.sqlite.zst absent et zstandard non installé "
            "(pip install zstandard)",
            file=sys.stderr,
        )
        return None

    compressor = zstandard.ZstdCompressor(level=10)
    # Écriture dans un fichier temporaire puis renommage : une interruption ne
    # laisse jamais une archive tronquée qui serait prise pour valide.
    temporary = f"{packed}.part"
    with open(plain, "rb") as source, open(temporary, "wb") as target:
        compressor.copy_stream(source, target)
    os.replace(temporary, packed)
    report["compressed"] += 1
    return packed


def manifest_key(edition_id: str, content_version: int) -> str:
    return f"books/{edition_id}/{content_version}/manifest.json"


def _upload(client, bucket, key, body, content_type, metadata, force, report):
    """Envoie [body] sous [key], sauf si un objet de même taille est déjà là."""
    if not force:
        try:
            head = client.head_object(Bucket=bucket, Key=key)
            if head.get("ContentLength") == len(body):
                report["skipped"] += 1
                return
        except Exception:
            pass  # absent ou illisible : on envoie
    client.put_object(
        Bucket=bucket,
        Key=key,
        Body=body,
        ContentType=content_type,
        CacheControl=CACHE_CONTROL,
        Metadata=metadata,
    )
    report["uploaded"] += 1


def publish(client, *, src, bucket, force=False, dry_run=False):
    """Monte les livres puis réécrit `object_key`. Renvoie un compte rendu."""
    report = {
        "uploaded": 0,
        "skipped": 0,
        "updated": 0,
        "compressed": 0,
        # Essai à blanc : ce qui *serait* fait, puisque rien ne l'est.
        "planned": 0,
        "would_compress": 0,
        "missing": [],
    }
    catalog_path = os.path.join(src, "catalog.sqlite")
    if not os.path.exists(catalog_path):
        raise SystemExit(f"catalogue introuvable : {catalog_path}")

    con = sqlite3.connect(catalog_path)
    releases = con.execute(
        "SELECT release_id, edition_id, content_version FROM book_releases WHERE is_active = 1"
    ).fetchall()

    books_dir = os.path.join(src, "books")
    updates = []
    for release_id, edition_id, content_version in releases:
        manifest_path = os.path.join(books_dir, f"{edition_id}.manifest.json")

        if dry_run:
            # Un essai à blanc n'ouvre ni ne compresse aucun fichier : il se
            # contente de dire ce qui partirait. Compresser d'abord pour ne rien
            # envoyer ensuite serait le pire des deux mondes.
            has_archive = os.path.exists(os.path.join(books_dir, f"{edition_id}.sqlite.zst"))
            has_source = os.path.exists(os.path.join(books_dir, f"{edition_id}.sqlite"))
            if not has_archive and not has_source:
                report["missing"].append(edition_id)
                continue
            report["planned"] += 2  # l'archive et son manifest
            if not has_archive:
                report["would_compress"] += 1
            continue

        packed = _archive(books_dir, edition_id, report)
        if packed is None:
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
            report,
        )
        updates.append((key, len(body), release_id))

    if updates and not dry_run:
        con.executemany(
            "UPDATE book_releases SET object_key = ?, compressed_size = ? WHERE release_id = ?",
            updates,
        )
        con.commit()
        report["updated"] = len(updates)
    con.close()

    if report["missing"]:
        print(
            f"attention : {len(report['missing'])} livre(s) sans fichier dans {books_dir}",
            file=sys.stderr,
        )
    return report


def set_anonymous_policy(client, bucket):
    """Rend `books/*` lisible sans authentification. À lancer une seule fois."""
    policy = json.loads(json.dumps(READ_ONLY_POLICY))
    policy["Statement"][0]["Resource"] = [f"arn:aws:s3:::{bucket}/books/*"]
    client.put_bucket_policy(Bucket=bucket, Policy=json.dumps(policy))


def _try(label, fn, applied, skipped):
    """Applique un réglage optionnel ; MinIO n'implémente pas toute l'API S3."""
    try:
        fn()
        applied.append(label)
    except Exception as exc:  # noqa: BLE001 — un réglage absent n'est pas fatal
        skipped.append(f"{label} ({type(exc).__name__})")


def configure_bucket(client, bucket, region=None):
    """Pose la configuration d'un bucket de distribution publique.

    Le principe : **rien n'est public sauf `books/*`, et par politique, jamais
    par ACL**. Une ACL publique posée par erreur sur un objet ne rendrait rien
    lisible, puisque les ACL sont désactivées et ignorées.
    """
    applied, skipped = [], []
    created = ensure_bucket(client, bucket, region)

    # ACL désactivées : le propriétaire du bucket possède tout, et le seul
    # chemin vers du public est la politique ci-dessous — un seul endroit à
    # auditer au lieu de deux.
    _try(
        "ownership=BucketOwnerEnforced",
        lambda: client.put_bucket_ownership_controls(
            Bucket=bucket,
            OwnershipControls={"Rules": [{"ObjectOwnership": "BucketOwnerEnforced"}]},
        ),
        applied,
        skipped,
    )

    # AWS bloque tout accès public par défaut sur un bucket neuf. On lève le
    # blocage des *politiques* seulement : les ACL publiques restent bloquées
    # et ignorées, ce qui est exactement le garde-fou qu'on veut garder.
    _try(
        "public-access-block (politiques autorisées, ACL bloquées)",
        lambda: client.put_public_access_block(
            Bucket=bucket,
            PublicAccessBlockConfiguration={
                "BlockPublicAcls": True,
                "IgnorePublicAcls": True,
                "BlockPublicPolicy": False,
                "RestrictPublicBuckets": False,
            },
        ),
        applied,
        skipped,
    )

    _try(
        "chiffrement SSE-S3",
        lambda: client.put_bucket_encryption(
            Bucket=bucket,
            ServerSideEncryptionConfiguration={
                "Rules": [
                    {
                        "ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"},
                        "BucketKeyEnabled": True,
                    }
                ]
            },
        ),
        applied,
        skipped,
    )

    _try(
        "CORS (GET/HEAD + Range)",
        lambda: client.put_bucket_cors(
            Bucket=bucket, CORSConfiguration={"CORSRules": CORS_RULES}
        ),
        applied,
        skipped,
    )

    # Un envoi interrompu laisse des morceaux facturés que personne ne voit.
    _try(
        "cycle de vie (multipart abandonnés à 7 jours)",
        lambda: client.put_bucket_lifecycle_configuration(
            Bucket=bucket,
            LifecycleConfiguration={
                "Rules": [
                    {
                        "ID": "abort-incomplete-multipart",
                        "Status": "Enabled",
                        "Filter": {"Prefix": ""},
                        "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 7},
                    }
                ]
            },
        ),
        applied,
        skipped,
    )

    # En dernier : la politique n'est acceptée qu'une fois le blocage levé.
    _try(
        "lecture publique de books/*",
        lambda: set_anonymous_policy(client, bucket),
        applied,
        skipped,
    )
    return {"created": created, "applied": applied, "skipped": skipped}


def build_parser():
    parser = argparse.ArgumentParser(description="Publie dist/shamela vers MinIO")
    parser.add_argument("--src", default="dist/shamela")
    parser.add_argument(
        "--endpoint",
        default="http://127.0.0.1:9000",
        help="URL du serveur S3 ; chaîne vide ou 'aws' pour AWS S3",
    )
    parser.add_argument("--region", default=None, help="région AWS (défaut : AWS_REGION)")
    parser.add_argument("--bucket", default="beytelhikma")
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

    access = os.environ.get("MINIO_ACCESS_KEY") or os.environ.get("AWS_ACCESS_KEY_ID")
    secret = os.environ.get("MINIO_SECRET_KEY") or os.environ.get("AWS_SECRET_ACCESS_KEY")
    if not access or not secret:
        print(
            "erreur : définir MINIO_ACCESS_KEY/MINIO_SECRET_KEY "
            "ou AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY",
            file=sys.stderr,
        )
        return 2

    endpoint = None if args.endpoint in ("", "aws") else args.endpoint
    region = args.region or os.environ.get("AWS_REGION") or "us-east-1"

    client = boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access,
        aws_secret_access_key=secret,
        region_name=region,
    )

    if args.set_anonymous_policy:
        result = configure_bucket(client, args.bucket, region)
        if result["created"]:
            print(f"bucket créé : {args.bucket} ({region})")
        for label in result["applied"]:
            print(f"  posé    : {label}")
        for label in result["skipped"]:
            print(f"  ignoré  : {label}", file=sys.stderr)

    report = publish(
        client,
        src=args.src,
        bucket=args.bucket,
        force=args.force,
        dry_run=args.dry_run,
    )
    if args.dry_run:
        print(
            f"essai à blanc — objets à envoyer : {report['planned']} • "
            f"à compresser : {report['would_compress']} • "
            f"livres sans fichier : {len(report['missing'])}"
        )
    else:
        print(
            f"envoyés : {report['uploaded']} • ignorés : {report['skipped']} • "
            f"compressés : {report['compressed']} • catalogue mis à jour : {report['updated']}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
