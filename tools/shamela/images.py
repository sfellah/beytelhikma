"""Extraction des images encodées en base64.

363 balises `<img>` réparties sur 88 livres, en `image/png` et `image/jpg`.
Elles sont responsables de lignes JSONL de plusieurs centaines de kilo-octets.

Le client n'affiche pas d'images (`ALLOWED_TAGS` côté Electron ne connaît pas
`img`). On les sort du texte, on les catalogue
dans `assets`, et on laisse un marqueur `data-asset` qui préserve le lien
page <-> image — de quoi reconstruire une table `page_assets` plus tard sans
relire les 19 Go du corpus.
"""

from __future__ import annotations

import base64
import hashlib
import io
import os
import re

try:  # dimensions optionnelles
    from PIL import Image

    Image.MAX_IMAGE_PIXELS = 64_000_000  # garde anti « decompression bomb »
except ImportError:  # pragma: no cover - dépend de l'environnement
    Image = None

DATA_URI_RE = re.compile(r"^data:(image/[a-zA-Z0-9.+-]+);base64,(.*)$", re.S)
MIME_EXT = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/bmp": "bmp",
    "image/tiff": "tif",
}


class ImageCollector:
    """Collecte, déduplique et catalogue les images d'un seul livre."""

    def __init__(self, extract_dir: str | None = None, inline_limit: int = 0):
        self.assets: list[dict] = []
        self.by_digest: dict[str, dict] = {}
        self.extract_dir = extract_dir
        self.inline_limit = inline_limit  # > 0 : garder la data URI sous ce seuil

    def register(self, src: str) -> str:
        """Renvoie le fragment HTML à insérer à la place du `<img>`."""
        m = DATA_URI_RE.match(src.strip())
        if not m:
            return ""

        mime = m.group(1).lower()
        if mime == "image/jpg":  # pas un type MIME valide
            mime = "image/jpeg"

        try:
            blob = base64.b64decode(m.group(2), validate=False)
        except Exception:
            return ""
        if not blob:
            return ""

        digest = hashlib.sha256(blob).hexdigest()
        asset = self.by_digest.get(digest)
        if asset is None:
            asset = {
                "asset_id": len(self.assets) + 1,
                "file_path": f"assets/{digest[:16]}.{MIME_EXT.get(mime, 'bin')}",
                "mime_type": mime,
                "sha256": digest,
                "byte_size": len(blob),
                **self._dimensions(blob),
            }
            self.assets.append(asset)
            self.by_digest[digest] = asset
            if self.extract_dir:
                self._write(asset, blob)

        if 0 < self.inline_limit and len(blob) <= self.inline_limit:
            payload = base64.b64encode(blob).decode("ascii")
            return f'<img src="data:{mime};base64,{payload}">'
        return f'<span class="figure" data-asset="{digest[:8]}"></span>'

    @staticmethod
    def _dimensions(blob: bytes) -> dict:
        if Image is None:
            return {"width": None, "height": None}
        try:
            with Image.open(io.BytesIO(blob)) as im:  # lecture d'en-tête seule
                width, height = im.size
            return {"width": width, "height": height}
        except Exception:
            return {"width": None, "height": None}

    def _write(self, asset: dict, blob: bytes) -> None:
        # adressage par contenu : déduplication à l'échelle du corpus entier
        digest = asset["sha256"]
        target = os.path.join(self.extract_dir, digest[:2], os.path.basename(asset["file_path"]))
        if os.path.exists(target):
            return
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "wb") as fh:
            fh.write(blob)

    def rows(self) -> list[tuple]:
        """Lignes prêtes pour `INSERT INTO assets` (sans `byte_size`, absent du schéma)."""
        return [
            (a["asset_id"], a["file_path"], a["mime_type"], a["sha256"], a["width"], a["height"])
            for a in self.assets
        ]
