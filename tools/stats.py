"""Le tableau de bord privé du projet — téléchargements et usage réel.

Deux sous-commandes, deux sources, aucune donnée personnelle :

    python tools/stats.py releases            # compteurs de l'API GitHub
    python tools/stats.py bucket --days 30    # journaux d'accès du bucket S3

**Rien n'est mesuré dans la page du site.** Un script d'analytics tiers y
serait refusé par `site/test/build.test.js` — et il faudrait un bandeau de
consentement pour une donnée que ces deux sources donnent déjà. La
fréquentation, elle, se lit dans le tableau de bord Cloudflare, mesurée à
l'edge : voir `docs/KPI.md`.

Ce que l'on compte ici, ce sont des **requêtes**, jamais des personnes. Aucun
identifiant n'est posé chez le client, et `parse_log_line` écarte l'adresse IP
à la lecture : l'outil ne peut donc en afficher aucune, même par erreur.
"""

import argparse
import collections
import gzip
import io
import json
import os
import sys
import urllib.error
import urllib.request

API = "https://api.github.com/repos/{owner}/{name}/releases"
OWNER, NAME = "sfellah", "beytelhikma"

# Le classement par extension, et rien de plus fin. La table de vérité est
# `site/lib/releases.mjs` (`classifyAsset`), en JavaScript : la recopier
# entièrement ici en ferait une seconde source qui dériverait. On s'en tient
# donc à ce qu'une extension suffit à dire, et l'on ne prétend pas à mieux.
PLATFORMS = {
    ".exe": "windows",
    ".msi": "windows",
    ".appimage": "linux",
    ".deb": "linux",
    ".rpm": "linux",
    ".apk": "android",
    ".dmg": "macos",
    ".zip": "portable",
}

# Ce que `site/lib/releases.mjs` écarte aussi : ces fichiers servent au
# mécanisme de mise à jour, personne ne les télécharge à la main, et les
# compter gonflerait les chiffres d'un trafic qui n'est pas une adoption.
MACHINE_ONLY = (".blockmap", ".yml", ".yaml", ".idsig")

POINTER_KEY = "catalog/latest.json"


# --- les compteurs de GitHub ------------------------------------------------


def platform_of(name: str) -> str:
    lowered = name.lower()
    for suffix, platform in PLATFORMS.items():
        if lowered.endswith(suffix):
            return platform
    return "autre"


def is_machine_only(name: str) -> bool:
    return name.lower().endswith(MACHINE_ONLY)


