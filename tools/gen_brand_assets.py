"""Dérive les assets de marque de l'application depuis `logo.png` et `icon.svg`.

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

`icon.svg` est la **seconde** source : le symbole seul, en vectoriel. Il donne
l'écran de démarrage Android, en `VectorDrawable` — un format que le système
rend à n'importe quelle densité, ce qui évite d'exporter cinq PNG dont aucun ne
tomberait juste sur l'appareil suivant. La sortie va dans
`apps/mobile/resources/android/`, **suivie par git**, d'où
`scripts/prepare-android.mjs` la recopie dans le projet natif — lequel est
engendré, donc ignoré.

Usage (depuis la racine du dépôt) :

    python tools/gen_brand_assets.py
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

REPO_ROOT = Path(__file__).resolve().parent.parent
SOURCE = REPO_ROOT / "logo.png"
OUT_DIR = REPO_ROOT / "apps" / "desktop" / "src" / "renderer" / "assets" / "brand"

# Le symbole en vectoriel, source de l'écran de démarrage Android.
SPLASH_SOURCE = REPO_ROOT / "icon.svg"
ANDROID_RES = REPO_ROOT / "apps" / "mobile" / "resources" / "android" / "res"

# La toile que le système réserve à l'icône de démarrage, et le disque qui en
# reste visible. Les deux nombres sortent de `core-splashscreen` :
# `splashscreen_icon_size_no_background` vaut 288 dp, et le masque circulaire
# fait 410 dp de diamètre pour un anneau de 109 dp — il ne laisse donc voir que
# 410 − 2×109 = 192 dp. Android 12+ applique exactement le même rognage.
# Dessiner jusqu'au bord de la toile ferait couper le mihrab par le masque.
SPLASH_CANVAS = 288
SPLASH_KEYLINE = 192

# L'icône du lanceur. La toile adaptative fait 108 dp, dont le système ne
# garantit que les 66 dp centraux : le reste sert au débordement des animations
# et se fait rogner par le masque du constructeur, rond, carré ou en écusson
# selon l'appareil. La garde est donc **plus serrée** que celle du démarrage.
LAUNCHER_CANVAS = 108
LAUNCHER_KEYLINE = 66

# Les tailles qu'Android 7 et 8.0 réclament : ils ignorent l'icône adaptative.
LEGACY_SIZES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}

# Le symbole occupe 62 % de l'icône héritée, comme sur `app-icon.png` : celle-ci
# porte déjà sa plaque, le masque du système ne s'y applique pas, et il ne reste
# qu'à ménager une marge que l'œil lise comme une marge.
LEGACY_GLYPH = 0.62

# Durée de l'animation d'entrée. Le système la plafonne à 1 000 ms sur API 31+ :
# au-delà, il coupe l'écran de démarrage au milieu du geste.
SPLASH_DURATION = 700

# Gouttière verticale du lockup : tout ce qui est à droite est le symbole.
GUTTER_X = 489

# Hauteurs d'export. Le symbole s'affiche à 34-40 px, le lockup à ~120 px de
# large : on exporte large une fois pour couvrir les écrans à forte densité.
MARK_HEIGHT = 256
LOCKUP_WIDTH = 512
ICON_SIZE = 512
# Tailles portées par `icon.ico`. Windows pioche selon le contexte : 16 dans la
# barre des tâches, 256 dans l'explorateur en grandes icônes.
ICO_SIZES = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]

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


# ---------------------------------------------------------------------------
# `icon.svg` -> `VectorDrawable` (écran de démarrage Android)
# ---------------------------------------------------------------------------
#
# Pas de rastérisation : un `VectorDrawable` porte les mêmes courbes que le SVG
# et le système le rend à la densité de l'appareil. Le passage d'un format à
# l'autre est une réécriture de coordonnées, pas une conversion d'image.
#
# La transformation (recadrage + mise à l'échelle) est **cuite dans les
# coordonnées** plutôt que confiée à un `<group>`. Un groupe applique ses
# attributs dans un ordre imposé — échelle, rotation, translation, le tout
# autour d'un pivot — et deux lectures de la documentation donnent deux
# placements différents. Les nombres, eux, ne se discutent pas. Le seul groupe
# qui reste sert à l'animation, et ne porte qu'une échelle centrée.

PATH_RE = re.compile(r'<path\s+d="(.*?)"(.*?)/>', re.S)
FILL_RE = re.compile(r'fill="(#[0-9a-fA-F]{3,8})"')
NUMBER_RE = re.compile(r"[MCLZmclz]|-?\d*\.?\d+(?:[eE][-+]?\d+)?")

# Nombre de segments par courbe pour le calcul de la boîte. Les points de
# contrôle d'une cubique sortent de la courbe : les prendre pour la boîte
# donnerait un dessin plus petit que la place disponible.
FLATTEN_STEPS = 24


def lire_chemins(svg: str) -> list[tuple[str, str]]:
    """Rend les `(données, remplissage)` des `<path>` du SVG, dans l'ordre."""
    chemins = []
    for donnees, reste in PATH_RE.findall(svg):
        remplissage = FILL_RE.search(reste)
        chemins.append((donnees, remplissage.group(1) if remplissage else "#000000"))
    if not chemins:
        raise SystemExit("aucun <path> trouvé : le SVG attendu est un tracé, pas une image")
    return chemins


