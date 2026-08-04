"""Assemble la fiche du Google Play Store dans `dist/play/`.

Pourquoi un générateur plutôt qu'un dossier tenu à la main : une fiche de
magasin ne se relit pas. Elle se remplit une fois, se corrige deux ans plus
tard, et personne ne remarque entre-temps que le titre déborde de deux
caractères ou que l'icône a gardé son canal alpha. Ici les bornes de Google
sont **des assertions** — le script échoue avant d'écrire, et il échoue en
nommant le champ fautif.

La sortie va dans `dist/`, ignoré par git : ce sont des artefacts, comme la
graine de catalogue ou `site/dist/`. La source suivie est ce fichier.

Les deux images ne sont pas composées ici : elles sortent de
`tools/gen_brand_assets.py`, du même `logo.png` que toute la marque. Ce script
ne fait que les rassembler, et refuse de finir si elles manquent.

Usage (depuis la racine du dépôt) :

    python tools/gen_brand_assets.py     # une fois, si les images manquent
    python tools/gen_play_listing.py
"""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
PLAY_ASSETS = REPO_ROOT / "apps" / "mobile" / "resources" / "play"
OUT_DIR = REPO_ROOT / "dist" / "play"

# Les bornes du Play Console, en **caractères** et non en octets : un caractère
# arabe en pèse deux en UTF-8, et compter des octets amputerait le titre arabe
# de moitié pour rien.
LIMITES = {"titre": 30, "courte": 80, "longue": 4000}

# Le nom du paquet, figé au premier envoi. Écrit ici pour que la fiche et le
# projet natif se contredisent visiblement s'ils divergent.
APP_ID = "org.beytelhikma.app"
PRIVACY_URL = "https://beytelhikma.com/ar/privacy/"

TITRES = {
    "ar": "بيت الحكمة | مكتبة كتب إسلامية",
    "en": "Beyt El Hikma: Arabic Library",
    "fr": "Beyt El Hikma : livres arabes",
}

COURTES = {
    "ar": "مكتبة عربية تعمل دون اتصال: ٨٥٠٠ كتاب في التفسير والحديث والفقه واللغة.",
    "en": "8,500 Arabic heritage books. Offline reading, no account, no ads, no tracking.",
    "fr": "8 500 livres arabes et islamiques, hors ligne. Sans compte ni publicité.",
}