def fetch_releases(owner=OWNER, name=NAME, token=None):
    """Lit l'API publique. Le jeton est facultatif — il ne sert qu'au quota."""
    request = urllib.request.Request(
        API.format(owner=owner, name=name),
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "beytelhikma-stats",
            **({"Authorization": f"Bearer {token}"} if token else {}),
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def summarize_releases(releases):
    """Rend un résumé pur, sans réseau : c'est ce qui le rend testable.

    Les brouillons sont écartés comme dans `buildIndex` du site : ils ne sont
    téléchargeables par personne, et leur compteur n'est donc pas une adoption.
    """
    versions, platforms = [], collections.Counter()
    for release in releases:
        if release.get("draft"):
            continue
        assets = []
        for asset in release.get("assets", []):
            asset_name = asset.get("name", "")
            if is_machine_only(asset_name):
                continue
            count = int(asset.get("download_count") or 0)
            assets.append({"name": asset_name, "count": count})
            platforms[platform_of(asset_name)] += count
        versions.append(
            {
                "tag": release.get("tag_name", "?"),
                "prerelease": bool(release.get("prerelease")),
                "published": (release.get("published_at") or "")[:10],
                "assets": sorted(assets, key=lambda entry: -entry["count"]),
                "total": sum(entry["count"] for entry in assets),
            }
        )

    total = sum(version["total"] for version in versions)
    # La dernière **stable** : c'est elle que le site met en avant, donc elle
    # seule mesure la vitesse d'adoption. Une préversion en tête fausserait le
    # rapport en le comparant à un lien que personne ne voit.
    latest = next((v for v in versions if not v["prerelease"]), None)
    return {
        "versions": versions,
        "platforms": dict(platforms),
        "total": total,
        "latest": latest,
        "latest_share": (latest["total"] / total) if latest and total else 0.0,
    }


def print_releases(summary, out=sys.stdout):
    print(f"téléchargements, toutes versions : {summary['total']}", file=out)
    for platform, count in sorted(summary["platforms"].items(), key=lambda kv: -kv[1]):
        print(f"  {platform:<10} {count}", file=out)
    print(file=out)
    for version in summary["versions"]:
        marque = " (préversion)" if version["prerelease"] else ""
        print(f"{version['tag']}{marque} — {version['published']} — {version['total']}", file=out)
        for asset in version["assets"]:
            print(f"    {asset['count']:>6}  {asset['name']}", file=out)
    if summary["latest"]:
        part = round(summary["latest_share"] * 100)
        print(
            f"\npart de {summary['latest']['tag']} dans le total : {part} %"
            "  (vitesse d'adoption ; une part basse dit que les gens tombent"
            " sur d'anciens liens)",
            file=out,
        )


# --- les journaux du bucket -------------------------------------------------


def parse_log_line(line: str):
    """Découpe une ligne de journal d'accès S3. Rend `None` si elle est illisible.

    Le format est fixe et documenté, mais il évolue par **ajout** de champs en
    fin de ligne : lire par position depuis le début, et jamais compter les
    champs, est ce qui laisse l'outil survivre à la prochaine version. Une ligne
    qu'on ne sait pas lire est sautée, jamais levée — un journal a des millions
    de lignes, et l'une d'elles ne doit pas faire tomber le décompte.

    **L'adresse IP est écartée ici**, au seul endroit qui la voit. Le journal en
    contient ; le bucket qui le porte est privé et l'expire à 30 jours ; et
    aucune fonction en aval ne peut en afficher une, puisqu'aucune ne la reçoit.
    """
    # Champs entre guillemets ou entre crochets : un découpage sur l'espace
    # couperait la date `[04/Aug/2026:10:00:00 +0000]` et la requête en deux.
    fields, current, quote = [], [], None
    for char in line.strip():
        if quote:
            if (quote == '"' and char == '"') or (quote == "[" and char == "]"):
                # Le champ est posé **à la fermeture**, même vide : un `""` que
                # l'on sauterait décalerait tous les champs suivants d'un cran,
                # et le statut HTTP se lirait dans la colonne d'à côté.
                quote = None
                fields.append("".join(current))
                current = []
                continue
            current.append(char)
        elif char in '"[':
            quote = char
        elif char == " ":
            if current:
                fields.append("".join(current))
                current = []
        else:
            current.append(char)
    if current:
        fields.append("".join(current))

    # 0 propriétaire, 1 bucket, 2 date, 3 adresse (écartée), 4 requérant,
    # 5 identifiant de requête, 6 opération, 7 clé, 8 requête, 9 statut,
    # 10 erreur, 11 octets envoyés.
    if len(fields) < 10:
        return None
    try:
        status = int(fields[9])
    except ValueError:
        return None

    key = fields[7]
    day = fields[2].split(":", 1)[0]  # « 04/Aug/2026 »
    try:
        bytes_sent = int(fields[11])
    except (IndexError, ValueError):
        bytes_sent = 0

    return {
        "day": day,
        "operation": fields[6],
        "key": None if key == "-" else key,
        "status": status,
        "bytes": bytes_sent,
    }


def summarize_access(lines):
    """Agrège des lignes de journal en indicateurs par jour.

    `pointeurs` compte les lectures réussies de `catalog/latest.json` : une par
    démarrage d'application. C'est la seule mesure d'usage réel du produit, et
    elle ne dit **pas** un nombre de personnes — deux cents démarrages peuvent
    être vingt lecteurs.
    """
    days = collections.defaultdict(
        lambda: {"pointeurs": 0, "catalogues": 0, "livres": 0, "octets": 0, "erreurs": 0}
    )
    livres = collections.Counter()

    for line in lines:
        entry = parse_log_line(line)
        if entry is None or not entry["operation"].startswith("REST.GET"):
            continue
        jour = days[entry["day"]]
        if entry["status"] >= 400:
            jour["erreurs"] += 1
            continue
        key = entry["key"] or ""
        jour["octets"] += entry["bytes"]
        if key == POINTER_KEY:
            jour["pointeurs"] += 1
        elif key.startswith("catalog/"):
            jour["catalogues"] += 1
        elif key.startswith("books/"):
            jour["livres"] += 1
            # `books/<edition_id>/<version>/book.sqlite.zst`
            parts = key.split("/")
            if len(parts) > 1:
                livres[parts[1]] += 1

    return {"days": dict(sorted(days.items())), "books": livres}


def read_access_logs(client, bucket, prefix="access/", limit_days=30):
    """Rend les lignes des journaux, du plus récent au plus ancien.

    Un générateur : les journaux d'un bucket actif se comptent en milliers de
    fichiers, et tout charger en mémoire pour en compter les lignes serait
    payer deux fois.
    """
    paginator = client.get_paginator("list_objects_v2")
    objets = []
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        objets.extend(page.get("Contents", []))
    objets.sort(key=lambda entry: entry["LastModified"], reverse=True)

    plus_recent = objets[0]["LastModified"] if objets else None
    for objet in objets:
        if plus_recent and (plus_recent - objet["LastModified"]).days > limit_days:
            break
        corps = client.get_object(Bucket=bucket, Key=objet["Key"])["Body"].read()
        # S3 livre en texte brut ; un bucket dont le cycle de vie compresse les
        # anciens objets ne doit pas faire tomber la lecture pour autant.
        if corps[:2] == b"\x1f\x8b":
            corps = gzip.decompress(corps)
        yield from io.StringIO(corps.decode("utf-8", "replace"))


def print_access(summary, out=sys.stdout):
    if not summary["days"]:
        print(
            "aucun journal lisible. La livraison des journaux S3 est différée "
            "(compter une heure après la première requête).",
            file=out,
        )
        return

    print(f"{'jour':<13}{'démarrages':>11}{'catalogues':>11}{'livres':>8}"
          f"{'Mo servis':>11}{'erreurs':>9}", file=out)
    for day, stats in summary["days"].items():
        print(
            f"{day:<13}{stats['pointeurs']:>11}{stats['catalogues']:>11}"
            f"{stats['livres']:>8}{stats['octets'] / 1e6:>11.1f}{stats['erreurs']:>9}",
            file=out,
        )

    if summary["books"]:
        print("\nlivres les plus téléchargés :", file=out)
        for edition, count in summary["books"].most_common(10):
            print(f"  {count:>5}  {edition}", file=out)

    print(
        "\n« démarrages » compte les lectures de catalog/latest.json : une par"
        "\nlancement d'application, jamais une par personne.",
        file=out,
    )


# --- entrée -----------------------------------------------------------------


def build_parser():
    parser = argparse.ArgumentParser(description="Les indicateurs du projet")
    sub = parser.add_subparsers(dest="command", required=True)

    releases = sub.add_parser("releases", help="compteurs de téléchargement GitHub")
    releases.add_argument("--owner", default=OWNER)
    releases.add_argument("--name", default=NAME)
    releases.add_argument("--json", action="store_true", help="rendre le résumé brut")

    bucket = sub.add_parser("bucket", help="usage réel, depuis les journaux S3")
    bucket.add_argument("--bucket", default="beytelhima-library-logs",
                        help="le bucket **de journaux**, pas celui de distribution")
    bucket.add_argument("--prefix", default="access/")
    bucket.add_argument("--days", type=int, default=30)
    bucket.add_argument("--endpoint", default="aws",
                        help="URL du serveur S3 ; vide ou 'aws' pour AWS S3")
    bucket.add_argument("--region", default=None)
    bucket.add_argument("--json", action="store_true")
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)

    if args.command == "releases":
        token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
        try:
            releases = fetch_releases(args.owner, args.name, token)
        except urllib.error.URLError as exc:
            print(f"erreur : API GitHub injoignable ({exc})", file=sys.stderr)
            return 2
        summary = summarize_releases(releases)
        if args.json:
            print(json.dumps(summary, ensure_ascii=False, indent=2))
        else:
            print_releases(summary)
        return 0

    try:
        import boto3
    except ImportError:
        print("erreur : boto3 est requis (pip install boto3)", file=sys.stderr)
        return 2

    access = os.environ.get("MINIO_ACCESS_KEY") or os.environ.get("AWS_ACCESS_KEY_ID")
    secret = os.environ.get("MINIO_SECRET_KEY") or os.environ.get("AWS_SECRET_ACCESS_KEY")
    if not access or not secret:
        print(
            "erreur : définir AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY "
            "ou MINIO_ACCESS_KEY/MINIO_SECRET_KEY",
            file=sys.stderr,
        )
        return 2

    client = boto3.client(
        "s3",
        endpoint_url=None if args.endpoint in ("", "aws") else args.endpoint,
        aws_access_key_id=access,
        aws_secret_access_key=secret,
        region_name=args.region or os.environ.get("AWS_REGION") or "us-east-1",
    )
    summary = summarize_access(read_access_logs(client, args.bucket, args.prefix, args.days))
    if args.json:
        print(json.dumps({"days": summary["days"], "books": dict(summary["books"])},
                         ensure_ascii=False, indent=2))
    else:
        print_access(summary)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