def jetons(donnees: str) -> list[tuple[str, list[float]]]:
    """Découpe `d` en `(commande, arguments)`, commandes absolues seulement."""
    brut = NUMBER_RE.findall(donnees)
    sortie: list[tuple[str, list[float]]] = []
    commande = None
    for morceau in brut:
        if morceau[0].isalpha():
            commande = morceau
            if commande in "Zz":
                sortie.append((commande, []))
            elif commande.islower():
                raise SystemExit(
                    f"commande relative « {commande} » dans le SVG : "
                    "réexportez avec des coordonnées absolues"
                )
            continue
        if commande is None:
            raise SystemExit("le SVG commence par un nombre sans commande")
        if sortie and sortie[-1][0] == commande and commande not in "Zz":
            sortie[-1][1].append(float(morceau))
        else:
            sortie.append((commande, [float(morceau)]))
    return sortie


def points_aplatis(donnees: str) -> list[tuple[float, float]]:
    """Échantillonne le tracé, courbes comprises, pour en mesurer la boîte."""
    points: list[tuple[float, float]] = []
    courant = (0.0, 0.0)
    for sous in sous_chemins(donnees):
        points += sous
    return points


def sous_chemins(donnees: str) -> list[list[tuple[float, float]]]:
    """Échantillonne le tracé en polygones, un par sous-chemin.

    La structure compte : le mihrab est un contour creux, deux boucles dont la
    seconde évide la première. À plat, en une seule liste de points, il se
    remplirait plein.
    """
    sorties: list[list[tuple[float, float]]] = []
    courant: list[tuple[float, float]] = []
    point = (0.0, 0.0)
    for commande, args in jetons(donnees):
        if commande == "M":
            if courant:
                sorties.append(courant)
            courant = []
            for i in range(0, len(args) - 1, 2):
                point = (args[i], args[i + 1])
                courant.append(point)
        elif commande == "L":
            for i in range(0, len(args) - 1, 2):
                point = (args[i], args[i + 1])
                courant.append(point)
        elif commande == "C":
            for i in range(0, len(args) - 5, 6):
                p0 = point
                c1, c2 = (args[i], args[i + 1]), (args[i + 2], args[i + 3])
                p3 = (args[i + 4], args[i + 5])
                for pas in range(1, FLATTEN_STEPS + 1):
                    t = pas / FLATTEN_STEPS
                    u = 1 - t
                    courant.append(
                        (
                            u**3 * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t**3 * p3[0],
                            u**3 * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t**3 * p3[1],
                        )
                    )
                point = p3
    if courant:
        sorties.append(courant)
    return sorties