LONGUES = {
    "ar": """\
مكتبة عربية كاملة في جهازك: أكثر من ٨٥٠٠ كتاب من التراث العربي والإسلامي،
تقرؤها دون اتصال. لا حساب، ولا إعلانات، ولا تتبُّع، ولا اشتراك.

التفسير، والحديث، والفقه، والعقيدة، والسيرة، والتاريخ، واللغة، والأدب،
والمنطق، والطبّ — موزّعة على نحو أربعين فنًّا، من القرن الأول الهجري إلى اليوم.

◆ اقرأ دون اتصال
الفهرس مثبَّت مع التطبيق: التصفّح والبحث في المكتبة لا يحتاجان إلى إنترنت.
تُنزِّل الكتاب مرّة واحدة فيصير لك، ويبقى على جهازك.

◆ بحث يفهم العربية
بحث يتجاوز التشكيل وصور الهمزة، في عناوين الكتب وأسماء المؤلّفين وفي متون
الكتب المنزَّلة. تجد الكلمة كما كتبتَها، لا كما شُكِّلت.

◆ وضعان للقراءة
صفحة مطبوعة تُقلَّب باللمس، أو سياق متّصل يُمرَّر بلا انقطاع. ثلاث سمات —
ورق، وأبيض، وليل — وتكبير النصّ بالقرص بالإصبعين.

◆ تعليقات مثبَّتة على النصّ
تظليل بأربع درجات، وملاحظات، وعلامات مرجعية، مثبَّتة على النصّ نفسه لا على
رقم الصفحة. يعود التطبيق بك إلى موضع وقوفك تمامًا.

◆ مكتوب للعربية أصالةً
واجهة من اليمين إلى اليسار، لا واجهة مقلوبة. خطوط نسخ مضمَّنة: أميري، ونوتو
نسخ العربي، وIBM Plex Sans Arabic. الواجهة متاحة بالعربية والإنجليزية.

◆ تصفّح بالفنّ وبالعصر
استكشف المكتبة بالفنّ، أو بالقرن الهجري، أو بالمؤلّف. مناهج دراسية جاهزة،
وأمّهات الكتب في متناول اليد.

المدوّنة مصدرها المكتبة الشاملة، محوَّلة إلى قواعد بيانات مفهرسة قابلة للبحث.

التطبيق حرّ ومفتوح المصدر برخصة AGPL-3.0. لا يجمع عنك شيئًا، ولا يطلب حسابًا،
ولا يعرض إعلانًا. الموقع وسياسة الخصوصية: beytelhikma.com
""",
    "en": """\
A complete Arabic library on your device: over 8,500 books of the Arabic and
Islamic heritage, readable offline. No account, no ads, no tracking, no
subscription.

Quran commentary, hadith, jurisprudence, creed, biography, history, language,
literature, logic and medicine — across some forty disciplines, from the 1st
century AH to the present day.

◆ Read offline
The catalogue ships with the app: browsing and searching the library need no
connection. Download a book once and it stays on your device.

◆ Search that understands Arabic
Search ignores diacritics and hamza variants, across book titles, author names
and the full text of downloaded books.

◆ Two reading modes
Printed page turned by touch, or continuous scroll. Three moods — paper, white,
night — and pinch to resize the text.

◆ Annotations anchored to the text
Four highlight tints, notes and bookmarks, anchored to the text itself rather
than a page number. Reopen a book exactly where you left off.

◆ Built for Arabic
A native right-to-left interface, not a mirrored one. Embedded naskh typefaces:
Amiri, Noto Naskh Arabic, IBM Plex Sans Arabic. Interface in Arabic and English.

◆ Browse by discipline and era
Explore by discipline, by Hijri century, or by author. Ready-made curricula and
the reference works of the tradition, one tap away.

The corpus comes from the Shamela Library, converted to indexed, searchable
databases.

Free and open source under AGPL-3.0. It collects nothing, asks for no account,
shows no ad. Website and privacy policy: beytelhikma.com
""",
    "fr": """\
Une bibliothèque arabe complète sur votre appareil : plus de 8 500 livres du
patrimoine arabe et islamique, à lire hors ligne. Sans compte, sans publicité,
sans suivi, sans abonnement.

Exégèse du Coran, hadith, jurisprudence, croyance, biographie du Prophète,
histoire, langue, littérature, logique et médecine — répartis sur une
quarantaine de disciplines, du 1ᵉʳ siècle de l'hégire à aujourd'hui.

◆ Lire hors ligne
Le catalogue est installé avec l'application : parcourir et chercher dans la
bibliothèque ne demandent aucune connexion. Vous téléchargez un livre une fois,
il reste sur votre appareil.

◆ Une recherche qui comprend l'arabe
Elle ignore les diacritiques et les variantes de hamza, et porte sur les titres,
les noms d'auteurs et le texte intégral des livres téléchargés.

◆ Deux façons de lire
Page imprimée que l'on tourne au doigt, ou fil continu que l'on fait défiler.
Trois ambiances — parchemin, blanc, nuit — et le texte s'agrandit au pincement.

◆ Des annotations ancrées sur le texte
Quatre teintes de surlignage, des notes et des signets, ancrés sur le texte
lui-même et non sur un numéro de page. Vous rouvrez un livre exactement là où
vous l'aviez laissé.

◆ Écrit pour l'arabe
Une interface de droite à gauche native, pas une interface retournée. Polices
naskh embarquées : Amiri, Noto Naskh Arabic, IBM Plex Sans Arabic. L'interface
est disponible en arabe et en anglais.

◆ Parcourir par discipline et par époque
Explorez par discipline, par siècle de l'hégire ou par auteur. Des cursus tout
prêts, et les ouvrages de référence de la tradition à portée de doigt.

Le corpus provient de la Bibliothèque Shamela, converti en bases de données
indexées et cherchables.

Libre et open source sous licence AGPL-3.0. L'application ne collecte rien, ne
demande aucun compte et n'affiche aucune publicité. Site et politique de
confidentialité : beytelhikma.com
""",
}

# Les six captures, dans l'ordre du carrousel. Les trois premières sont celles
# qui paraissent dans les résultats de recherche, sans que personne n'ouvre la
# fiche : elles doivent porter la promesse, pas montrer un écran au hasard.
CAPTURES = [
    ("01-accueil", "/", "٨٥٠٠ كتاب في جيبك"),
    ("02-explore", "/explore, 8 568 résultats", "تصفّح بالفنّ والقرن"),
    ("03-lecteur", "un livre ouvert, page posée", "اقرأ دون اتصال"),
    ("04-nuit", "le même écran, ambiance nuit", "سمة ليلية مريحة"),
    ("05-sommaire", "le panneau du sommaire", "فهرس المحتويات"),
]

IMAGES = {
    "icon-512.png": "Icône de la fiche — 512×512, RGB opaque, ≤ 1 Mo",
    "feature-1024x500.png": "Feature graphic — 1024×500, RGB opaque, ≤ 15 Mo",
}


def verifier(champ: str, valeur: str, limite: int) -> int:
    """Le nombre de caractères, ou l'échec nommé."""
    longueur = len(valeur)
    if longueur > limite:
        raise SystemExit(
            f"{champ} : {longueur} caractères pour {limite} permis — "
            f"le Play Console refuserait le champ.\n  « {valeur[:60]}… »"
        )
    return longueur


