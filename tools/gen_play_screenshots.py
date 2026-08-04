"""Met les captures d'appareil au format que le Play Store accepte.

Le piège que ce script existe pour éviter : un téléphone moderne capture en
1080×2400, soit un rapport de 1:2,22. **Play refuse.** Il exige du 9:16 pour
les captures de téléphone, chaque côté entre 320 et 3840 px. Une campagne
entière peut donc se faire au propre, se téléverser, et se faire rejeter une
par une sur une propriété que personne ne regarde en la prenant.

Le recadrage n'est pas une option : rogner 480 px d'un écran de lecture
couperait soit la barre d'outils, soit la barre de navigation, c'est-à-dire
précisément ce qui montre à quoi ressemble l'application. L'écran est donc
**posé en entier** sur une planche crème au bon rapport. C'est la même couleur
que le fond de l'application, donc la bande ne se lit pas comme un cadre : elle
se lit comme la marge d'une page.

Seule la pilule de navigation gestuelle est retirée — elle appartient au
système, pas à l'application, et elle attire l'œil en bas de chaque planche.

    adb exec-out screencap -p > dist/play/captures/brut/01-accueil.png
    python tools/gen_play_screenshots.py
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image

REPO_ROOT = Path(__file__).resolve().parent.parent
BRUT = REPO_ROOT / "dist" / "play" / "captures" / "brut"
OUT_DIR = REPO_ROOT / "dist" / "play" / "captures"

# Les trois planches, une par emplacement du Console. Toutes en **9:16 exact**,
# ce que Play exige : 1350×2400 et 1728×3072 sont choisies pour que la capture
# d'origine y tienne à sa taille native. Agrandir une capture la rend floue, et
# un écran flou dans une fiche se lit comme une application mal finie.
#
#   téléphone   côtés entre  320 et 3 840 px
#   7 pouces    côtés entre  320 et 3 840 px
#   10 pouces   côtés entre 1 080 et 7 680 px  ← le plancher change, pas le plafond
PLANCHES = {
    "telephone": (1080, 1920),
    "tablette7": (1350, 2400),
    "tablette10": (1728, 3072),
}
PLANCHE = PLANCHES["telephone"]

# Le crème de l'application (`--surface` côté renderer), le même que l'icône.
FOND = (251, 249, 244)

# La pilule de navigation gestuelle, en bas. Elle est au système : la garder
# ferait croire à un élément de l'application.
PILULE = 60

# Marge de la planche, en part de sa hauteur. Assez pour que l'écran ne touche
# pas le bord — une capture collée au cadre se lit comme une capture ratée.
MARGE = 0.022


def poser(capture: Image.Image, planche_taille: tuple[int, int] = PLANCHE) -> Image.Image:
    """L'écran entier, centré sur une planche 9:16."""
    ecran = capture.convert("RGB")
    if PILULE:
        ecran = ecran.crop((0, 0, ecran.width, ecran.height - PILULE))

    largeur, hauteur = planche_taille
    marge = round(hauteur * MARGE)
    disponible = hauteur - 2 * marge
    # On tient par la hauteur : un écran de téléphone est toujours plus haut que
    # large, et c'est la hauteur qui sature la planche en premier.
    echelle = min(disponible / ecran.height, (largeur - 2 * marge) / ecran.width)
    if echelle < 1:
        ecran = ecran.resize(
            (round(ecran.width * echelle), round(ecran.height * echelle)), Image.LANCZOS
        )

    planche = Image.new("RGB", planche_taille, FOND)
    planche.paste(ecran, ((largeur - ecran.width) // 2, (hauteur - ecran.height) // 2))
    return planche


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--brut", type=Path, default=BRUT)
    parser.add_argument("--out", type=Path, default=OUT_DIR)
    parser.add_argument(
        "--format",
        choices=sorted(PLANCHES),
        default="telephone",
        help="l'emplacement du Console visé : chacun a sa planche et ses bornes",
    )
    args = parser.parse_args()
    taille = PLANCHES[args.format]
    # Résolus tout de suite : un chemin relatif passé en ligne de commande fait
    # échouer `relative_to` en fin de course, après que tout a été écrit.
    args.brut = args.brut.resolve()
    args.out = args.out.resolve()

    sources = sorted(p for p in args.brut.glob("*.png"))
    if not sources:
        raise SystemExit(
            f"aucune capture dans {args.brut.relative_to(REPO_ROOT)}\n"
            "  adb exec-out screencap -p > dist/play/captures/brut/01-accueil.png"
        )

    args.out.mkdir(parents=True, exist_ok=True)
    for source in sources:
        planche = poser(Image.open(source), taille)
        cible = args.out / source.name
        planche.save(cible, optimize=True)
        rapport = f"{planche.width}×{planche.height}"
        print(f"  {source.name:<24} {rapport}  {cible.stat().st_size / 1024:>4.0f} Ko")

    print(f"\n{len(sources)} planche(s) — {args.out.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
