#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Chaîne de publication de la bibliothèque : importe, publie, vérifie.

    python tools/release_library.py --dry-run
    python tools/release_library.py

Un seul point d'entrée, parce que l'ordre compte et qu'aucun document ne
l'impose : les livres partent avant le catalogue, et le pointeur en dernier.
Tant qu'il n'a pas bougé, aucun client ne peut découvrir un catalogue dont les
livres ne sont pas encore montés.

La `catalog_version` n'est pas donnée à la main. Elle se déduit de ce qui est
**en ligne** : le pointeur dit la version publiée et son empreinte ; si le
catalogue produit a la même empreinte, il n'y a rien à republier. Une version
qui s'incrémenterait à chaque exécution ferait retélécharger la graine à tous
les clients pour un catalogue identique.

Identifiants lus dans l'environnement, jamais dans le dépôt — voir
`publish_minio.py`. Un fichier `.env` à la racine est chargé s'il existe.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import subprocess
import sys
import urllib.error
import urllib.request

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RACINE, "tools"))

POINTEUR = "catalog/latest.json"


# ------------------------------------------------------------------ version


def version_suivante(pointeur_en_ligne, sha_local):
    """Version à publier, ou `None` s'il n'y a rien à publier.

    Un pointeur illisible, absent ou malformé se traite comme une première
    publication : il n'y a rien en ligne qu'on risquerait d'écraser.

    Un pointeur sans empreinte ne permet pas de conclure à l'identité — on
    publie, mais au-dessus de ce qui est en ligne : la version ne descend jamais.
    """
    if not isinstance(pointeur_en_ligne, dict):
        return 1

    version = pointeur_en_ligne.get("catalog_version")
    if not isinstance(version, int) or isinstance(version, bool) or version < 1:
        return 1

    if pointeur_en_ligne.get("sha256") == sha_local:
        return None
    return version + 1


# ------------------------------------------------------------------ outillage


def charge_env(racine):
    """Charge `.env` dans l'environnement, sans jamais afficher les valeurs."""
    chemin = os.path.join(racine, ".env")
    if not os.path.exists(chemin):
        return
    with open(chemin, encoding="utf-8-sig") as fh:
        for ligne in fh:
            ligne = ligne.strip()
            if ligne and not ligne.startswith("#") and "=" in ligne:
                cle, _, valeur = ligne.partition("=")
                os.environ.setdefault(cle.strip(), valeur.strip().strip('"').strip("'"))


def base_publique(bucket, region):
    return f"https://{bucket}.s3.{region}.amazonaws.com"


def lit_pointeur(base):
    """Pointeur en ligne, ou `None` pour toute anomalie.

    Anonyme et sans cache : c'est ce que verra un client, et c'est la seule
    lecture qui prouve quelque chose.
    """
    requete = urllib.request.Request(
        f"{base}/{POINTEUR}", headers={"Cache-Control": "no-cache"}
    )
    try:
        with urllib.request.urlopen(requete, timeout=15) as reponse:
            return json.loads(reponse.read().decode("utf-8"))
    except (urllib.error.URLError, ValueError, OSError):
        return None


