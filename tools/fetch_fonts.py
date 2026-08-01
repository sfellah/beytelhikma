"""Embarque les polices arabes du lecteur.

Télécharge les sous-ensembles *arabe* et *latin* d'Amiri, Noto Naskh Arabic et
IBM Plex Sans Arabic depuis Google Fonts, les dépose dans
`beytelhikma-electron/src/renderer/assets/fonts/` et régénère
`styles/fonts.css`. L'application est hors ligne : rien ne doit être servi
depuis le réseau à l'exécution (voir la CSP `font-src 'self'` de `index.html`).

Usage (depuis la racine du dépôt) : python tools/fetch_fonts.py
"""

import pathlib
import re
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
RENDERER = ROOT / "beytelhikma-electron" / "src" / "renderer"
FONT_DIR = RENDERER / "assets" / "fonts"

# Chrome récent : sans cet en-tête, Google Fonts renvoie des TTF non compressés.
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)
API = (
    "https://fonts.googleapis.com/css2"
    "?family=Amiri:wght@400;700"
    "&family=Noto+Naskh+Arabic:wght@400;500;700"
    "&family=IBM+Plex+Sans+Arabic:wght@400;500;600"
    # Faces latines de l'interface anglaise. Elles n'ont pas de sous-ensemble
    # arabe : seul `latin` sera retenu pour elles.
    "&family=Literata:wght@400;600"
    "&family=EB+Garamond:wght@400;600"
    "&family=Source+Serif+4:wght@400;600"
    "&display=swap"
)

# Google découpe chaque police en sous-ensembles ; seuls ces deux nous servent.
SUBSETS = {"arabic": "U+0600-06FF", "latin": "U+0000-00FF"}
SLUGS = {
    "Amiri": "amiri",
    "Noto Naskh Arabic": "noto-naskh-arabic",
    "IBM Plex Sans Arabic": "ibm-plex-sans-arabic",
    "Literata": "literata",
    "EB Garamond": "eb-garamond",
    "Source Serif 4": "source-serif-4",
}


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def main() -> None:
    FONT_DIR.mkdir(parents=True, exist_ok=True)
    css = fetch(API).decode("utf-8")

    lines = [
        "/* Polices embarquées : sous-ensembles arabe + latin de Google Fonts.",
        "   Arabes — Amiri et Noto Naskh Arabic pour lire, IBM Plex Sans Arabic",
        "   pour manœuvrer. Latines — Literata, EB Garamond et Source Serif 4,",
        "   pour l'interface en anglais.",
        "   Généré par `tools/fetch_fonts.py`, ne pas éditer. */",
        "",
    ]
    seen = set()

    for block in re.findall(r"@font-face \{(.*?)\}", css, re.S):
        family = re.search(r"font-family: '([^']+)'", block).group(1)
        weight = re.search(r"font-weight: (\d+)", block).group(1)
        url = re.search(r"src: url\((\S+?)\)", block).group(1)
        ranges = re.search(r"unicode-range: ([^;]+);", block).group(1)

        subset = next((name for name, probe in SUBSETS.items() if probe in ranges), None)
        key = (family, weight, subset)
        if subset is None or family not in SLUGS or key in seen:
            continue
        seen.add(key)

        name = f"{SLUGS[family]}-{weight}-{subset}.woff2"
        target = FONT_DIR / name
        if not target.exists():
            target.write_bytes(fetch(url))
        print(f"{name} — {target.stat().st_size // 1024} Ko")

        lines += [
            "@font-face {",
            f"  font-family: '{family}';",
            "  font-style: normal;",
            f"  font-weight: {weight};",
            "  font-display: swap;",
            f"  src: url('../assets/fonts/{name}') format('woff2');",
            f"  unicode-range: {ranges};",
            "}",
            "",
        ]

    (RENDERER / "styles" / "fonts.css").write_text("\n".join(lines), encoding="utf-8")
    print("styles/fonts.css régénéré")


if __name__ == "__main__":
    main()
