"""Dérive les assets de marque de l'application depuis `logo.png`.

Le logo source est un lockup horizontal : le mot « بيت الحكمة » à gauche, le
symbole (mihrab + livre ouvert) à droite, séparés par une gouttière vide. On en
tire quatre déclinaisons plus une icône de fenêtre :

  mark.png / mark-light.png       le symbole seul, pour les emplacements carrés
                                  (rail, barre supérieure) où le nom est déjà
                                  écrit en texte à côté ;
  lockup.png / lockup-light.png   le logo entier détouré, pour les surfaces
                                  larges (à-propos, écran d'accueil vide) ;
  app-icon.png                    512×512 sur fond crème arrondi, pour la
                                  fenêtre Electron et la barre des tâches.

Les variantes `-light` remplacent l'encre vert foncé par du crème : le vert
disparaît sur un fond sombre. L'or est laissé tel quel, il tient sur les deux
fonds.

Usage (depuis la racine du dépôt) :

    python tools/gen_brand_assets.py
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw

REPO_ROOT = Path(__file__).resolve().parent.parent
SOURCE = REPO_ROOT / "logo.png"
OUT_DIR = REPO_ROOT / "beytelhikma-electron" / "src" / "renderer" / "assets" / "brand"

# Gouttière verticale du lockup : tout ce qui est à droite est le symbole.
GUTTER_X = 489

# Hauteurs d'export. Le symbole s'affiche à 34-40 px, le lockup à ~120 px de
# large : on exporte large une fois pour couvrir les écrans à forte densité.
MARK_HEIGHT = 256
LOCKUP_WIDTH = 512
ICON_SIZE = 512

# Crème de l'application (`--surface` côté renderer) et encre de substitution.
ICON_BACKGROUND = (251, 249, 244, 255)
LIGHT_INK = (242, 236, 223)


def is_green_ink(r: int, g: int, b: int) -> bool:
    """Vrai pour l'encre vert foncé du logo, faux pour les filets dorés."""
    return g >= r and g >= b and (0.299 * r + 0.587 * g + 0.114 * b) < 120


def to_light_variant(image: Image.Image) -> Image.Image:
    """Remplace l'encre verte par du crème, en gardant l'alpha et l'or."""
    out = image.copy()
    pixels = out.load()
    width, height = out.size
    for y in range(height):
        for x in range(width):
            r, g, b, a = pixels[x, y]
            if a and is_green_ink(r, g, b):
                pixels[x, y] = (*LIGHT_INK, a)
    return out


def scaled_to_height(image: Image.Image, height: int) -> Image.Image:
    width = round(image.width * height / image.height)
    return image.resize((width, height), Image.LANCZOS)


def scaled_to_width(image: Image.Image, width: int) -> Image.Image:
    height = round(image.height * width / image.width)
    return image.resize((width, height), Image.LANCZOS)


def build_app_icon(mark: Image.Image, size: int = ICON_SIZE) -> Image.Image:
    """Le symbole centré sur un carré crème aux angles arrondis."""
    icon = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    plate = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(plate).rounded_rectangle(
        (0, 0, size - 1, size - 1), radius=round(size * 0.22), fill=ICON_BACKGROUND
    )
    icon.alpha_composite(plate)

    glyph = scaled_to_height(mark, round(size * 0.62))
    icon.alpha_composite(glyph, ((size - glyph.width) // 2, (size - glyph.height) // 2))
    return icon


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=SOURCE)
    parser.add_argument("--out", type=Path, default=OUT_DIR)
    args = parser.parse_args()

    logo = Image.open(args.source).convert("RGBA")
    lockup = logo.crop(logo.getbbox())

    symbol = logo.crop((GUTTER_X, 0, logo.width, logo.height))
    box = symbol.getbbox()
    if box is None:
        raise SystemExit(f"aucun symbole à droite de x={GUTTER_X} dans {args.source}")
    mark = symbol.crop(box)

    args.out.mkdir(parents=True, exist_ok=True)
    exports = {
        "mark.png": scaled_to_height(mark, MARK_HEIGHT),
        "mark-light.png": scaled_to_height(to_light_variant(mark), MARK_HEIGHT),
        "lockup.png": scaled_to_width(lockup, LOCKUP_WIDTH),
        "lockup-light.png": scaled_to_width(to_light_variant(lockup), LOCKUP_WIDTH),
        "app-icon.png": build_app_icon(mark),
    }
    for name, image in exports.items():
        path = args.out / name
        image.save(path, optimize=True)
        print(f"{path.relative_to(REPO_ROOT)}  {image.width}×{image.height}")


if __name__ == "__main__":
    main()
