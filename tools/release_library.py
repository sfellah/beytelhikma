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


def lance(commande, codes_ok=(0,), **kwargs):
    """Exécute et vérifie le code de retour. Renvoie ce code.

    `codes_ok` existe pour l'importeur, qui rend **1 dès qu'un livre est sauté**
    et 2 pour une erreur bloquante. Sur 8 589 livres du corpus réel, quelques
    sources sont défectueuses — un sommaire qui pointe une page absente, par
    exemple — et l'importeur est fait pour les sauter en les signalant. Traiter
    ce 1 comme un échec arrêtait toute la publication au premier livre bancal.
    """
    print(f"$ {' '.join(commande)}", flush=True)
    resultat = subprocess.run(commande, cwd=RACINE, **kwargs)
    if resultat.returncode not in codes_ok:
        raise SystemExit(f"échec : {' '.join(commande)}")
    return resultat.returncode


# ------------------------------------------------------------------ étapes


def importe(args, book_ids=None, compress=True):
    """Un tour d'importeur. `book_ids` restreint à une tranche.

    Sans `book_ids`, la portée est celle des options — c'est aussi la forme qui
    reconstruit le catalogue **complet** en fin de course : tous les livres sont
    repris depuis leur manifest, y compris ceux dont le `.sqlite` a été effacé.
    """
    commande = [sys.executable, os.path.join("tools", "import_shamela.py")]
    if book_ids:
        commande += ["--book-ids", ",".join(str(i) for i in book_ids)]
    elif args.all:
        commande.append("--all")
    else:
        commande += ["--books-per-category", str(args.books_per_category)]
    commande += ["--jobs", str(args.jobs), "--resume"]
    if compress:
        commande.append("--compress")
    # 1 = des livres ont été sautés, et ils sont déjà détaillés dans la sortie
    # de l'importeur et dans son rapport. 2 reste bloquant.
    return lance(commande, codes_ok=(0, 1))


def selection(args):
    """La sélection de l'importeur, calculée ici pour pouvoir la découper.

    On appelle le même `select` que lui plutôt que d'analyser sa sortie : deux
    listes tirées de deux codes différents finiraient par diverger, et une
    tranche publiée qui ne serait plus au catalogue final ne se verrait pas.
    """
    from shamela.cli import DEFAULT_SRC
    from shamela.discovery import scan_corpus, select

    corpus = scan_corpus(args.corpus or DEFAULT_SRC)
    return select(corpus, None if args.all else args.books_per_category)


