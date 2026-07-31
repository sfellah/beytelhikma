#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Génère les bases SQLite d'exemple (catalog + book) conformes à DATAMODEL.md.

Sortie : beytelhikma/assets/sample/
    catalog.sqlite
    books/<edition_id>.sqlite

Le schema et les fonctions de normalisation viennent de `tools/_common.py`,
partages avec l'importeur Shamela (`tools/import_shamela.py`).

Usage : python tools/gen_sample_data.py
"""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3

from _common import (
    BOOK_SCHEMA,
    CATALOG_SCHEMA,
    SCHEMA_VERSION,
    normalize_ar,
    sha256_file,
    sha256_text,
    strip_html,
)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "beytelhikma", "assets", "sample")
BOOKS_DIR = os.path.join(OUT_DIR, "books")

# Le portage Electron embarque sa propre copie du jeu d'exemple : ses tests la
# lisent sans passer par le client Flutter. Elle était recopiée à la main, donc
# elle dérivait — un changement de schéma laissait les deux jeux désaccordés et
# la suite Electron échouait loin de sa cause. Le générateur écrit les deux.
MIRROR_DIRS = [os.path.join(ROOT, "beytelhikma-electron", "assets", "sample")]

CONTENT_VERSION = 1


# ---------------------------------------------------------------- jeu de données

CATEGORIES = [
    (1, "التفسير"),
    (2, "الحديث"),
    (3, "الفقه"),
    (4, "اللغة"),
    (5, "التاريخ"),
    (6, "الأدب"),
    (7, "التصوف"),
]

AUTHORS = [
    {
        "author_id": "aut-ibn-khaldun",
        "full_name_ar": "عبد الرحمن بن خلدون",
        "short_name_ar": "ابن خلدون",
        "death_year_hijri": 808,
        "bio_ar": "أبو زيد عبد الرحمن بن محمد بن خلدون الحضرمي، مؤرخ ومؤسس علم العمران البشري.",
    },
    {
        "author_id": "aut-malik",
        "full_name_ar": "مالك بن أنس الأصبحي",
        "short_name_ar": "الإمام مالك",
        "death_year_hijri": 179,
        "bio_ar": "إمام دار الهجرة، صاحب المذهب المالكي ومؤلف الموطأ.",
    },
    {
        "author_id": "aut-bukhari",
        "full_name_ar": "محمد بن إسماعيل البخاري",
        "short_name_ar": "الإمام البخاري",
        "death_year_hijri": 256,
        "bio_ar": "أمير المؤمنين في الحديث، صاحب الجامع الصحيح.",
    },
    {
        "author_id": "aut-ghazali",
        "full_name_ar": "أبو حامد محمد الغزالي",
        "short_name_ar": "الغزالي",
        "death_year_hijri": 505,
        "bio_ar": "حجة الإسلام، فقيه وأصولي ومتكلم، صاحب إحياء علوم الدين.",
    },
    {
        "author_id": "aut-mutanabbi",
        "full_name_ar": "أبو الطيب المتنبي",
        "short_name_ar": "المتنبي",
        "death_year_hijri": 354,
        "bio_ar": "أحمد بن الحسين الكندي، من أعظم شعراء العربية.",
    },
]

BOOKS = [
    {
        "work_id": "wrk-muqaddima",
        "edition_id": "ed-muqaddima-01",
        "source_book_id": 10001,
        "shamela_id": 10001,
        "title_ar": "مقدمة ابن خلدون",
        "subtitle_ar": "كتاب العبر وديوان المبتدأ والخبر",
        "category_id": 5,
        "author_id": "aut-ibn-khaldun",
        "publisher_ar": "دار الفكر",
        "edition_label_ar": "الطبعة الأولى",
        "publication_year": 2001,
        "bibliography_text": "المقدمة لعبد الرحمن بن خلدون، تحقيق خليل شحادة، دار الفكر، بيروت.",
        "volumes": [(1, "الجزء الأول")],
        "toc": [
            (1, None, 1, "ديباجة الكتاب", 1),
            (2, None, 2, "الفصل الأول: في العمران البشري على الجملة", 1),
            (3, 2, 3, "في أن الاجتماع الإنساني ضروري", 2),
            (4, None, 4, "الفصل الثاني: في العمران البدوي", 1),
        ],
        "pages": [
            {
                "part": 1,
                "printed": 5,
                "html": (
                    "<h2>ديباجة الكتاب</h2>"
                    "<p>الحمد لله الذي له العزة والجبروت، وبيده الملك والملكوت، وله الأسماء الحسنى والنعوت.</p>"
                    "<p>أما بعد، فإن فنَّ التاريخ من الفنون التي تتداولها الأمم والأجيال، وتُشدُّ إليه الركائب "
                    "والرحال، وتسمو إلى معرفته السُّوقة والأغفال، وتتنافس فيه الملوك والأقيال.<sup class=\"fn\">1</sup></p>"
                ),
                "footnotes": "(1) الأقيال: جمع قَيْل، وهو الملك من ملوك حِمْيَر.",
            },
            {
                "part": 1,
                "printed": 6,
                "html": (
                    "<p>اعلم أن فنَّ التاريخ فنٌّ عزيز المذهب، جمُّ الفوائد، شريف الغاية، إذ هو يوقفنا على "
                    "أحوال الماضين من الأمم في أخلاقهم، والأنبياء في سِيَرهم، والملوك في دولهم وسياستهم.</p>"
                    "<p>حتى تتمَّ فائدة الاقتداء في ذلك لمن يرومه في أحوال الدين والدنيا.</p>"
                ),
                "footnotes": None,
            },
            {
                "part": 1,
                "printed": 7,
                "html": (
                    "<h2>الفصل الأول: في العمران البشري على الجملة</h2>"
                    "<p>الاجتماع الإنساني ضروري، ويعبِّر الحكماء عن هذا بقولهم: الإنسان مدنيٌّ بالطبع، "
                    "أي لا بدَّ له من الاجتماع الذي هو المدنية في اصطلاحهم، وهو معنى العمران.</p>"
                ),
                "footnotes": None,
            },
            {
                "part": 1,
                "printed": 8,
                "html": (
                    "<p>وبيانه أن الله سبحانه خلق الإنسان وركَّبه على صورة لا يصحُّ حياتها وبقاؤها إلا بالغذاء، "
                    "وهداه إلى التماسه بفطرته، وبما ركَّب فيه من القدرة على تحصيله.</p>"
                    "<p>غير أن قدرة الواحد من البشر قاصرةٌ عن تحصيل حاجته من ذلك الغذاء، "
                    "غير موفيةٍ له بمادة حياته منه.<sup class=\"fn\">1</sup></p>"
                ),
                "footnotes": "(1) أي أن الفرد وحده لا يكفي نفسه، فيحتاج إلى التعاون.",
            },
            {
                "part": 1,
                "printed": 9,
                "html": (
                    "<h2>الفصل الثاني: في العمران البدوي</h2>"
                    "<p>اعلم أن اختلاف الأجيال في أحوالهم إنما هو باختلاف نِحلتهم من المعاش، "
                    "فإن اجتماعهم إنما هو للتعاون على تحصيله والابتداء بما هو ضروري منه.</p>"
                ),
                "footnotes": None,
            },
        ],
    },
    {
        "work_id": "wrk-muwatta",
        "edition_id": "ed-muwatta-01",
        "source_book_id": 10002,
        "shamela_id": 10002,
        "title_ar": "الموطأ",
        "subtitle_ar": "رواية يحيى الليثي",
        "category_id": 2,
        "author_id": "aut-malik",
        "publisher_ar": "دار إحياء التراث العربي",
        "edition_label_ar": "طبعة محققة",
        "publication_year": 1985,
        "bibliography_text": "موطأ الإمام مالك، رواية يحيى بن يحيى الليثي، تحقيق محمد فؤاد عبد الباقي.",
        "volumes": [(1, "الجزء الأول")],
        "toc": [
            (1, None, 1, "كتاب وقوت الصلاة", 1),
            (2, 1, 2, "باب وقوت الصلاة", 2),
            (3, None, 3, "كتاب الزكاة", 1),
        ],
        "pages": [
            {
                "part": 1,
                "printed": 3,
                "html": (
                    "<h2>كتاب وقوت الصلاة</h2>"
                    "<p>حدثني يحيى، عن مالك، عن ابن شهاب: أن عمر بن عبد العزيز أخَّر الصلاة يوماً، "
                    "فدخل عليه عروة بن الزبير فأخبره أن المغيرة بن شعبة أخَّر الصلاة يوماً وهو بالكوفة.</p>"
                ),
                "footnotes": None,
            },
            {
                "part": 1,
                "printed": 4,
                "html": (
                    "<p>فدخل عليه أبو مسعود الأنصاري فقال: ما هذا يا مغيرة؟ أليس قد علمتَ أن جبريل نزل فصلَّى، "
                    "فصلَّى رسول الله ﷺ، ثم صلَّى فصلَّى رسول الله ﷺ.<sup class=\"fn\">1</sup></p>"
                ),
                "footnotes": "(1) الحديث متفق عليه، وأخرجه البخاري في مواقيت الصلاة.",
            },
            {
                "part": 1,
                "printed": 5,
                "html": (
                    "<h2>كتاب الزكاة</h2>"
                    "<p>حدثني يحيى، عن مالك، عن عمرو بن يحيى المازني، عن أبيه، أنه قال: "
                    "سمعت أبا سعيد الخدري يقول: ليس فيما دون خمسة أوسُقٍ من التمر صدقة.</p>"
                ),
                "footnotes": None,
            },
            {
                "part": 1,
                "printed": 6,
                "html": (
                    "<p>والوَسْق ستون صاعاً، والصاع أربعة أمداد بمدِّ النبي ﷺ. "
                    "وهذا بيانٌ لمقدار النصاب الذي تجب فيه الزكاة من الثمار والحبوب.</p>"
                ),
                "footnotes": None,
            },
        ],
    },
    {
        "work_id": "wrk-bukhari",
        "edition_id": "ed-bukhari-01",
        "source_book_id": 10003,
        "shamela_id": 10003,
        "title_ar": "صحيح البخاري",
        "subtitle_ar": "الجامع المسند الصحيح المختصر",
        "category_id": 2,
        "author_id": "aut-bukhari",
        "publisher_ar": "دار طوق النجاة",
        "edition_label_ar": "الطبعة السلطانية",
        "publication_year": 2001,
        "bibliography_text": "الجامع الصحيح، تحقيق محمد زهير بن ناصر الناصر، دار طوق النجاة.",
        "volumes": [(1, "الجزء الأول"), (2, "الجزء الثاني")],
        "toc": [
            (1, None, 1, "كتاب بدء الوحي", 1),
            (2, 1, 1, "باب كيف كان بدء الوحي", 2),
            (3, None, 3, "كتاب الإيمان", 1),
            (4, None, 4, "كتاب العلم", 1),
        ],
        "pages": [
            {
                "part": 1,
                "printed": 1,
                "html": (
                    "<h2>كتاب بدء الوحي</h2>"
                    "<p>حدثنا الحميدي عبد الله بن الزبير قال: حدثنا سفيان قال: حدثنا يحيى بن سعيد الأنصاري قال: "
                    "أخبرني محمد بن إبراهيم التيمي، أنه سمع علقمة بن وقاص الليثي يقول: "
                    "سمعت عمر بن الخطاب رضي الله عنه على المنبر قال:</p>"
                ),
                "footnotes": None,
            },
            {
                "part": 1,
                "printed": 2,
                "html": (
                    "<p>سمعت رسول الله ﷺ يقول: «إنما الأعمال بالنيات، وإنما لكل امرئٍ ما نوى، "
                    "فمن كانت هجرته إلى دنيا يصيبها أو إلى امرأةٍ ينكحها فهجرته إلى ما هاجر إليه».<sup class=\"fn\">1</sup></p>"
                ),
                "footnotes": "(1) هذا الحديث أحد الأحاديث التي عليها مدار الإسلام.",
            },
            {
                "part": 1,
                "printed": 3,
                "html": (
                    "<h2>كتاب الإيمان</h2>"
                    "<p>حدثنا عبيد الله بن موسى قال: أخبرنا حنظلة بن أبي سفيان، عن عكرمة بن خالد، عن ابن عمر "
                    "رضي الله عنهما قال: قال رسول الله ﷺ: «بُني الإسلام على خمس».</p>"
                ),
                "footnotes": None,
            },
            {
                "part": 2,
                "printed": 21,
                "html": (
                    "<h2>كتاب العلم</h2>"
                    "<p>باب فضل العلم. قال الله تعالى: ﴿يرفع الله الذين آمنوا منكم والذين أوتوا العلم درجات﴾.</p>"
                    "<p>حدثنا محمد بن سلام قال: أخبرنا وكيع، عن الأعمش، عن أبي وائل، عن عبد الله بن مسعود.</p>"
                ),
                "footnotes": None,
            },
            {
                "part": 2,
                "printed": 22,
                "html": (
                    "<p>قال: قال النبي ﷺ: «لا حسد إلا في اثنتين: رجلٌ آتاه الله مالاً فسُلِّط على هلكته في الحق، "
                    "ورجلٌ آتاه الله حكمةً فهو يقضي بها ويعلِّمها».</p>"
                ),
                "footnotes": None,
            },
        ],
    },
    {
        "work_id": "wrk-ihya",
        "edition_id": "ed-ihya-01",
        "source_book_id": 10004,
        "shamela_id": 10004,
        "title_ar": "إحياء علوم الدين",
        "subtitle_ar": None,
        "category_id": 7,
        "author_id": "aut-ghazali",
        "publisher_ar": "دار المعرفة",
        "edition_label_ar": None,
        "publication_year": None,
        "bibliography_text": "إحياء علوم الدين لأبي حامد الغزالي، دار المعرفة، بيروت.",
        "volumes": [(1, "الجزء الأول")],
        "toc": [
            (1, None, 1, "كتاب العلم", 1),
            (2, 1, 2, "بيان فضيلة العلم", 2),
            (3, None, 4, "كتاب قواعد العقائد", 1),
        ],
        "pages": [
            {
                "part": 1,
                "printed": 9,
                "html": (
                    "<h2>كتاب العلم</h2>"
                    "<p>الحمد لله أولاً، والصلاة على رسوله ثانياً. أما بعد، فإن طلب العلم فريضةٌ على كل مسلم، "
                    "وهو أشرف ما تُصرف فيه الأعمار.</p>"
                ),
                "footnotes": None,
            },
            {
                "part": 1,
                "printed": 10,
                "html": (
                    "<h2>بيان فضيلة العلم</h2>"
                    "<p>قال الله تعالى: ﴿شهد الله أنه لا إله إلا هو والملائكة وأولو العلم قائماً بالقسط﴾، "
                    "فانظر كيف بدأ سبحانه بنفسه، وثنَّى بالملائكة، وثلَّث بأهل العلم.</p>"
                ),
                "footnotes": None,
            },
            {
                "part": 1,
                "printed": 11,
                "html": (
                    "<p>وناهيك بهذا شرفاً وفضلاً وجلالاً ونُبلاً. والعلم بغير عملٍ جنون، والعمل بغير علمٍ لا يكون.<sup class=\"fn\">1</sup></p>"
                ),
                "footnotes": "(1) نُقل هذا القول عن أبي الدرداء رضي الله عنه.",
            },
            {
                "part": 1,
                "printed": 12,
                "html": (
                    "<h2>كتاب قواعد العقائد</h2>"
                    "<p>اعلم أن أصل الإيمان هو التصديق بالقلب، وأن كمال ذلك بالعمل بالجوارح، "
                    "وأن معرفة الله تعالى هي رأس هذه القواعد وأساسها.</p>"
                ),
                "footnotes": None,
            },
        ],
    },
    {
        "work_id": "wrk-diwan-mutanabbi",
        "edition_id": "ed-mutanabbi-01",
        "source_book_id": 10005,
        "shamela_id": 10005,
        "title_ar": "ديوان المتنبي",
        "subtitle_ar": None,
        "category_id": 6,
        "author_id": "aut-mutanabbi",
        "publisher_ar": "دار بيروت",
        "edition_label_ar": None,
        "publication_year": 1983,
        "bibliography_text": "ديوان أبي الطيب المتنبي، دار بيروت للطباعة والنشر.",
        "volumes": [(1, "الديوان")],
        "toc": [
            (1, None, 1, "قافية الميم", 1),
            (2, None, 2, "قافية اللام", 1),
        ],
        "pages": [
            {
                "part": 1,
                "printed": 15,
                "html": (
                    "<h2>قافية الميم</h2>"
                    "<p class=\"verse\">على قدر أهل العزم تأتي العزائمُ &nbsp;&nbsp;&nbsp; وتأتي على قدر الكرام المكارمُ</p>"
                    "<p class=\"verse\">وتعظم في عين الصغير صغارُها &nbsp;&nbsp;&nbsp; وتصغر في عين العظيم العظائمُ</p>"
                ),
                "footnotes": None,
            },
            {
                "part": 1,
                "printed": 16,
                "html": (
                    "<h2>قافية اللام</h2>"
                    "<p class=\"verse\">الخيل والليل والبيداء تعرفني &nbsp;&nbsp;&nbsp; والسيف والرمح والقرطاس والقلمُ</p>"
                    "<p class=\"verse\">صحبتُ في الفلوات الوحش منفرداً &nbsp;&nbsp;&nbsp; حتى تعجَّب مني القور والأكمُ<sup class=\"fn\">1</sup></p>"
                ),
                "footnotes": "(1) القور: جمع قارة، وهي الجبل الصغير. الأكم: جمع أكمة.",
            },
            {
                "part": 1,
                "printed": 17,
                "html": (
                    "<p class=\"verse\">وما الدهر إلا من رواة قصائدي &nbsp;&nbsp;&nbsp; إذا قلتُ شعراً أصبح الدهر منشدا</p>"
                    "<p class=\"verse\">فسار به من لا يسير مشمِّراً &nbsp;&nbsp;&nbsp; وغنَّى به من لا يغنِّي مغرِّدا</p>"
                ),
                "footnotes": None,
            },
        ],
    },
]


# ---------------------------------------------------------------- book.sqlite



def build_book(book: dict) -> dict:
    """Écrit books/<edition_id>.sqlite et renvoie les stats pour le catalogue."""
    path = os.path.join(BOOKS_DIR, f"{book['edition_id']}.sqlite")
    if os.path.exists(path):
        os.remove(path)

    con = sqlite3.connect(path)
    con.executescript(BOOK_SCHEMA)

    volume_ids = {}
    for idx, (part_number, label) in enumerate(book["volumes"], start=1):
        con.execute(
            "INSERT INTO volumes (volume_id, part_number, label_ar, sequence_num) VALUES (?,?,?,?)",
            (idx, part_number, label, idx),
        )
        volume_ids[part_number] = idx

    page_ids_by_seq = {}
    hasher = hashlib.sha256()
    for seq, page in enumerate(book["pages"], start=1):
        html = page["html"]
        plain = strip_html(html)
        search = normalize_ar(plain)
        footnotes = page.get("footnotes")
        page_id = seq
        page_ids_by_seq[seq] = page_id
        hasher.update(html.encode("utf-8"))
        con.execute(
            """INSERT INTO pages (page_id, shamela_page_id, volume_id, printed_page_num,
                                  sequence_num, body_html, body_plain, body_search,
                                  footnotes, hints, content_hash)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (
                page_id,
                book["source_book_id"] * 1000 + seq,
                volume_ids[page["part"]],
                page["printed"],
                seq,
                html,
                plain,
                search,
                footnotes,
                None,
                sha256_text(html),
            ),
        )
        # `pages_fts` est contentless (`content=''`) : FTS5 ne stocke PAS les
        # colonnes UNINDEXED, donc `SELECT page_id ... WHERE ... MATCH` renvoie
        # NULL. Le seul lien exploitable vers `pages` est le rowid — il doit
        # donc valoir explicitement page_id.
        con.execute(
            "INSERT INTO pages_fts (rowid, page_id, body_search, footnotes_search) VALUES (?,?,?,?)",
            (page_id, page_id, search, normalize_ar(footnotes) if footnotes else ""),
        )

    for part_number, volume_id in volume_ids.items():
        con.execute(
            """UPDATE volumes SET
                   first_page_id = (SELECT MIN(page_id) FROM pages WHERE volume_id = ?),
                   last_page_id  = (SELECT MAX(page_id) FROM pages WHERE volume_id = ?)
               WHERE volume_id = ?""",
            (volume_id, volume_id, volume_id),
        )

    for toc_id, parent_id, page_seq, title, level in book["toc"]:
        con.execute(
            """INSERT INTO toc (toc_id, parent_toc_id, page_id, title_text,
                                title_normalized, level, sequence_num, shamela_title_id)
               VALUES (?,?,?,?,?,?,?,?)""",
            (
                toc_id,
                parent_id,
                page_ids_by_seq[page_seq],
                title,
                normalize_ar(title),
                level,
                toc_id,
                None,
            ),
        )

    content_hash = hasher.hexdigest()
    con.execute(
        """INSERT INTO book_info (edition_id, source_book_id, shamela_id, title_ar,
                                  schema_version, content_version, page_count, toc_count,
                                  created_at, content_hash)
           VALUES (?,?,?,?,?,?,?,?,?,?)""",
        (
            book["edition_id"],
            book["source_book_id"],
            book["shamela_id"],
            book["title_ar"],
            SCHEMA_VERSION,
            CONTENT_VERSION,
            len(book["pages"]),
            len(book["toc"]),
            "2026-01-01T00:00:00Z",
            content_hash,
        ),
    )
    con.commit()
    con.close()

    manifest = {
        "edition_id": book["edition_id"],
        "title_ar": book["title_ar"],
        "schema_version": SCHEMA_VERSION,
        "content_version": CONTENT_VERSION,
        "page_count": len(book["pages"]),
        "toc_count": len(book["toc"]),
        "content_hash": content_hash,
        "sha256": sha256_file(path),
        "size": os.path.getsize(path),
    }
    with open(os.path.join(BOOKS_DIR, f"{book['edition_id']}.manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=2)
    return manifest


# ---------------------------------------------------------------- catalog.sqlite



def build_catalog(manifests: dict) -> None:
    path = os.path.join(OUT_DIR, "catalog.sqlite")
    if os.path.exists(path):
        os.remove(path)

    con = sqlite3.connect(path)
    con.executescript(CATALOG_SCHEMA)

    con.execute(
        "INSERT INTO catalog_info VALUES (?,?,?,?)",
        (1, SCHEMA_VERSION, "2026-01-01T00:00:00Z", len(BOOKS)),
    )
    for order, (cat_id, label) in enumerate(CATEGORIES, start=1):
        con.execute(
            "INSERT INTO categories (category_id, label_ar, parent_id, sort_order) VALUES (?,?,?,?)",
            (cat_id, label, None, order),
        )
    for author in AUTHORS:
        con.execute(
            """INSERT INTO authors (author_id, full_name_ar, short_name_ar,
                                    death_year_hijri, bio_ar, portrait_url)
               VALUES (?,?,?,?,?,?)""",
            (
                author["author_id"],
                author["full_name_ar"],
                author["short_name_ar"],
                author["death_year_hijri"],
                author["bio_ar"],
                None,
            ),
        )

    authors_by_id = {a["author_id"]: a for a in AUTHORS}

    for book in BOOKS:
        manifest = manifests[book["edition_id"]]
        con.execute(
            "INSERT INTO works (work_id, title_ar, category_id) VALUES (?,?,?)",
            (book["work_id"], book["title_ar"], book["category_id"]),
        )
        volume_count = len(book["volumes"])
        con.execute(
            """INSERT INTO editions (edition_id, work_id, source, source_book_id, shamela_id,
                                     title_ar, subtitle_ar, category_id, book_type, book_type_label,
                                     bibliography_text, publisher_ar, edition_label_ar,
                                     publication_year, printed, is_hidden, volume_count,
                                     has_multi_part, language, cover_url)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                book["edition_id"],
                book["work_id"],
                "shamela4",
                book["source_book_id"],
                book["shamela_id"],
                book["title_ar"],
                book.get("subtitle_ar"),
                book["category_id"],
                1,
                "كتاب",
                book["bibliography_text"],
                book.get("publisher_ar"),
                book.get("edition_label_ar"),
                book.get("publication_year"),
                1,
                0,
                volume_count,
                1 if volume_count > 1 else 0,
                "ar",
                None,
            ),
        )
        con.execute(
            "INSERT INTO edition_authors (edition_id, author_id, role, position) VALUES (?,?,?,?)",
            (book["edition_id"], book["author_id"], "author", 0),
        )
        con.execute(
            """INSERT INTO book_releases (release_id, edition_id, schema_version, content_version,
                                          source_version, object_key, compressed_size,
                                          uncompressed_size, sha256, page_count, toc_count,
                                          fts_version, min_app_version, published_at, is_active)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                f"rel-{book['edition_id']}-v1",
                book["edition_id"],
                SCHEMA_VERSION,
                CONTENT_VERSION,
                "shamela4-2025",
                f"asset://sample/books/{book['edition_id']}.sqlite",
                manifest["size"],
                manifest["size"],
                manifest["sha256"],
                manifest["page_count"],
                manifest["toc_count"],
                1,
                "1.0.0",
                "2026-01-01T00:00:00Z",
                1,
            ),
        )
        author = authors_by_id[book["author_id"]]
        con.execute(
            """INSERT INTO catalog_fts (edition_id, title_ar, title_normalized,
                                        author_names, bibliography_text)
               VALUES (?,?,?,?,?)""",
            (
                book["edition_id"],
                book["title_ar"],
                normalize_ar(book["title_ar"]),
                normalize_ar(author["full_name_ar"]),
                normalize_ar(book["bibliography_text"]),
            ),
        )

    # quelques relations d'exemple
    con.execute(
        "INSERT INTO edition_relations VALUES (?,?,?)",
        ("ed-bukhari-01", "ed-muwatta-01", "related_to"),
    )
    con.commit()
    con.close()


def mirror() -> None:
    """Recopie le jeu produit dans les miroirs, à l'identique.

    `shutil.copytree(dirs_exist_ok=True)` écrase mais ne supprime pas : un livre
    retiré du jeu resterait dans le miroir. On repart donc d'un dossier vide.
    """
    import shutil

    for target in MIRROR_DIRS:
        parent = os.path.dirname(target)
        if not os.path.isdir(parent):
            continue  # implémentation absente de cette copie de travail
        shutil.rmtree(target, ignore_errors=True)
        shutil.copytree(OUT_DIR, target)
        print(f"miroir  -> {os.path.join(target, 'catalog.sqlite')}")


def main() -> None:
    os.makedirs(BOOKS_DIR, exist_ok=True)
    manifests = {}
    for book in BOOKS:
        manifests[book["edition_id"]] = build_book(book)
        print(f"book   {book['edition_id']:20s} {manifests[book['edition_id']]['page_count']} pages")
    build_catalog(manifests)
    print(f"catalog {len(BOOKS)} éditions -> {os.path.join(OUT_DIR, 'catalog.sqlite')}")
    mirror()


if __name__ == "__main__":
    main()
