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
import hashlib
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

# Le pointeur est la seule chose du bucket qui change sous une clé fixe. Le
# mettre en cache comme le reste tuerait la mise à jour en silence : tout
# marcherait le premier jour, et plus rien ne bougerait ensuite.
POINTER_KEY = "catalog/latest.json"
POINTER_CACHE_CONTROL = "no-cache"

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


def catalog_key(catalog_version: int) -> str:
    return f"catalog/{catalog_version}/catalog.sqlite.zst"


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


def _upload(client, bucket, key, body, content_type, metadata, force, report,
            cache_control=CACHE_CONTROL):
    """Envoie [body] sous [key], sauf si un objet de même taille est déjà là.

    Le raccourci « même taille = déjà là » est faux pour le pointeur, dont la
    taille ne bouge pas d'une version à l'autre : il part toujours en `force`.
    """
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
        CacheControl=cache_control,
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
        # Livres montés lors d'une tranche précédente, dont les fichiers ont été
        # effacés pour rendre la place. Ils ne sont ni envoyés ni manquants.
        "already": 0,
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
        manifest = {}
        if os.path.exists(manifest_path):
            with open(manifest_path, encoding="utf-8") as fh:
                manifest = json.load(fh)
        key = object_key(edition_id, content_version)

        if dry_run:
            # Un essai à blanc n'ouvre ni ne compresse aucun fichier : il se
            # contente de dire ce qui partirait. Compresser d'abord pour ne rien
            # envoyer ensuite serait le pire des deux mondes.
            has_archive = os.path.exists(os.path.join(books_dir, f"{edition_id}.sqlite.zst"))
            has_source = os.path.exists(os.path.join(books_dir, f"{edition_id}.sqlite"))
            if not has_archive and not has_source:
                if manifest.get("object_key") == key:
                    report["already"] += 1
                else:
                    report["missing"].append(edition_id)
                continue
            report["planned"] += 2  # l'archive et son manifest
            if not has_archive:
                report["would_compress"] += 1
            continue

        packed = _archive(books_dir, edition_id, report)
        if packed is None:
            # Fichier absent, mais le manifest porte déjà la clé : le livre a
            # été monté par une tranche précédente puis effacé. Le catalogue
            # doit quand même recevoir sa clé, sinon il repartirait en
            # `local://` et le client ne saurait pas où le chercher.
            if manifest.get("object_key") == key:
                report["already"] += 1
                updates.append((key, manifest.get("compressed_size") or 0, release_id))
            else:
                report["missing"].append(edition_id)
            continue

        with open(packed, "rb") as fh:
            body = fh.read()

        # La clé est écrite au manifest **avant** son envoi. C'est la seule
        # trace qui survit à la suppression du fichier, et celle dont la reprise
        # se sert pour reconstruire un catalogue complet depuis un disque
        # presque vide. La compléter après l'envoi ferait diverger la copie
        # locale de celle du bucket, et le passage suivant renverrait tous les
        # manifests pour cette seule différence.
        manifest["object_key"] = key
        manifest["compressed_size"] = len(body)
        if os.path.exists(manifest_path):
            temporary = f"{manifest_path}.part"
            with open(temporary, "w", encoding="utf-8") as fh:
                json.dump(manifest, fh, ensure_ascii=False, indent=2)
            os.replace(temporary, manifest_path)

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
    """Rend `books/*` et `catalog/*` lisibles sans authentification.

    Deux préfixes explicites, jamais le bucket entier : le listing anonyme doit
    continuer de répondre 403. Le catalogue ne porte que des métadonnées de
    livres déjà publics — l'ouvrir ne concède rien.
    """
    policy = json.loads(json.dumps(READ_ONLY_POLICY))
    policy["Statement"][0]["Resource"] = [
        f"arn:aws:s3:::{bucket}/books/*",
        f"arn:aws:s3:::{bucket}/catalog/*",
    ]
    client.put_bucket_policy(Bucket=bucket, Policy=json.dumps(policy))