def tranches(livres, taille):
    """Découpe en lots d'environ `taille` livres, de poids comparables.

    On distribue en escalier (`[i::n]`) après un tri par taille décroissante,
    au lieu de couper la liste triée en tronçons. Découper une liste triée
    mettrait les cent plus gros livres dans la première tranche : 4,5 Go de
    source, ~45 Go en sortie, soit exactement le pic qu'on cherche à éviter.
    En escalier, chaque tranche reçoit un gros, un moyen, un petit — le pic
    disque devient la moyenne, et il est le même à la première tranche qu'à la
    dernière.
    """
    if not livres:
        return []
    ordonnes = sorted(livres, key=lambda b: -b.size)
    nombre = max(1, -(-len(ordonnes) // taille))  # division entière par excès
    return [ordonnes[i::nombre] for i in range(nombre)]


def publie_tranche(src, bucket, region, editions):
    """Monte une tranche, puis efface ce qui vient d'être monté.

    L'ordre compte : on ne supprime **que** les éditions dont le manifest porte
    désormais une `object_key`. Un envoi qui a échoué laisse donc son fichier en
    place, et la tranche suivante le retentera au lieu de le perdre.
    """
    import publish_minio

    code = publish_minio.main(
        ["--src", src, "--endpoint", "aws", "--region", region,
         "--bucket", bucket, "--skip-catalog"]
    )
    if code != 0:
        raise SystemExit("publication de la tranche en échec")

    livres = os.path.join(RACINE, src, "books")
    liberes = supprimes = 0
    for eid in editions:
        manifeste = os.path.join(livres, f"{eid}.manifest.json")
        if not os.path.exists(manifeste):
            continue
        with open(manifeste, encoding="utf-8") as fh:
            if not json.load(fh).get("object_key"):
                continue  # jamais monté : on garde le fichier
        for nom in (f"{eid}.sqlite", f"{eid}.sqlite.zst"):
            chemin = os.path.join(livres, nom)
            if os.path.exists(chemin):
                liberes += os.path.getsize(chemin)
                os.remove(chemin)
                supprimes += 1
    return supprimes, liberes


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


# Restes d'exécutions interrompues. `-journal`, `-wal` et `-shm` sont écrits par
# SQLite à côté de la base et survivent à un import tué ; ils ne tombaient pas
# sous la règle « édition hors catalogue » parce que leur nom commence par un
# identifiant valide, et s'accumulaient donc en silence.
TEMPORAIRES = (".part", ".tmp", "-journal", "-wal", "-shm")


def nettoie(src, editions_montees=False):
    """Retire archives, restes temporaires et fichiers d'éditions hors catalogue.

    Avec `editions_montees`, retire aussi les `.sqlite` des livres dont le
    manifest porte une `object_key` : leur contenu est au bucket, le manifest
    suffit à reconstruire le catalogue.
    """
    livres = os.path.join(src, "books")
    con = sqlite3.connect(os.path.join(src, "catalog.sqlite"))
    actives = {r[0] for r in con.execute("SELECT edition_id FROM book_releases WHERE is_active = 1")}
    con.close()

    montees = set()
    if editions_montees:
        for nom in os.listdir(livres):
            if not nom.endswith(".manifest.json"):
                continue
            try:
                with open(os.path.join(livres, nom), encoding="utf-8") as fh:
                    if json.load(fh).get("object_key"):
                        montees.add(nom[: -len(".manifest.json")])
            except (OSError, ValueError):
                continue

    supprimes = 0
    liberes = 0
    for nom in os.listdir(livres):
        chemin = os.path.join(livres, nom)
        if not os.path.isfile(chemin):
            continue
        base = nom.split(".")[0]
        jetable = (
            nom.endswith(TEMPORAIRES)
            or nom.endswith(".sqlite.zst")
            or base not in actives
            or (nom.endswith(".sqlite") and base in montees)
        )
        if jetable:
            liberes += os.path.getsize(chemin)
            os.remove(chemin)
            supprimes += 1
    print(f"nettoyage : {supprimes} fichiers, {liberes / 1048576:.1f} Mo libérés")


def monte_par_tranches(args, bucket, region):
    """Importe, monte, efface, recommence — puis reconstruit le catalogue entier.

    Le corpus complet pèse ~300 Go une fois converti, pour 18 Go de source : le
    tenir en entier sur le disque n'est pas une option. Chaque tranche ne laisse
    derrière elle que son manifest, quelques kilo-octets qui suffisent à
    reconstituer le catalogue.

    Le catalogue et le pointeur ne partent **pas** d'ici : `build_catalog`
    réécrit `catalog.sqlite` avec la seule tranche courante, et publier ce
    catalogue-là annoncerait cent livres au lieu de huit mille. Ils partent à la
    fin, une fois le catalogue complet reconstruit, par le chemin ordinaire.
    """
    from shamela.catalogdb import edition_id

    livres = selection(args)
    lots = tranches(livres, args.batch_size)
    total_source = sum(b.size for b in livres)
    print(f"{len(livres)} livres à monter en {len(lots)} tranche(s) de {args.batch_size} "
          f"({total_source / 1024 / 1024:.0f} Mo de source)")

    if args.dry_run:
        # Un essai à blanc ne monte ni n'efface rien. Le pic disque annoncé est
        # celui de la tranche la plus lourde, seul chiffre qui décide si la
        # publication tient sur ce disque.
        # Ratio mesuré sur 911 livres réels : 10,25 Go de source ont donné
        # 32,2 Go de SQLite. Le texte normalisé de `body_search` et les index
        # FTS pèsent plus que le texte lui-même.
        pic = max(sum(b.size for b in lot) for lot in lots) / 1024 / 1024
        print(f"essai à blanc — tranche la plus lourde : {pic:.0f} Mo de source, "
              f"soit ~{pic * 3.1 / 1024:.1f} Go sur le disque à son pic")
        return

    libere_total = 0
    tranches_incompletes = []
    for numero, lot in enumerate(lots, start=1):
        poids = sum(b.size for b in lot) / 1024 / 1024
        print(f"\n--- tranche {numero}/{len(lots)} : {len(lot)} livres, "
              f"{poids:.0f} Mo de source ---", flush=True)

        if importe(args, book_ids=[b.book_id for b in lot]) == 1:
            tranches_incompletes.append(numero)
        supprimes, liberes = publie_tranche(
            args.src, bucket, region, [edition_id(b.book_id) for b in lot]
        )
        libere_total += liberes
        print(f"tranche {numero} montée — {supprimes} fichiers effacés, "
              f"{liberes / 1048576:.0f} Mo rendus au disque", flush=True)

    if tranches_incompletes:
        # Un saut silencieux serait un livre absent du catalogue que personne ne
        # chercherait : le détail est dans `import-report.csv`.
        print(f"\n{len(tranches_incompletes)} tranche(s) ont sauté des livres "
              f"(sources défectueuses) : {tranches_incompletes}", file=sys.stderr)

    print(f"\ntoutes les tranches sont montées ({libere_total / 1073741824:.1f} Go rendus). "
          "Reconstruction du catalogue complet…", flush=True)
    # Sans `--compress` : plus rien n'est à compresser, tout est déjà en ligne.
    importe(args, compress=False)


# ------------------------------------------------------------------ entrée


def build_parser():
    p = argparse.ArgumentParser(description="Publie la bibliothèque vers le bucket")
    p.add_argument("--src", default="dist/shamela")
    p.add_argument("--corpus", default=None, help="corpus source (défaut : celui de l'importeur)")
    p.add_argument("--all", action="store_true", help="tout le corpus (8 589 livres)")
    p.add_argument("--batch-size", type=int, default=100, metavar="N",
                   help="livres par tranche : importer, monter, effacer, recommencer "
                        "(0 : tout d'un coup, ce qui demande ~300 Go de disque)")
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
        if args.batch_size:
            monte_par_tranches(args, bucket, region)
        else:
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
        nettoie(src, editions_montees=bool(args.batch_size))
    print(f"bibliothèque publiée : catalogue v{version} sur {base}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