def readme(mesures: dict[str, int]) -> str:
    lignes = [
        "# Fiche Google Play — Beyt El Hikma",
        "",
        "Artefact engendré par `python tools/gen_play_listing.py`. Ne pas éditer ici :",
        "la source est le script, et ce dossier est refait à chaque exécution.",
        "",
        f"- **Nom du paquet** : `{APP_ID}` — figé au premier envoi",
        "- **Catégorie** : Books & Reference",
        f"- **Politique de confidentialité** : {PRIVACY_URL}",
        "",
        "## Fiche du magasin",
        "",
        "| Champ | Fichier | Caractères |",
        "| --- | --- | --- |",
    ]
    for langue in TITRES:
        for champ, gabarit in (
            ("Titre", "titre-{}.txt"),
            ("Description courte", "description-courte-{}.txt"),
            ("Description longue", "description-longue-{}.txt"),
        ):
            fichier = gabarit.format(langue)
            lignes.append(f"| {champ} ({langue}) | `{fichier}` | {mesures[fichier]} |")

    lignes += [
        "",
        "Langue par défaut : **العربية (ar)**. C'est l'audience, pas la langue du compte —",
        "le titre arabe devient le titre canonique et les magasins MENA s'indexent dessus.",
        "Play n'a qu'une locale arabe : pas de variante par pays.",
        "",
        "## Images",
        "",
    ]
    for nom, description in IMAGES.items():
        lignes.append(f"- `{nom}` — {description}")

    lignes += [
        "",
        "Aucune transparence dans les deux : Play applique son propre masque et aplatit",
        "l'alpha sur du noir. Elles sortent de `tools/gen_brand_assets.py`.",
        "",
        "## Captures",
        "",
        "2 à 8, ratio **9:16** (1080×1920), chaque côté entre 320 et 3840 px.",
        "Une capture brute de téléphone fait 1080×2400 : ratio 1:2,22, **refusé par Play**.",
        "",
        "Trois emplacements, trois dossiers, tous en 9:16 exact :",
        "",
        "| Emplacement | Dossier | Planche | Bornes de Play |",
        "| --- | --- | --- | --- |",
        "| Téléphone | `captures/` | 1080×1920 | côtés 320 – 3 840 |",
        "| Tablette 7\" | `tablette7/` | 1350×2400 | côtés 320 – 3 840 |",
        "| Tablette 10\" | `tablette10/` | 1728×3072 | côtés **1 080** – 7 680 |",
        "",
        "Chaque dossier porte ses originaux dans `brut/`. Les planches sont choisies",
        "pour que la capture y tienne à sa **taille native** : agrandir la rendrait",
        "floue, et un écran flou dans une fiche se lit comme une application mal finie.",
        "Rien de tout cela n'est effacé par `gen_play_listing.py`.",
        "",
        "Les captures de tablette viennent du **même émulateur redimensionné**",
        "(`adb shell wm size 1200x1920 && wm density 240`, puis 1600×2560 / 320), donc",
        "d'un vrai rendu Android et non d'une transposition du bureau.",
        "",
        "```bash",
        "adb exec-out screencap -p > dist/play/captures/brut/01-accueil.png",
        "python tools/gen_play_screenshots.py",
        "python tools/gen_play_screenshots.py --format tablette7 \\",
        "    --brut dist/play/tablette7/brut --out dist/play/tablette7",
        "```",
        "",
        "| Ordre | Écran | Légende (à incruster, pas encore posée) |",
        "| --- | --- | --- |",
    ]
    for nom, ecran, legende in CAPTURES:
        lignes.append(f"| `{nom}` | {ecran} | {legende} |")

    lignes += [
        "",
        "Les trois premières paraissent dans les résultats de recherche, sans que",
        "personne n'ouvre la fiche. La légende est **incrustée dans l'image** : la fiche",
        "ne l'affiche pas autrement, et une capture d'écran arabe ne se déchiffre pas à",
        "la taille d'une vignette.",
        "",
        "**Vidéo** : laisser vide. Une vidéo médiocre remplace la première capture dans",
        "le carrousel, et c'est la capture qui convertit.",
        "",
        "## Contenu de l'application — les réponses arrêtées",
        "",
        "| Question | Réponse |",
        "| --- | --- |",
        "| Contenu classant **dans le paquet** | Non — l'APK ne porte que le catalogue |",
        "| Partage entre utilisateurs | Non |",
        "| Contenu en ligne | **Oui** — les livres viennent du bucket |",
        "| Violence | **Oui** — texte seul, non graphique, contexte historique |",
        "| Sexualité | Non — cadre juridique et médical, exclu par la question |",
        "| Langage offensant | Non |",
        "| Substances contrôlées | Non — classification et interdit, jamais l'usage |",
        "| Produits à âge restreint | Non |",
        "| Localisation partagée | Non |",
        "| Achat de biens numériques | Non |",
        "| Récompenses, crypto, NFT | Non |",
        "| Navigateur ou moteur de recherche | Non |",
        "| Produit d'actualité ou éducatif | **Oui → éducatif**, jamais actualité |",
        "",
        "Classement attendu : Teen / 12+ selon les régions.",
        "",
        "### Public cible",
        "",
        "13-15, 16-17, 18 et plus. **Jamais moins de 13** : ça bascule dans la politique",
        "Families, incompatible avec un catalogue de fiqh classique.",
        "Attrait pour les enfants : non. Designed for Families : décliner.",
        "",
        "### Sécurité des données",
        "",
        "Aucune donnée collectée. Pas d'identifiant publicitaire. La politique de",
        "confidentialité mentionne la journalisation IP du bucket et ses 30 jours.",
        "",
        "### Tags (5 max, liste fermée du Console)",
        "",
        "Religious Texts · Ebook Readers · Libraries · Reference · Literature",
        "",
        "Ils ne pèsent pas sur le classement en recherche, seulement sur le voisinage.",
        "",
        "## Ce qui manque encore",
        "",
        "1. **AAB** — `release-android.mjs` produit un APK ; Play veut un bundle.",
        "2. **Clé d'upload** — `keytool -genkeypair`, sauvegardée hors du dépôt.",
        "3. **Alias `contact@beytelhikma.com`** — publié par la politique, à créer.",
        "4. **Captures** — six, au format ci-dessus.",
        "",
        "Le chemin critique reste le test fermé : 12 testeurs, 14 jours continus, pour un",
        "compte personnel. Rien ne le raccourcit — le lancer dès qu'un AAB existe.",
        "",
    ]
    return "\n".join(lignes)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=OUT_DIR)
    parser.add_argument("--assets", type=Path, default=PLAY_ASSETS)
    args = parser.parse_args()

    # Les bornes d'abord : rien n'est écrit tant qu'un champ déborde. Un dossier
    # à moitié juste se téléverse sans qu'on relise.
    mesures: dict[str, int] = {}
    for langue, titre in TITRES.items():
        mesures[f"titre-{langue}.txt"] = verifier(f"titre ({langue})", titre, LIMITES["titre"])
    for langue, courte in COURTES.items():
        mesures[f"description-courte-{langue}.txt"] = verifier(
            f"description courte ({langue})", courte, LIMITES["courte"]
        )
    for langue, longue in LONGUES.items():
        mesures[f"description-longue-{langue}.txt"] = verifier(
            f"description longue ({langue})", longue, LIMITES["longue"]
        )

    manquantes = [nom for nom in IMAGES if not (args.assets / nom).exists()]
    if manquantes:
        raise SystemExit(
            f"image(s) absente(s) dans {args.assets.relative_to(REPO_ROOT)} : "
            f"{', '.join(manquantes)}\n  lancez `python tools/gen_brand_assets.py`"
        )

    # Ce que le script engendre est **refait** ; ce qu'il n'engendre pas est
    # laissé intact. La nuance a son défaut : `captures/` ne sort pas d'ici mais
    # d'un appareil, et `captures/brut/` porte les originaux, qu'une campagne
    # entière a coûté à produire. Un `rmtree` du dossier de sortie les emportait.
    # On efface donc les seuls fichiers dont ce script est l'auteur.
    captures = args.out / "captures"
    captures.mkdir(parents=True, exist_ok=True)
    for chemin in args.out.glob("*"):
        if chemin.is_file():
            chemin.unlink()

    ecrit = []
    for langue, titre in TITRES.items():
        ecrit.append((f"titre-{langue}.txt", titre + "\n"))
    for langue, courte in COURTES.items():
        ecrit.append((f"description-courte-{langue}.txt", courte + "\n"))
    for langue, longue in LONGUES.items():
        ecrit.append((f"description-longue-{langue}.txt", longue))

    for nom, contenu in ecrit:
        (args.out / nom).write_text(contenu, encoding="utf-8", newline="\n")
        print(f"  {nom:<32} {mesures[nom]:>4} caractères")

    for nom in IMAGES:
        shutil.copy2(args.assets / nom, args.out / nom)
        taille = (args.out / nom).stat().st_size / 1024
        print(f"  {nom:<32} {taille:>4.0f} Ko")

    planches = sorted(captures.glob("*.png"))
    print(f"  captures/{'':<23} {len(planches)} planche(s) conservée(s)")

    (args.out / "README.md").write_text(readme(mesures), encoding="utf-8", newline="\n")
    print(f"  README.md                        la liste des champs du Console")
    print(f"\n{args.out.relative_to(REPO_ROOT)} — prêt à téléverser")


if __name__ == "__main__":
    main()