def publish_catalog(client, *, src, bucket, force=False, dry_run=False):
    """Monte le catalogue compressé sous un chemin versionné, puis son pointeur.

    Le pointeur est écrit **en dernier** : tant qu'il n'a pas bougé, aucun client
    ne peut découvrir un catalogue à moitié monté.
    """
    catalog_path = os.path.join(src, "catalog.sqlite")
    if not os.path.exists(catalog_path):
        raise SystemExit(f"catalogue introuvable : {catalog_path}")

    con = sqlite3.connect(catalog_path)
    row = con.execute(
        "SELECT catalog_version, schema_version, generated_at, edition_count FROM catalog_info"
    ).fetchone()
    con.close()
    if row is None:
        raise SystemExit("catalog_info est vide : impossible de versionner le catalogue")
    catalog_version, schema_version, generated_at, edition_count = row

    report = {
        "catalog_version": catalog_version,
        "uploaded": 0,
        "skipped": 0,
        "planned": 0,
        "compressed": 0,
    }
    if dry_run:
        report["planned"] = 2  # le catalogue et son pointeur
        return report

    try:
        import zstandard
    except ImportError:
        print("erreur : zstandard est requis (pip install zstandard)", file=sys.stderr)
        raise SystemExit(2)

    with open(catalog_path, "rb") as fh:
        raw = fh.read()
    body = zstandard.ZstdCompressor(level=19).compress(raw)
    report["compressed"] += 1
    digest = hashlib.sha256(raw).hexdigest()

    key = catalog_key(catalog_version)
    _upload(
        client,
        bucket,
        key,
        body,
        "application/zstd",
        {"sha256": digest, "uncompressed-size": str(len(raw))},
        force,
        report,
    )

    pointer = {
        "catalog_version": catalog_version,
        "schema_version": schema_version,
        "generated_at": generated_at,
        "edition_count": edition_count,
        "object_key": key,
        "sha256": digest,
        "compressed_size": len(body),
        "uncompressed_size": len(raw),
    }
    _upload(
        client,
        bucket,
        POINTER_KEY,
        json.dumps(pointer, ensure_ascii=False, indent=2).encode("utf-8"),
        "application/json",
        {},
        True,  # jamais sauté : sa taille ne change pas d'une version à l'autre
        report,
        cache_control=POINTER_CACHE_CONTROL,
    )
    return report


"""Préfixe et rétention des journaux d'accès.

Trente jours, pas un an : un journal contient des adresses IP, et le seul usage
qu'on en fait est un décompte par jour. Le garder plus longtemps, c'est payer un
stockage qui grandit et détenir des données dont on n'a que faire.
"""
ACCESS_LOG_PREFIX = "access/"
ACCESS_LOG_RETENTION_DAYS = 30


def logging_policy(log_bucket: str, source_bucket: str, account_id: str | None):
    """La politique qui laisse S3 écrire les journaux, et personne d'autre.

    `aws:SourceArn` et `aws:SourceAccount` ne sont pas décoratifs : sans eux, le
    service de journalisation **d'un autre compte** peut écrire dans ce bucket,
    et l'on paie le stockage de journaux qui ne nous concernent pas. AWS appelle
    cela le « confused deputy ». `aws:SourceAccount` est omis si l'identifiant
    du compte n'a pas pu être lu — la restriction par ARN suffit à cadrer.
    """
    condition = {"ArnLike": {"aws:SourceArn": f"arn:aws:s3:::{source_bucket}"}}
    if account_id:
        condition["StringEquals"] = {"aws:SourceAccount": account_id}
    return {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "S3ServerAccessLogsPolicy",
                "Effect": "Allow",
                "Principal": {"Service": "logging.s3.amazonaws.com"},
                "Action": ["s3:PutObject"],
                "Resource": [f"arn:aws:s3:::{log_bucket}/{ACCESS_LOG_PREFIX}*"],
                "Condition": condition,
            }
        ],
    }


def _try(label, fn, applied, skipped):
    """Applique un réglage optionnel ; MinIO n'implémente pas toute l'API S3."""
    try:
        fn()
        applied.append(label)
    except Exception as exc:  # noqa: BLE001 — un réglage absent n'est pas fatal
        skipped.append(f"{label} ({type(exc).__name__})")


