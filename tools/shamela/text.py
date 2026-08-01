"""Conversion du `body` source vers les trois représentations de texte.

Le corpus contient un HTML minimal et incohérent : les attributs sont tantôt en
guillemets simples, tantôt doubles, tantôt absents. La parade est structurelle —
on ne recopie jamais un attribut de la source, on ne réémet que des attributs
fabriqués ici, toujours en guillemets doubles.

Recensement réel (60 livres, 41 619 pages) : span 34 934, td 284, tr 102, th 58,
br 25, table 18, img 18, plus des liens `<a href="inr://man-N">`.
"""

from __future__ import annotations

import re

from _common import decode_entities, normalize_ar, strip_html

TAG_RE = re.compile(r"<\s*(/?)([a-zA-Z][\w-]*)([^>]*?)/?\s*>")
ATTR_RE = re.compile(r"([\w-]+)\s*=\s*(?:\"([^\"]*)\"|'([^']*)'|([^\s>]+))")
TABLE_RE = re.compile(r"<\s*table", re.I)
ROW_SPLIT_RE = re.compile(r"<\s*tr[^>]*>", re.I)
CELL_SPLIT_RE = re.compile(r"<\s*t[dh][^>]*>", re.I)

# Marqueurs internes, remplacés avant sortie. Des caractères de contrôle qui
# n'apparaissent jamais dans le corpus.
_TITLE_START = "\x00<\x00"
_TITLE_END = "\x00>\x00"

CELL_SEPARATOR = " ǀ "


def parse_attrs(raw: str) -> dict[str, str]:
    """Attributs d'une balise, quel que soit le style de guillemets."""
    out: dict[str, str] = {}
    for m in ATTR_RE.finditer(raw):
        out[m.group(1).lower()] = m.group(2) or m.group(3) or m.group(4) or ""
    return out


def escape(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def flatten_table(segment: str) -> str:
    """`<table>` -> un `<p>` par ligne, cellules jointes.

    Aucun des deux clients ne gère les tables : sans séparateur explicite ils
    colleraient les cellules bout à bout. La balise fermante n'est pas garantie
    dans le corpus, on s'arrête donc à la fin du segment.
    """
    rows = []
    for row in ROW_SPLIT_RE.split(segment)[1:]:
        cells = [strip_html(c).strip() for c in CELL_SPLIT_RE.split(row)[1:]]
        cells = [c for c in cells if c]
        if cells:
            rows.append("<p>" + escape(CELL_SEPARATOR.join(cells)) + "</p>")
    return "".join(rows)


def convert_segment(segment: str, images) -> tuple[str, dict[str, int]]:
    """Un segment source (un paragraphe) -> un bloc HTML."""
    stats = {"tables_flattened": 0, "links_unwrapped": 0, "images_stripped": 0}

    if TABLE_RE.search(segment):
        stats["tables_flattened"] = 1
        return flatten_table(segment), stats

    out: list[str] = []
    title_depth = 0
    saw_title = False
    title_id: str | None = None
    pos = 0

    for m in TAG_RE.finditer(segment):
        out.append(escape(segment[pos:m.start()]))
        pos = m.end()
        closing = m.group(1) == "/"
        name = m.group(2).lower()
        attrs = parse_attrs(m.group(3))

        if name == "span":
            if closing:
                if title_depth:
                    title_depth -= 1
                    if title_depth == 0:
                        out.append(_TITLE_END)
            elif attrs.get("data-type") == "title":
                title_depth += 1
                saw_title = True
                title_id = attrs.get("id") or title_id
                out.append(_TITLE_START)
            elif title_depth:
                title_depth += 1
        elif name in ("br", "hr") and not closing:
            out.append(f"<{name}>")
        elif name == "img" and not closing:
            marker = images.register(attrs.get("src", ""))
            if marker:
                stats["images_stripped"] = 1
                out.append(marker)
        elif name == "a" and not closing:
            # `inr://man-3654` pointe vers un narrateur : non résolvable sans le
            # pack narrateurs. On garde le texte, on jette le lien mort.
            stats["links_unwrapped"] = 1
        # toute autre balise : supprimée, texte conservé (comme les deux clients)

    out.append(escape(segment[pos:]))
    html = "".join(out)

    whole_title = (
        saw_title
        and html.startswith(_TITLE_START)
        and html.rstrip().endswith(_TITLE_END)
        and html.count(_TITLE_START) == 1
    )

    if whole_title:
        inner = html.replace(_TITLE_START, "", 1).replace(_TITLE_END, "", 1).strip()
        anchor = f' id="{escape(title_id)}"' if title_id else ""
        return (f'<h2 class="title"{anchor}>{inner}</h2>' if inner else ""), stats

    html = html.replace(_TITLE_START, '<span class="title">').replace(_TITLE_END, "</span>")
    return (f"<p>{html}</p>" if html.strip() else ""), stats


def convert_body(body: str, images) -> tuple[str, dict[str, int]]:
    """`body` source -> `body_html`. Les paragraphes sont séparés par des `\\r`."""
    blocks: list[str] = []
    totals = {"tables_flattened": 0, "links_unwrapped": 0, "images_stripped": 0}
    for segment in body.split("\r"):
        if not segment.strip():
            continue
        block, stats = convert_segment(segment, images)
        for key, value in stats.items():
            totals[key] += value
        if block:
            blocks.append(block)
    return "".join(blocks), totals


def to_plain(body_html: str) -> str:
    return decode_entities(strip_html(body_html))


def to_search(body_plain: str) -> str:
    """Dérivé du texte plat, jamais du HTML : aucune balise dans l'index."""
    return normalize_ar(body_plain)


def clean_footnotes(raw: str | None) -> str | None:
    """Notes -> texte brut avec `\\n`. Jamais de HTML.

    Le client affiche les notes dans un nœud texte (`reader.js`) : y mettre
    du HTML afficherait des balises à l'écran.

    Ordre critique : `strip_html` supprime les `\\r`, il faut donc les convertir
    en `\\n` AVANT de l'appeler, sinon toutes les notes se retrouvent collées.
    """
    if not raw or not raw.strip():
        return None
    text = decode_entities(strip_html(raw.replace("\r", "\n")))
    text = "\n".join(part.strip() for part in text.split("\n") if part.strip())
    return text or None