def empreinte_catalogue(chemin):
    with open(chemin, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def ecrit_version(chemin, version):
    con = sqlite3.connect(chemin)
    con.execute("UPDATE catalog_info SET catalog_version = ?", (version,))
    con.commit()
    con.close()


def lance(commande, **kwargs):
    print(f"$ {' '.join(commande)}", flush=True)
    resultat = subprocess.run(commande, cwd=RACINE, **kwargs)
    if resultat.returncode != 0:
        raise SystemExit(f"échec : {' '.join(commande)}")


# ------------------------------------------------------------------ étapes


def importe(args):
    commande = [
        sys.executable,
        os.path.join("tools", "import_shamela.py"),
        "--books-per-category",
        str(args.books_per_category),
        "--jobs",
        str(args.jobs),
        "--resume",
        "--compress",
    ]
    lance(commande)


def verifie_anonymement(base, src):
    """Relit le pointeur et un livre **sans identifiants**.

    Une publication qui réussit derrière des clés et échoue sans elles est un
    échec qui ne se voit qu'en production.
    """
    pointeur = lit_pointeur(base)
    if not pointeur:
        raise SystemExit("vérification : le pointeur n'est pas lisible anonymement")

    con = sqlite3.connect(os.path.join(src, "catalog.sqlite"))
    ligne = con.execute(
        "SELECT object_key FROM book_releases WHERE is_active = 1 LIMIT 1"
    ).fetchone()
    con.close()
    if not ligne:
        raise SystemExit("vérification : aucun livre actif au catalogue")

    cle = ligne[0]
    if "://" in cle:
        raise SystemExit(f"vérification : le catalogue porte encore un hôte ({cle})")

    requete = urllib.request.Request(f"{base}/{cle}", headers={"Range": "bytes=0-15"})
    try:
        with urllib.request.urlopen(requete, timeout=15) as reponse:
            if reponse.status not in (200, 206):
                raise SystemExit(f"vérification : livre illisible (HTTP {reponse.status})")
    except (urllib.error.URLError, OSError) as erreur:
        raise SystemExit(f"vérification : livre illisible ({erreur})")

    print(
        f"vérifié anonymement : pointeur v{pointeur['catalog_version']} "
        f"({pointeur['edition_count']} éditions) et {cle}"
    )


def nettoie(src):
    """Retire les archives montées et les fichiers d'éditions hors catalogue."""
    livres = os.path.join(src, "books")
    con = sqlite3.connect(os.path.join(src, "catalog.sqlite"))
    actives = {r[0] for r in con.execute("SELECT edition_id FROM book_releases WHERE is_active = 1")}
    con.close()

    supprimes = 0
    liberes = 0
    for nom in os.listdir(livres):
        chemin = os.path.join(livres, nom)
        jetable = (
            nom.endswith(".part")
            or nom.endswith(".sqlite.zst")
            or nom.split(".")[0] not in actives
        )
        if jetable:
            liberes += os.path.getsize(chemin)
            os.remove(chemin)
            supprimes += 1
    print(f"nettoyage : {supprimes} fichiers, {liberes / 1048576:.1f} Mo libérés")


# ------------------------------------------------------------------ entrée


def build_parser():
    p = argparse.ArgumentParser(description="Publie la bibliothèque vers le bucket")
    p.add_argument("--src", default="dist/shamela")
    p.add_argument("--books-per-category", type=int, default=10)
    p.add_argument("--jobs", type=int, default=8)
    p.add_argument("--bucket", default=None, help="défaut : BUCKET_NAME")
    p.add_argument("--region", default=None, help="défaut : AWS_REGION")
    p.add_argument("--skip-import", action="store_true", help="publier sans réimporter")
    p.add_argument("--skip-cleanup", action="store_true", help="garder les archives")
    p.add_argument("--force-version", type=int, default=None,
                   help="imposer une catalog_version au lieu de la calculer")
    p.add_argument("--dry-run", action="store_true")
    return p


def main(argv=None):
    args = build_parser().parse_args(argv)
    charge_env(RACINE)

    bucket = args.bucket or os.environ.get("BUCKET_NAME")
    region = args.region or os.environ.get("AWS_REGION")
    if not bucket or not region:
        raise SystemExit("erreur : définir BUCKET_NAME et AWS_REGION (ou --bucket / --region)")

    src = os.path.join(RACINE, args.src)
    if not args.skip_import:
        importe(args)

    catalogue = os.path.join(src, "catalog.sqlite")
    if not os.path.exists(catalogue):
        raise SystemExit(f"catalogue introuvable : {catalogue}")

    base = base_publique(bucket, region)
    sha_local = empreinte_catalogue(catalogue)
    pointeur = lit_pointeur(base)
    version = args.force_version or version_suivante(pointeur, sha_local)

    if version is None:
        en_ligne = pointeur["catalog_version"]
        print(f"catalogue inchangé (v{en_ligne}, même empreinte) — rien à publier")
        return 0

    print(f"catalogue à publier en v{version} (empreinte {sha_local[:12]}…)")
    if args.dry_run:
        print("essai à blanc — rien n'est écrit ni envoyé")
        return 0

    # La version est écrite **avant** la publication : c'est elle que
    # `publish_catalog` lira dans `catalog_info` pour nommer l'objet.
    ecrit_version(catalogue, version)

    import publish_minio

    code = publish_minio.main(
        [
            "--src",
            args.src,
            "--endpoint",
            "aws",
            "--region",
            region,
            "--bucket",
            bucket,
        ]
    )
    if code != 0:
        raise SystemExit("publication en échec")

    verifie_anonymement(base, src)
    if not args.skip_cleanup:
        nettoie(src)
    print(f"bibliothèque publiée : catalogue v{version} sur {base}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