def cercle_minimal(points: list[tuple[float, float]]) -> tuple[float, float, float]:
    """Le plus petit disque qui contient tous les points — centre et rayon.

    La ligne de garde d'Android est un **disque**, pas un carré : caler le
    dessin sur sa boîte laisse ses coins dehors, et le masque les rogne. Ici la
    pointe du mihrab et les angles du livre sortaient de 25 %.

    Méthode de Bădoiu-Clarkson : partir du centre de la boîte, puis tirer le
    centre vers le point le plus lointain, d'un pas qui décroît. Cent tours
    suffisent largement pour trois mille points, et le résultat ne dépend
    d'aucun hasard — deux exécutions donnent le même XML.
    """
    xs = [x for x, _ in points]
    ys = [y for _, y in points]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    for tour in range(1, 201):
        px, py = max(points, key=lambda p: (p[0] - cx) ** 2 + (p[1] - cy) ** 2)
        cx += (px - cx) / (tour + 1)
        cy += (py - cy) / (tour + 1)
    rayon = max(((x - cx) ** 2 + (y - cy) ** 2) ** 0.5 for x, y in points)
    return cx, cy, rayon


def nombre(valeur: float) -> str:
    """Deux décimales, sans zéros inutiles : le XML se relit."""
    return f"{valeur:.2f}".rstrip("0").rstrip(".") or "0"


def transformer(donnees: str, echelle: float, dx: float, dy: float) -> str:
    """Réécrit `d` dans le repère de la toile : x' = x·échelle + dx."""
    morceaux = []
    for commande, args in jetons(donnees):
        if commande in "Zz":
            morceaux.append("Z")
            continue
        places = []
        for i in range(0, len(args) - 1, 2):
            places.append(nombre(args[i] * echelle + dx))
            places.append(nombre(args[i + 1] * echelle + dy))
        morceaux.append(f"{commande}{','.join(places)}")
    return " ".join(morceaux)


def cadrage(chemins: list[tuple[str, str]], toile: float, garde: float):
    """L'échelle et le décalage qui inscrivent le dessin dans la ligne de garde.

    Rendus séparément parce que trois sorties s'en servent — le dessin du
    démarrage, l'avant-plan du lanceur, les icônes héritées — avec trois
    toiles et trois gardes. Écrire le calcul une fois par sortie, c'est la
    liste recopiée dont ce projet a déjà payé le prix trois fois.
    """
    points = [point for donnees, _ in chemins for point in points_aplatis(donnees)]
    cx, cy, rayon = cercle_minimal(points)
    echelle = (garde / 2) / rayon
    return echelle, toile / 2 - cx * echelle, toile / 2 - cy * echelle


def build_vector(svg: str, toile: float, garde: float, anime: bool) -> str:
    """Le symbole recadré au centre de la toile, dans la ligne de garde.

    `anime` ne décide que des **noms** : sans cible nommée, un
    `animated-vector` n'a rien à viser. L'avant-plan du lanceur n'en a pas
    besoin — un nom qu'aucune animation ne cite se lirait comme une intention.
    """
    chemins = lire_chemins(svg)
    echelle, dx, dy = cadrage(chemins, toile, garde)

    lignes = [
        '<?xml version="1.0" encoding="utf-8"?>',
        "<!-- Engendré par tools/gen_brand_assets.py depuis icon.svg — ne pas éditer. -->",
        '<vector xmlns:android="http://schemas.android.com/apk/res/android"',
        *(['    android:name="icone"'] if anime else []),
        f'    android:width="{toile:g}dp"',
        f'    android:height="{toile:g}dp"',
        f'    android:viewportWidth="{toile:g}"',
        f'    android:viewportHeight="{toile:g}">',
        "",
    ]
    if anime:
        lignes += [
            '    <group android:name="glyphe"',
            f'        android:pivotX="{toile / 2:g}"',
            f'        android:pivotY="{toile / 2:g}">',
        ]
    retrait = "        " if anime else "    "
    for donnees, remplissage in chemins:
        lignes += [
            f"{retrait}<path",
            f'{retrait}    android:fillColor="{remplissage}"',
            # `evenOdd` et non `nonZero` : le mihrab est un contour creux, tracé
            # en deux boucles de même sens. En `nonZero` il se remplirait plein.
            f'{retrait}    android:fillType="evenOdd"',
            f'{retrait}    android:pathData="{transformer(donnees, echelle, dx, dy)}" />',
        ]
    if anime:
        lignes.append("    </group>")
    lignes += ["</vector>", ""]
    return "\n".join(lignes)