def configure_logging(client, bucket, log_bucket, region=None, account_id=None):
    """Fait journaliser les accès du bucket de distribution vers un bucket privé.

    C'est la seule mesure d'usage réel du produit : chaque démarrage d'une
    application fait un `GET catalog/latest.json`, et rien d'autre ne le dit.
    Aucun identifiant n'est posé chez le client pour l'obtenir — on compte des
    requêtes, jamais des personnes.

    Le bucket de journaux est **privé, et le reste**. Le bucket de distribution
    est public par politique ; celui-ci contient des adresses IP, et une erreur
    qui le rendrait lisible serait une fuite. D'où le blocage d'accès public à
    quatre `True`, en toutes lettres, plutôt qu'un défaut hérité.

    Rendu dans le style de `configure_bucket` : ce que MinIO n'implémente pas
    est signalé et sauté, jamais fatal.
    """
    applied, skipped = [], []
    created = ensure_bucket(client, log_bucket, region)

    _try(
        f"journaux : {log_bucket} strictement privé",
        lambda: client.put_public_access_block(
            Bucket=log_bucket,
            PublicAccessBlockConfiguration={
                "BlockPublicAcls": True,
                "IgnorePublicAcls": True,
                "BlockPublicPolicy": True,
                "RestrictPublicBuckets": True,
            },
        ),
        applied,
        skipped,
    )

    _try(
        f"journaux : {log_bucket} en BucketOwnerEnforced",
        lambda: client.put_bucket_ownership_controls(
            Bucket=log_bucket,
            OwnershipControls={"Rules": [{"ObjectOwnership": "BucketOwnerEnforced"}]},
        ),
        applied,
        skipped,
    )

    # `BlockPublicPolicy` est vrai ci-dessus, et cette politique-ci n'est pas
    # publique : son principal est un service AWS nommé, pas `*`.
    _try(
        "journaux : écriture réservée au service de journalisation",
        lambda: client.put_bucket_policy(
            Bucket=log_bucket,
            Policy=json.dumps(logging_policy(log_bucket, bucket, account_id)),
        ),
        applied,
        skipped,
    )

    _try(
        f"journaux : expiration à {ACCESS_LOG_RETENTION_DAYS} jours",
        lambda: client.put_bucket_lifecycle_configuration(
            Bucket=log_bucket,
            LifecycleConfiguration={
                "Rules": [
                    {
                        "ID": "expire-access-logs",
                        "Status": "Enabled",
                        "Filter": {"Prefix": ACCESS_LOG_PREFIX},
                        "Expiration": {"Days": ACCESS_LOG_RETENTION_DAYS},
                    }
                ]
            },
        ),
        applied,
        skipped,
    )

    # En dernier : la cible doit accepter l'écriture avant qu'on y dirige quoi
    # que ce soit, sinon AWS refuse la configuration de journalisation.
    _try(
        f"journalisation des accès vers {log_bucket}/{ACCESS_LOG_PREFIX}",
        lambda: client.put_bucket_logging(
            Bucket=bucket,
            BucketLoggingStatus={
                "LoggingEnabled": {
                    "TargetBucket": log_bucket,
                    "TargetPrefix": ACCESS_LOG_PREFIX,
                }
            },
        ),
        applied,
        skipped,
    )
    return {"created": created, "applied": applied, "skipped": skipped}


def configure_bucket(client, bucket, region=None, log_bucket=None, account_id=None):
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

    # Les journaux d'accès, si l'on en veut. Leur bucket est un second bucket,
    # privé : sa configuration vit dans `configure_logging`, pas ici, parce
    # qu'aucun de ses réglages ne ressemble à ceux du bucket public.
    if log_bucket:
        logs = configure_logging(client, bucket, log_bucket, region, account_id)
        applied.extend(logs["applied"])
        skipped.extend(logs["skipped"])
        created = created or logs["created"]

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
    parser.add_argument(
        "--access-logs",
        default=None,
        metavar="BUCKET",
        help="journaliser les accès vers ce bucket privé (créé s'il manque)",
    )
    parser.add_argument("--catalog-only", action="store_true",
                        help="ne publier que le catalogue et son pointeur")
    parser.add_argument("--skip-catalog", action="store_true",
                        help="ne publier que les livres")
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
        # L'identifiant de compte ne sert qu'à cadrer la politique des journaux.
        # MinIO n'a pas de STS de ce genre : son absence n'est pas une erreur,
        # la restriction par ARN cadre déjà la politique.
        account_id = None
        if args.access_logs:
            try:
                account_id = boto3.client(
                    "sts",
                    aws_access_key_id=access,
                    aws_secret_access_key=secret,
                    region_name=region,
                ).get_caller_identity()["Account"]
            except Exception:  # noqa: BLE001 — cadrage en moins, pas un échec
                print(
                    "note : compte AWS non résolu, politique des journaux "
                    "cadrée par ARN seulement",
                    file=sys.stderr,
                )
        result = configure_bucket(
            client, args.bucket, region, log_bucket=args.access_logs, account_id=account_id
        )
        if result["created"]:
            print(f"bucket créé : {args.bucket} ({region})")
        for label in result["applied"]:
            print(f"  posé    : {label}")
        for label in result["skipped"]:
            print(f"  ignoré  : {label}", file=sys.stderr)

    if not args.catalog_only:
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
                f"déjà montés : {report['already']} • "
                f"livres sans fichier : {len(report['missing'])}"
            )
        else:
            print(
                f"envoyés : {report['uploaded']} • ignorés : {report['skipped']} • "
                f"compressés : {report['compressed']} • déjà montés : {report['already']} • "
                f"catalogue mis à jour : {report['updated']}"
            )

    # Le catalogue part **après** les livres : un pointeur qui annonce des
    # éditions dont les objets ne sont pas encore montés ferait échouer des
    # téléchargements chez ceux qui le liraient entre les deux.
    if not args.skip_catalog:
        catalog_report = publish_catalog(
            client,
            src=args.src,
            bucket=args.bucket,
            force=args.force,
            dry_run=args.dry_run,
        )
        verbe = "à publier" if args.dry_run else "publié"
        print(f"catalogue v{catalog_report['catalog_version']} {verbe} • pointeur {POINTER_KEY}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