def build_splash_vector(svg: str) -> str:
    return build_vector(svg, SPLASH_CANVAS, SPLASH_KEYLINE, anime=True)


def build_splash_animated() -> str:
    """L'icône qui grandit et paraît.

    Elle vit dans `drawable-v31/`, sous le **même nom** que l'alias statique de
    `drawable/`, et le thème n'en désigne qu'un : c'est le système qui choisit
    selon la version. L'autre voie — un `values-v31/styles.xml` — obligerait à
    recopier le thème entier pour en changer une ligne, et la copie dériverait.

    Pourquoi ne pas servir l'animation partout : avant Android 12,
    `core-splashscreen` pose l'icône en **fond de fenêtre**. Un fond de fenêtre
    n'est jamais animé — personne n'appelle `start()` — et rien ne garantit
    l'image qu'un `AnimatedVectorDrawable` à l'arrêt donne à dessiner. Le
    dessin fixe, lui, ne pose pas la question.
    """
    return "\n".join(
        [
            '<?xml version="1.0" encoding="utf-8"?>',
            "<!-- Engendré par tools/gen_brand_assets.py — ne pas éditer. -->",
            '<animated-vector xmlns:android="http://schemas.android.com/apk/res/android"',
            '    android:drawable="@drawable/splash_icon">',
            "",
            '    <target android:name="icone" android:animation="@animator/splash_apparait" />',
            '    <target android:name="glyphe" android:animation="@animator/splash_grandit" />',
            "</animated-vector>",
            "",
        ]
    )


# ---------------------------------------------------------------------------
# `icon.svg` -> icône du lanceur
# ---------------------------------------------------------------------------

def rasteriser(chemins: list[tuple[str, str]], taille: int, garde: float) -> Image.Image:
    """Peint le symbole en RGBA, inscrit dans la ligne de garde.

    Il n'y a pas de bibliothèque de rendu SVG ici, et en installer une pour
    deux tracés remplis coûterait plus cher que ces vingt lignes. Le tracé est
    aplati en polygones et rempli en **ou exclusif** — c'est la règle
    `even-odd`, celle que porte le SVG source, et la seule qui garde le mihrab
    creux. `ImageDraw` ne connaît pas cette règle : il faut la composer.

    Rendu à quatre fois la taille demandée puis réduit : les tracés sont fins,
    et sans ce suréchantillonnage les filets dorés se hachent à 48 px.
    """
    facteur = 4
    grand = taille * facteur
    echelle, dx, dy = cadrage(chemins, taille, garde)
    image = Image.new("RGBA", (grand, grand), (0, 0, 0, 0))

    for donnees, remplissage in chemins:
        masque = Image.new("1", (grand, grand), 0)
        for sous in sous_chemins(donnees):
            if len(sous) < 3:
                continue
            couche = Image.new("1", (grand, grand), 0)
            ImageDraw.Draw(couche).polygon(
                [((x * echelle + dx) * facteur, (y * echelle + dy) * facteur) for x, y in sous],
                fill=1,
            )
            masque = ImageChops.logical_xor(masque, couche)
        teinte = Image.new("RGBA", (grand, grand), remplissage)
        image.paste(teinte, (0, 0), masque)

    return image.resize((taille, taille), Image.LANCZOS)


def plaque(taille: int, ronde: bool) -> Image.Image:
    """Le fond crème des icônes héritées : disque, ou carré aux angles arrondis."""
    fond = Image.new("RGBA", (taille, taille), (0, 0, 0, 0))
    dessin = ImageDraw.Draw(fond)
    if ronde:
        dessin.ellipse((0, 0, taille - 1, taille - 1), fill=ICON_BACKGROUND)
    else:
        dessin.rounded_rectangle(
            (0, 0, taille - 1, taille - 1), radius=round(taille * 0.22), fill=ICON_BACKGROUND
        )
    return fond


def build_launcher(source: Path, res_dir: Path) -> list[Path]:
    """L'avant-plan adaptatif, et les PNG que les vieilles versions réclament."""
    svg = source.read_text(encoding="utf-8")
    chemins = lire_chemins(svg)
    ecrits: list[Path] = []

    avant_plan = res_dir / "drawable" / "ic_launcher_foreground.xml"
    avant_plan.parent.mkdir(parents=True, exist_ok=True)
    avant_plan.write_text(
        build_vector(svg, LAUNCHER_CANVAS, LAUNCHER_KEYLINE, anime=False),
        encoding="utf-8",
        newline="\n",
    )
    ecrits.append(avant_plan)

    # Android 7 et 8.0 ignorent l'icône adaptative : sans ces PNG, ils
    # retomberaient sur celle que Capacitor a posée. `minSdkVersion` vaut 24.
    for densite, taille in LEGACY_SIZES.items():
        dossier = res_dir / f"mipmap-{densite}"
        dossier.mkdir(parents=True, exist_ok=True)
        glyphe = rasteriser(chemins, taille, taille * LEGACY_GLYPH)
        for nom, ronde in (("ic_launcher.png", False), ("ic_launcher_round.png", True)):
            icone = plaque(taille, ronde)
            icone.alpha_composite(glyphe)
            chemin = dossier / nom
            icone.save(chemin, optimize=True)
            ecrits.append(chemin)

    return ecrits


def write_splash(source: Path, res_dir: Path) -> list[Path]:
    svg = source.read_text(encoding="utf-8")
    sorties = {
        res_dir / "drawable" / "splash_icon.xml": build_splash_vector(svg),
        res_dir / "drawable-v31" / "splash_reveal.xml": build_splash_animated(),
    }
    for chemin, contenu in sorties.items():
        chemin.parent.mkdir(parents=True, exist_ok=True)
        chemin.write_text(contenu, encoding="utf-8", newline="\n")
    return list(sorties)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=SOURCE)
    parser.add_argument("--out", type=Path, default=OUT_DIR)
    parser.add_argument("--splash-source", type=Path, default=SPLASH_SOURCE)
    parser.add_argument("--android-res", type=Path, default=ANDROID_RES)
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

    # L'icône Windows sort du même dessin que `app-icon.png` : la dériver ici
    # plutôt que de la convertir à la main est ce qui empêche l'icône de
    # l'installeur de dater d'un logo que plus personne n'utilise.
    ico_dir = REPO_ROOT / "apps" / "desktop" / "build"
    ico_dir.mkdir(parents=True, exist_ok=True)
    ico = ico_dir / "icon.ico"
    exports["app-icon.png"].save(ico, sizes=ICO_SIZES)
    print(f"{ico.relative_to(REPO_ROOT)}  {len(ICO_SIZES)} tailles")

    # L'écran de démarrage Android sort du vectoriel, pas du raster : le
    # symbole y est rendu à 288 dp, soit 1 152 px sur un écran xxxhdpi — deux
    # fois ce que `logo.png` contient. Un PNG dérivé serait flou là où il se
    # regarde le plus longtemps.
    if not args.splash_source.exists():
        raise SystemExit(
            f"{args.splash_source} est absent : l'écran de démarrage Android en dérive.\n"
            "Fournissez le symbole seul en SVG, chemins à coordonnées absolues."
        )
    for chemin in write_splash(args.splash_source, args.android_res):
        print(f"{chemin.relative_to(REPO_ROOT)}")

    ecrites = build_launcher(args.splash_source, args.android_res)
    print(
        f"{ecrites[0].relative_to(REPO_ROOT)}  + "
        f"{len(ecrites) - 1} PNG hérités ({', '.join(map(str, LEGACY_SIZES.values()))} px)"
    )


if __name__ == "__main__":
    main()
